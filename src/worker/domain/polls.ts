// 日程調整（GAS 版 Polls.js）。調整中の卓に候補日を出し、GM と参加者が候補日ごとに ◯ か × を付ける。
// 開催日は自動では決めない。全員の回答がそろったら GM に知らせ、GM が候補日から選んで「開催」にする
import { decidedPayload, pollReadyPayload } from '../discord/payloads';
import { appendLog, postToTargets, type Sleep } from '../discord/send';
import { sessionTargets } from '../discord/targets';
import { adminError, badRequest } from '../lib/errors';
import { fmtDateJa, normTime, parseYmd } from '../lib/jst';
import { POLL_MARKS, POLL_MAX_DATES, STATUS } from './constants';
import { type Form, list, requireSelf, str } from './form';
import { findAdjusting, findSession, peopleOf, pollComplete } from './model';
import type { GoogleDeps } from '../google/config';
import type { Ctx, Session } from './types';

/** 書いたあとで読み直す道具と、Discord の送り直しを待つ道具（routes/rpc.ts が渡す） */
export type Io = {
  reload: () => Promise<Ctx>;
  data: () => Promise<unknown>;
  sleep: Sleep;
  /** Google カレンダーとの連携に使う一式（設定が無ければ null。呼び出しが使うときだけ作る） */
  google?: GoogleDeps | null;
  /** 返事のあとも続ける仕事（Workers の waitUntil） */
  defer?: (work: Promise<unknown>) => void;
};

/** 本人（ログインした人）の回答を書く文。vote が空なら消す。回答は本人だけが入れるので、いつもメンバーの行で書く */
function voteStmts(ctx: Ctx, s: Session, days: string[], vote: string): D1PreparedStatement {
  const json = JSON.stringify(days), memberId = ctx.actor.memberId;
  if (!vote) return ctx.db.prepare('DELETE FROM poll_votes WHERE session_id = ?1 AND date IN (SELECT value FROM json_each(?2)) AND member_id = ?3').bind(s.rowId, json, memberId);
  return ctx.db
    .prepare(
      `INSERT INTO poll_votes (session_id, date, member_id, vote, updated_at) SELECT ?1, value, ?3, ?4, ?5 FROM json_each(?2) WHERE true
       ON CONFLICT (session_id, date, member_id) WHERE member_id IS NOT NULL DO UPDATE SET vote = excluded.vote, updated_at = excluded.updated_at`,
    )
    .bind(s.rowId, json, memberId, vote, ctx.now.toISOString());
}

/** 送った結果を、返事の文に添える */
export function noticeNote(sent: boolean | null, what: string): string {
  return sent === true ? '　' + what + 'を Discord に送りました。' : sent === false ? '　' + what + 'を Discord に送れませんでした。' : '';
}

/**
 * 日程調整の知らせ（'decided' 日程決定 / 'pollReady' 回答そろい）をサーバーからその場で送る。
 * 画面から送ると、送り終わる前に閉じられたときに届かない。true（届いた）/ false（失敗。画面が送り直す）/ null（送り先のチャンネルが無い）
 */
export async function sendPollNotice(ctx: Ctx, s: Session, kind: 'decided' | 'pollReady', sleep: Sleep): Promise<boolean | null> {
  const targets = sessionTargets(ctx, s);
  if (!targets.length) return null;
  const log = { db: ctx.db, groupId: ctx.group.id, token: ctx.bot.token };
  return kind === 'decided'
    ? postToTargets(log, decidedPayload(ctx, s), '日程決定', s.name, targets, sleep)
    : postToTargets(log, pollReadyPayload(ctx, s), '回答そろい', s.name, targets, sleep);
}

/**
 * 回答を書いたあと、全員がそろったかを見る。そろったら「回答そろい」の印を取り（二重に送らないため）、GM に知らせる。
 * そろわなくなったら（回答を取り消した）印を外す
 */
