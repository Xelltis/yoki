// 卓をDiscordのイベントに出す: 中身・Botの権限・設定のつまみ・書き直しの印・見回りでの同期（作る・書き換える・消す）・片付け
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SYSTEM_ACTOR } from '../../src/worker/auth/guard';
import { botCanCreateEvents } from '../../src/worker/discord/member';
import { EVENT_ERROR, eventBody, processDiscordEvents, sweepOrphanEvents } from '../../src/worker/discord/events';
import { loadGroup } from '../../src/worker/domain/load';
import { cleanup } from '../../src/worker/domain/patrol';
import { addDays, jst } from '../../src/worker/lib/jst';
import { fail, loginAs, makeGroup, ok, rpc, today } from './helpers';

const GUILD = '123456789012345678';
const BOT = '900000000000000001';
const API = 'https://discord.com/api/v10';
let admin: string;
let T: (n: number) => string;

type Reply = number | Response | Error;
type Call = { method: string; url: string; body: Record<string, any> | null };
let calls: Call[] = [];
/** 方法ごとの返事の並び（尽きたら、POSTは作ったイベント、PATCHは200、DELETEは204） */
let replies: Record<string, Reply[]> = {};
let created = 0;

/** DiscordのAPIを差し替える。Botの権限は、rolesで決める（イベントを作成あり） */
function mockDiscord(perms = String(1n << 44n)) {
  calls = []; replies = {}; created = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const next = replies[method]?.shift();
    if (next instanceof Error) throw next;
    if (next instanceof Response) return next;
    if (typeof next === 'number') return new Response(next === 204 ? null : JSON.stringify({ message: 'x' }), { status: next });
    if (method === 'GET' && url.endsWith('/users/@me')) return Response.json({ id: BOT });
    if (method === 'GET' && url.endsWith('/channels')) return Response.json([{ id: '123456789012345671', name: '卓', type: 0, position: 0, parent_id: null }]);
    if (method === 'GET' && url.includes('/members/')) return Response.json({ roles: ['r1'] });
    if (method === 'GET') return Response.json({ owner_id: '1', roles: [{ id: GUILD, permissions: '0' }, { id: 'r1', permissions: perms }] });
    if (method === 'POST') return Response.json({ id: 'ev' + ++created });
    if (method === 'PATCH') return Response.json({ id: url.split('/').pop() });
    return new Response(null, { status: 204 });
  });
}
const events = () => calls.filter((c) => c.url.includes('/scheduled-events'));
const load = (id: string) => loadGroup(env.DB, id, SYSTEM_ACTOR, 'https://yoki.test/g/' + id + '/', new Date(), { token: 'test-bot-token' });
const run = (budget = 10) => processDiscordEvents(env.DB, load, { left: budget });
const group = () => env.DB.prepare("SELECT discord_events, events_pending, events_error FROM groups WHERE id = 'ev'").first<Record<string, any>>();
const mappings = async () => (await env.DB.prepare("SELECT session_id, guild_id, event_id, start_at FROM discord_events WHERE group_id = 'ev' ORDER BY session_id").all<Record<string, any>>()).results;
const save = (o: Record<string, unknown>) => ok(admin, 'ev', 'saveSession', { gm: 'ひより', members: [], start: '20:00', end: '23:00', status: '開催', ...o });

beforeEach(async () => {
  await makeGroup('ev', GUILD);
  admin = await loginAs({ id: '400000000000000010', name: 'ひより' }, [{ id: GUILD, name: 'T', canManage: true }]);
  await rpc(admin, 'ev', 'getConsoleData');
  const t0 = await today();
  T = (n) => addDays(t0, n);
  mockDiscord();
});
afterEach(() => vi.restoreAllMocks());

/** イベントに出す設定にする（印も付く） */
async function turnOn() {
  await ok(admin, 'ev', 'saveConsoleSettings', { discordEvents: true });
}

