// テストの小道具: ログイン済みの人を作る、Discordとの通信を差し替える、Workerを呼ぶ
import { env, SELF } from 'cloudflare:test';
import { vi } from 'vitest';
import { sha256Hex } from '../../src/worker/lib/ids';

export const ORIGIN = 'https://yoki.test';
export const SID = '__Host-yoki_sid';

export type Guild = { id: string; name: string; owner?: boolean; permissions?: string };

/** ログイン済みの人をDBに直接作り、cookieの値を返す（OAuthを通さない） */
export async function loginAs(
  user: { id: string; name: string },
  guilds: { id: string; name: string; canManage?: boolean }[],
  opts: { checkedAt?: Date } = {},
): Promise<string> {
  const now = new Date();
  const checked = (opts.checkedAt ?? now).toISOString();
  const token = 'tok-' + user.id + '-' + Math.random().toString(36).slice(2);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, username, global_name, guilds_checked_at, created_at, last_login_at) VALUES (?1, ?2, ?3, ?4, ?4, ?4)
       ON CONFLICT (id) DO UPDATE SET guilds_checked_at = excluded.guilds_checked_at, global_name = excluded.global_name`,
    ).bind(user.id, 'u' + user.id, user.name, checked),
    env.DB.prepare('DELETE FROM user_guilds WHERE user_id = ?').bind(user.id),
    ...guilds.map((g) =>
      env.DB.prepare('INSERT INTO user_guilds (user_id, guild_id, name, can_manage) VALUES (?, ?, ?, ?)').bind(user.id, g.id, g.name, g.canManage ? 1 : 0),
    ),
    env.DB.prepare('INSERT INTO auth_sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(
      await sha256Hex(token),
      user.id,
      now.toISOString(),
      new Date(now.getTime() + 86400_000).toISOString(),
    ),
  ]);
  return token;
}

export async function makeGroup(id: string, guildId: string, title = 'テストの卓'): Promise<void> {
  await env.DB.prepare("INSERT INTO groups (id, guild_id, guild_name, title, created_by, created_at) VALUES (?, ?, 'サーバー', ?, 'x', ?)")
    .bind(id, guildId, title, new Date().toISOString())
    .run();
}

/** Workerを呼ぶ。cookieがあれば添える。転送は追わない */
export function call(path: string, init: RequestInit & { sid?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.sid) headers.set('Cookie', SID + '=' + init.sid);
  return SELF.fetch(ORIGIN + path, { ...init, headers, redirect: 'manual' });
}

export function postJson(path: string, body: unknown, sid?: string, extra: Record<string, string> = {}): Promise<Response> {
  return call(path, { method: 'POST', sid, headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...extra }, body: JSON.stringify(body) });
}

/** Discord（OAuthのトークン・プロフィール・サーバーの一覧）の返事を差し替え、呼ばれたURLを記録する */
export function mockDiscord(profile: { user: { id: string; username: string; global_name?: string }; guilds: Guild[] }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'at', token_type: 'Bearer' });
    if (url.endsWith('/users/@me')) return Response.json(profile.user);
    if (url.includes('/users/@me/guilds')) return Response.json(profile.guilds);
    return new Response('unexpected ' + url, { status: 599 });
  });
  return { calls, restore: () => spy.mockRestore() };
}

/**
 * BotのDiscordのAPI（サーバーのメンバー・サーバー）の返事を差し替える。membersはサーバーごとのメンバー（ID → ロール）。
 * 載っていないサーバーは、Botがいない（403）。ownerとroles（ID → 権限の数）はサーバーの中身
 */
export function mockBotGuilds(guilds: Record<string, { members: Record<string, string[]>; owner?: string; roles?: Record<string, string> }> = {}) {
  const calls: string[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const m = /\/guilds\/([^/]+)(?:\/members\/([^/]+))?$/.exec(new URL(url).pathname);
    const g = m && guilds[m[1]!];
    if (!g) return Response.json({ code: 50001, message: 'Missing Access' }, { status: 403 });
    if (m[2]) return m[2] in g.members ? Response.json({ roles: g.members[m[2]] }) : Response.json({ code: 10007, message: 'Unknown Member' }, { status: 404 });
    if (!g.roles) return new Response('server error', { status: 500 });
    return Response.json({ owner_id: g.owner ?? '0', roles: Object.entries(g.roles).map(([id, permissions]) => ({ id, permissions })) });
  });
  return { calls, restore: () => spy.mockRestore() };
}

export function setCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

/** テスト用のグループと人。adminはサーバーの管理者（グループの管理者）、ソラとこまちはただのメンバー */
export const GUILD = 'guild-t';
export async function setupGroup(id = 'grp') {
  await makeGroup(id, GUILD);
  const admin = await loginAs({ id: '400000000000000010', name: 'ひより' }, [{ id: GUILD, name: 'T', canManage: true }]);
  const sora = await loginAs({ id: '400000000000000011', name: 'ソラ' }, [{ id: GUILD, name: 'T' }]);
  const komachi = await loginAs({ id: '400000000000000012', name: 'こまち' }, [{ id: GUILD, name: 'T' }]);
  // 初めて呼んだときにメンバーになる
  for (const sid of [admin, sora, komachi]) await rpc(sid, id, 'getConsoleData');
  return { id, admin, sora, komachi };
}

export type Rpc = { status: number; body: Record<string, any> };

export async function rpc(sid: string, groupId: string, fn: string, form: Record<string, unknown> = {}): Promise<Rpc> {
  const res = await postJson('/api/g/' + groupId + '/' + fn, form, sid);
  return { status: res.status, body: await res.json() };
}

/** 成功を確かめて返事を返す */
export async function ok(sid: string, groupId: string, fn: string, form: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const r = await rpc(sid, groupId, fn, form);
  if (r.status !== 200) throw new Error(fn + 'が失敗: ' + r.status + ' ' + JSON.stringify(r.body));
  return r.body;
}

/** 失敗を確かめてメッセージを返す */
export async function fail(sid: string, groupId: string, fn: string, form: Record<string, unknown> = {}): Promise<{ status: number; error: string }> {
  const r = await rpc(sid, groupId, fn, form);
  if (r.status === 200) throw new Error(fn + 'が成功してしまった: ' + JSON.stringify(r.body).slice(0, 200));
  return { status: r.status, error: String(r.body.error) };
}

export async function today(): Promise<string> {
  const { jst } = await import('../../src/worker/lib/jst');
  return jst(new Date()).ymd;
}
