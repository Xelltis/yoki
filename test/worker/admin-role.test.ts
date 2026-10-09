// Discordのロールで管理者を決める: ロールの一覧を読む・選ぶ（名前はBotで読む）、そのロールのある人は名簿に無くても管理者（ロールはBotで読んで1日控える）
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { groupAccess } from '../../src/worker/auth/guard';
import type { Viewer } from '../../src/worker/auth/session';
import { loadGroup } from '../../src/worker/domain/load';
import { getDiscordRoles, saveConsoleSettings } from '../../src/worker/domain/settings';
import { fail, GUILD, loginAs, makeGroup, mockBotGuilds, ok, setupGroup } from './helpers';

afterEach(() => vi.restoreAllMocks());

/** Botの返事を差し替える。ロールの一覧（/roles）と、メンバー（/members/:id）。codeを渡すと、その状態で断る */
function mockRoles(o: { roles?: unknown; status?: number; members?: Record<string, string[]> } = {}) {
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    calls.push(url);
    if (o.status) return new Response('{}', { status: o.status });
    const m = /\/members\/(\d+)$/.exec(url);
    if (m) return o.members?.[m[1]!] ? Response.json({ roles: o.members[m[1]!] }) : Response.json({ code: 10007 }, { status: 404 });
    return Response.json(o.roles ?? []);
  });
  return calls;
}
const ROLES = [
  { id: GUILD, name: '@everyone', position: 0 },
  { id: '900000000000000001', name: 'メンバー', position: 1 },
  { id: '900000000000000002', name: '運営', position: 3 },
  { id: '900000000000000003', name: 'Yoki', position: 2, managed: true },
];

describe('ロールを選ぶ', () => {
  let G: Awaited<ReturnType<typeof setupGroup>>;
  beforeEach(async () => { G = await setupGroup(); });

  test('ロールの一覧は上から（@everyoneとBotのロールは除く）。Botがいない・トークンが無いときは、そう返す。管理者だけ', async () => {
    mockRoles({ roles: ROLES });
    expect(await ok(G.admin, G.id, 'getDiscordRoles')).toEqual({ ok: true, botReady: true, inGuild: true, roles: [{ id: '900000000000000002', name: '運営' }, { id: '900000000000000001', name: 'メンバー' }] });
    mockRoles({ status: 403 });
    expect((await ok(G.admin, G.id, 'getDiscordRoles')).inGuild).toBe(false);
    mockRoles({ status: 500 });
    expect((await fail(G.admin, G.id, 'getDiscordRoles')).status).toBe(500);
    expect((await fail(G.sora, G.id, 'getDiscordRoles')).error).toBe('ADMIN: Discordのロールの一覧を読むことができるのは管理者だけです。');
  });

  test('選ぶと、名前をBotで読んで控える。外せる。無いロール・Botがいないときは断る', async () => {
    mockRoles({ roles: ROLES });
    let r = await ok(G.admin, G.id, 'saveConsoleSettings', { adminRole: '900000000000000002' });
    expect(r.data.settings.adminRole).toEqual({ id: '900000000000000002', name: '運営' });
    expect((await fail(G.admin, G.id, 'saveConsoleSettings', { adminRole: '900000000000000009' })).error).toBe('そのロールはサーバーにありません。ロールを読み直して選んでください。');
    mockRoles({ status: 404 });
    expect((await fail(G.admin, G.id, 'saveConsoleSettings', { adminRole: '900000000000000002' })).error).toContain('Botがサーバーにいないので');
    r = await ok(G.admin, G.id, 'saveConsoleSettings', { adminRole: '' });
    expect(r.data.settings.adminRole).toEqual({ id: '', name: '' });
    expect((await fail(G.sora, G.id, 'saveConsoleSettings', { adminRole: '' })).error).toContain('ADMIN:');
  });

  test('Botのトークンが無ければ、ロールを読まない（一覧はそう返し、選ぶのは断る）', async () => {
    const ctx = await loadGroup(env.DB, G.id, { memberId: 1, name: 'ひより', isAdmin: true, userId: '' }, '', new Date(), { token: '', clientId: '' });
    expect(await getDiscordRoles(ctx)).toEqual({ ok: true, botReady: false, inGuild: false, roles: [] });
    await expect(saveConsoleSettings(ctx, { adminRole: '900000000000000002' })).rejects.toThrow('YokiのBotのトークンが無いので、ロールを読めません。');
  });
});