describe('イベントの中身', () => {
  test('時刻のある卓は、その時刻の外部のイベント。場所は卓の場所。説明にGM・参加者・グループの画面', async () => {
    const ctx = { appUrl: 'https://yoki.test/g/ev/', group: { title: 'テストの卓' } } as any;
    const s = { rowId: 1, name: 'A', gm: 'ひより', members: ['ソラ'], date: '2026-10-10', start: '20:00', end: '23:00', place: 'ユドナリウム', memo: '', updatedAt: '' } as any;
    expect(eventBody(ctx, s)).toEqual({
      name: 'A', privacy_level: 2, entity_type: 3, channel_id: null,
      scheduled_start_time: '2026-10-10T11:00:00.000Z', scheduled_end_time: '2026-10-10T14:00:00.000Z',
      description: 'GM: ひより\n参加: ソラ\n\nテストの卓（Yoki）: https://yoki.test/g/ev/',
      entity_metadata: { location: 'ユドナリウム' },
    });
  });

  test('終日の卓はその日の0時から翌日の0時。場所が無ければ画面のアドレス、それも無ければグループの名前。長い名前と説明は切る', async () => {
    const s = { rowId: 1, name: 'あ'.repeat(120), gm: '', members: [], date: '2026-10-10', start: '', end: '', place: '', memo: 'い'.repeat(1200), updatedAt: '' } as any;
    const b = eventBody({ appUrl: 'https://yoki.test/g/ev/', group: { title: 'テストの卓' } } as any, s);
    expect([b.scheduled_start_time, b.scheduled_end_time]).toEqual(['2026-10-09T15:00:00.000Z', '2026-10-10T15:00:00.000Z']);
    expect(b.entity_metadata.location).toBe('https://yoki.test/g/ev/');
    expect(b.name).toHaveLength(100);
    expect(b.description).toHaveLength(1000);
    expect(eventBody({ appUrl: '', group: { title: 'テストの卓' } } as any, s).entity_metadata.location).toBe('テストの卓');
  });
});

describe('Botがイベントを作れるか', () => {
  test('ロールの権限に、イベントを作成・イベントの管理・管理者のどれかがあれば作れる', async () => {
    expect(await botCanCreateEvents('tok', GUILD)).toBe(true);
    mockDiscord(String(1n << 33n));
    expect(await botCanCreateEvents('tok', GUILD)).toBe(true);
    mockDiscord('8');
    expect(await botCanCreateEvents('tok', GUILD)).toBe(true);
    mockDiscord('19456');
    expect(await botCanCreateEvents('tok', GUILD)).toBe(false);
  });

  test('Botがサーバーにいなければfalse。Discordが答えなければnull', async () => {
    replies.GET = [new Response('{}', { status: 200 })];
    expect(await botCanCreateEvents('tok', GUILD)).toBeNull();   // 自分のIDが読めない
    replies.GET = [Response.json({ id: BOT }), 404];
    expect(await botCanCreateEvents('tok', GUILD)).toBe(false);
    replies.GET = [Response.json({ id: BOT }), 403];
    expect(await botCanCreateEvents('tok', GUILD)).toBe(false);
    replies.GET = [Response.json({ id: BOT }), 500];
    expect(await botCanCreateEvents('tok', GUILD)).toBeNull();
    replies.GET = [Response.json({ id: BOT }), Response.json({ roles: [] }), 500];
    expect(await botCanCreateEvents('tok', GUILD)).toBeNull();
    replies.GET = [new Error('network')];
    expect(await botCanCreateEvents('tok', GUILD)).toBeNull();
  });
});

