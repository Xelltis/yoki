// 日程調整（GAS版Polls.js）。調整中の卓に候補日を出し、GMと参加者が候補日ごとに ◯・△・× を付ける（△ は調整すれば行ける）。
// 開催日は自動では決めない。全員の回答がそろったらGMに知らせ、GMが候補日から選んで「開催」にする
import { decidedPayload, pollReadyPayload } from '../discord/payloads';
import { appendLog, type Sleep } from '../discord/send';
import { postSessionNotice } from '../discord/threads';
import { sessionTargets } from '../discord/targets';
import { adminError, badRequest } from '../lib/errors';
import { consoleData } from './console-data';
import { reloadLog } from './load';
import { addDays, fmtDateJa, normTime, parseYmd, timeRange } from '../lib/jst';
import { candDay, candLabel, candPart, parseCandidate, sortCandidates } from '../../shared/candidates';
import { queueDm } from './dm-notices';
import { POLL_MARKS, POLL_MAX_DATES, STATUS } from './constants';
import { type Form, list, requireSelf, str } from './form';
import { bookedAt, type BookedParts, markAt, type Part, partOf } from '../../shared/parts';
import { historyStmt } from './history';
import { bookedPartsMap, findAdjusting, findSession, peopleOf, pollComplete } from './model';
import type { GoogleDeps } from '../google/config';
import type { Ctx, Session } from './types';
import { gmsOf, isGm } from '../../shared/gm';

/** 候補の書き方（10/12（月）、時間帯があれば10/12（月）の夜） */
const label = (k: string) => candLabel(k, fmtDateJa);

/** 書いたあとで読み直す道具と、Discordの送り直しを待つ道具（routes/rpc.tsが渡す） */
export type Io = {
  reload: () => Promise<Ctx>;
  data: () => Promise<unknown>;
  sleep: Sleep;
  /** Googleカレンダーとの連携に使う一式（設定が無ければnull。呼び出しが使うときだけ作る） */
  google?: GoogleDeps | null;
  /** 返事のあとも続ける仕事（WorkersのwaitUntil） */
  defer?: (work: Promise<unknown>) => void;
};

/** 本人（ログインした人）の回答を書く文。日ごとに違う回答を1文で書く。回答は本人だけが入れるので、いつもメンバーの行で書く */
function voteRowsStmt(ctx: Ctx, s: Session, rows: { date: string; vote: string }[]): D1PreparedStatement {
  return ctx.db
    .prepare(
      `INSERT INTO poll_votes (session_id, date, member_id, vote, updated_at)
       SELECT ?1, json_extract(value, '$.date'), ?3, json_extract(value, '$.vote'), ?4 FROM json_each(?2) WHERE true
       ON CONFLICT (session_id, date, member_id) WHERE member_id IS NOT NULL DO UPDATE SET vote = excluded.vote, updated_at = excluded.updated_at`,
    )
    .bind(s.rowId, JSON.stringify(rows), ctx.actor.memberId, ctx.now.toISOString());
}

/** 本人の回答を、いくつかの日に同じ印で書く文。voteが空なら消す */
function voteStmts(ctx: Ctx, s: Session, days: string[], vote: string): D1PreparedStatement {
  if (vote) return voteRowsStmt(ctx, s, days.map((date) => ({ date, vote })));
  return ctx.db.prepare('DELETE FROM poll_votes WHERE session_id = ?1 AND date IN (SELECT value FROM json_each(?2)) AND member_id = ?3').bind(s.rowId, JSON.stringify(days), ctx.actor.memberId);
}

/**
 * 予定表の印から決める回答。ほかの卓のある日と × は ×、△ は △、空欄は ◯。
 * 昼と夜に分けるグループでは、卓の開始時刻の時間帯（partOf）の印と卓で決める
 */
function voteFromAvail(ctx: Pick<Ctx, 'avail' | 'availParts'>, booked: BookedParts, name: string, day: string, part: Part | ''): string {
  if (bookedAt(booked, day, name, part)) return '×';
  const m = markAt(ctx.avail, ctx.availParts, day, name, part);
  return m === '×' || m === '△' ? m : '◯';
}

/** 送った結果を、返事の文に添える */
export function noticeNote(sent: boolean | null, what: string): string {
  return sent === true ? '　' + what + 'をDiscordに送りました。' : sent === false ? '　' + what + 'をDiscordに送れませんでした。' : '';
}

