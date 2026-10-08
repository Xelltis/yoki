// 知らせの見回り（GAS版Notify.jsのdailyNotify・sendTomorrow_・sendUrge_・sendStartingSoon_）。cronが5分おきに呼ぶ。
//   毎時の仕事（開催前の知らせ・期間前の催促・募集の締め切りの知らせ・キャラシの催促・過ぎた卓の自動終了）は、metaの印で1時間に1回だけ回す
//   開始直前の知らせは毎回見る
//   運営者への知らせ（operator-notice.ts）: 毎時Botのトークンを確かめ、毎日10時台に新しいバージョンを見る。続けて失敗したら知らせる
// 送る前に卓の「送った」印を取り（UPDATE … WHERE … IS NULL）、取れた卓だけを送る。重なって動いても二重には送らない。
// 全部の送り先で失敗したら印を戻し、次の回で送り直す
import type { PatrolRecord } from '../../shared/admin';
import { SYSTEM_ACTOR } from '../auth/guard';
import { savedOrigin } from '../auth/origin';
import { EVENT_BUDGET, processDiscordEvents, sweepOrphanEvents } from '../discord/events';
import { mentionsOf, recruitDuePayload, recruitLink, sessionEmbed, sheetUrgePayload } from '../discord/payloads';
import { appendLog, discordCalls, postDiscord, realSleep, type Sleep } from '../discord/send';
import { postSessionNotice } from '../discord/threads';
import { sessionTargets, type Target, targetNote } from '../discord/targets';
import type { Bindings } from '../env';
import { googleDeps } from '../google/config';
import { googleBudget, patrolGoogle, WRITE_PAST_DAYS } from '../google/sync';
import { addDays, daysBetween, jst, minutesOfTime } from '../lib/jst';
import { updateDeps, type UpdateDeps } from '../update/config';
import { DATED, SOON_LATE_MIN, STATUS } from './constants';
import { HISTORY_KEEP } from './history';
import { loadGroup } from './load';
import { checkBot, GITHUB_CALLS, noticePatrolFailed, noticeVersion, VERSION_HOUR } from './operator-notice';
import { aheadText, notifyHourOf, notifyYmdOf } from './notify';
import type { Ctx, Session } from './types';

/** 1通に載せる卓の数（Discordのembedは1通に10個まで） */
const EMBEDS_PER_MESSAGE = 10;
const KEEP_LOG_ROWS = 500;
const KEEP_AVAIL_DAYS = 90;
const KEEP_DAY_NOTE_DAYS = 365;

/**
 * sleepは送り直しの待ち。operatorは運営者への知らせ（Botのトークンの確かめ・新しいバージョン）に使うGitHubで、
 * cronの入口（runPatrol）が渡したときだけ回す（知らせのテストが、GitHubとBotの確かめを呼ばないように）
 */
type Deps = { sleep: Sleep; operator?: { github: UpdateDeps } };

/** 見回りの様子（metaのpatrol）。運営者の管理画面が読む */
export type { PatrolRecord };

/**
 * 見回りを回し、その様子をmetaに残す（patrol: 最後の回の結果、patrol_ok_at: 最後にうまくいった時刻）。
 * 失敗は記録してから投げ直す（Cloudflareのcronの失敗としても残す）。runはテストで差し替える
 */
export async function runPatrol(env: Bindings, scheduledTime: number, deps: Deps = { sleep: realSleep, operator: { github: updateDeps(env) } }, run = patrol): Promise<void> {
  const t0 = Date.now();
  let error = '';
  try {
    await run(env, scheduledTime, deps);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    const at = new Date(scheduledTime).toISOString();
    const put = 'INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value';
    try {
      // 続けて失敗した回数を数え、知らせる回数になったら運営者に知らせる
      const fails = error ? failsOf(await env.DB.prepare("SELECT value FROM meta WHERE key = 'patrol'").first<string>('value')) + 1 : 0;
      const rec: PatrolRecord = { at, ms: Date.now() - t0, ok: !error, error, fails };
      await env.DB.batch([env.DB.prepare(put).bind('patrol', JSON.stringify(rec)), ...(error ? [] : [env.DB.prepare(put).bind('patrol_ok_at', at)])]);
      if (error) await noticePatrolFailed(env, fails, error, new Date(scheduledTime));
    } catch {
      // 記録できなくても（知らせられなくても）、見回りの結果は変えない
    }
  }
}

