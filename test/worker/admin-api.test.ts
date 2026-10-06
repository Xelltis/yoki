// 運営者のAPI（/api/admin/*）: 入れる人の確かめ・様子・グループ（管理者とDiscordサーバーの付け替え・消す）・利用者（ログインを切る・締め出す）
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
  const reads = ['/api/admin/overview', '/api/admin/groups', '/api/admin/groups/grp', '/api/admin/users', '/api/admin/legal'];
  const writes = ['/api/admin/groups/grp/admins', '/api/admin/groups/grp/guild', '/api/admin/groups/grp/delete', '/api/admin/users/x/logout', '/api/admin/users/x/ban', '/api/admin/users/x/delete', '/api/admin/registration', '/api/admin/legal'];

  test('ログインしていなければAUTH:、運営者でなければ403。グループの管理者でも入れない', async () => {
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

  test('入口の /api/meで、運営者かが分かる', async () => {
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
    await log(iso(60_000), '送信失敗（チャンネル）: HTTP 404');
    await log(iso(2 * 86400_000), '送らず: 送り先のチャンネルが未設定');
    await log(iso(30_000), 'HTTP 429 …（1回目、3秒後に送り直し）');
    await log(iso(10_000), 'OK (200)');
    await log(iso(10 * 86400_000), '送信失敗（古い）');
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('patrol', ?), ('hourly', '2026-10-10T20')").bind(JSON.stringify({ at: iso(60_000), ms: 12, ok: true, error: '' })).run();
    const { body: o } = await get<AdminOverview>('/api/admin/overview');
    expect(o.counts).toMatchObject({ groups: 1, users: 4, bannedUsers: 0, activeSessions: 0 });
    expect(o.counts.logins).toBe(4);
    expect(o.failures.day).toBe(1);
    expect(o.failures.week).toBe(2);
    expect(o.failures.recent.map((f) => f.result)).toEqual(['送信失敗（チャンネル）: HTTP 404', '送らず: 送り先のチャンネルが未設定', '送信失敗（古い）']);
    expect(o.failures.recent[0]).toMatchObject({ groupId: 'grp', groupTitle: 'テストの卓' });
    expect(o.patrol).toMatchObject({ hourly: '2026-10-10T20', stale: false });
    expect(o.patrol.last?.ok).toBe(true);
  });

  test('見回りの記録が無いか、15分より前なら止まっているかも', async () => {
    expect((await get<AdminOverview>('/api/admin/overview')).body.patrol.stale).toBe(true);
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('patrol', ?)").bind(JSON.stringify({ at: new Date(Date.now() - 20 * 60_000).toISOString(), ms: 1, ok: true, error: '' })).run();
    expect((await get<AdminOverview>('/api/admin/overview')).body.patrol.stale).toBe(true);
  });
});