/**
 * 日程調整の知らせ（'decided' 日程決定 / 'pollReady' 回答そろい）をサーバーからその場で送る。
 * 画面から送ると、送り終わる前に閉じられたときに届かない。true（届いた）/ false（失敗。画面が送り直す）/ null（送り先のチャンネルが無い）
 */
export async function sendPollNotice(ctx: Ctx, s: Session, kind: 'decided' | 'pollReady', sleep: Sleep): Promise<boolean | null> {
  const targets = sessionTargets(ctx, s);
  if (!targets.length) return null;
  return kind === 'decided'
    ? postSessionNotice(ctx, s, decidedPayload(ctx, s), '日程決定', targets, sleep)
    : postSessionNotice(ctx, s, pollReadyPayload(ctx, s), '回答そろい', targets, sleep);
}

/**
 * 回答を書いたあと、全員がそろったかを見る。そろったら「回答そろい」の印を取り（二重に送らないため）、GMに知らせる。
 * そろわなくなったら（回答を取り消した）印を外す
 */
async function afterVote(ctx: Ctx, sid: string, wasComplete: boolean, io: Io): Promise<{ ready: boolean; notified?: boolean | null; message: string; fresh: Ctx }> {
  const fresh = await io.reload();
  const s = findSession(fresh, sid);
  const complete = pollComplete(fresh, s);
  if (!complete) {
    if (s.pollReadyAt) await fresh.db.prepare('UPDATE sessions SET poll_ready_at = NULL WHERE id = ?').bind(s.rowId).run();
    return { ready: false, message: '', fresh };
  }
  if (wasComplete) return { ready: false, message: '', fresh };
  const claim = await fresh.db.prepare('UPDATE sessions SET poll_ready_at = ?1 WHERE id = ?2 AND poll_ready_at IS NULL').bind(ctx.now.toISOString(), s.rowId).run();
  if (!claim.meta.changes) return { ready: true, message: '　全員の回答がそろいました。', fresh };
  const notified = await sendPollNotice(fresh, s, 'pollReady', io.sleep);
  if (notified === false) await fresh.db.prepare('UPDATE sessions SET poll_ready_at = NULL WHERE id = ?').bind(s.rowId).run();
  // 知らせを送り直さないとき（届いた・送り先が無い）だけ、GMにDMでも知らせる（最後に答えたのがGMなら送らない）
  else await queueDm(fresh, 'poll', gmsOf(s).filter((n) => n !== ctx.actor.name), '📝 「' + s.name + '」の日程調整の回答がそろいました。開催日を選んでください。');
  // 送ったら、送信記録だけを読み直す（返事の画面データに、送った結果を出すため）
  if (notified !== null) await reloadLog(fresh);
  return { ready: true, notified, message: '　全員の回答がそろいました。' + noticeNote(notified, 'GMへの知らせ'), fresh };
}

/**
 * 回答の締め切りを読む。form.dueが無ければ、選び直しなら今の締め切りのまま（始め直しなら無し）、空なら無し。
 * 締め切りは、今日から、いちばん早い候補日の前日まで。過ぎた締め切りは、変えずに選び直すときだけそのまま残す
 */
function readPollDue(ctx: Ctx, s: Session, form: Form, dates: string[], fresh: boolean): string | null {
  if (form.due === undefined) return fresh ? null : s.pollDue;
  const raw = str(form.due);
  if (!raw) return null;
  const due = parseYmd(raw);
  if (!due) throw badRequest('回答の締め切りが読めません: ' + raw);
  if (due < ctx.today) {
    if (due === s.pollDue && !fresh) return due;
    throw badRequest('過ぎた日は、回答の締め切りにできません。');
  }
  if (due >= candDay(dates[0]!)) throw badRequest('回答の締め切りは、いちばん早い候補日（' + fmtDateJa(candDay(dates[0]!)) + '）より前の日にしてください。');
  return due;
}

/**
 * 日程調整を始める／候補日を選び直す。form: { id, dates, start, end, due }
 * 始め直しなら前の回答は消す。選び直しなら外した日の回答だけ消す。出した人がGMか参加者なら、新しく足した候補日に ◯ を付けておく。
 * 締め切りを変えたら、締め切りの催促と知らせを送り直せるようにする
 */