/** 前の回の記録から、それまで続けて失敗した回数を読む（前の版の記録にはfailsが無いので、失敗なら1回と数える） */
function failsOf(raw: string | null): number {
  try {
    const rec = raw ? (JSON.parse(raw) as PatrolRecord) : null;
    return !rec || rec.ok ? 0 : rec.fails ?? 1;
  } catch {
    return 0;
  }
}

export async function patrol(env: Bindings, scheduledTime: number, deps: Deps): Promise<void> {
  const now = new Date(scheduledTime);
  // この回に外へ出した呼び出しを数え始める（Googleに回せる残りを決めるため）
  const callsAtStart = discordCalls();
  const db = env.DB;
  const p = jst(now);
  const appBase = await savedOrigin(env);
  const bot = { token: env.DISCORD_BOT_TOKEN ?? '', clientId: env.DISCORD_CLIENT_ID };
  const load = (groupId: string) => loadGroup(db, groupId, SYSTEM_ACTOR, appBase ? appBase + '/g/' + groupId + '/' : '', now, bot);
  const groupsOf = async (sql: string, ...args: unknown[]) => (await db.prepare(sql).bind(...args).all<{ group_id: string }>()).results.map((r) => r.group_id);

  const hourly = await claim(db, 'hourly', p.ymd + 'T' + String(p.hour).padStart(2, '0'));
  if (hourly) {
    // 開催日が過ぎた「開催」の卓を「終了」に（読み込むたびにもするが、誰も開かないグループのため）
    await db
      .prepare(`UPDATE sessions SET status = '終了', updated_at = ?1 WHERE status = '開催' AND date < ?2 AND group_id IN (SELECT id FROM groups WHERE auto_finish = 1)`)
      .bind(now.toISOString(), p.ymd)
      .run();
    // 毎時の知らせがありそうなグループだけを、1回ずつ読む（D1の問い合わせの数を抑えるため。読み込みは1回14文）
    const ids = new Set([
      // 開催前の知らせ: 近いうちの開催日で、まだ送っていない卓
      ...(await groupsOf(
        `SELECT DISTINCT s.group_id FROM sessions s JOIN groups g ON g.id = s.group_id
          WHERE g.remind_enabled = 1 AND s.status = '開催' AND s.notified_at IS NULL AND s.date BETWEEN ?1 AND ?2`,
        p.ymd, addDays(p.ymd, 31),
      )),
      // 期間前の催促: 期間の始まりが明日の、募集中・調整中の卓
      ...(await groupsOf(
        `SELECT DISTINCT s.group_id FROM sessions s JOIN groups g ON g.id = s.group_id
          WHERE g.urge = 1 AND s.status IN ('募集', '調整中') AND s.urged_at IS NULL AND s.window_from = ?1`,
        addDays(p.ymd, 1),
      )),
      // 募集の締め切りの知らせ: 締め切りが今日の、募集中の卓
      ...(await groupsOf(
        `SELECT DISTINCT s.group_id FROM sessions s JOIN groups g ON g.id = s.group_id
          WHERE g.urge = 1 AND s.status = '募集' AND s.due_urged_at IS NULL AND s.recruit_due = ?1`,
        p.ymd,
      )),
      // キャラシの催促: 締め切りが今日か明日で、まだ催促していない卓
      ...(await groupsOf(
        `SELECT DISTINCT group_id FROM sessions WHERE sheet_due BETWEEN ?1 AND ?2 AND sheet_urged_at IS NULL AND status IN ('募集', '調整中', '開催')`,
        p.ymd, addDays(p.ymd, 1),
      )),
    ]);
    for (const id of ids) {
      const ctx = await load(id);
      await sendReminders(ctx, p.hour, deps);
      await sendUrges(ctx, p.hour, deps);
      await sendRecruitDue(ctx, p.hour, deps);
      await sendSheetUrges(ctx, p.hour, deps);
    }
  }

  // 開始直前の知らせ: 今日開く卓（開始時刻のある「開催」）
  for (const id of await groupsOf(
    `SELECT DISTINCT s.group_id FROM sessions s JOIN groups g ON g.id = s.group_id
      WHERE g.soon = 1 AND s.status = '開催' AND s.date = ?1 AND s.soon_at IS NULL AND s.start_time <> ''`,
    p.ymd,
  )) await sendStartingSoon(await load(id), deps);

  // Discordのイベント: 書き直しが要るグループを1つずつ（毎時、持ち主のいなくなったイベントも片付ける）
  const events = { left: EVENT_BUDGET };
  await processDiscordEvents(db, load, events);
  if (hourly) await sweepOrphanEvents(db, bot.token, now, events);

  // 運営者への知らせ: 毎時Botのトークンを確かめ、毎日10時台に新しいバージョンを見る
  let github = 0;
  if (deps.operator) {
    if (hourly) await checkBot(env, now);
    if (p.hour >= VERSION_HOUR && (await claim(db, 'operator_daily', p.ymd))) {
      await noticeVersion(env, deps.operator.github, now, appBase);
      github = GITHUB_CALLS;
    }
  }

  // Googleカレンダーとの同期（連携している人を、長く回っていない人から少しずつ）。先にDiscordとGitHubを呼んだ分を、外へ出せる数から引く
  const google = await googleDeps(env, appBase || 'http://localhost');
  if (google) await patrolGoogle(db, google, now, googleBudget(discordCalls() - callsAtStart + github));

  if (p.hour >= 4 && (await claim(db, 'daily', p.ymd))) await cleanup(db, now);
}