describe('設定のつまみ', () => {
  test('入れるときはBotの権限を確かめる。入れたら・切ったら、書き直しの印が付く', async () => {
    const r = await ok(admin, 'ev', 'saveConsoleSettings', { discordEvents: true });
    expect(r.message).toBe('保存しました: Discordのイベントに出すのをON');
    expect(r.data.settings).toMatchObject({ discordEvents: true, eventsError: '' });
    expect(await group()).toEqual({ discord_events: 1, events_pending: 1, events_error: '' });
    await env.DB.prepare("UPDATE groups SET events_pending = 0, events_error = 'x' WHERE id = 'ev'").run();
    await ok(admin, 'ev', 'saveConsoleSettings', { discordEvents: false });
    expect(await group()).toEqual({ discord_events: 0, events_pending: 1, events_error: '' });
  });

  test('権限が無い・確かめられない・サーバーのIDの形が違うときは入れない', async () => {
    mockDiscord('19456');
    expect((await fail(admin, 'ev', 'saveConsoleSettings', { discordEvents: true })).error).toBe(EVENT_ERROR.forbidden);
    replies.GET = [500];
    expect((await fail(admin, 'ev', 'saveConsoleSettings', { discordEvents: true })).error).toBe('Botの権限を確かめられませんでした。時間をおいてもう一度入れてください。');
  });

  test('サーバーのIDの形が違う（開発用のサンプルなど）・Botが設定されていなければ入れない', async () => {
    const { saveConsoleSettings } = await import('../../src/worker/domain/settings');
    const actor = { memberId: 1, name: 'ひより', isAdmin: true, userId: '' };
    await env.DB.prepare("UPDATE groups SET guild_id = 'guild-x' WHERE id = 'ev'").run();
    const bad = await loadGroup(env.DB, 'ev', actor, 'https://yoki.test/g/ev/', new Date(), { token: 'test-bot-token' });
    await expect(saveConsoleSettings(bad, { discordEvents: true })).rejects.toThrow(EVENT_ERROR.badGuild);
    const noBot = await loadGroup(env.DB, 'ev', actor, 'https://yoki.test/g/ev/');
    await expect(saveConsoleSettings(noBot, { discordEvents: true })).rejects.toThrow(EVENT_ERROR.noBot);
  });

  test('チャンネルの一覧は、イベントに出すグループだけ、Botがイベントを作れるかも返す', async () => {
    expect((await ok(admin, 'ev', 'getDiscordChannels')).canEvents).toBeNull();
    await env.DB.prepare("UPDATE groups SET discord_events = 1 WHERE id = 'ev'").run();
    expect((await ok(admin, 'ev', 'getDiscordChannels')).canEvents).toBe(true);
  });
});

describe('書き直しの印', () => {
  test('卓を変える呼び出しで、イベントに出しているグループだけ印が付く', async () => {
    await save({ name: 'A', date: T(3) });
    expect((await group())!.events_pending).toBe(0);
    await env.DB.prepare("UPDATE groups SET discord_events = 1 WHERE id = 'ev'").run();
    await save({ name: 'B', date: T(4) });
    expect((await group())!.events_pending).toBe(1);
  });

  test('運営者がサーバーを付け替えると、印が付く', async () => {
    const { changeGuild } = await import('../../src/worker/domain/admin');
    await changeGuild(env.DB, 'ev', { guildId: '123456789012345679', guildName: '別のサーバー' });
    expect((await group())!.events_pending).toBe(1);
  });
});

