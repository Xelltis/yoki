// Worker の入口まわり: 道が無いとき・エラーのとき・CSRF の細かい場合・お知らせのページ・cron の入口・送られた JSON が壊れているとき
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { Hono } from 'hono';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { app, handleError } from '../../src/worker/app';
import worker from '../../src/worker/index';
import { badRequest } from '../../src/worker/lib/errors';
import { noticePage } from '../../src/worker/routes/html';
import { call, loginAs, makeGroup, ORIGIN, setupGroup } from './helpers';

afterEach(() => vi.restoreAllMocks());

describe('道が無いとき・エラーのとき', () => {
  test('/api の道が無ければ JSON で 404', async () => {
    const res = await call('/api/nothing');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: '見つかりません。' });
  });

  test('ページの道で AppError なら、その文と状態をお知らせのページで返す', async () => {
    const t = new Hono().get('/x', () => { throw badRequest('入力が読めません。'); });
    t.onError(handleError);
    const res = await t.request('/x');
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('入力が読めません。');
  });

  test('思わぬエラーは log に出し、中身を見せずに 500 を返す（/api は JSON、ほかはページ）', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = new Hono().get('/api/x', () => { throw new Error('DB の中身'); }).get('/x', () => { throw new Error('DB の中身'); });
    t.onError(handleError);
    const api = await t.request('/api/x');
    expect(api.status).toBe(500);
    expect(await api.json()).toEqual({ error: 'サーバーでエラーが起きました。少し待ってから、もう一度お試しください。' });
    const page = await t.request('/x');
    expect(page.status).toBe(500);
    const html = await page.text();
    expect(html).toContain('サーバーでエラーが起きました');
    expect(html).not.toContain('DB の中身');
    expect(logged).toHaveBeenCalledTimes(2);
  });
});

describe('CSRF の細かい場合', () => {
  const post = (headers: Record<string, string>) => call('/api/groups', { method: 'POST', headers, body: '{}' });

  test('Sec-Fetch-Site が別のサイトなら断る。自分か、手で開いた（none）なら通す', async () => {
    expect((await post({ 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' })).status).toBe(403);
    // 通ったあとはログインしていないので AUTH: になる
    expect((await post({ 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' })).status).toBe(401);
    expect((await post({ 'Sec-Fetch-Site': 'none', 'Content-Type': 'application/json' })).status).toBe(401);
  });

  test('/api に Content-Type が無ければ断る', async () => {
    // 本文を付けると fetch が text/plain を足すので、本文なしで送る
    expect((await call('/api/groups', { method: 'POST', headers: { Origin: ORIGIN } })).status).toBe(415);
  });
});

test('お知らせのページは、文字を HTML として読まないように逃がす', () => {
  const html = noticePage('<b>題</b>', 'A & "B"', { href: "/?q='x'", label: '<戻る>' });
  expect(html).toContain('&lt;b&gt;題&lt;/b&gt;');
  expect(html).toContain('A &amp; &quot;B&quot;');
  expect(html).toContain('href="/?q=&#39;x&#39;"');
  expect(html).toContain('&lt;戻る&gt;');
});

test('cron の入口から見回りが回り、様子が残る', async () => {
  const ctx = createExecutionContext();
  const scheduledTime = Date.parse('2026-10-10T20:00:00+09:00');
  await worker.scheduled({ scheduledTime, cron: '*/5 * * * *', noRetry: () => {} }, env, ctx);
  await waitOnExecutionContext(ctx);
  const rec = JSON.parse((await env.DB.prepare("SELECT value FROM meta WHERE key = 'patrol'").first<string>('value'))!);
  expect(rec).toMatchObject({ at: new Date(scheduledTime).toISOString(), ok: true });
});

describe('送られた JSON が壊れているか null のときは、空の入力として扱う', () => {
  const raw = (path: string, body: string, sid: string) =>
    call(path, { method: 'POST', sid, headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body });

  test('画面からの呼び出し', async () => {
    const { admin } = await setupGroup();
    for (const body of ['{', 'null']) {
      const res = await raw('/api/g/grp/saveConsoleSettings', body, admin);
      expect(res.status).toBe(200);
      expect((await res.json<{ message: string }>()).message).toBe('変更はありません。');
    }
  });

  test('運営者の API', async () => {
    const op = await loginAs({ id: '400000000000000098', name: '運営' }, []);
    await loginAs({ id: '300', name: 'ふつうの人' }, []);
    for (const body of ['{', 'null']) {
      // banned が無いので「戻す」になる
      const res = await raw('/api/admin/users/300/ban', body, op);
      expect(res.status).toBe(200);
      expect((await res.json<{ message: string }>()).message).toContain('締め出しから戻しました');
    }
  });
});

describe('Discord の設定が無いとき（手元で開発用ログインだけを使う）', () => {
  const noDiscord = { ...env, DISCORD_CLIENT_ID: '' };

  test('/auth/login は、設定が無いことをページで知らせる', async () => {
    const res = await app.request(ORIGIN + '/auth/login', {}, noDiscord);
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('DISCORD_CLIENT_ID が設定されていません');
  });

  test('ログインしていない人がグループを開いたら、Discord ではなく入口へ戻り先つきで送る', async () => {
    await makeGroup('p1', 'gp');
    const res = await app.request(ORIGIN + '/g/p1/', {}, noDiscord);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/?return_to=%2Fg%2Fp1%2F');
  });
});
