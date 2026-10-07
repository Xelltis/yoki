// 管理画面の土台: 運営者の判定・締め出し・ログインのあとの戻り先
import { env, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { isOperator, parseOperatorIds } from '../../src/worker/auth/operator';
import { isReturnPath } from '../../src/shared/routes';
import { call, loginAs, mockDiscord, setCookies } from './helpers';

afterEach(() => vi.restoreAllMocks());

const ban = (id: string) =>
  env.DB.prepare("UPDATE users SET banned_at = ?, banned_reason = 'テスト' WHERE id = ?").bind(new Date().toISOString(), id).run();

/** /auth/loginを呼び、Discordへ渡すstateと、戻ってくるときのcookieを返す */
async function startLogin(returnTo = '/') {
  const res = await call('/auth/login?return_to=' + encodeURIComponent(returnTo));
  const to = new URL(res.headers.get('Location') ?? '');
  const cookie = setCookies(res).find((c) => c.startsWith('yoki_oauth='))!.split(';')[0]!;
  return { state: to.searchParams.get('state')!, cookie, saved: decodeURIComponent(cookie.slice('yoki_oauth='.length)) };
}

describe('運営者', () => {
  test('OPERATOR_IDSはカンマと空白で区切る', () => {
    expect(parseOperatorIds('1, 2,3  4')).toEqual(['1', '2', '3', '4']);
    expect(parseOperatorIds('')).toEqual([]);
    expect(parseOperatorIds(undefined)).toEqual([]);
  });

  test('設定に書いたIDの人が運営者。開発用の管理者（ひより）は、開発サーバーを手元から開いたときだけ', () => {
    const prod = new URL('https://yoki.test/'), local = new URL('http://localhost:5173/');
    expect(isOperator(env, '400000000000000098', prod)).toBe(true);
    expect(isOperator(env, '400000000000000099', prod)).toBe(true);
    expect(isOperator(env, '400000000000000010', prod)).toBe(false);
    expect(isOperator(env, '400000000000000010', local)).toBe(true);
    expect(isOperator(env, '400000000000000011', local)).toBe(false);
  });
});

describe('締め出し', () => {
  test('締め出すと、持っていたログインも効かなくなる', async () => {
    const sid = await loginAs({ id: '200', name: 'ボブ' }, []);
    expect(((await (await call('/api/me', { sid })).json()) as { loggedIn: boolean }).loggedIn).toBe(true);
    await ban('200');
    expect(((await (await call('/api/me', { sid })).json()) as { loggedIn: boolean }).loggedIn).toBe(false);
  });

  test('締め出された人はDiscordでログインし直しても入れず、ログインの記録も残らない', async () => {
    await loginAs({ id: '201', name: 'キャロル' }, []);
    await env.DB.prepare("UPDATE users SET last_login_at = '2026-01-01T00:00:00.000Z' WHERE id = '201'").run();
    await ban('201');
    mockDiscord({ user: { id: '201', username: 'carol', global_name: 'キャロル' }, guilds: [] });
    const { state, cookie } = await startLogin('/');
    const res = await call('/auth/callback?code=c&state=' + encodeURIComponent(state), { headers: { Cookie: cookie } });
    expect(res.headers.get('Location')).toBe('/?login=banned');
    expect(setCookies(res).some((c) => c.startsWith('__Host-yoki_sid='))).toBe(false);
    expect(await env.DB.prepare("SELECT last_login_at FROM users WHERE id = '201'").first('last_login_at')).toBe('2026-01-01T00:00:00.000Z');
    expect(await env.DB.prepare("SELECT count(*) AS n FROM auth_sessions WHERE user_id = '201'").first('n')).toBe(1);
  });

  test('開発用ログインでも断る', async () => {
    await env.DB.prepare("INSERT INTO users (id, username, guilds_checked_at, created_at, last_login_at, banned_at) VALUES ('400000000000000011', 'dev-11', '', '', '', '2026-01-01')").run();
    const res = await SELF.fetch('http://localhost:5173/dev/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'http://localhost:5173' },
      body: 'as=ソラ',
      redirect: 'manual',
    });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/?login=banned');
    expect(res.headers.getSetCookie().some((c) => c.startsWith('yoki_sid='))).toBe(false);
  });
});

describe('運営者の管理画面のリンク', () => {
  test('リンクの中身を読みに来たものには、ログインへ送らずに、Yokiの見た目を返す', async () => {
    const res = await call('/admin/', { headers: { 'User-Agent': 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<meta property="og:title" content="Yoki">');
    expect((await call('/admin/')).status).toBe(302);
  });
});

describe('ログインのあとの戻り先', () => {
  test('入口・グループのページとタブ・グループの管理画面と区分・運営者の管理画面と区分だけ', () => {
    for (const ok of ['/', '/g/abc/', '/g/abc/recruit/', '/g/abc/settings/', '/g/abc/admin/', '/g/abc/admin/danger/', '/g/abc/admin/admins/', '/admin/', '/admin/legal/']) {
      expect(isReturnPath(ok), ok).toBe(true);
    }
    for (const ng of ['/admin', '/g/abc/x/', '/g/abc/recruit', '/g/abc/admin/x/', '/g/abc/admin/admin/', '/g/ABC/', '/g/' + 'a'.repeat(41) + '/', '//evil.example/', 'https://evil.example/', '/admin/x/', '/admin/legal']) {
      expect(isReturnPath(ng), ng).toBe(false);
    }
  });

  test('タブの道からログインし直したら、そのタブへ戻る', async () => {
    expect((await startLogin('/g/abc/recruit/')).saved.endsWith('|n|/g/abc/recruit/')).toBe(true);
  });

  test('管理画面からログインし直したら、管理画面へ戻る', async () => {
    expect((await startLogin('/admin/')).saved.endsWith('|n|/admin/')).toBe(true);
    expect((await startLogin('/g/abc/admin/')).saved.endsWith('|n|/g/abc/admin/')).toBe(true);
  });
});