describe('ロールのある人は管理者', () => {
  const viewer = (id: string, checkedAt = new Date()): Viewer => ({ id, username: 'u', globalName: 'ユーザー', avatar: null, guildsCheckedAt: checkedAt.toISOString() });
  const old = new Date(Date.now() - 25 * 3600_000);
  const ROLE = '900000000000000002';
  const ug = (id: string) => env.DB.prepare('SELECT roles, roles_at FROM user_guilds WHERE user_id = ?').bind(id).first<{ roles: string | null; roles_at: string | null }>();
  beforeEach(async () => {
    await makeGroup('rg', '111');
    await env.DB.prepare("UPDATE groups SET admin_role = ?, admin_role_name = '運営' WHERE id = 'rg'").bind(ROLE).run();
  });

  test('控えのロールが新しければ、それで決める。古ければBotで読み直して控える（次の1日は読まない）', async () => {
    await loginAs({ id: '601', name: 'A' }, [{ id: '111', name: 'S' }]);
    await env.DB.prepare('UPDATE user_guilds SET roles = ?, roles_at = ? WHERE user_id = ?').bind(JSON.stringify([ROLE]), new Date().toISOString(), '601').run();
    const calls = mockRoles();
    expect(await groupAccess(env.DB, viewer('601'), 'rg', 'tok')).toMatchObject({ ok: true, actor: { isAdmin: true } });
    expect(calls).toEqual([]);
    await env.DB.prepare('UPDATE user_guilds SET roles_at = ? WHERE user_id = ?').bind(old.toISOString(), '601').run();
    mockRoles({ members: { 601: ['900000000000000001'] } });
    expect(await groupAccess(env.DB, viewer('601'), 'rg', 'tok')).toMatchObject({ ok: true, actor: { isAdmin: false } });
    expect(JSON.parse((await ug('601'))!.roles!)).toEqual(['900000000000000001']);
  });

  test('Botで分からなければ、ロールでは管理者にしない。Botのトークンが無ければ読まない', async () => {
    await loginAs({ id: '602', name: 'B' }, [{ id: '111', name: 'S' }]);
    mockRoles({ status: 500 });
    expect(await groupAccess(env.DB, viewer('602'), 'rg', 'tok')).toMatchObject({ ok: true, actor: { isAdmin: false } });
    expect((await ug('602'))!.roles_at).toBeNull();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'));
    expect(await groupAccess(env.DB, viewer('602'), 'rg', 'tok')).toMatchObject({ ok: true, actor: { isAdmin: false } });
    vi.restoreAllMocks();
    const calls = mockRoles();
    expect(await groupAccess(env.DB, viewer('602'), 'rg', undefined)).toMatchObject({ ok: true, actor: { isAdmin: false } });
    expect(calls).toEqual([]);
  });

  test('サーバーにいるかをBotで確かめ直すときは、ロールも一緒に控える', async () => {
    await loginAs({ id: '603', name: 'C' }, [{ id: '111', name: 'S' }], { checkedAt: old });
    mockBotGuilds({ 111: { members: { 603: [ROLE] }, owner: '0', roles: { 111: '0', [ROLE]: '0' } } });
    expect(await groupAccess(env.DB, viewer('603', old), 'rg', 'tok')).toMatchObject({ ok: true, actor: { isAdmin: true } });
    expect(JSON.parse((await ug('603'))!.roles!)).toEqual([ROLE]);
  });

  test('サーバーを管理できる人は、ロールを読まない。ロールを決めていないグループでも読まない', async () => {
    await loginAs({ id: '604', name: 'D' }, [{ id: '111', name: 'S', canManage: true }]);
    const calls = mockRoles();
    expect(await groupAccess(env.DB, viewer('604'), 'rg', 'tok')).toMatchObject({ ok: true, actor: { isAdmin: true } });
    await env.DB.prepare("UPDATE groups SET admin_role = '' WHERE id = 'rg'").run();
    await loginAs({ id: '605', name: 'E' }, [{ id: '111', name: 'S' }]);
    expect(await groupAccess(env.DB, viewer('605'), 'rg', 'tok')).toMatchObject({ ok: true, actor: { isAdmin: false } });
    expect(calls).toEqual([]);
  });
});
