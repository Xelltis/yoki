// Google カレンダーとの同期。人ごとに、入っているグループすべての卓と予定を見る。
//   書き込み … GM か参加者として入っている開催の卓を、本人のカレンダーに書く。変われば書き直し、外れたら（中止・日程の取り消し・
//             参加者から外れた・卓を消した）消す。開催日から WRITE_PAST_DAYS 日より前の卓は、もう触らない
//   読み込み … 本人の予定から、決めた時間帯が埋まっていれば ×、一部なら △ を、予定表に入れる。本人が入れた印・本人が消した日・
//             卓に入っている日には入れない。卓予定が書いた予定は数えない
// Google を呼ぶ回数は budget で数え、使い切ったらやめる（残りは次の回。どちらも、あるべき形に合わせ直す作りなので、途中でやめてよい）
import { SYSTEM_ACTOR } from '../auth/guard';
import { calendarItem, calendarSessions } from '../domain/calendar';
import { loadGroup } from '../domain/load';
import { bookedMap } from '../domain/model';
import type { Ctx, Session } from '../domain/types';
import { jstMs } from '../lib/ics';
import { sha256Hex } from '../lib/ids';
import { addDays, jst, minutesOfTime } from '../lib/jst';
import { open } from '../lib/secretbox';
import { type Busy, type GoogleEventBody, GoogleRevoked } from './api';
import type { GoogleDeps } from './config';

/** 書き込む卓の、過ぎた日数（これより前の卓は書き込まない・書き直さない・消さない） */
export const WRITE_PAST_DAYS = 7;
/** 1 回の同期で Google を呼ぶ回数の上限（Workers の 1 回の要求で外へ出せる数に収める） */
export const CALL_BUDGET = 40;
/** 予定を読み直す間隔 */
export const BUSY_EVERY_MS = 3600_000;
/** 見回り 1 回で回る人の数 */
export const PATROL_USERS = 5;

export const REVOKED_MESSAGE = 'Google の許可が取り消されたか、期限が切れました。もう一度「Google と連携する」を押してください。';

export type Budget = { left: number };

type LinkRow = { user_id: string; refresh_token: string; write_events: number; read_busy: number; busy_from: string; busy_to: string; busy_at: string | null };
type MappingRow = { session_id: number; event_id: string; hash: string; date: string };
/** 本人が入っているグループ（読み込んだデータと、本人のメンバーの行） */
type Joined = { ctx: Ctx; memberId: number; name: string };

/** 卓を Google カレンダーの予定にする */
export function eventBody(ctx: Ctx, s: Session & { date: string }): GoogleEventBody {
  const item = calendarItem(ctx, s);
  const span = item.span;
  const when = span.allDay
    ? { start: { date: span.date }, end: { date: span.endDate } }
    : {
        start: { dateTime: new Date(span.startMs).toISOString(), timeZone: 'Asia/Tokyo' },
        end: { dateTime: new Date(span.endMs).toISOString(), timeZone: 'Asia/Tokyo' },
      };
  return {
    summary: item.summary,
    location: item.location,
    description: item.description,
    ...when,
    source: { title: '卓予定', url: item.url },
    extendedProperties: { private: { yoki: '1', session: ctx.group.id + '-' + s.rowId } },
  };
}