describe('グループ', () => {
  test('一覧と中身。メンバー・ログインした人・サーバーの管理者が分かる。知らせのチャンネルは、決まっているかだけを出す', async () => {
    await setupGroup();
    await env.DB.prepare("UPDATE groups SET channel_id = '123456789012345678' WHERE id = 'grp'").run();
    const { body: list } = await get<AdminGroupRow[]>('/api/admin/groups');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'grp', title: 'テストの卓', guildId: GUILD, memberCount: 3, linkedCount: 3, adminCount: 0 });
    const { body: d, res } = await get<AdminGroupDetail>('/api/admin/groups/grp');
    expect(d.channelSet).toBe(true);
    // チャンネルのIDもBotのトークンも出さない
    for (const json of [JSON.stringify(list), JSON.stringify(d)]) {
      expect(json).not.toContain('123456789012345678');
      expect(json).not.toContain('test-bot-token');
    }
    expect(d.members.map((m) => m.name).sort()).toEqual(['こまち', 'ひより', 'ソラ']);
    expect(d.members.every((m) => m.userId && m.lastLoginAt)).toBe(true);
    expect(d.guildManagers).toEqual([{ id: '400000000000000010', name: 'ひより' }]);
    expect(res.status).toBe(200);
    expect((await get('/api/admin/groups/none')).status).toBe(404);
  });

  test('管理者を付け替える。印が0人になる外し方は断る', async () => {
    await setupGroup();
    const { body: d } = await get<AdminGroupDetail>('/api/admin/groups/grp');
    const sora = d.members.find((m) => m.name === 'ソラ')!, komachi = d.members.find((m) => m.name === 'こまち')!;
    expect((await post('/api/admin/groups/grp/admins', { memberId: sora.id, admin: true })).status).toBe(200);
    expect((await post('/api/admin/groups/grp/admins', { memberId: sora.id, admin: false })).body.error).toMatch(/0人/);
    expect((await post('/api/admin/groups/grp/admins', { memberId: komachi.id, admin: true })).status).toBe(200);
    expect((await post('/api/admin/groups/grp/admins', { memberId: sora.id, admin: false })).status).toBe(200);
    expect(await count("SELECT count(*) AS n FROM members WHERE group_id = 'grp' AND is_admin = 1")).toBe(1);
    expect(logs.some((l) => l.includes('"action":"setGroupAdmin"') && l.includes(OP.id))).toBe(true);
    // 管理者の付け替えで、ソラの画面でも管理者になる
    expect((await rpc(await loginAs({ id: '400000000000000012', name: 'こまち' }, [{ id: GUILD, name: 'T' }]), 'grp', 'getConsoleData')).body.isAdmin).toBe(true);
  });

  test('まだ開いていない人を、Discord IDで管理者として足せる。初めて開いたときにその行に結びつく', async () => {
    await setupGroup();
    expect((await post('/api/admin/groups/grp/admins', { discordId: '123', name: 'ダン', admin: true })).status).toBe(400);
    expect((await post('/api/admin/groups/grp/admins', { discordId: '500000000000000001', admin: true })).body.error).toMatch(/名前/);
    expect((await post('/api/admin/groups/grp/admins', { discordId: '500000000000000001', name: 'ダン', admin: true })).status).toBe(200);
    const dan = await loginAs({ id: '500000000000000001', name: 'ダン（Discord）' }, [{ id: GUILD, name: 'T' }]);
    const d = (await rpc(dan, 'grp', 'getConsoleData')).body;
    expect(d.me.name).toBe('ダン');
    expect(d.isAdmin).toBe(true);
    // すでにいる人をDiscord IDで指すと、その人に印を付ける
    expect((await post('/api/admin/groups/grp/admins', { discordId: '400000000000000011', admin: true })).body.message).toMatch(/ソラ/);
  });

  test('Discordサーバーを付け替える。IDの形・同じサーバー・名前の分からないサーバーを確かめる。知らせのチャンネルはいつも外す', async () => {
    await setupGroup();
    /** 基本・種類ごと・シリーズのチャンネルを決めておく */
    const setChannels = () => env.DB.batch([
      env.DB.prepare("UPDATE groups SET channel_id = '123456789012345678', remind_channel_id = '123456789012345679', recruit_channel_id = '123456789012345680' WHERE id = 'grp'"),
      env.DB.prepare(
        `INSERT INTO series_notify (group_id, series, channel_id, updated_at) VALUES ('grp', '港', '123456789012345681', 'x')
         ON CONFLICT (group_id, series) DO UPDATE SET channel_id = excluded.channel_id`,
      ),
    ]);
    const channels = () =>
      env.DB.prepare(
        `SELECT g.channel_id AS base, g.remind_channel_id AS remind, g.recruit_channel_id AS recruit, s.channel_id AS series
           FROM groups g JOIN series_notify s ON s.group_id = g.id WHERE g.id = 'grp'`,
      ).first();
    const cleared = { base: '', remind: '', recruit: '', series: '' };
    await setChannels();
    expect((await post('/api/admin/groups/grp/guild', { guildId: 'abc' })).status).toBe(400);
    expect((await post('/api/admin/groups/grp/guild', { guildId: '700000000000000001' })).body.error).toMatch(/名前/);
    // 断ったときは、チャンネルを残す
    expect(await channels()).toEqual({ base: '123456789012345678', remind: '123456789012345679', recruit: '123456789012345680', series: '123456789012345681' });
    let r = await post('/api/admin/groups/grp/guild', { guildId: '700000000000000001', guildName: '新しいサーバー' });
    expect(r.status).toBe(200);
    expect(r.body.message).toBe('「テストの卓」をDiscordサーバー「新しいサーバー」に結び直しました。知らせのチャンネルは外したので、新しいサーバーにBotを招いて選び直してください。');
    expect(await env.DB.prepare("SELECT guild_id || ' ' || guild_name AS v FROM groups WHERE id = 'grp'").first('v')).toBe('700000000000000001 新しいサーバー');
    expect(await channels()).toEqual(cleared);
    expect((await get<AdminGroupDetail>('/api/admin/groups/grp')).body.channelSet).toBe(false);
    expect(logs.some((l) => l.includes('"action":"changeGuild"') && l.includes('"guildId":"700000000000000001"'))).toBe(true);
    expect((await post('/api/admin/groups/grp/guild', { guildId: '700000000000000001' })).body.error).toMatch(/同じ/);
    // 古いサーバーの人は入れなくなる（控えが新しいので、聞き直しもしない）
    const sora = await loginAs({ id: '400000000000000011', name: 'ソラ' }, [{ id: GUILD, name: 'T' }]);
    expect((await rpc(sora, 'grp', 'getConsoleData')).status).toBe(403);
    // ログインした人の控えにあるサーバーなら、名前はそこから。このときもチャンネルを外す
    await setChannels();
    await loginAs({ id: '600', name: 'イブ' }, [{ id: '700000000000000002', name: '控えのサーバー', canManage: true }]);
    r = await post('/api/admin/groups/grp/guild', { guildId: '700000000000000002' });
    expect(r.body.message).toMatch(/^「テストの卓」をDiscordサーバー「控えのサーバー」に結び直しました。知らせのチャンネルは外した/);
    expect(await channels()).toEqual(cleared);
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
    await loginAs({ id: '400000000000000011', name: 'ソラ' }, [{ id: GUILD, name: 'T' }]);   // 2つ目のログイン
    const { body } = await get<AdminUserRow[]>('/api/admin/users');
    const sora = body.find((u) => u.id === '400000000000000011')!;
    expect(sora).toMatchObject({ name: 'ソラ', logins: 2, groups: [{ id: 'grp', title: 'テストの卓' }], bannedAt: '', operator: false });
    expect(body.find((u) => u.id === OP.id)!.operator).toBe(true);
  });

  test('ログインを切る。Discordでログインし直せば、また入れる', async () => {
    const { sora } = await setupGroup();
    expect((await post('/api/admin/users/400000000000000011/logout', {})).body.message).toMatch(/1件/);
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

  test('消す。利用者の行・ログイン・サーバーの控えと、どのグループのメンバーの行も消える。卓と回答には名前が残る', async () => {
    const SORA = '400000000000000011';
    const { admin, sora } = await setupGroup();
    await rpc(admin, 'grp', 'saveSession', { name: '迷宮', gm: 'ひより', members: ['ソラ'], status: '調整中' });
    const soraId = await env.DB.prepare("SELECT id FROM members WHERE group_id = 'grp' AND user_id = ?").bind(SORA).first<number>('id');
    const sid = await env.DB.prepare('SELECT id FROM sessions').first<number>('id');
    await env.DB.batch([
      env.DB.prepare("INSERT INTO poll_votes (session_id, date, member_id, vote, updated_at) VALUES (?, '2026-12-01', ?, '◯', '')").bind(sid, soraId),
      env.DB.prepare("INSERT INTO availability (member_id, date, mark) VALUES (?, '2026-12-01', '×')").bind(soraId),
      // ソラが作った別のグループ。そこでは、まだ開いていない人としてDiscord IDで先に登録されていた
      env.DB.prepare("INSERT INTO groups (id, guild_id, guild_name, title, created_by, created_at) VALUES ('g2', 'guild-2', 'S2', '二つ目', ?, '2026-10-01T00:00:00Z')").bind(SORA),
      env.DB.prepare("INSERT INTO members (group_id, name, discord_id, created_at) VALUES ('g2', 'そら', ?, '')").bind(SORA),
    ]);
    const r = await post('/api/admin/users/' + SORA + '/delete', {});
    expect(r.body.message).toBe('ソラを消しました（グループのメンバーの行2件も消しました）。Discordサーバーにいれば、次に開いたときにまた入れます。');
    for (const sql of ['SELECT count(*) AS n FROM users WHERE id = ?1', 'SELECT count(*) AS n FROM auth_sessions WHERE user_id = ?1', 'SELECT count(*) AS n FROM user_guilds WHERE user_id = ?1', 'SELECT count(*) AS n FROM members WHERE user_id = ?1 OR discord_id = ?1']) {
      expect(await count(sql, SORA), sql).toBe(0);
    }
    expect(await count('SELECT count(*) AS n FROM availability')).toBe(0);
    expect(await env.DB.prepare("SELECT guest_name FROM session_people WHERE role = 'member'").first('guest_name')).toBe('ソラ');
    expect(await env.DB.prepare('SELECT guest_name, member_id FROM poll_votes').first()).toEqual({ guest_name: 'ソラ', member_id: null });
    expect(await env.DB.prepare("SELECT created_by FROM groups WHERE id = 'g2'").first('created_by')).toBe('');
    expect((await rpc(sora, 'grp', 'getConsoleData')).status).toBe(401);
    // ほかの人はそのまま
    expect(await count("SELECT count(*) AS n FROM members WHERE group_id = 'grp'")).toBe(2);
    expect(logs.filter((l) => l.includes('"audit":"operator"')).map((l) => JSON.parse(l))).toEqual([{ audit: 'operator', by: OP.id, action: 'deleteUser', target: SORA }]);
  });

  test('運営者と、締め出している人は消せない。いない人は404', async () => {
    await setupGroup();
    expect((await post('/api/admin/users/' + OP.id + '/delete', {})).body.error).toBe('運営者は消せません（OPERATOR_IDSから外してからにしてください）。');
    await post('/api/admin/users/400000000000000012/ban', { banned: true });
    expect((await post('/api/admin/users/400000000000000012/delete', {})).body.error).toMatch(/^締め出している人は消せません。/);
    expect(await count("SELECT count(*) AS n FROM users WHERE id = '400000000000000012'")).toBe(1);
    expect((await post('/api/admin/users/none/delete', {})).status).toBe(404);
  });
});