async function afterVote(ctx: Ctx, sid: string, wasComplete: boolean, io: Io): Promise<{ ready: boolean; notified?: boolean | null; message: string }> {
  const fresh = await io.reload();
  const s = findSession(fresh, sid);
  const complete = pollComplete(fresh, s);
  if (!complete) {
    if (s.pollReadyAt) await fresh.db.prepare('UPDATE sessions SET poll_ready_at = NULL WHERE id = ?').bind(s.rowId).run();
    return { ready: false, message: '' };
  }
  if (wasComplete) return { ready: false, message: '' };
  const claim = await fresh.db.prepare('UPDATE sessions SET poll_ready_at = ?1 WHERE id = ?2 AND poll_ready_at IS NULL').bind(ctx.now.toISOString(), s.rowId).run();
  if (!claim.meta.changes) return { ready: true, message: '　全員の回答がそろいました。' };
  const notified = await sendPollNotice(fresh, s, 'pollReady', io.sleep);
  if (notified === false) await fresh.db.prepare('UPDATE sessions SET poll_ready_at = NULL WHERE id = ?').bind(s.rowId).run();
  return { ready: true, notified, message: '　全員の回答がそろいました。' + noticeNote(notified, 'GM への知らせ') };
}

/**
 * 日程調整を始める／候補日を選び直す。form: { id, dates, start, end }
 * 始め直しなら前の回答は消す。選び直しなら外した日の回答だけ消す。出した人が GM か参加者なら、新しく足した候補日に ◯ を付けておく
 */