/** metaの印をvalueに進める。進められたら（この時刻の仕事をまだしていなければ）true */
async function claim(db: D1Database, key: string, value: string): Promise<boolean> {
  const r = await db
    .prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE meta.value <> excluded.value RETURNING value')
    .bind(key, value)
    .first();
  return !!r;
}

/** 卓の送った印を取る。取れた卓（まだ誰も送っていない卓）のidを返す */
type MarkColumn = 'notified_at' | 'urged_at' | 'soon_at' | 'sheet_urged_at' | 'due_urged_at';

async function claimMark(ctx: Ctx, column: MarkColumn, sessions: Session[]): Promise<Set<number>> {
  if (!sessions.length) return new Set();
  const r = await ctx.db
    .prepare(`UPDATE sessions SET ${column} = ?1 WHERE id IN (SELECT value FROM json_each(?2)) AND ${column} IS NULL RETURNING id`)
    .bind(ctx.now.toISOString(), JSON.stringify(sessions.map((s) => s.rowId)))
    .all<{ id: number }>();
  return new Set(r.results.map((x) => x.id));
}

/** 送れなかった卓の印を戻す（自分が付けた印だけ） */
async function releaseMark(ctx: Ctx, column: MarkColumn, rowIds: number[]): Promise<void> {
  if (!rowIds.length) return;
  await ctx.db
    .prepare(`UPDATE sessions SET ${column} = NULL WHERE id IN (SELECT value FROM json_each(?2)) AND ${column} = ?1`)
    .bind(ctx.now.toISOString(), JSON.stringify(rowIds))
    .run();
}

const logTo = (ctx: Ctx) => ({ db: ctx.db, groupId: ctx.group.id, token: ctx.bot.token });

/**
 * 開催前の知らせ。今日が知らせの日（開催日のN日前）で、送る時刻（シリーズか基本の時刻）を過ぎた卓を送る。
 * 送り先と「あと何日」ごとに1通にまとめ（10卓ごとに分ける）、どこか1か所に届いた卓を送った扱いにする
 */
export async function sendReminders(ctx: Ctx, hour: number, deps: Deps): Promise<void> {
  // ほかの知らせのためにグループを読んだときも、止めていれば送らない
  if (!ctx.group.remind_enabled) return;
  const kind = '開催前の知らせ';
  const due = ctx.sessions.filter((s) => DATED.includes(s.status) && s.date && !s.notifiedAt && notifyYmdOf(ctx, s) === ctx.today && notifyHourOf(ctx, s) <= hour);
  if (!due.length) return;
  const withTargets = due.filter((s) => sessionTargets(ctx, s, 'remind').length);
  const noTarget = due.filter((s) => !withTargets.includes(s));
  if (noTarget.length) await appendLog(logTo(ctx), kind, noTarget.map((s) => s.name).join('、'), '送らず: 送り先のチャンネルが未設定');
  const claimed = await claimMark(ctx, 'notified_at', withTargets);
  const mine = withTargets.filter((s) => claimed.has(s.rowId));
  if (!mine.length) return;
  // 送り先と「あと何日」ごとにまとめる
  const groups = new Map<string, { t: Target; ahead: number; list: Session[] }>();
  for (const s of mine) {
    const ahead = daysBetween(ctx.today, s.date!);
    for (const t of sessionTargets(ctx, s, 'remind')) {
      const key = t.channelId + '|' + ahead;
      const g = groups.get(key) ?? { t, ahead, list: [] };
      g.list.push(s);
      groups.set(key, g);
    }
  }
  const delivered = new Set<number>();
  for (const g of groups.values()) {
    for (let i = 0; i < g.list.length; i += EMBEDS_PER_MESSAGE) {
      const chunk = g.list.slice(i, i + EMBEDS_PER_MESSAGE);
      const mentions = mentionsOf(ctx, chunk);
      const payload = { content: '📢 ' + aheadText(g.ahead) + 'は卓の日です！' + (mentions ? ' ' + mentions : ''), embeds: chunk.map((s) => sessionEmbed(ctx, s)) };
      if (await postDiscord(logTo(ctx), payload, kind, chunk.map((s) => s.name).join('、') + targetNote(g.t), g.t.channelId, deps.sleep)) {
        chunk.forEach((s) => delivered.add(s.rowId));
      }
    }
  }
  await releaseMark(ctx, 'notified_at', mine.filter((s) => !delivered.has(s.rowId)).map((s) => s.rowId));
}

