// Discord でログイン・ログアウト・/api/me
import { env, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { call, loginAs, makeGroup, mockDiscord, ORIGIN, postJson, setCookies } from './helpers';

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

describe('ログインの端の場合', () => {
  test('戻り先が無ければ入口。consent=1 なら Discord に許可の画面を出させる', async () => {
    expect((await startLogin()).saved.endsWith('|n|/')).toBe(true);
    const res = await call('/auth/login?consent=1&return_to=%2Fg%2Fx%2F');
    expect(new URL(res.headers.get('Location')!).searchParams.get('prompt')).toBe('consent');
    const saved = decodeURIComponent(setCookies(res).find((c) => c.startsWith('yoki_oauth='))!.split(';')[0]!.slice('yoki_oauth='.length));
    expect(saved.endsWith('|c|/g/x/')).toBe(true);
  });

  test('consent でも断られたら、もうやり直さずに入口へ', async () => {
    const res = await call('/auth/login?consent=1');
    const cookie = setCookies(res).find((c) => c.startsWith('yoki_oauth='))!.split(';')[0]!;
    const r = await call('/auth/callback?error=consent_required', { headers: { Cookie: cookie } });
    expect(r.headers.get('Location')).toBe('/?login=cancelled');
  });

  test('途中の情報（cookie）が無いか、state が無ければやり直してもらう', async () => {
    expect((await call('/auth/callback?code=c&state=s')).status).toBe(400);
    const { cookie } = await startLogin();
    expect((await call('/auth/callback?code=c', { headers: { Cookie: cookie } })).status).toBe(400);
  });

  test('途中の情報が欠けていたら、やめたことにして入口へ', async () => {
    const r = await call('/auth/callback?error=login_required', { headers: { Cookie: 'yoki_oauth=only-state' } });
    expect(r.headers.get('Location')).toBe('/?login=cancelled');
  });

  test('途中の情報の戻り先が書き換えられていたら、入口へ戻す。表示名の無い人はユーザー名のまま', async () => {
    mockDiscord({ user: { id: '100', username: 'alice' }, guilds: [] });
    const r = await call('/auth/callback?code=c&state=st', { headers: { Cookie: 'yoki_oauth=' + encodeURIComponent('st|n|https://evil.example/') } });
    expect(r.headers.get('Location')).toBe('/');
    expect(await env.DB.prepare("SELECT global_name FROM users WHERE id = '100'").first('global_name')).toBeNull();
  });

  test('Discord が応えなければ、エラーのページを出す（中身は log へ）', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('down', { status: 502 }));
    const { state, cookie } = await startLogin();
    const r = await call('/auth/callback?code=c&state=' + state, { headers: { Cookie: cookie } });
    expect(r.status).toBe(500);
    expect(await r.text()).toContain('サーバーでエラーが起きました');
    expect(logged).toHaveBeenCalled();
  });

  test('ログインしていなくてもログアウトはできる（入口へ戻るだけ）', async () => {
    const res = await call('/auth/logout', { method: 'POST', headers: { Origin: ORIGIN } });
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/');
  });
});

describe('/api/me とグループを作るときの端の場合', () => {
  test('手元から開くと、開発用ログインの人を並べる', async () => {
    const body = await (await SELF.fetch('http://localhost:5173/api/me')).json<{ dev: { users: string[] } | null }>();
    expect(body.dev?.users).toContain('ひより');
  });

  test('表示名の無い人は、ユーザー名で出す', async () => {
    const sid = await loginAs({ id: '200', name: 'ボブ' }, []);
    await env.DB.prepare("UPDATE users SET global_name = NULL WHERE id = '200'").run();
    const body = await (await call('/api/me', { sid })).json<{ user: { name: string } }>();
    expect(body.user.name).toBe('u200');
  });

  test('サーバーの一覧が古ければ、ログインし直してもらう。サーバーを選んでいなければ断る', async () => {
    const old = await loginAs({ id: '201', name: 'キャロル' }, [{ id: 'g1', name: 'G', canManage: true }], { checkedAt: new Date(Date.now() - 25 * 3600_000) });
    const r1 = await postJson('/api/groups', { guildId: 'g1' }, old);
    expect(r1.status).toBe(401);
    expect((await r1.json<{ error: string }>()).error).toBe('AUTH: サーバーの一覧が古くなりました。ログインし直してください。');
    const sid = await loginAs({ id: '202', name: 'デイブ' }, [{ id: 'g1', name: 'G', canManage: true }]);
    const r2 = await postJson('/api/groups', {}, sid);
    expect(r2.status).toBe(400);
    expect((await r2.json<{ error: string }>()).error).toBe('Discord サーバーを選んでください。');
  });

  test('名前を付けなければ、サーバーの名前をグループの名前にする', async () => {
    const sid = await loginAs({ id: '203', name: 'エレン' }, [{ id: 'g1', name: 'G のサーバー', canManage: true }]);
    const { id } = await (await postJson('/api/groups', { guildId: 'g1' }, sid)).json<{ id: string }>();
    expect(await env.DB.prepare('SELECT title FROM groups WHERE id = ?').bind(id).first('title')).toBe('G のサーバー');
  });
});