/** 時間帯 [from, to) が予定でどれだけ埋まっているか。全部なら ×、一部なら △、無ければ空 */
export function markOf(busy: Busy[], from: number, to: number): string {
  const parts = busy
    .map((b) => [Math.max(b.start, from), Math.min(b.end, to)] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let covered = 0, reach = from;
  for (const [s, e] of parts) {
    const start = Math.max(s, reach);
    if (e > start) {
      covered += e - start;
      reach = e;
    }
  }
  if (!covered) return '';
  return covered >= to - from ? '×' : '△';
}

/** 'HH:MM' を分に。'24:00' は日の終わり */
export function windowMinutes(t: string): number | null {
  return t === '24:00' ? 1440 : minutesOfTime(t);
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function setError(db: D1Database, userId: string, message: string, now: Date): Promise<void> {
  await db.prepare('UPDATE google_links SET error = ?, checked_at = ? WHERE user_id = ?').bind(message, now.toISOString(), userId).run();
}

async function joinedGroups(db: D1Database, deps: GoogleDeps, userId: string, now: Date): Promise<Joined[]> {
  const rows = (await db.prepare('SELECT id, group_id, name FROM members WHERE user_id = ? ORDER BY id').bind(userId).all<{ id: number; group_id: string; name: string }>()).results;
  return Promise.all(
    rows.map(async (m) => ({ ctx: await loadGroup(db, m.group_id, SYSTEM_ACTOR, deps.appBase + '/g/' + m.group_id + '/', now), memberId: m.id, name: m.name })),
  );
}

/**
 * 卓を書き込む。あるべき予定と、書いた予定（google_events）を比べ、足りない・変わった・要らなくなったものだけ Google を呼ぶ。
 * 全部終われば true、budget を使い切って途中でやめたら false
 */
async function writeEvents(db: D1Database, deps: GoogleDeps, at: string, userId: string, groups: Joined[], now: Date, budget: Budget): Promise<boolean> {
  const today = jst(now).ymd;
  const want = new Map<number, { body: GoogleEventBody; hash: string; date: string }>();
  for (const g of groups) {
    for (const s of calendarSessions(g.ctx, g.name, WRITE_PAST_DAYS)) {
      const body = eventBody(g.ctx, s);
      want.set(s.rowId, { body, hash: await sha256Hex(JSON.stringify(body)), date: s.date });
    }
  }
  const have = (await db.prepare('SELECT session_id, event_id, hash, date FROM google_events WHERE user_id = ?').bind(userId).all<MappingRow>()).results;
  const old = addDays(today, -WRITE_PAST_DAYS);
  const drop = (sessionId: number) => db.prepare('DELETE FROM google_events WHERE user_id = ? AND session_id = ?').bind(userId, sessionId).run();
  const put = (sessionId: number, eventId: string, w: { hash: string; date: string }) =>
    db
      .prepare(
        `INSERT INTO google_events (user_id, session_id, event_id, hash, date) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (user_id, session_id) DO UPDATE SET event_id = excluded.event_id, hash = excluded.hash, date = excluded.date`,
      )
      .bind(userId, sessionId, eventId, w.hash, w.date)
      .run();

  for (const h of have) {
    if (want.has(h.session_id)) continue;
    // 過ぎた卓は、Google の予定を残したまま覚えるのをやめる（終わった卓の記録として残す）
    if (h.date < old) {
      await drop(h.session_id);
      continue;
    }
    if (budget.left <= 0) return false;
    budget.left--;
    await deps.api.deleteEvent(at, h.event_id);
    await drop(h.session_id);
  }
  const byId = new Map(have.map((h) => [h.session_id, h]));
  for (const [sessionId, w] of want) {
    const h = byId.get(sessionId);
    if (h && h.hash === w.hash) continue;
    if (budget.left <= 0) return false;
    budget.left--;
    // Google 側で消されていたら、書き足す（卓が変わったので、新しい中身を届ける）
    if (h && (await deps.api.updateEvent(at, h.event_id, w.body)) === 'ok') {
      await put(sessionId, h.event_id, w);
      continue;
    }
    if (h) budget.left--;
    await put(sessionId, await deps.api.insertEvent(at, w.body), w);
  }
  return true;
}

/** 予定から都合の印を入れる。範囲は、グループごとの予定表の日数（今日から） */
async function importBusy(db: D1Database, deps: GoogleDeps, at: string, link: LinkRow, groups: Joined[], now: Date, budget: Budget): Promise<void> {
  const today = jst(now).ymd;
  const days = Math.max(0, ...groups.map((g) => g.ctx.group.avail_days));
  if (!days) return;
  budget.left--;
  const busy = await deps.api.busy(at, jstMs(today, 0), jstMs(addDays(today, days), 0));
  const from = windowMinutes(link.busy_from) ?? 19 * 60;
  const to = windowMinutes(link.busy_to) ?? 23 * 60;
  const stmts: D1PreparedStatement[] = [];
  for (const g of groups) {
    const booked = bookedMap(g.ctx.sessions);
    const end = addDays(today, g.ctx.group.avail_days);
    const marks: { d: string; m: string }[] = [];
    for (let d = today; d < end; d = addDays(d, 1)) {
      if (booked[d]?.[g.name]) continue;
      const m = markOf(busy, jstMs(d, from), jstMs(d, to));
      if (m) marks.push({ d, m });
    }
    const json = JSON.stringify(marks);
    stmts.push(
      // 本人が入れた印（source が空）は上書きしない。本人が消した日には入れない
      db
        .prepare(
          `INSERT INTO availability (member_id, date, mark, source)
           SELECT ?1, json_extract(value, '$.d'), json_extract(value, '$.m'), 'google' FROM json_each(?2)
            WHERE NOT EXISTS (SELECT 1 FROM google_dismissed x WHERE x.member_id = ?1 AND x.date = json_extract(value, '$.d'))
           ON CONFLICT (member_id, date) DO UPDATE SET mark = excluded.mark WHERE availability.source = 'google'`,
        )
        .bind(g.memberId, json),
      // 予定が無くなった日の、Google から入れた印を消す
      db
        .prepare(
          `DELETE FROM availability WHERE member_id = ?1 AND source = 'google' AND date >= ?3 AND date < ?4
             AND date NOT IN (SELECT json_extract(value, '$.d') FROM json_each(?2))`,
        )
        .bind(g.memberId, json, today, end),
    );
  }
  await db.batch(stmts);
}

export type SyncOptions = {
  /** 卓を書き込むか（連携の設定でオフなら、こちらが true でも書かない） */
  write?: boolean;
  /** 予定を読むか。'due' は、前に読んでから BUSY_EVERY_MS 経っていれば */
  busy?: boolean | 'due';
  budget?: Budget;
};

/** 1 人ぶんの同期。結果の message は画面に出す（何もしなかったときは空） */
export async function syncUser(db: D1Database, deps: GoogleDeps, userId: string, now: Date, opts: SyncOptions = {}): Promise<{ ok: boolean; message: string }> {
  const link = await db
    .prepare('SELECT user_id, refresh_token, write_events, read_busy, busy_from, busy_to, busy_at FROM google_links WHERE user_id = ?')
    .bind(userId)
    .first<LinkRow>();
  if (!link) return { ok: false, message: 'Google と連携していません。' };
  const budget = opts.budget ?? { left: CALL_BUDGET };
  const write = (opts.write ?? true) && link.write_events === 1;
  const due = !link.busy_at || now.getTime() - Date.parse(link.busy_at) >= BUSY_EVERY_MS;
  const busy = link.read_busy === 1 && (opts.busy === true || (opts.busy === 'due' && due));
  if (!write && !busy) {
    await db.prepare('UPDATE google_links SET checked_at = ? WHERE user_id = ?').bind(now.toISOString(), userId).run();
    return { ok: true, message: '' };
  }
  try {
    budget.left--;
    const at = await deps.api.accessToken(await open(deps.key, link.refresh_token));
    const groups = await joinedGroups(db, deps, userId, now);
    const done = write ? await writeEvents(db, deps, at, userId, groups, now, budget) : false;
    if (busy) await importBusy(db, deps, at, link, groups, now, budget);
    const t = now.toISOString();
    await db
      .prepare(
        `UPDATE google_links SET error = '', checked_at = ?2, synced_at = CASE WHEN ?3 THEN ?2 ELSE synced_at END,
           busy_at = CASE WHEN ?4 THEN ?2 ELSE busy_at END WHERE user_id = ?1`,
      )
      .bind(userId, t, done ? 1 : 0, busy ? 1 : 0)
      .run();
    return { ok: true, message: write && !done ? '卓が多いので、残りは少し後に書き込みます。' : 'Google カレンダーと同期しました。' };
  } catch (e) {
    const message = e instanceof GoogleRevoked ? REVOKED_MESSAGE : errorText(e);
    await setError(db, userId, message, now);
    return { ok: false, message };
  }
}

const WRITERS = 'FROM google_links l JOIN members m ON m.user_id = l.user_id WHERE m.group_id = ? AND l.write_events = 1';

/** グループに、卓を Google に書き込んでいる人がいるか */
export async function hasGoogleWriters(db: D1Database, groupId: string): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 ' + WRITERS + ' LIMIT 1').bind(groupId).first());
}

/** グループの卓が変わったとき、そのグループのメンバーで連携している人の予定を書き直す（書き込みだけ） */
export async function syncGroupWrites(db: D1Database, deps: GoogleDeps, groupId: string, now: Date): Promise<void> {
  const users = (
    await db
      .prepare('SELECT l.user_id ' + WRITERS + ' ORDER BY l.user_id')
      .bind(groupId)
      .all<{ user_id: string }>()
  ).results;
  const budget = { left: CALL_BUDGET };
  for (const u of users) {
    if (budget.left <= 0) break;
    await syncUser(db, deps, u.user_id, now, { write: true, busy: false, budget });
  }
}

/** 見回り（5 分おき）。長く回っていない人から順に、書き込みと（1 時間おきの）予定の読み込み */
export async function patrolGoogle(db: D1Database, deps: GoogleDeps, now: Date): Promise<void> {
  const users = (await db.prepare('SELECT user_id FROM google_links ORDER BY checked_at IS NOT NULL, checked_at LIMIT ?').bind(PATROL_USERS).all<{ user_id: string }>()).results;
  const budget = { left: CALL_BUDGET };
  for (const u of users) {
    if (budget.left <= 0) break;
    await syncUser(db, deps, u.user_id, now, { write: true, busy: 'due', budget });
  }
}

/** 書き込んだ予定を消す（連携を外す・書き込みをやめるとき）。消せなかったぶん（budget を超えた・失敗した）は残す。消した数を返す */
export async function removeEvents(db: D1Database, deps: GoogleDeps, at: string | null, userId: string, budget: Budget): Promise<number> {
  const have = (await db.prepare('SELECT session_id, event_id FROM google_events WHERE user_id = ?').bind(userId).all<{ session_id: number; event_id: string }>()).results;
  let n = 0;
  if (at) {
    for (const h of have) {
      if (budget.left <= 0) break;
      budget.left--;
      try {
        await deps.api.deleteEvent(at, h.event_id);
        n++;
      } catch {
        // 消せなかった予定は Google に残る（本人が消せる）
      }
    }
  }
  await db.prepare('DELETE FROM google_events WHERE user_id = ?').bind(userId).run();
  return n;
}

/** Google から入れた印と、本人が消した日の記録を消す（連携を外す・読み込みをやめるとき） */
export function removeBusyMarks(db: D1Database, userId: string): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM availability WHERE source = 'google' AND member_id IN (SELECT id FROM members WHERE user_id = ?)").bind(userId),
    db.prepare('DELETE FROM google_dismissed WHERE member_id IN (SELECT id FROM members WHERE user_id = ?)').bind(userId),
  ];
}

/** access token を取る。取れなければ null（取り消されていれば、連携の印に残す） */
export async function tryAccessToken(db: D1Database, deps: GoogleDeps, userId: string, sealed: string, now: Date): Promise<string | null> {
  try {
    return await deps.api.accessToken(await open(deps.key, sealed));
  } catch (e) {
    await setError(db, userId, e instanceof GoogleRevoked ? REVOKED_MESSAGE : errorText(e), now);
    return null;
  }
}