/** 期間前の催促。募集中・調整中のまま、期間の始まりが明日に迫った卓をGMに知らせる。送る時刻は開催前の知らせと同じ */
export async function sendUrges(ctx: Ctx, hour: number, deps: Deps): Promise<void> {
  if (!ctx.group.urge) return;
  const kind = '期間前の催促';
  const tomorrow = addDays(ctx.today, 1);
  const due = ctx.sessions.filter((s) => (s.status === STATUS.RECRUIT || s.status === STATUS.ADJUSTING) && !s.urgedAt && s.windowFrom === tomorrow && notifyHourOf(ctx, s) <= hour);
  for (const s of due) {
    const targets = sessionTargets(ctx, s);
    if (!targets.length) { await appendLog(logTo(ctx), kind, s.name, '送らず: 送り先のチャンネルが未設定'); continue; }
    if (!(await claimMark(ctx, 'urged_at', [s])).size) continue;
    const gmId = ctx.memberByName.get(s.gm)?.discordId;
    const head = s.status === STATUS.RECRUIT
      ? '⏳ 明日から「' + s.name + '」の募集の期間です。まだ参加者を集めている途中です。'
      : '⏳ 明日から「' + s.name + '」の候補の期間です。まだ開催日が決まっていません。';
    const payload = { content: head + (gmId ? ' <@' + gmId + '>' : '') + recruitLink(ctx, s), embeds: [sessionEmbed(ctx, s)] };
    if (!(await postSessionNotice(ctx, s, payload, kind, targets, deps.sleep))) await releaseMark(ctx, 'urged_at', [s.rowId]);
  }
}

/**
 * 募集の締め切りの知らせ。締め切りが今日の募集中の卓を、送る時刻（開催前の知らせと同じ）になったらGMに知らせる。
 * 期間前の催促と同じつまみ（urge）で止める。送り先が無ければ、記録して印を付ける（毎時記録しないように）
 */
export async function sendRecruitDue(ctx: Ctx, hour: number, deps: Deps): Promise<void> {
  if (!ctx.group.urge) return;
  const kind = '締め切りの知らせ';
  const due = ctx.sessions.filter((s) => s.status === STATUS.RECRUIT && !s.dueUrgedAt && s.recruitDue === ctx.today && notifyHourOf(ctx, s) <= hour);
  for (const s of due) {
    if (!(await claimMark(ctx, 'due_urged_at', [s])).size) continue;
    const targets = sessionTargets(ctx, s);
    if (!targets.length) { await appendLog(logTo(ctx), kind, s.name, '送らず: 送り先のチャンネルが未設定'); continue; }
    if (!(await postSessionNotice(ctx, s, recruitDuePayload(ctx, s), kind, targets, deps.sleep))) await releaseMark(ctx, 'due_urged_at', [s.rowId]);
  }
}

/**
 * キャラシの催促。締め切りが明日の卓を、送る時刻（開催前の知らせと同じ）になったら知らせる。その時刻を逃しても、締め切りの当日に送る。
 * まだ出していないPL（メンバー）をメンションする。みんな出していれば、送らずに印だけ付ける。送り先が無ければ、記録して印を付ける（毎時記録しないように）
 */