export async function startPoll(ctx: Ctx, form: Form) {
  const s = findAdjusting(ctx, form.id);
  if (!s.members.length) throw badRequest('「' + s.name + '」には参加者がいません。参加者を入れてから日程を調整してください。');
  const picked: string[] = [];
  for (const d of list(form.dates)) {
    const x = parseCandidate(d, parseYmd);
    if (!x) throw badRequest('日付が読めません: ' + d);
    if (candPart(x) && !ctx.group.day_parts) throw badRequest('昼と夜に分けていないグループでは、候補に時間帯を付けられません。');
    if (!picked.includes(x)) picked.push(x);
  }
  const dates = sortCandidates(picked);
  if (!dates.length) throw badRequest('候補日を1日以上選んでください。');
  if (dates.length > POLL_MAX_DATES) throw badRequest('候補日は' + POLL_MAX_DATES + '日までです。');
  const past = dates.filter((k) => candDay(k) < ctx.today);
  if (past.length) throw badRequest('過ぎた日は候補にできません: ' + past.map(label).join('、'));
  const fresh = !s.candidates.length;
  const due = readPollDue(ctx, s, form, dates, fresh);
  const dueChanged = due !== s.pollDue;
  const db = ctx.db;
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE sessions SET candidates = ?2, start_time = COALESCE(?3, start_time), end_time = COALESCE(?4, end_time),
           editor = ?5, updated_at = ?6, poll_ready_at = NULL, poll_due = ?7,
           poll_urged_at = CASE WHEN ?8 THEN NULL ELSE poll_urged_at END, poll_closed_at = CASE WHEN ?8 THEN NULL ELSE poll_closed_at END WHERE id = ?1`,
      )
      .bind(
        s.rowId, JSON.stringify(dates), form.start === undefined ? null : normTime(form.start), form.end === undefined ? null : normTime(form.end), ctx.actor.name, ctx.now.toISOString(),
        due, dueChanged ? 1 : 0,
      ),
    fresh
      ? db.prepare('DELETE FROM poll_votes WHERE session_id = ?').bind(s.rowId)
      : db.prepare('DELETE FROM poll_votes WHERE session_id = ? AND date NOT IN (SELECT value FROM json_each(?))').bind(s.rowId, JSON.stringify(dates)),
  ];
  const me = ctx.actor.name;
  const added = dates.filter((k) => fresh || !s.candidates.includes(k));
  if (peopleOf(s).includes(me) && added.length) stmts.push(voteStmts(ctx, s, added, '◯'));
  const dueText = due ? '（締め切り ' + fmtDateJa(due) + '）' : dueChanged ? '（締め切りなし）' : '';
  stmts.push(historyStmt(ctx, s.rowId, '日程調整', (fresh ? '候補日を出した: ' : '候補日を選び直した: ') + dates.map(label).join('、') + dueText));
  await db.batch(stmts);
  return { ok: true, id: s.id, dates, fresh, message: '「' + s.name + '」の日程調整を' + (fresh ? '始めました' : '更新しました') + '（候補' + dates.length + '日' + (due ? '、締め切り ' + fmtDateJa(due) : '') + '）。' };
}

/** 候補日に回答する。form: { id, ymd, name, vote: '◯' | '△' | '×' | '' }。この回答で全員がそろったら、GMに知らせる */
export async function setPollVote(ctx: Ctx, form: Form, io: Io) {
  const name = requireSelf(ctx, form.name);
  const vote = str(form.vote);
  if (vote && !POLL_MARKS.includes(vote)) throw badRequest('回答は ◯・△・× のどれかです。');
  const s = findAdjusting(ctx, form.id);
  const k = parseCandidate(form.ymd, parseYmd);
  if (!k) throw badRequest('日付が読めません: ' + str(form.ymd));
  if (!s.candidates.includes(k)) throw badRequest(label(k) + 'は「' + s.name + '」の候補日ではありません。');
  if (candDay(k) < ctx.today) throw badRequest('過ぎた候補日には回答できません。');
  if (!peopleOf(s).includes(name)) throw badRequest(name + 'は「' + s.name + '」のGMでも参加者でもないので、回答できません。');
  const wasComplete = pollComplete(ctx, s);
  await voteStmts(ctx, s, [k], vote).run();
  const after = await afterVote(ctx, s.id, wasComplete, io);
  const message = label(k) + ' ' + name + ': ' + (vote || '回答を取り消しました') + after.message;
  // 返事の画面データは、そろったかを見るために読み直した中身を使う（もう一度読まない。D1の問い合わせの数を抑えるため）
  return { ok: true, id: s.id, ymd: k, vote, ready: after.ready, notified: after.notified, message, data: consoleData(after.fresh) };
}

/**
 * 「どの日でもいい」（おまかせ）。これからの候補日すべてに ◯ を付ける。form: { id, name, vote }
 * voteが '◯' なら全部に ◯（× の日も ◯ に）、空なら自分の回答を全部消す
 */
export async function setPollVoteAll(ctx: Ctx, form: Form, io: Io) {
  const name = requireSelf(ctx, form.name);
  const vote = form.vote === undefined ? POLL_MARKS[0]! : str(form.vote);
  if (vote && vote !== POLL_MARKS[0]) throw badRequest('おまかせで付けられるのは ◯ だけです。');
  const s = findAdjusting(ctx, form.id);
  if (!peopleOf(s).includes(name)) throw badRequest(name + 'は「' + s.name + '」のGMでも参加者でもないので、回答できません。');
  const days = s.candidates.filter((k) => k >= ctx.today);
  if (!days.length) throw badRequest('「' + s.name + '」には、これからの候補日がありません。');
  const wasComplete = pollComplete(ctx, s);
  await voteStmts(ctx, s, days, vote).run();
  const after = await afterVote(ctx, s.id, wasComplete, io);
  const message = (vote ? name + ': 候補日' + days.length + '日すべてに ◯ を付けました（どの日でもいい）' : name + ': 「' + s.name + '」の回答を取り消しました') + after.message;
  return { ok: true, id: s.id, days, vote, ready: after.ready, notified: after.notified, message, data: consoleData(after.fresh) };
}

/**
 * 行ける日を選んで答える（Discordの選ぶ欄から）。選んだ候補日に ◯、選ばなかった、これからの候補日に × を付ける。form: { id, name, days }
 */
export async function setPollVoteDays(ctx: Ctx, form: Form, io: Io) {
  const name = requireSelf(ctx, form.name);
  const s = findAdjusting(ctx, form.id);
  if (!peopleOf(s).includes(name)) throw badRequest(name + 'は「' + s.name + '」のGMでも参加者でもないので、回答できません。');
  const future = s.candidates.filter((k) => k >= ctx.today);
  if (!future.length) throw badRequest('「' + s.name + '」には、これからの候補日がありません。');
  const ok = list(form.days);
  const rows = future.map((date) => ({ date, vote: ok.includes(date) ? POLL_MARKS[0]! : '×' }));
  const wasComplete = pollComplete(ctx, s);
  await voteRowsStmt(ctx, s, rows).run();
  const after = await afterVote(ctx, s.id, wasComplete, io);
  const yes = rows.filter((r) => r.vote !== '×');
  const what = !yes.length ? 'どの日も ×' : yes.length === rows.length ? 'どの日も ◯' : yes.map((r) => label(r.date)).join('・') + 'は ◯、ほかの日は ×';
  const message = name + ': 「' + s.name + '」に、' + what + ' で答えました' + after.message;
  return { ok: true, id: s.id, ready: after.ready, notified: after.notified, message, data: consoleData(after.fresh) };
}

/**
 * 予定表から答える。まだ答えていない、これからの候補日に、本人の予定表の印から回答を入れる（voteFromAvail）。
 * 答えた日は変えない。予定表の範囲の外の候補日は、印が分からないので入れない。form: { id, name }
 */
export async function setPollVoteFromAvail(ctx: Ctx, form: Form, io: Io) {
  const name = requireSelf(ctx, form.name);
  const s = findAdjusting(ctx, form.id);
  if (!peopleOf(s).includes(name)) throw badRequest(name + 'は「' + s.name + '」のGMでも参加者でもないので、回答できません。');
  const votes = ctx.votes.get(s.rowId) ?? {};
  const last = addDays(ctx.today, ctx.group.avail_days), booked = bookedPartsMap(ctx.sessions, ctx.members), part = ctx.group.day_parts ? partOf(s.start) : '';
  // 時間帯の付いた候補は、その時間帯の印で見る
  const rows = s.candidates.filter((k) => k >= ctx.today && candDay(k) < last && !votes[k]?.[name])
    .map((date) => ({ date, vote: voteFromAvail(ctx, booked, name, candDay(date), candPart(date) || part) }));
  if (!rows.length) return { ok: true, id: s.id, count: 0, message: name + ': 予定表から入れられる候補日はありません（まだ答えていない、予定表の範囲の日がありません）。' };
  const wasComplete = pollComplete(ctx, s);
  await voteRowsStmt(ctx, s, rows).run();
  const after = await afterVote(ctx, s.id, wasComplete, io);
  const tally = POLL_MARKS.map((m) => [m, rows.filter((r) => r.vote === m).length] as const).filter(([, n]) => n).map(([m, n]) => m + ' ' + n + '日').join('・');
  const message = name + ': 予定表から' + rows.length + '日に答えました（' + tally + '）' + after.message;
  return { ok: true, id: s.id, count: rows.length, ready: after.ready, notified: after.notified, message, data: consoleData(after.fresh) };
}

/** GMが候補日から開催日を選ぶ（GMのほかは管理者だけ）。決めたら「日程が決まりました」をサーバーから送る。form: { id, ymd } */
export async function decidePoll(ctx: Ctx, form: Form, io: Io) {
  const s = findAdjusting(ctx, form.id);
  if (!isGm(s, ctx.actor.name) && !ctx.actor.isAdmin) throw adminError('GMのほかが開催日を決めること');
  const k = parseCandidate(form.ymd, parseYmd);
  if (!k) throw badRequest('日付が読めません: ' + str(form.ymd));
  if (!s.candidates.includes(k)) throw badRequest(label(k) + 'は「' + s.name + '」の候補日ではありません。');
  if (candDay(k) < ctx.today) throw badRequest('過ぎた候補日には決められません。');
  // 時間帯の付いた候補に決めて、開始時刻がその時間帯でなければ、時間を空にする（GMが「編集」で入れる）
  const clearTime = !!candPart(k) && partOf(s.start) !== candPart(k);
  const db = ctx.db;
  await db.batch([
    db
      .prepare(
        `UPDATE sessions SET date = ?2, status = '開催', window_from = NULL, window_to = NULL, candidates = '[]',
           start_time = CASE WHEN ?5 THEN '' ELSE start_time END, end_time = CASE WHEN ?5 THEN '' ELSE end_time END,
           notified_at = NULL, poll_ready_at = NULL, poll_due = NULL, poll_urged_at = NULL, poll_closed_at = NULL, editor = ?3, updated_at = ?4 WHERE id = ?1`,
      )
      .bind(s.rowId, candDay(k), ctx.actor.name, ctx.now.toISOString(), clearTime ? 1 : 0),
    db.prepare('DELETE FROM poll_votes WHERE session_id = ?').bind(s.rowId),
    historyStmt(ctx, s.rowId, '日程決定', label(k)),
  ]);
  await appendLog({ db, groupId: ctx.group.id }, '日程決定', s.name, 'GMが選んだ日: ' + label(k));
  const fresh = await io.reload();
  const decided = findSession(fresh, s.id);
  const notified = decided.status === STATUS.HELD ? await sendPollNotice(fresh, decided, 'decided', io.sleep) : null;
  // GMと参加者に、DMでも知らせる（決めた人には送らない）
  await queueDm(fresh, 'poll', peopleOf(decided).filter((n) => n !== ctx.actor.name), '✅ 「' + s.name + '」の日程が決まりました: ' + fmtDateJa(candDay(k)) + ' ' + timeRange(decided));
  if (notified !== null) await reloadLog(fresh);
  return {
    ok: true, id: s.id, decided: k, notified,
    message: '日程を決めました: ' + s.name + '（' + label(k) + '）' + (clearTime ? '　時間は「編集」で入れてください。' : '') + noticeNote(notified, '決まった知らせ'),
    data: consoleData(fresh),
  };
}

/** 日程調整をやめる。候補日と回答を消す（卓は調整中のまま）。form: { id } */
export async function cancelPoll(ctx: Ctx, form: Form) {
  const s = findAdjusting(ctx, form.id);
  await ctx.db.batch([
    ctx.db
      .prepare("UPDATE sessions SET candidates = '[]', poll_ready_at = NULL, poll_due = NULL, poll_urged_at = NULL, poll_closed_at = NULL, editor = ?2, updated_at = ?3 WHERE id = ?1")
      .bind(s.rowId, ctx.actor.name, ctx.now.toISOString()),
    ctx.db.prepare('DELETE FROM poll_votes WHERE session_id = ?').bind(s.rowId),
    historyStmt(ctx, s.rowId, '日程調整', 'やめた'),
  ]);
  return { ok: true, id: s.id, message: '「' + s.name + '」の日程調整をやめました。' };
}