describe('端の場合', () => {
  test('見回りの記録が読めなければ、記録が無いのと同じに扱う', async () => {
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('patrol', '{壊れた')").run();
    const { body } = await get<AdminOverview>('/api/admin/overview');
    expect(body.patrol.last).toBeNull();
    expect(body.patrol.stale).toBe(true);
  });

  test('まだ一度も使われていないグループは、作った日を最後に使われた日とする', async () => {
    await makeGroup('fresh', GUILD, '新しい卓');
    const { body } = await get<AdminGroupRow[]>('/api/admin/groups');
    const g = body.find((x) => x.id === 'fresh')!;
    expect(g.lastUsedAt).toBe(g.createdAt);
  });

  test('グループやメンバーが無ければ404。Discord IDでは外せない。使えない名前・同じ名前では足せない', async () => {
    await setupGroup();
    expect((await post('/api/admin/groups/none/admins', { memberId: 1, admin: true })).status).toBe(404);
    expect((await post('/api/admin/groups/none/guild', { guildId: '700000000000000001', guildName: 'S' })).status).toBe(404);
    expect((await post('/api/admin/groups/grp/admins', { memberId: 99999, admin: true })).status).toBe(404);
    expect((await post('/api/admin/groups/grp/admins', { discordId: '500000000000000001', admin: false })).body.error).toBe('外すときは、メンバーを選んでください。');
    expect((await post('/api/admin/groups/grp/admins', { discordId: '500000000000000001', name: '全員', admin: true })).body.error).toBe('その名前は使えません: 全員');
    expect((await post('/api/admin/groups/grp/admins', { discordId: '500000000000000001', name: 'ダン、エマ', admin: true })).body.error).toBe('その名前は使えません: ダン、エマ');
    expect((await post('/api/admin/groups/grp/admins', { discordId: '500000000000000001', name: 'ソラ', admin: true })).body.error).toBe('同じ名前のメンバーがいます: ソラ');
  });

  test('表示名の無い利用者は、ユーザー名で出す', async () => {
    await loginAs({ id: '300', name: 'ふつうの人' }, []);
    await env.DB.prepare("UPDATE users SET global_name = NULL WHERE id = '300'").run();
    const { body } = await get<AdminUserRow[]>('/api/admin/users');
    expect(body.find((u) => u.id === '300')!.name).toBe('u300');
  });
});
