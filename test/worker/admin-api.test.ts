// 運営者の API（/api/admin/*）: 入れる人の確かめ・様子・グループ（管理者と Discord サーバーの付け替え・消す）・利用者（ログインを切る・締め出す）
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AdminGroupDetail, AdminGroupRow, AdminOverview, AdminUserRow } from '../../src/shared/admin';
import { call, GUILD, loginAs, makeGroup, postJson, rpc, setupGroup } from './helpers';

const OP = { id: '400000000000000099', name: '運営' };
let op = '';
let logs: string[] = [];

beforeEach(async () => {
  op = await loginAs(OP, []);
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((s: unknown) => { logs.push(String(s)); });
});
afterEach(() => vi.restoreAllMocks());

const get = async <T,>(path: string, sid = op) => {
  const res = await call(path, { sid });
  return { status: res.status, body: (await res.json()) as T, res };
};
const post = async (path: string, body: unknown, sid = op) => {
  const res = await postJson(path, body, sid);
  return { status: res.status, body: (await res.json()) as { ok?: boolean; message?: string; error?: string } };
};
const count = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).first<number>('n');

describe('入れる人', () => {
  const reads = ['/api/admin/overview', '/api/admin/groups', '/api/admin/groups/grp', '/api/admin/users'];
  const writes = ['/api/admin/groups/grp/admins', '/api/admin/groups/grp/guild', '/api/admin/groups/grp/delete', '/api/admin/users/x/logout', '/api/admin/users/x/ban'];

  test('ログインしていなければ AUTH:、運営者でなければ 403。グループの管理者でも入れない', async () => {
    const { admin } = await setupGroup();
    for (const p of reads) {
      const anon = await call(p);
      expect(anon.status, p).toBe(401);
      expect(((await anon.json()) as { error: string }).error).toMatch(/^AUTH:/);
      expect((await call(p, { sid: admin })).status, p).toBe(403);
    }
    for (const p of writes) expect((await postJson(p, {}, admin)).status, p).toBe(403);
    expect(await count("SELECT count(*) AS n FROM groups WHERE id = 'grp'")).toBe(1);
  });

  test('運営者は入れる。返事は控えさせない（no-store）', async () => {
    await setupGroup();
    for (const p of reads) {
      const r = await call(p, { sid: op });
      expect(r.status, p).toBe(200);
      expect(r.headers.get('Cache-Control'), p).toBe('no-store');
    }
  });

  test('変える操作は、ほかのサイトからは受けない（CSRF）', async () => {
    await setupGroup();
    const res = await postJson('/api/admin/groups/grp/delete', { confirm: 'テストの卓' }, op, { Origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(await count("SELECT count(*) AS n FROM groups WHERE id = 'grp'")).toBe(1);
  });

  test('入口の /api/me で、運営者かが分かる', async () => {
    const me = (sid: string) => call('/api/me', { sid }).then((r) => r.json() as Promise<{ operator: boolean }>);
    const { admin } = await setupGroup();
    expect((await me(op)).operator).toBe(true);
    expect((await me(admin)).operator).toBe(false);
  });
});

describe('様子', () => {
  test('数・送信の失敗（送り直しの途中は数えない）・見回りの様子', async () => {
    await setupGroup();
    const now = Date.now(), iso = (msAgo: number) => new Date(now - msAgo).toISOString();
    const log = (at: string, result: string) => env.DB.prepare("INSERT INTO notify_log (group_id, at, kind, target, result) VALUES ('grp', ?, '開催前の知らせ', '卓', ?)").bind(at, result).run();
    await log(iso(60_000), '送信失敗（Webhook URL が違う）: HTTP 404');
    await log(iso(2 * 86400_000), '送らず: Discord Webhook URL が空');
    await log(iso(30_000), 'HTTP 429 …（1 回目、3 秒後に送り直し）');
    await log(iso(10_000), 'OK (204)');
    await log(iso(10 * 86400_000), '送信失敗（古い）');
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('patrol', ?), ('hourly', '2026-10-10T20')").bind(JSON.stringify({ at: iso(60_000), ms: 12, ok: true, error: '' })).run();
    const { body: o } = await get<AdminOverview>('/api/admin/overview');
    expect(o.counts).toMatchObject({ groups: 1, users: 4, bannedUsers: 0, activeSessions: 0 });
    expect(o.counts.logins).toBe(4);
    expect(o.failures.day).toBe(1);
    expect(o.failures.week).toBe(2);
    expect(o.failures.recent.map((f) => f.result)).toEqual(['送信失敗（Webhook URL が違う）: HTTP 404', '送らず: Discord Webhook URL が空', '送信失敗（古い）']);
    expect(o.failures.recent[0]).toMatchObject({ groupId: 'grp', groupTitle: 'テストの卓' });
    expect(o.patrol).toMatchObject({ hourly: '2026-10-10T20', stale: false });
    expect(o.patrol.last?.ok).toBe(true);
  });

  test('見回りの記録が無いか、15 分より前なら止まっているかも', async () => {
    expect((await get<AdminOverview>('/api/admin/overview')).body.patrol.stale).toBe(true);
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('patrol', ?)").bind(JSON.stringify({ at: new Date(Date.now() - 20 * 60_000).toISOString(), ms: 1, ok: true, error: '' })).run();
    expect((await get<AdminOverview>('/api/admin/overview')).body.patrol.stale).toBe(true);
  });
});

describe('グループ', () => {
  test('一覧と中身。メンバー・ログインした人・サーバーの管理者が分かり、Webhook の URL は出さない', async () => {
    await setupGroup();
    await env.DB.prepare("UPDATE groups SET webhook_url = 'https://discord.com/api/webhooks/1/secret' WHERE id = 'grp'").run();
    const { body: list } = await get<AdminGroupRow[]>('/api/admin/groups');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'grp', title: 'テストの卓', guildId: GUILD, memberCount: 3, linkedCount: 3, adminCount: 0 });
    const { body: d, res } = await get<AdminGroupDetail>('/api/admin/groups/grp');
    expect(d.webhookSet).toBe(true);
    expect(JSON.stringify(d)).not.toContain('secret');
    expect(d.members.map((m) => m.name).sort()).toEqual(['こまち', 'ひより', 'ソラ']);
    expect(d.members.every((m) => m.userId && m.lastLoginAt)).toBe(true);
    expect(d.guildManagers).toEqual([{ id: '400000000000000010', name: 'ひより' }]);
    expect(res.status).toBe(200);
    expect((await get('/api/admin/groups/none')).status).toBe(404);
  });

  test('管理者を付け替える。印が 0 人になる外し方は断る', async () => {
    await setupGroup();
    const { body: d } = await get<AdminGroupDetail>('/api/admin/groups/grp');
    const sora = d.members.find((m) => m.name === 'ソラ')!, komachi = d.members.find((m) => m.name === 'こまち')!;
    expect((await post('/api/admin/groups/grp/admins', { memberId: sora.id, admin: true })).status).toBe(200);
    expect((await post('/api/admin/groups/grp/admins', { memberId: sora.id, admin: false })).body.error).toMatch(/0 人/);
    expect((await post('/api/admin/groups/grp/admins', { memberId: komachi.id, admin: true })).status).toBe(200);
    expect((await post('/api/admin/groups/grp/admins', { memberId: sora.id, admin: false })).status).toBe(200);
    expect(await count("SELECT count(*) AS n FROM members WHERE group_id = 'grp' AND is_admin = 1")).toBe(1);
    expect(logs.some((l) => l.includes('"action":"setGroupAdmin"') && l.includes(OP.id))).toBe(true);
    // 管理者の付け替えで、ソラの画面でも管理者になる
    expect((await rpc(await loginAs({ id: '400000000000000012', name: 'こまち' }, [{ id: GUILD, name: 'T' }]), 'grp', 'getConsoleData')).body.isAdmin).toBe(true);
  });

  test('まだ開いていない人を、Discord ID で管理者として足せる。初めて開いたときにその行に結びつく', async () => {
    await setupGroup();
    expect((await post('/api/admin/groups/grp/admins', { discordId: '123', name: 'ダン', admin: true })).status).toBe(400);
    expect((await post('/api/admin/groups/grp/admins', { discordId: '500000000000000001', admin: true })).body.error).toMatch(/名前/);
    expect((await post('/api/admin/groups/grp/admins', { discordId: '500000000000000001', name: 'ダン', admin: true })).status).toBe(200);
    const dan = await loginAs({ id: '500000000000000001', name: 'ダン（Discord）' }, [{ id: GUILD, name: 'T' }]);
    const d = (await rpc(dan, 'grp', 'getConsoleData')).body;
    expect(d.me.name).toBe('ダン');
    expect(d.isAdmin).toBe(true);
    // すでにいる人を Discord ID で指すと、その人に印を付ける
    expect((await post('/api/admin/groups/grp/admins', { discordId: '400000000000000011', admin: true })).body.message).toMatch(/ソラ/);
  });

  test('Discord サーバーを付け替える。ID の形・同じサーバー・名前の分からないサーバーを確かめる', async () => {
    await setupGroup();
    await env.DB.prepare("UPDATE groups SET webhook_url = 'https://discord.com/api/webhooks/1/x' WHERE id = 'grp'").run();
    expect((await post('/api/admin/groups/grp/guild', { guildId: 'abc' })).status).toBe(400);
    expect((await post('/api/admin/groups/grp/guild', { guildId: '700000000000000001' })).body.error).toMatch(/名前/);
    expect((await post('/api/admin/groups/grp/guild', { guildId: '700000000000000001', guildName: '新しいサーバー' })).status).toBe(200);
    expect(await env.DB.prepare("SELECT guild_id || ' ' || guild_name AS v FROM groups WHERE id = 'grp'").first('v')).toBe('700000000000000001 新しいサーバー');
    expect((await post('/api/admin/groups/grp/guild', { guildId: '700000000000000001' })).body.error).toMatch(/同じ/);
    // 古いサーバーの人は入れなくなる（控えが新しいので、聞き直しもしない）
    const sora = await loginAs({ id: '400000000000000011', name: 'ソラ' }, [{ id: GUILD, name: 'T' }]);
    expect((await rpc(sora, 'grp', 'getConsoleData')).status).toBe(403);
    // ログインした人の控えにあるサーバーなら、名前はそこから。Webhook も外せる
    await loginAs({ id: '600', name: 'イブ' }, [{ id: '700000000000000002', name: '控えのサーバー', canManage: true }]);
    expect((await post('/api/admin/groups/grp/guild', { guildId: '700000000000000002', clearWebhooks: true })).body.message).toMatch(/控えのサーバー.*Webhook も外しました/);
    expect(await env.DB.prepare("SELECT webhook_url FROM groups WHERE id = 'grp'").first('webhook_url')).toBe('');
  });

  test('消す。名前が違えば消さず、合えば中身ごと消える。ほかのグループは残る', async () => {
    const g = await setupGroup('grp');
    await makeGroup('other', GUILD, 'ほかの卓');
    await rpc(g.admin, 'other', 'getConsoleData');
    await rpc(g.admin, 'grp', 'saveSession', { name: '卓', status: '開催', date: '2099-01-01', gm: 'ひより', members: ['ソラ'] });
    await rpc(g.sora, 'grp', 'setAvailability', { name: 'ソラ', ymd: '2099-01-02', mark: '×' });
    await rpc(g.admin, 'grp', 'setDayNote', { ymd: '2099-01-03', text: 'メモ', me: 'ひより' });
    expect((await post('/api/admin/groups/grp/delete', { confirm: 'ちがう名前' })).status).toBe(400);
    expect(await count("SELECT count(*) AS n FROM groups WHERE id = 'grp'")).toBe(1);
    expect((await post('/api/admin/groups/grp/delete', { confirm: ' テストの卓 ' })).status).toBe(200);
    for (const t of ['members', 'sessions', 'day_notes', 'notify_log', 'series_notify']) expect(await count(`SELECT count(*) AS n FROM ${t} WHERE group_id = 'grp'`), t).toBe(0);
    expect(await count('SELECT count(*) AS n FROM availability')).toBe(0);
    expect(await count('SELECT count(*) AS n FROM session_people')).toBe(0);
    expect(await count("SELECT count(*) AS n FROM members WHERE group_id = 'other'")).toBe(1);
    expect(logs.some((l) => l.includes('"action":"deleteGroup"'))).toBe(true);
    expect((await post('/api/admin/groups/grp/delete', { confirm: 'テストの卓' })).status).toBe(404);
  });
});

