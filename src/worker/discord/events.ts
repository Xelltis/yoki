// 卓をDiscordのサーバーのイベント（Guild Scheduled Event）に出す。グループごとに管理者が入れる（groups.discord_events。初めは切ってある）。
// 出すのは、これから60日以内の「開催」の卓（20件まで。サーバーのイベントは100件までなので、ほかのボットの分を残す）。
// 外部のイベント（EXTERNAL）にして、場所には卓の場所（無ければYokiのアドレス）を書く。外部のイベントは、始まりの時刻に自動で始まり、
// 終わりの時刻に自動で終わるので、始まったイベントには触らない（控えだけを消す）。
// 書くのは見回り（domain/patrol.ts）だけ。卓を変える呼び出しは、グループに書き直しが要る印（events_pending）を付けるだけにする
// （重なった呼び出しが同じイベントを2つ作らないように。Googleとの同期と、外へ出せる呼び出しの数を分け合うため）
import { DISCORD_API } from '../auth/oauth';
import { calendarItem } from '../domain/calendar';
import { STATUS } from '../domain/constants';
import type { Ctx, Session } from '../domain/types';
import { jstMs } from '../lib/ics';
import { sha256Hex } from '../lib/ids';
import { addDays } from '../lib/jst';
import { discordFetch } from './calls';
import { isChannelId } from './channel';

/** イベントに出す卓の日数と件数 */
export const EVENT_DAYS = 60;
export const EVENTS_MAX = 20;
/** 1回の見回りで、イベントのためにDiscordを呼ぶ回数の上限 */
export const EVENT_BUDGET = 10;
/** 始まりまでこれより短い卓は、作らず書き直さない（Discordは始まりの過ぎたイベントを断る） */
const START_MARGIN_MS = 60_000;

export const EVENT_ERROR = {
  noBot: 'YokiのBotが設定されていません（運営者の設定）。',
  badGuild: 'このグループのDiscordサーバーには、イベントを出せません。',
  forbidden: 'Botに「イベントを作成」の権限がありません。管理画面の「知らせ」から、イベントの権限を付けてBotを招き直してください。',
} as const;

/** Discordのイベントの中身（作る・書き換えるときに送る） */
export type EventBody = {
  name: string;
  privacy_level: 2;
  scheduled_start_time: string;
  scheduled_end_time: string;
  description: string;
  entity_type: 3;
  entity_metadata: { location: string };
  channel_id: null;
};

/** 卓をイベントにする。終日の卓（開始時刻が無い）は、その日の0時から翌日の0時まで */
export function eventBody(ctx: Pick<Ctx, 'appUrl' | 'group'>, s: Session & { date: string }): EventBody {
  const item = calendarItem(ctx, s);
  const span = item.span;
  const [start, end] = span.allDay ? [jstMs(span.date, 0), jstMs(span.endDate, 0)] : [span.startMs, span.endMs];
  return {
    name: item.summary.slice(0, 100),
    privacy_level: 2,
    scheduled_start_time: new Date(start).toISOString(),
    scheduled_end_time: new Date(end).toISOString(),
    description: item.description.slice(0, 1000),
    entity_type: 3,
    entity_metadata: { location: (item.location || item.url || ctx.group.title).slice(0, 100) },
    channel_id: null,
  };
}

type Mapping = { session_id: number; guild_id: string; event_id: string; hash: string; date: string; start_at: string };
export type Budget = { left: number };
/** 同期の結果。done（済んだ）・more（呼び出しの枠が尽きたか、Discordが混んでいる。次の回に続ける）・error（失敗。理由はmessage） */
export type SyncResult = { state: 'done' | 'more' | 'error'; message: string };