export async function sendSheetUrges(ctx: Ctx, hour: number, deps: Deps): Promise<void> {
  const kind = 'キャラシの催促';
  const tomorrow = addDays(ctx.today, 1);
  const open = [STATUS.RECRUIT, STATUS.ADJUSTING, STATUS.HELD] as string[];
  const due = ctx.sessions.filter((s) => s.sheetDue && s.sheetDue >= ctx.today && s.sheetDue <= tomorrow && !s.sheetUrgedAt && open.includes(s.status) && notifyHourOf(ctx, s) <= hour);
  for (const s of due) {
    if (!(await claimMark(ctx, 'sheet_urged_at', [s])).size) continue;
    const submitted = new Set(s.sheets.map((x) => x.memberId));
    const missing = s.members.map((n) => ctx.memberByName.get(n)?.id).filter((id): id is number => id !== undefined && !submitted.has(id));
    if (!missing.length) continue;
    const targets = sessionTargets(ctx, s, 'remind');
    if (!targets.length) { await appendLog(logTo(ctx), kind, s.name, '送らず: 送り先のチャンネルが未設定'); continue; }
    if (!(await postSessionNotice(ctx, s, sheetUrgePayload(ctx, s, missing), kind, targets, deps.sleep))) await releaseMark(ctx, 'sheet_urged_at', [s.rowId]);
  }
}

/**
 * 開始直前の知らせ。今日の卓の開始が近づいたら（開始のN分前を過ぎた最初の見回りで）GMと参加者に知らせる。
 * 開始を大きく過ぎた卓には送らない
 */
export async function sendStartingSoon(ctx: Ctx, deps: Deps): Promise<void> {
  const kind = '開始直前の知らせ';
  const p = jst(ctx.now);
  const nowMin = p.hour * 60 + p.minute;
  for (const s of ctx.sessions) {
    if (!DATED.includes(s.status) || s.date !== ctx.today || s.soonAt) continue;
    const t = minutesOfTime(s.start);
    if (t === null) continue;
    const left = t - nowMin;
    if (left > ctx.group.soon_minutes || left <= -SOON_LATE_MIN) continue;
    const targets = sessionTargets(ctx, s, 'remind');
    if (!targets.length) { await appendLog(logTo(ctx), kind, s.name, '送らず: 送り先のチャンネルが未設定'); continue; }
    if (!(await claimMark(ctx, 'soon_at', [s])).size) continue;
    const mentions = mentionsOf(ctx, [s]);
    const head = left <= 0 ? '⏰ まもなく「' + s.name + '」が始まります。' : '⏰ あと' + left + '分で「' + s.name + '」が始まります。';
    const payload = { content: head + (mentions ? ' ' + mentions : ''), embeds: [sessionEmbed(ctx, s)] };
    if (!(await postSessionNotice(ctx, s, payload, kind, targets, deps.sleep))) await releaseMark(ctx, 'soon_at', [s.rowId]);
  }
}

/** 毎日1回の片付け: 期限切れのログイン、古い送信記録・卓の履歴・予定・メモ、Googleの古い記録 */
export async function cleanup(db: D1Database, now: Date): Promise<void> {
  const today = jst(now).ymd;
  await db.batch([
    db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').bind(now.toISOString()),
    db.prepare(`DELETE FROM notify_log WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY group_id ORDER BY id DESC) AS rn FROM notify_log) WHERE rn > ?)`).bind(KEEP_LOG_ROWS),
    db.prepare(`DELETE FROM session_history WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY id DESC) AS rn FROM session_history) WHERE rn > ?)`).bind(HISTORY_KEEP),
    db.prepare('DELETE FROM availability WHERE date < ?').bind(addDays(today, -KEEP_AVAIL_DAYS)),
    db.prepare('DELETE FROM avail_notes WHERE date < ?').bind(addDays(today, -KEEP_AVAIL_DAYS)),
    db.prepare('DELETE FROM day_notes WHERE COALESCE(end_date, date) < ?').bind(addDays(today, -KEEP_DAY_NOTE_DAYS)),
    db.prepare('DELETE FROM google_dismissed WHERE date < ?').bind(addDays(today, -KEEP_AVAIL_DAYS)),
    // 連携が無くなった人（運営者が利用者を消したなど）と、触らなくなった過ぎた卓の、書いた予定の控え。Googleの予定は残る
    db.prepare('DELETE FROM google_events WHERE user_id NOT IN (SELECT user_id FROM google_links) OR date < ?').bind(addDays(today, -WRITE_PAST_DAYS)),
    // 過ぎた卓のDiscordのイベントの控え（イベントは終わっている）
    db.prepare('DELETE FROM discord_events WHERE date < ?').bind(addDays(today, -1)),
  ]);
}
