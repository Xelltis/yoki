// Workerの入口まわり: 道が無いとき・エラーのとき・CSRFの細かい場合・お知らせのページ・cronの入口・送られたJSONが壊れているとき
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { Hono } from 'hono';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { app, handleError } from '../../src/worker/app';
import worker from '../../src/worker/index';
import { badRequest } from '../../src/worker/lib/errors';
import { noticePage } from '../../src/worker/routes/html';
import { call, loginAs, makeGroup, ORIGIN, SID, setupGroup } from './helpers';

afterEach(() => vi.restoreAllMocks());

describe('道が無いとき・エラーのとき', () => {
  test('/apiの道が無ければJSONで404', async () => {
    const res = await call('/api/nothing');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: '見つかりません。' });
  });

  test('ページの道でAppErrorなら、その文と状態をお知らせのページで返す', async () => {
    const t = new Hono().get('/x', () => { throw badRequest('入力が読めません。'); });
    t.onError(handleError);
    const res = await t.request('/x');
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('入力が読めません。');
  });

  test('思わぬエラーはlogに出し、中身を見せずに500を返す（/apiはJSON、ほかはページ）', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = new Hono().get('/api/x', () => { throw new Error('DBの中身'); }).get('/x', () => { throw new Error('DBの中身'); });
    t.onError(handleError);
    const api = await t.request('/api/x');
    expect(api.status).toBe(500);
    expect(await api.json()).toEqual({ error: 'サーバーでエラーが起きました。少し待ってから、もう一度お試しください。' });
    const page = await t.request('/x');
    expect(page.status).toBe(500);
    const html = await page.text();
    expect(html).toContain('サーバーでエラーが起きました');
    expect(html).not.toContain('DBの中身');
    expect(logged).toHaveBeenCalledTimes(2);
  });
});

describe('CSRFの細かい場合', () => {
  const post = (headers: Record<string, string>) => call('/api/groups', { method: 'POST', headers, body: '{}' });

  test('Sec-Fetch-Siteが別のサイトなら断る。自分か、手で開いた（none）なら通す', async () => {
    expect((await post({ 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' })).status).toBe(403);
    // 通ったあとはログインしていないのでAUTH: になる
    expect((await post({ 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' })).status).toBe(401);
    expect((await post({ 'Sec-Fetch-Site': 'none', 'Content-Type': 'application/json' })).status).toBe(401);
  });

  test('/apiにContent-Typeが無ければ断る', async () => {
    // 本文を付けるとfetchがtext/plainを足すので、本文なしで送る
    expect((await call('/api/groups', { method: 'POST', headers: { Origin: ORIGIN } })).status).toBe(415);
  });
});

test('お知らせのページは、文字をHTMLとして読まないように逃がす', () => {
  const html = noticePage('<b>題</b>', 'A & "B"', { href: "/?q='x'", label: '<戻る>' });
  expect(html).toContain('&lt;b&gt;題&lt;/b&gt;');
  expect(html).toContain('A &amp; &quot;B&quot;');
  expect(html).toContain('href="/?q=&#39;x&#39;"');
  expect(html).toContain('&lt;戻る&gt;');
});

test('cronの入口から見回りが回り、様子が残る', async () => {
  const ctx = createExecutionContext();
  const scheduledTime = Date.parse('2026-10-10T20:00:00+09:00');
  await worker.scheduled({ scheduledTime, cron: '*/5 * * * *', noRetry: () => {} }, env, ctx);
  await waitOnExecutionContext(ctx);
  const rec = JSON.parse((await env.DB.prepare("SELECT value FROM meta WHERE key = 'patrol'").first<string>('value'))!);
  expect(rec).toMatchObject({ at: new Date(scheduledTime).toISOString(), ok: true });
});

describe('送られたJSONが壊れているかnullのときは、空の入力として扱う', () => {
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

  test('運営者のAPI', async () => {
    const op = await loginAs({ id: '400000000000000098', name: '運営' }, []);
    await loginAs({ id: '300', name: 'ふつうの人' }, []);
    for (const body of ['{', 'null']) {
      // bannedが無いので「戻す」になる
      const res = await raw('/api/admin/users/300/ban', body, op);
      expect(res.status).toBe(200);
      expect((await res.json<{ message: string }>()).message).toContain('締め出しから戻しました');
    }
  });
});

describe('Discordの設定が無いとき（手元で開発用ログインだけを使う）', () => {
  const noDiscord = { ...env, DISCORD_CLIENT_ID: '' };

  test('/auth/loginは、設定が無いことをページで知らせる', async () => {
    const res = await app.request(ORIGIN + '/auth/login', {}, noDiscord);
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('DISCORD_CLIENT_IDが設定されていません');
  });

  test('ログインしていない人がグループを開いたら、Discordではなく入口へ戻り先つきで送る', async () => {
    await makeGroup('p1', 'gp');
    const res = await app.request(ORIGIN + '/g/p1/', {}, noDiscord);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/?return_to=%2Fg%2Fp1%2F');
  });
});

test('Botのトークンが無いCloudflareでは、画面にBotが無いことを知らせる', async () => {
  const { admin } = await setupGroup();
  const { DISCORD_BOT_TOKEN: _, ...noBot } = env;
  const res = await app.request(ORIGIN + '/api/g/grp/getConsoleData', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Cookie: SID + '=' + admin }, body: '{}' }, noBot);
  expect((await res.json<{ bot: { ready: boolean } }>()).bot.ready).toBe(false);
});