/** 出す卓。「開催」で、今日からEVENT_DAYS日のうち、始まりまでSTART_MARGIN_MS以上ある卓を、日の順にEVENTS_MAX件まで */
function wanted(ctx: Ctx): { s: Session & { date: string }; body: EventBody }[] {
  const last = addDays(ctx.today, EVENT_DAYS);
  const soon = ctx.now.getTime() + START_MARGIN_MS;
  return ctx.sessions
    .filter((s): s is Session & { date: string } => s.status === STATUS.HELD && !!s.date && s.date >= ctx.today && s.date <= last)
    .map((s) => ({ s, body: eventBody(ctx, s) }))
    .filter((x) => Date.parse(x.body.scheduled_start_time) > soon)
    .sort((a, b) => a.body.scheduled_start_time.localeCompare(b.body.scheduled_start_time))
    .slice(0, EVENTS_MAX);
}

const eventsUrl = (guildId: string, eventId = '') => DISCORD_API + '/guilds/' + guildId + '/scheduled-events' + (eventId ? '/' + eventId : '');

/** Discordを呼ぶ。通信が切れたら status 0 */
async function call(token: string, method: string, url: string, body?: EventBody): Promise<{ status: number; id: string }> {
  try {
    const res = await discordFetch(url, {
      method,
      headers: { Authorization: 'Bot ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = (await res.json().catch(() => null)) as { id?: string } | null;
    return { status: res.status, id: j?.id ?? '' };
  } catch {
    return { status: 0, id: '' };
  }
}

/** 混んでいる・Discordの不調・通信の切れ（次の回に送り直す） */
const retryLater = (status: number) => status === 0 || status === 429 || status >= 500;

/**
 * グループのイベントを、あるべき形に合わせる。discord_eventsが0なら、まだ始まっていないイベントを全部消す（出すのをやめたとき）。
 * 控え（discord_events）は、最後に2文でまとめて書く（D1の問い合わせの数を抑えるため）
 */
export async function syncDiscordEvents(ctx: Ctx, budget: Budget): Promise<SyncResult> {
  const db = ctx.db, g = ctx.group, token = ctx.bot.token;
  const now = ctx.now.getTime();
  const have = (await db.prepare('SELECT session_id, guild_id, event_id, hash, date, start_at FROM discord_events WHERE group_id = ?').bind(g.id).all<Mapping>()).results;
  const on = g.discord_events === 1;
  if (on && !token) return { state: 'error', message: EVENT_ERROR.noBot };
  if (on && !isChannelId(g.guild_id)) return { state: 'error', message: EVENT_ERROR.badGuild };
  const want = new Map<number, { s: Session & { date: string }; body: EventBody; hash: string }>();
  if (on) for (const w of wanted(ctx)) want.set(w.s.rowId, { ...w, hash: await sha256Hex(JSON.stringify(w.body)) });
  const keep = new Map<number, Mapping>();
  const drop: number[] = [];
  const write = async (result: SyncResult): Promise<SyncResult> => {
    const stmts: D1PreparedStatement[] = [];
    if (drop.length) stmts.push(db.prepare('DELETE FROM discord_events WHERE group_id = ?1 AND session_id IN (SELECT value FROM json_each(?2))').bind(g.id, JSON.stringify(drop)));
    if (keep.size) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO discord_events (group_id, session_id, guild_id, event_id, hash, date, start_at)
             SELECT ?1, json_extract(value, '$.session_id'), json_extract(value, '$.guild_id'), json_extract(value, '$.event_id'),
                    json_extract(value, '$.hash'), json_extract(value, '$.date'), json_extract(value, '$.start_at') FROM json_each(?2) WHERE true
             ON CONFLICT (group_id, session_id) DO UPDATE SET guild_id = excluded.guild_id, event_id = excluded.event_id, hash = excluded.hash,
               date = excluded.date, start_at = excluded.start_at`,
          )
          .bind(g.id, JSON.stringify([...keep.values()])),
      );
    }
    if (stmts.length) await db.batch(stmts);
    return result;
  };

  // 出さなくなった卓（中止・消した・日が遠い・出すのをやめた）と、付け替える前のサーバーのイベントを消す。始まったイベントは控えだけを消す
  for (const h of have) {
    const w = want.get(h.session_id);
    if (w && h.guild_id === g.guild_id) continue;
    if (Date.parse(h.start_at) <= now) { drop.push(h.session_id); continue; }
    if (budget.left <= 0) return write({ state: 'more', message: '' });
    budget.left--;
    const r = await call(token, 'DELETE', eventsUrl(h.guild_id, h.event_id));
    if (retryLater(r.status)) return write({ state: 'more', message: '' });
    // 消せた・もう無い・もう見られない（Botが外された）ときは、控えを消す（いつまでも消しに行かないように）
    drop.push(h.session_id);
  }
  // 作る・書き換える
  for (const [rowId, w] of want) {
    const h = have.find((x) => x.session_id === rowId && x.guild_id === g.guild_id);
    if (h && h.hash === w.hash) continue;
    if (budget.left <= 0) return write({ state: 'more', message: '' });
    budget.left--;
    let r = h ? await call(token, 'PATCH', eventsUrl(g.guild_id, h.event_id), w.body) : { status: 404, id: '' };
    if (r.status === 404) {
      // まだ無いか、Discordで消された。作り直す
      if (h) {
        if (budget.left <= 0) return write({ state: 'more', message: '' });
        budget.left--;
      }
      r = await call(token, 'POST', eventsUrl(g.guild_id), w.body);
    }
    if (retryLater(r.status)) return write({ state: 'more', message: '' });
    if (r.status === 401 || r.status === 403) return write({ state: 'error', message: EVENT_ERROR.forbidden });
    if (r.status !== 200 || !r.id) return write({ state: 'error', message: '「' + w.s.name + '」をDiscordのイベントにできませんでした（HTTP ' + r.status + '）。' });
    keep.set(rowId, { session_id: rowId, guild_id: g.guild_id, event_id: r.id, hash: w.hash, date: w.s.date, start_at: w.body.scheduled_start_time });
  }
  return write({ state: 'done', message: '' });
}

/**
 * 書き直しが要るグループを1つ取って、イベントを合わせる（見回りが毎回呼ぶ）。取ったら印を0にし、続きがあれば1に戻す。
 * 取るのは UPDATE … RETURNING で1つだけ（2つの見回りが同じグループを取らないように）。結果の失敗は events_error に残す
 */
export async function processDiscordEvents(db: D1Database, load: (groupId: string) => Promise<Ctx>, budget: Budget): Promise<void> {
  const r = await db
    .prepare('UPDATE groups SET events_pending = 0 WHERE id = (SELECT id FROM groups WHERE events_pending = 1 ORDER BY id LIMIT 1) RETURNING id')
    .first<{ id: string }>();
  if (!r) return;
  const result = await syncDiscordEvents(await load(r.id), budget);
  await db
    .prepare('UPDATE groups SET events_pending = CASE WHEN ?2 THEN 1 ELSE events_pending END, events_error = ?3 WHERE id = ?1')
    .bind(r.id, result.state === 'more' ? 1 : 0, result.message)
    .run();
}

/**
 * 持ち主のいなくなったイベントを消す（グループが消えた）。まだ始まっていなければDiscordで消し、控えを消す。毎時、見回りが呼ぶ
 */
export async function sweepOrphanEvents(db: D1Database, token: string, now: Date, budget: Budget): Promise<void> {
  const rows = (await db
    .prepare('SELECT group_id, session_id, guild_id, event_id, start_at FROM discord_events WHERE group_id NOT IN (SELECT id FROM groups) LIMIT ?')
    .bind(EVENT_BUDGET)
    .all<Mapping & { group_id: string }>()).results;
  const done: [string, number][] = [];
  for (const h of rows) {
    if (Date.parse(h.start_at) > now.getTime() && token) {
      if (budget.left <= 0) break;
      budget.left--;
      if (retryLater((await call(token, 'DELETE', eventsUrl(h.guild_id, h.event_id))).status)) continue;
    }
    done.push([h.group_id, h.session_id]);
  }
  if (done.length) {
    await db
      .prepare('DELETE FROM discord_events WHERE EXISTS (SELECT 1 FROM json_each(?1) j WHERE json_extract(j.value, \'$[0]\') = discord_events.group_id AND json_extract(j.value, \'$[1]\') = discord_events.session_id)')
      .bind(JSON.stringify(done))
      .run();
  }
}