export async function startPoll(ctx: Ctx, form: Form) {
  const s = findAdjusting(ctx, form.id);
  if (!s.members.length) throw badRequest('「' + s.name + '」には参加者がいません。参加者を入れてから日程を調整してください。');
  const dates: string[] = [];
  for (const d of list(form.dates)) {
    const x = parseYmd(d);
    if (!x) throw badRequest('日付が読めません: ' + d);
    if (!dates.includes(x)) dates.push(x);
  }
  dates.sort();
  if (!dates.length) throw badRequest('候補日を 1 日以上選んでください。');
  if (dates.length > POLL_MAX_DATES) throw badRequest('候補日は ' + POLL_MAX_DATES + ' 日までです。');
  const past = dates.filter((k) => k < ctx.today);
  if (past.length) throw badRequest('過ぎた日は候補にできません: ' + past.map(fmtDateJa).join('、'));
  const fresh = !s.candidates.length;
  const db = ctx.db;
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE sessions SET candidates = ?2, start_time = COALESCE(?3, start_time), end_time = COALESCE(?4, end_time),
           editor = ?5, updated_at = ?6, poll_ready_at = NULL WHERE id = ?1`,
      )
      .bind(s.rowId, JSON.stringify(dates), form.start === undefined ? null : normTime(form.start), form.end === undefined ? null : normTime(form.end), ctx.actor.name, ctx.now.toISOString()),
    fresh
      ? db.prepare('DELETE FROM poll_votes WHERE session_id = ?').bind(s.rowId)
      : db.prepare('DELETE FROM poll_votes WHERE session_id = ? AND date NOT IN (SELECT value FROM json_each(?))').bind(s.rowId, JSON.stringify(dates)),
  ];
  const me = ctx.actor.name;
  const added = dates.filter((k) => fresh || !s.candidates.includes(k));
  if (peopleOf(s).includes(me) && added.length) stmts.push(voteStmts(ctx, s, added, '◯'));
  await db.batch(stmts);
  return { ok: true, id: s.id, dates, fresh, message: '「' + s.name + '」の日程調整を' + (fresh ? '始めました' : '更新しました') + '（候補 ' + dates.length + ' 日）。' };
}

/** 候補日に回答する。form: { id, ymd, name, vote: '◯' | '×' | '' }。この回答で全員がそろったら、GM に知らせる */
export async function setPollVote(ctx: Ctx, form: Form, io: Io) {
  const name = requireSelf(ctx, form.name);
  const vote = str(form.vote);
  if (vote && !POLL_MARKS.includes(vote)) throw badRequest('回答は ◯ か × です。');
  const s = findAdjusting(ctx, form.id);
  const k = parseYmd(form.ymd);
  if (!k) throw badRequest('日付が読めません: ' + str(form.ymd));
  if (!s.candidates.includes(k)) throw badRequest(fmtDateJa(k) + ' は「' + s.name + '」の候補日ではありません。');
  if (k < ctx.today) throw badRequest('過ぎた候補日には回答できません。');
  if (!peopleOf(s).includes(name)) throw badRequest(name + ' は「' + s.name + '」の GM でも参加者でもないので、回答できません。');
  const wasComplete = pollComplete(ctx, s);
  await voteStmts(ctx, s, [k], vote).run();
  const after = await afterVote(ctx, s.id, wasComplete, io);
  const message = fmtDateJa(k) + ' ' + name + ': ' + (vote || '回答を取り消しました') + after.message;
  return { ok: true, id: s.id, ymd: k, vote, ready: after.ready, notified: after.notified, message };
}

/**
 * 「どの日でもいい」（おまかせ）。これからの候補日すべてに ◯ を付ける。form: { id, name, vote }
 * vote が '◯' なら全部に ◯（× の日も ◯ に）、空なら自分の回答を全部消す
 */
export async function setPollVoteAll(ctx: Ctx, form: Form, io: Io) {
  const name = requireSelf(ctx, form.name);
  const vote = form.vote === undefined ? POLL_MARKS[0]! : str(form.vote);
  if (vote && vote !== POLL_MARKS[0]) throw badRequest('おまかせで付けられるのは ◯ だけです。');
  const s = findAdjusting(ctx, form.id);
  if (!peopleOf(s).includes(name)) throw badRequest(name + ' は「' + s.name + '」の GM でも参加者でもないので、回答できません。');
  const days = s.candidates.filter((k) => k >= ctx.today);
  if (!days.length) throw badRequest('「' + s.name + '」には、これからの候補日がありません。');
  const wasComplete = pollComplete(ctx, s);
  await voteStmts(ctx, s, days, vote).run();
  const after = await afterVote(ctx, s.id, wasComplete, io);
  const message = (vote ? name + ': 候補日 ' + days.length + ' 日すべてに ◯ を付けました（どの日でもいい）' : name + ': 「' + s.name + '」の回答を取り消しました') + after.message;
  return { ok: true, id: s.id, days, vote, ready: after.ready, notified: after.notified, message };
}

/** GM が候補日から開催日を選ぶ（GM のほかは管理者だけ）。決めたら「日程が決まりました」をサーバーから送る。form: { id, ymd } */
export async function decidePoll(ctx: Ctx, form: Form, io: Io) {
  const s = findAdjusting(ctx, form.id);
  if (s.gm !== ctx.actor.name && !ctx.actor.isAdmin) throw adminError('GM のほかが開催日を決めること');
  const k = parseYmd(form.ymd);
  if (!k) throw badRequest('日付が読めません: ' + str(form.ymd));
  if (!s.candidates.includes(k)) throw badRequest(fmtDateJa(k) + ' は「' + s.name + '」の候補日ではありません。');
  if (k < ctx.today) throw badRequest('過ぎた候補日には決められません。');
  const db = ctx.db;
  await db.batch([
    db
      .prepare(
        `UPDATE sessions SET date = ?2, status = '開催', window_from = NULL, window_to = NULL, candidates = '[]',
           notified_at = NULL, poll_ready_at = NULL, editor = ?3, updated_at = ?4 WHERE id = ?1`,
      )
      .bind(s.rowId, k, ctx.actor.name, ctx.now.toISOString()),
    db.prepare('DELETE FROM poll_votes WHERE session_id = ?').bind(s.rowId),
  ]);
  await appendLog({ db, groupId: ctx.group.id }, '日程決定', s.name, 'GM が選んだ日: ' + fmtDateJa(k));
  const fresh = await io.reload();
  const decided = findSession(fresh, s.id);
  const notified = decided.status === STATUS.HELD ? await sendPollNotice(fresh, decided, 'decided', io.sleep) : null;
  return { ok: true, id: s.id, decided: k, notified, message: '日程を決めました: ' + s.name + '（' + fmtDateJa(k) + '）' + noticeNote(notified, '決まった知らせ') };
}

/** 日程調整をやめる。候補日と回答を消す（卓は調整中のまま）。form: { id } */
export async function cancelPoll(ctx: Ctx, form: Form) {
  const s = findAdjusting(ctx, form.id);
  await ctx.db.batch([
    ctx.db.prepare("UPDATE sessions SET candidates = '[]', poll_ready_at = NULL, editor = ?2, updated_at = ?3 WHERE id = ?1").bind(s.rowId, ctx.actor.name, ctx.now.toISOString()),
    ctx.db.prepare('DELETE FROM poll_votes WHERE session_id = ?').bind(s.rowId),
  ]);
  return { ok: true, id: s.id, message: '「' + s.name + '」の日程調整をやめました。' };
}
