// Discord でログイン・ログアウト・/api/me
import { env } from 'cloudflare:test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { call, loginAs, makeGroup, mockDiscord, ORIGIN, setCookies } from './helpers';

afterEach(() => vi.restoreAllMocks());

/** /auth/login を呼び、Discord へ渡す state と、戻ってくるときの cookie を返す */
async function startLogin(returnTo = '/') {
  const res = await call('/auth/login?return_to=' + encodeURIComponent(returnTo));
  const to = new URL(res.headers.get('Location') ?? '');
  const cookie = setCookies(res).find((c) => c.startsWith('yoki_oauth='))!.split(';')[0]!;
  // 値は URL エンコードされている（Worker は読むときに戻す）
  const saved = decodeURIComponent(cookie.slice('yoki_oauth='.length));
  return { res, to, state: to.searchParams.get('state')!, cookie, saved };
}

describe('/auth/login', () => {
  test('Discord の認可の画面へ送る（identify と guilds、prompt=none、戻り先は /auth/callback）', async () => {
    const { res, to, saved } = await startLogin('/g/abc/');
    expect(res.status).toBe(302);
    expect(to.origin + to.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(to.searchParams.get('client_id')).toBe('test-client');
    expect(to.searchParams.get('scope')).toBe('identify guilds');
    expect(to.searchParams.get('prompt')).toBe('none');
    expect(to.searchParams.get('redirect_uri')).toBe(ORIGIN + '/auth/callback');
    expect(saved.endsWith('|n|/g/abc/')).toBe(true);
    const raw = setCookies(res).find((c) => c.startsWith('yoki_oauth='))!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/Secure/i);
    expect(raw).toMatch(/Path=\/auth/i);
  });

  test('戻り先がグループのページでなければ、入口へ戻す', async () => {
    const { saved } = await startLogin('https://evil.example/');
    expect(saved.endsWith('|n|/')).toBe(true);
  });
});

describe('/auth/callback', () => {
  test('state が違えば断る', async () => {
    const { cookie } = await startLogin();
    const res = await call('/auth/callback?code=c&state=wrong', { headers: { Cookie: cookie } });
    expect(res.status).toBe(400);
  });

  test('ログインすると、セッションの cookie が付き、グループのあるサーバーと管理できるサーバーだけを控える', async () => {
    await makeGroup('grp1', 'g-hosted');
    const d = mockDiscord({
      user: { id: '100', username: 'alice', global_name: 'アリス' },
      guilds: [
        { id: 'g-hosted', name: '卓のサーバー', permissions: '0' },
        { id: 'g-mine', name: '自分のサーバー', permissions: '32' },
        { id: 'g-other', name: '関係ないサーバー', permissions: '0' },
      ],
    });
    const { state, cookie } = await startLogin('/g/grp1/');
    const res = await call('/auth/callback?code=the-code&state=' + encodeURIComponent(state), { headers: { Cookie: cookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/g/grp1/');
    const sid = setCookies(res).find((c) => c.startsWith('__Host-yoki_sid='))!;
    expect(sid).toMatch(/HttpOnly/i);
    expect(sid).toMatch(/SameSite=Lax/i);
    const token = d.calls.find((x) => x.url.endsWith('/oauth2/token'))!;
    expect(String(token.init?.body)).toContain('code=the-code');
    const guilds = await env.DB.prepare('SELECT guild_id, can_manage FROM user_guilds WHERE user_id = ? ORDER BY guild_id').bind('100').all();
    expect(guilds.results).toEqual([
      { guild_id: 'g-hosted', can_manage: 0 },
      { guild_id: 'g-mine', can_manage: 1 },
    ]);
    expect(await env.DB.prepare('SELECT global_name FROM users WHERE id = ?').bind('100').first('global_name')).toBe('アリス');
  });

  test('prompt=none を Discord が断ったら、consent でやり直す。やめたら入口へ', async () => {
    const a = await startLogin('/g/x/');
    const r1 = await call('/auth/callback?error=consent_required&state=' + a.state, { headers: { Cookie: a.cookie } });
    expect(r1.headers.get('Location')).toBe('/auth/login?consent=1&return_to=%2Fg%2Fx%2F');
    const b = await startLogin();
    const r2 = await call('/auth/callback?error=access_denied&state=' + b.state, { headers: { Cookie: b.cookie } });
    expect(r2.headers.get('Location')).toBe('/?login=cancelled');
  });
});

describe('/api/me とログアウト', () => {
  test('ログインしていなければ loggedIn: false', async () => {
    const body = await (await call('/api/me')).json<{ loggedIn: boolean; discord: boolean }>();
    expect(body.loggedIn).toBe(false);
    expect(body.discord).toBe(true);
  });

  test('入れるグループと、グループを作れるサーバーを返す', async () => {
    await makeGroup('grp2', 'g-a', 'A の卓');
    const sid = await loginAs({ id: '200', name: 'ボブ' }, [
      { id: 'g-a', name: 'A' },
      { id: 'g-b', name: 'B', canManage: true },
    ]);
    const body = await (await call('/api/me', { sid })).json<{ loggedIn: boolean; groups: { id: string; title: string }[]; creatable: { guildId: string }[]; user: { name: string } }>();
    expect(body.loggedIn).toBe(true);
    expect(body.user.name).toBe('ボブ');
    expect(body.groups.map((g) => g.id)).toEqual(['grp2']);
    expect(body.creatable.map((g) => g.guildId)).toEqual(['g-b']);
  });

  test('ログアウトするとセッションが消える', async () => {
    const sid = await loginAs({ id: '300', name: 'カレン' }, []);
    const res = await call('/auth/logout', { method: 'POST', sid, headers: { Origin: ORIGIN } });
    expect(res.status).toBe(303);
    const body = await (await call('/api/me', { sid })).json<{ loggedIn: boolean }>();
    expect(body.loggedIn).toBe(false);
  });
});