describe('見回りでの同期', () => {
  test('これからの「開催」の卓をイベントにする。中止・募集・遠い先・始まった卓は出さない。済んだら印を外す', async () => {
    await save({ name: '出す', date: T(3) });
    await save({ name: '中止', date: T(4), status: '中止' });
    await save({ name: '募集', date: '', status: '募集' });
    await save({ name: '遠い', date: T(61) });
    await save({ name: '今日の終日', date: T(0), start: '', end: '' });
    await turnOn();
    await run();
    expect(events().map((c) => [c.method, c.url, c.body?.name])).toEqual([['POST', API + '/guilds/' + GUILD + '/scheduled-events', '出す']]);
    expect(await mappings()).toEqual([{ session_id: 1, guild_id: GUILD, event_id: 'ev1', start_at: new Date(Date.parse(T(3) + 'T20:00:00+09:00')).toISOString() }]);
    expect(await group()).toEqual({ discord_events: 1, events_pending: 0, events_error: '' });
    // 印が無ければ、何もしない
    calls = [];
    await run();
    expect(calls).toEqual([]);
  });

  test('中身が変わったら書き換え、Discordで消されていたら作り直す。変わらなければ呼ばない', async () => {
    await save({ name: 'A', date: T(3) });
    await turnOn();
    await run();
    await env.DB.prepare("UPDATE groups SET events_pending = 1 WHERE id = 'ev'").run();
    calls = [];
    await run();
    expect(events()).toEqual([]);
    await save({ id: 'S001', name: 'A（改）', date: T(3) });
    await run();
    expect(events().map((c) => [c.method, c.url.split('/').pop()])).toEqual([['PATCH', 'ev1']]);
    await save({ id: 'S001', name: 'A（改2）', date: T(3) });
    replies.PATCH = [404];
    calls = [];
    await run();
    expect(events().map((c) => c.method)).toEqual(['PATCH', 'POST']);
    expect((await mappings())[0]!.event_id).toBe('ev2');
  });

  test('中止にした卓・消した卓のイベントを消す（もう無くても）。始まったイベントは、呼ばずに控えだけ消す', async () => {
    await save({ name: 'A', date: T(3) });
    await save({ name: 'B', date: T(4) });
    await save({ name: 'C', date: T(5) });
    await turnOn();
    await run();
    await ok(admin, 'ev', 'bulkUpdateSessions', { ids: ['S001'], action: 'status', value: '中止' });
    await ok(admin, 'ev', 'deleteSession', { id: 'S002' });
    await env.DB.prepare("UPDATE discord_events SET start_at = '2020-01-01T00:00:00.000Z' WHERE session_id = 3").run();
    await env.DB.prepare("UPDATE sessions SET status = '終了' WHERE seq = 3").run();
    replies.DELETE = [404];
    calls = [];
    await run();
    expect(events().map((c) => [c.method, c.url.split('/').pop()])).toEqual([['DELETE', 'ev1'], ['DELETE', 'ev2']]);
    expect(await mappings()).toEqual([]);
  });

  test('出すのをやめたら、まだ始まっていないイベントを全部消す', async () => {
    await save({ name: 'A', date: T(3) });
    await turnOn();
    await run();
    await ok(admin, 'ev', 'saveConsoleSettings', { discordEvents: false });
    calls = [];
    await run();
    expect(events().map((c) => c.method)).toEqual(['DELETE']);
    expect(await mappings()).toEqual([]);
  });

  test('サーバーを付け替えたら、前のサーバーのイベントを消して、新しいサーバーに作る', async () => {
    await save({ name: 'A', date: T(3) });
    await turnOn();
    await run();
    const { changeGuild } = await import('../../src/worker/domain/admin');
    await changeGuild(env.DB, 'ev', { guildId: '123456789012345679', guildName: '別のサーバー' });
    calls = [];
    await run();
    expect(events().map((c) => [c.method, c.url.split('/')[6]])).toEqual([['DELETE', GUILD], ['POST', '123456789012345679']]);
  });

  test('権限が無ければ失敗を残して止める。混んでいれば、続きを次の回に回す。ほかの失敗は卓の名前を添えて残す', async () => {
    await save({ name: 'A', date: T(3) });
    await save({ name: 'B', date: T(4) });
    await turnOn();
    replies.POST = [403];
    await run();
    expect(await group()).toMatchObject({ events_pending: 0, events_error: EVENT_ERROR.forbidden });
    await env.DB.prepare("UPDATE groups SET events_pending = 1 WHERE id = 'ev'").run();
    replies.POST = [Response.json({ id: 'evA' }), 429];
    await run();
    expect(await group()).toMatchObject({ events_pending: 1, events_error: '' });
    expect((await mappings()).map((m) => m.event_id)).toEqual(['evA']);
    replies.POST = [new Error('network')];
    await run();
    expect((await group())!.events_pending).toBe(1);
    replies.POST = [400];
    await run();
    expect((await group())!.events_error).toBe('「B」をDiscordのイベントにできませんでした（HTTP 400）。');
  });

  test('消すときに混んでいれば、続きを次の回に回す', async () => {
    await save({ name: 'A', date: T(3) });
    await turnOn();
    await run();
    await ok(admin, 'ev', 'bulkUpdateSessions', { ids: ['S001'], action: 'status', value: '中止' });
    replies.DELETE = [503];
    await run();
    expect(await group()).toMatchObject({ events_pending: 1 });
    expect(await mappings()).toHaveLength(1);
  });

  test('1回に呼べる数（枠）を使い切ったら、続きを次の回に回す。出すのは20件まで', async () => {
    const dates = Array.from({ length: 12 }, (_, i) => T(i + 3));
    await save({ name: '長編 1', dates: dates.concat(Array.from({ length: 8 }, (_, i) => T(i + 20))), date: dates[0] });
    await save({ name: '21件目', date: T(40) });
    await turnOn();
    await run(10);
    expect(events()).toHaveLength(10);
    expect((await group())!.events_pending).toBe(1);
    await run(10);
    expect(await mappings()).toHaveLength(20);
    expect((await group())!.events_pending).toBe(0);
    expect(events().map((c) => c.body?.name)).not.toContain('21件目');
    // 消すときも枠で止める
    await ok(admin, 'ev', 'saveConsoleSettings', { discordEvents: false });
    await run(0);
    expect((await group())!.events_pending).toBe(1);
  });

  test('作り直しの途中で枠が尽きたら、続きを次の回に回す', async () => {
    await save({ name: 'A', date: T(3) });
    await turnOn();
    await run();
    await save({ id: 'S001', name: 'A（改）', date: T(3) });
    replies.PATCH = [404];
    calls = [];
    await run(1);
    expect(events().map((c) => c.method)).toEqual(['PATCH']);
    expect((await group())!.events_pending).toBe(1);
  });

  test('Botが無い・サーバーのIDの形が違うときは、失敗を残す（呼ばない）', async () => {
    await save({ name: 'A', date: T(3) });
    await env.DB.prepare("UPDATE groups SET discord_events = 1, events_pending = 1 WHERE id = 'ev'").run();
    await processDiscordEvents(env.DB, (id) => loadGroup(env.DB, id, SYSTEM_ACTOR, '', new Date()), { left: 10 });
    expect((await group())!.events_error).toBe(EVENT_ERROR.noBot);
    await env.DB.prepare("UPDATE groups SET guild_id = 'dev-guild', events_pending = 1 WHERE id = 'ev'").run();
    await run();
    expect((await group())!.events_error).toBe(EVENT_ERROR.badGuild);
    expect(events()).toEqual([]);
  });
});

