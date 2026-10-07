// Googleカレンダーとの同期: 卓の書き込み（足す・書き直す・消す）と、予定から都合の印を入れる
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import type { Bindings } from '../../src/worker/env';
import { googleDeps, type GoogleDeps } from '../../src/worker/google/config';
import { readFake, writeFake } from '../../src/worker/google/dev';
import {
  BUSY_EVERY_MS, CALL_BUDGET, eventBody, googleBudget, hasGoogleWriters, markOf, patrolGoogle, removeBusyMarks, removeEvents, REVOKED_MESSAGE, syncGroupWrites, syncUser,
  tryAccessToken, windowMinutes,
} from '../../src/worker/google/sync';
import { jstMs } from '../../src/worker/lib/ics';
import { addDays } from '../../src/worker/lib/jst';
import { seal } from '../../src/worker/lib/secretbox';
import { ok, setupGroup, today } from './helpers';

const SORA = '400000000000000011', KOMACHI = '400000000000000012', HIYORI = '400000000000000010';

let deps: GoogleDeps;
let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
let now: Date;
beforeEach(async () => {
  deps = (await googleDeps(env as unknown as Bindings, 'https://yoki.test'))!;
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
  now = new Date();
});

async function link(userId: string, o: { write?: number; read?: number; from?: string; to?: string; busyAt?: string | null } = {}) {
  await env.DB.prepare(
    `INSERT INTO google_links (user_id, email, refresh_token, write_events, read_busy, busy_from, busy_to, busy_at, created_at)
     VALUES (?, 'dev@example.com', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(userId, await seal(deps.key, 'dev-refresh-' + userId), o.write ?? 1, o.read ?? 0, o.from ?? '19:00', o.to ?? '23:00', o.busyAt ?? null, now.toISOString())
    .run();
}
const linkRow = (userId: string) => env.DB.prepare('SELECT * FROM google_links WHERE user_id = ?').bind(userId).first<Record<string, any>>();
const events = async () => Object.values((await readFake(env.DB)).events);
const mappings = async (userId = SORA) => (await env.DB.prepare('SELECT * FROM google_events WHERE user_id = ? ORDER BY session_id').bind(userId).all<Record<string, any>>()).results;

describe('小さな決まり', () => {
  test('時間帯が全部埋まれば ×、一部なら △、無ければ空。重なる予定は1つに数える', () => {
    expect(markOf([], 0, 100)).toBe('');
    expect(markOf([{ start: 100, end: 200 }], 0, 100)).toBe('');
    expect(markOf([{ start: -50, end: 150 }], 0, 100)).toBe('×');
    expect(markOf([{ start: 0, end: 60 }, { start: 40, end: 100 }], 0, 100)).toBe('×');
    expect(markOf([{ start: 0, end: 60 }, { start: 10, end: 50 }], 0, 100)).toBe('△');
    expect(markOf([{ start: 70, end: 90 }, { start: 0, end: 30 }], 0, 100)).toBe('△');
  });

  test('時間帯の時刻。24:00は日の終わり', () => {
    expect(windowMinutes('24:00')).toBe(1440);
    expect(windowMinutes('19:30')).toBe(1170);
    expect(windowMinutes('夜')).toBeNull();
  });

  test('卓を予定にする。時刻があれば日時、無ければ終日。Yokiの印を付ける', () => {
    const ctx = { appUrl: 'https://yoki.test/g/grp/', group: { id: 'grp', title: 'テストの卓' } } as any;
    const s = { rowId: 7, name: 'A', gm: 'ひより', members: [], date: '2026-10-10', start: '20:00', end: '23:00', place: 'ユドナリウム', memo: '', updatedAt: '' } as any;
    expect(eventBody(ctx, s)).toMatchObject({
      summary: 'A', location: 'ユドナリウム', start: { dateTime: '2026-10-10T11:00:00.000Z', timeZone: 'Asia/Tokyo' }, end: { dateTime: '2026-10-10T14:00:00.000Z' },
      source: { title: 'Yoki', url: 'https://yoki.test/g/grp/' }, extendedProperties: { private: { yoki: '1', session: 'grp-7' } },
    });
    expect(eventBody(ctx, { ...s, start: '' })).toMatchObject({ start: { date: '2026-10-10' }, end: { date: '2026-10-11' } });
  });
});

describe('卓の書き込み', () => {
  beforeEach(async () => {
    await ok(G.admin, G.id, 'saveSession', { name: 'ソラが参加', gm: 'ひより', members: ['ソラ'], date: T(3), start: '20', end: '23', status: '開催' });
    await ok(G.admin, G.id, 'saveSession', { name: 'ソラがGM', gm: 'ソラ', members: [], date: T(4), status: '開催' });
    await ok(G.admin, G.id, 'saveSession', { name: 'こまちだけ', gm: 'こまち', members: [], date: T(5), status: '開催' });
    await ok(G.admin, G.id, 'saveSession', { name: '中止', gm: 'ソラ', members: [], date: T(6), status: '中止' });
    await link(SORA);
  });

  test('連携していなければ何もしない', async () => {
    expect(await syncUser(env.DB, deps, KOMACHI, now)).toEqual({ ok: false, message: 'Googleと連携していません。' });
  });

  test('入っている開催の卓だけを書く。2回目は変わっていなければGoogleを呼ばない', async () => {
    expect(await syncUser(env.DB, deps, SORA, now)).toEqual({ ok: true, message: 'Googleカレンダーと同期しました。' });
    expect((await events()).map((e) => e.summary).sort()).toEqual(['ソラがGM', 'ソラが参加']);
    expect((await mappings()).length).toBe(2);
    const row = (await linkRow(SORA))!;
    expect(row.synced_at).not.toBeNull();
    expect(row.busy_at).toBeNull();
    expect(row.error).toBe('');
    const seq = (await readFake(env.DB)).seq;
    await syncUser(env.DB, deps, SORA, now);
    expect((await readFake(env.DB)).seq).toBe(seq);
  });

  test('変われば書き直し、中止・参加者から外れたら消す。Google側で消されていたら書き足す', async () => {
    await syncUser(env.DB, deps, SORA, now);
    await env.DB.prepare("UPDATE sessions SET name = 'ソラが参加（改）' WHERE name = 'ソラが参加'").run();
    await syncUser(env.DB, deps, SORA, now);
    expect((await events()).map((e) => e.summary).sort()).toEqual(['ソラがGM', 'ソラが参加（改）']);
    await env.DB.prepare("UPDATE sessions SET status = '中止' WHERE name = 'ソラが参加（改）'").run();
    await syncUser(env.DB, deps, SORA, now);
    expect((await events()).map((e) => e.summary)).toEqual(['ソラがGM']);
    expect((await mappings()).length).toBe(1);
    // Google側で消された予定
    await writeFake(env.DB, { ...(await readFake(env.DB)), events: {} });
    await env.DB.prepare("UPDATE sessions SET place = 'Discord' WHERE name = 'ソラがGM'").run();
    await syncUser(env.DB, deps, SORA, now);
    const ev = await events();
    expect(ev.map((e) => e.location)).toEqual(['Discord']);
    expect((await mappings())[0]!.event_id).toBe(Object.keys((await readFake(env.DB)).events)[0]);
  });

  test('開催日から7日より前の卓は、Googleの予定を残したまま覚えるのをやめる', async () => {
    await env.DB.prepare("INSERT INTO google_events (user_id, session_id, event_id, hash, date) VALUES (?, 9999, 'old-event', 'h', ?)").bind(SORA, T(-8)).run();
    await writeFake(env.DB, { seq: 0, events: { 'old-event': {} as any }, busy: [], revoked: [] });
    await syncUser(env.DB, deps, SORA, now);
    expect((await mappings()).map((m) => m.session_id)).not.toContain(9999);
    expect((await readFake(env.DB)).events['old-event']).toBeDefined();
  });

  test('呼ぶ回数を使い切ったら途中でやめ、次の回に続ける', async () => {
    const r = await syncUser(env.DB, deps, SORA, now, { budget: { left: 2 } });
    expect(r).toEqual({ ok: true, message: '卓が多いので、残りは少し後に書き込みます。' });
    expect((await events()).length).toBe(1);
    expect((await linkRow(SORA))!.synced_at).toBeNull();
    // 消すほうも途中でやめる
    await syncUser(env.DB, deps, SORA, now);
    await env.DB.prepare("UPDATE sessions SET status = '中止'").run();
    expect((await syncUser(env.DB, deps, SORA, now, { budget: { left: 1 } })).message).toContain('残りは少し後に');
    expect((await events()).length).toBe(2);
  });

  test('書き込みも読み込みもしない回は、回った時刻だけ残す', async () => {
    await env.DB.prepare('UPDATE google_links SET write_events = 0').run();
    expect(await syncUser(env.DB, deps, SORA, now)).toEqual({ ok: true, message: '' });
    expect((await linkRow(SORA))!.checked_at).toBe(now.toISOString());
    expect(await events()).toEqual([]);
  });

  test('許可が取り消されていたら、連携の印に残す。ほかの失敗はその文を残す', async () => {
    await deps.api.revoke('dev-refresh-' + SORA);
    expect(await syncUser(env.DB, deps, SORA, now)).toEqual({ ok: false, message: REVOKED_MESSAGE });
    expect((await linkRow(SORA))!.error).toBe(REVOKED_MESSAGE);
    await env.DB.prepare("UPDATE google_links SET refresh_token = 'broken'").run();
    const r = await syncUser(env.DB, deps, SORA, now);
    expect(r.ok).toBe(false);
    expect((await linkRow(SORA))!.error).toBe(r.message);
    const throws = { ...deps, api: { ...deps.api, accessToken: () => Promise.reject('文字の失敗') } };
    await env.DB.prepare('UPDATE google_links SET refresh_token = ?').bind(await seal(deps.key, 'x')).run();
    expect((await syncUser(env.DB, throws, SORA, now)).message).toBe('文字の失敗');
  });

  test('グループの卓が変わったら、そのグループで書き込みをしている人を回る。使い切ったら残りは見回りに任せる', async () => {
    await link(KOMACHI);
    await link(HIYORI, { write: 0 });
    expect(await hasGoogleWriters(env.DB, G.id)).toBe(true);
    expect(await hasGoogleWriters(env.DB, 'other')).toBe(false);
    await syncGroupWrites(env.DB, deps, G.id, now);
    expect((await events()).map((e) => e.summary).sort()).toEqual(['こまちだけ', 'ソラがGM', 'ソラが参加']);
    // 先に回るひよりに、使える回数と同じ数の卓。ひよりで使い切り、ソラとこまちには回らない
    await env.DB.prepare('UPDATE google_links SET write_events = 1').run();
    await env.DB.prepare('DELETE FROM google_events').run();
    await writeFake(env.DB, { seq: 0, events: {}, busy: [], revoked: [] });
    const m = await env.DB.prepare("SELECT id FROM members WHERE name = 'ひより'").first<number>('id');
    for (let i = 0; i < CALL_BUDGET; i++) {
      const sid = (await env.DB.prepare("INSERT INTO sessions (group_id, seq, name, status, date, editor, updated_at) VALUES (?, ?, ?, '開催', ?, '', '') RETURNING id")
        .bind(G.id, 100 + i, '多い' + i, T(10)).first<number>('id'))!;
      await env.DB.prepare("INSERT INTO session_people (session_id, role, pos, member_id) VALUES (?, 'gm', 0, ?)").bind(sid, m).run();
    }
    await syncGroupWrites(env.DB, deps, G.id, now);
    expect(await mappings()).toEqual([]);
    expect(await mappings(KOMACHI)).toEqual([]);
  });

  test('見回りは、長く回っていない人から。使い切ったらやめる', async () => {
    await link(KOMACHI);
    await env.DB.prepare("UPDATE google_links SET checked_at = '2026-01-01T00:00:00Z' WHERE user_id = ?").bind(SORA).run();
    await patrolGoogle(env.DB, deps, now);
    expect((await linkRow(KOMACHI))!.checked_at).toBe(now.toISOString());
    expect((await linkRow(SORA))!.checked_at).toBe(now.toISOString());
    const m = await env.DB.prepare("SELECT id FROM members WHERE name = 'こまち'").first<number>('id');
    for (let i = 0; i < CALL_BUDGET; i++) {
      const sid = (await env.DB.prepare("INSERT INTO sessions (group_id, seq, name, status, date, editor, updated_at) VALUES (?, ?, ?, '開催', ?, '', '') RETURNING id")
        .bind(G.id, 200 + i, '多い' + i, T(10)).first<number>('id'))!;
      await env.DB.prepare("INSERT INTO session_people (session_id, role, pos, member_id) VALUES (?, 'gm', 0, ?)").bind(sid, m).run();
    }
    const later = new Date(now.getTime() + 60_000);
    await env.DB.prepare("UPDATE google_links SET checked_at = '2026-01-01T00:00:00Z' WHERE user_id = ?").bind(KOMACHI).run();
    await patrolGoogle(env.DB, deps, later);
    expect((await linkRow(SORA))!.checked_at).toBe(now.toISOString());
  });

  test('見回りでGoogleに使える回数は、先にDiscordへ送った分を、外へ出せる数（50）から引いた残り', async () => {
    expect(googleBudget(0)).toBe(CALL_BUDGET);
    expect(googleBudget(20)).toBe(25);
    expect(googleBudget(60)).toBe(0);
    // 残りが無ければ、だれも回らない
    await patrolGoogle(env.DB, deps, now, 0);
    expect((await linkRow(SORA))!.checked_at).toBeNull();
  });

  test('書いた予定を消す。access tokenが無ければ控えだけ消す。消せなかった予定は残す', async () => {
    await syncUser(env.DB, deps, SORA, now);
    const failing = { ...deps, api: { ...deps.api, deleteEvent: () => Promise.reject(new Error('x')) } };
    expect(await removeEvents(env.DB, failing, 'at', SORA, { left: CALL_BUDGET })).toBe(0);
    expect(await mappings()).toEqual([]);
    expect((await events()).length).toBe(2);
    await syncUser(env.DB, { ...deps }, SORA, new Date(now.getTime() + 1));
    expect(await removeEvents(env.DB, deps, 'at', SORA, { left: 1 })).toBe(1);
    expect(await removeEvents(env.DB, deps, null, SORA, { left: CALL_BUDGET })).toBe(0);
  });

  test('access token: 取れれば返し、取れなければnullと連携の印', async () => {
    const row = (await linkRow(SORA))!;
    expect(await tryAccessToken(env.DB, deps, SORA, row.refresh_token, now)).toBe('dev-access');
    expect(await tryAccessToken(env.DB, deps, SORA, 'broken', now)).toBeNull();
    expect((await linkRow(SORA))!.error).not.toBe('');
    await deps.api.revoke('dev-refresh-' + SORA);
    expect(await tryAccessToken(env.DB, deps, SORA, row.refresh_token, now)).toBeNull();
    expect((await linkRow(SORA))!.error).toBe(REVOKED_MESSAGE);
  });
});

describe('予定から都合の印', () => {
  const memberId = () => env.DB.prepare("SELECT id FROM members WHERE name = 'ソラ'").first<number>('id');
  const marks = async () =>
    Object.fromEntries((await env.DB.prepare('SELECT date, mark, source FROM availability WHERE member_id = ? ORDER BY date').bind(await memberId()).all<{ date: string; mark: string; source: string }>())
      .results.map((r) => [r.date, r.mark + (r.source ? ':' + r.source : '')]));
  const busyOn = (d: string, from: string, to: string) => ({ start: new Date(jstMs(d, Number(from.slice(0, 2)) * 60)).toISOString(), end: new Date(jstMs(d, Number(to.slice(0, 2)) * 60)).toISOString() });

  test('時間帯が埋まれば ×、一部なら △。本人の印・本人が消した日・卓の日には入れない。予定が無くなれば消す', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: 'ソラの卓', gm: 'ひより', members: ['ソラ'], date: T(3), status: '開催' });
    await link(SORA, { write: 0, read: 1 });
    const id = (await memberId())!;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO availability (member_id, date, mark) VALUES (?, ?, '△')").bind(id, T(5)),
      env.DB.prepare('INSERT INTO google_dismissed (member_id, date) VALUES (?, ?)').bind(id, T(6)),
      env.DB.prepare("INSERT INTO availability (member_id, date, mark, source) VALUES (?, ?, '×', 'google')").bind(id, T(7)),
    ]);
    const full = (d: string) => busyOn(d, '18', '24');
    await writeFake(env.DB, { seq: 0, events: {}, revoked: [], busy: [full(T(1)), busyOn(T(2), '20', '21'), full(T(3)), full(T(5)), full(T(6))] });
    expect(await syncUser(env.DB, deps, SORA, now, { busy: true })).toEqual({ ok: true, message: 'Googleカレンダーと同期しました。' });
    expect(await marks()).toEqual({ [T(1)]: '×:google', [T(2)]: '△:google', [T(5)]: '△' });
    expect((await linkRow(SORA))!.busy_at).toBe(now.toISOString());
    // 予定が変われば、Googleから入れた印も変わる
    await writeFake(env.DB, { seq: 0, events: {}, revoked: [], busy: [busyOn(T(1), '20', '21')] });
    await syncUser(env.DB, deps, SORA, now, { busy: true });
    expect(await marks()).toEqual({ [T(1)]: '△:google', [T(5)]: '△' });
  });

  test('時間帯は人ごと。dueなら1時間おき', async () => {
    await link(SORA, { write: 0, read: 1, from: '10:00', to: '24:00', busyAt: new Date(now.getTime() - BUSY_EVERY_MS / 2).toISOString() });
    await writeFake(env.DB, { seq: 0, events: {}, revoked: [], busy: [busyOn(T(1), '10', '24')] });
    await syncUser(env.DB, deps, SORA, now, { busy: 'due' });
    expect(await marks()).toEqual({});
    await syncUser(env.DB, deps, SORA, new Date(now.getTime() + BUSY_EVERY_MS), { busy: 'due' });
    expect(await marks()).toEqual({ [T(1)]: '×:google' });
    // 読めない時間帯は19:00〜23:00とみる
    await env.DB.prepare("UPDATE google_links SET busy_from = 'x', busy_to = 'y'").run();
    await writeFake(env.DB, { seq: 0, events: {}, revoked: [], busy: [busyOn(T(1), '19', '23')] });
    await syncUser(env.DB, deps, SORA, now, { busy: true });
    expect(await marks()).toEqual({ [T(1)]: '×:google' });
  });

  test('どのグループにも入っていなければ読まない', async () => {
    await env.DB.prepare("INSERT INTO users (id, username, guilds_checked_at, created_at, last_login_at) VALUES ('400000000000000077', 'x', '', '', '')").run();
    await link('400000000000000077', { write: 0, read: 1 });
    await writeFake(env.DB, { seq: 0, events: {}, revoked: [], busy: [busyOn(T(1), '18', '24')] });
    expect((await syncUser(env.DB, deps, '400000000000000077', now, { busy: true })).ok).toBe(true);
  });

  test('印と、消した日の記録を消す文', async () => {
    await link(SORA, { write: 0, read: 1 });
    const id = (await memberId())!;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO availability (member_id, date, mark, source) VALUES (?, ?, '×', 'google')").bind(id, T(1)),
      env.DB.prepare("INSERT INTO availability (member_id, date, mark) VALUES (?, ?, '△')").bind(id, T(2)),
      env.DB.prepare('INSERT INTO google_dismissed (member_id, date) VALUES (?, ?)').bind(id, T(3)),
    ]);
    await env.DB.batch(removeBusyMarks(env.DB, SORA));
    expect(await marks()).toEqual({ [T(2)]: '△' });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM google_dismissed').first<number>('n')).toBe(0);
  });
});