describe('利用者', () => {
  test('一覧。入っているグループ・有効なログインの数・運営者が分かる', async () => {
    await setupGroup();
    await loginAs({ id: '400000000000000011', name: 'ソラ' }, [{ id: GUILD, name: 'T' }]);   // 2 つ目のログイン
    const { body } = await get<AdminUserRow[]>('/api/admin/users');
    const sora = body.find((u) => u.id === '400000000000000011')!;
    expect(sora).toMatchObject({ name: 'ソラ', logins: 2, groups: [{ id: 'grp', title: 'テストの卓' }], bannedAt: '', operator: false });
    expect(body.find((u) => u.id === OP.id)!.operator).toBe(true);
  });

  test('ログインを切る。Discord でログインし直せば、また入れる', async () => {
    const { sora } = await setupGroup();
    expect((await post('/api/admin/users/400000000000000011/logout', {})).body.message).toMatch(/1 件/);
    expect((await rpc(sora, 'grp', 'getConsoleData')).status).toBe(401);
    expect(await count("SELECT count(*) AS n FROM users WHERE id = '400000000000000011' AND banned_at IS NULL")).toBe(1);
    expect((await post('/api/admin/users/none/logout', {})).status).toBe(404);
  });

  test('締め出す・戻す。締め出すとログインも消える。運営者は締め出せない', async () => {
    const { sora } = await setupGroup();
    expect((await post('/api/admin/users/400000000000000011/ban', { banned: true, reason: '荒らし' })).status).toBe(200);
    expect(await count("SELECT count(*) AS n FROM auth_sessions WHERE user_id = '400000000000000011'")).toBe(0);
    expect((await rpc(sora, 'grp', 'getConsoleData')).status).toBe(401);
    const { body } = await get<AdminUserRow[]>('/api/admin/users');
    expect(body.find((u) => u.id === '400000000000000011')).toMatchObject({ bannedReason: '荒らし' });
    expect((await post('/api/admin/users/400000000000000011/ban', { banned: false })).status).toBe(200);
    expect(await count("SELECT count(*) AS n FROM users WHERE banned_at IS NOT NULL")).toBe(0);
    expect((await post('/api/admin/users/' + OP.id + '/ban', { banned: true })).body.error).toMatch(/運営者/);
    expect(logs.filter((l) => l.includes('"audit":"operator"')).map((l) => JSON.parse(l).action)).toEqual(['ban', 'unban']);
  });
});