describe('片付け', () => {
  test('消えたグループのイベント: まだ始まっていなければDiscordで消す。始まったもの・Botが無いときは控えだけ消す。混んでいれば残す', async () => {
    const put = (sid: number, start: string) =>
      env.DB.prepare("INSERT INTO discord_events (group_id, session_id, guild_id, event_id, hash, date, start_at) VALUES ('gone', ?, ?, ?, 'h', '2026-01-01', ?)")
        .bind(sid, GUILD, 'e' + sid, start).run();
    const future = new Date(Date.now() + 86400_000).toISOString();
    await put(1, future);
    await put(2, '2020-01-01T00:00:00.000Z');
    await put(3, future);
    replies.DELETE = [204, 429];
    await sweepOrphanEvents(env.DB, 'tok', new Date(), { left: 10 });
    expect(events().map((c) => c.url.split('/').pop())).toEqual(['e1', 'e3']);
    const left = async () => (await env.DB.prepare("SELECT session_id FROM discord_events WHERE group_id = 'gone'").all<{ session_id: number }>()).results.map((r) => r.session_id);
    expect(await left()).toEqual([3]);
    // 枠が無ければ、呼ばずに残す
    calls = [];
    await sweepOrphanEvents(env.DB, 'tok', new Date(), { left: 0 });
    expect(await left()).toEqual([3]);
    // Botが無ければ、控えだけ消す
    await sweepOrphanEvents(env.DB, '', new Date(), { left: 10 });
    expect(await left()).toEqual([]);
    // 何も無ければ何もしない
    await sweepOrphanEvents(env.DB, 'tok', new Date(), { left: 10 });
  });

  test('毎日の片付けで、過ぎた卓のイベントの控えを消す', async () => {
    const now = new Date();
    const ymd = jst(now).ymd;
    await env.DB.prepare("INSERT INTO discord_events (group_id, session_id, guild_id, event_id, hash, date, start_at) VALUES ('ev', 1, ?, 'a', 'h', ?, 'x'), ('ev', 2, ?, 'b', 'h', ?, 'x')")
      .bind(GUILD, addDays(ymd, -2), GUILD, ymd).run();
    await cleanup(env.DB, now);
    expect((await mappings()).map((m) => m.session_id)).toEqual([2]);
  });
});
