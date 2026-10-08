// 卓の変更の履歴（session_history）。だれが・いつ・何をしたかを卓ごとに残し、卓の変更の窓で読む。
// 書く文は、変える文と同じbatchに入れる（変更と履歴がずれないように）。中身は画面の言葉の短い文で、秘匿HOは書かない
import { fmtDateJa, stampText } from '../lib/jst';
import type { Form } from './form';
import { findSession, windowInfo } from './model';
import type { Ctx, Session } from './types';

/** 卓ごとに残す件数（毎日の片付けで、古いものから消す） */
export const HISTORY_KEEP = 50;
/** 文の長さの上限 */
const DETAIL_MAX = 500;

const INSERT = 'INSERT INTO session_history (session_id, at, by_name, action, detail)';

/** 卓（rowId）の履歴を1件書く文 */
export function historyStmt(ctx: Pick<Ctx, 'db' | 'now' | 'actor'>, rowId: number, action: string, detail: string): D1PreparedStatement {
  return ctx.db.prepare(INSERT + ' VALUES (?1, ?2, ?3, ?4, ?5)').bind(rowId, ctx.now.toISOString(), ctx.actor.name, action, detail.slice(0, DETAIL_MAX));
}

/** いくつかの卓（rowIdのJSONの配列）に、同じ履歴を書く文（卓の数によらず1文） */
export function historyManyStmt(ctx: Pick<Ctx, 'db' | 'now' | 'actor'>, rowIds: number[], action: string, detail: string): D1PreparedStatement {
  return ctx.db.prepare(INSERT + ' SELECT value, ?2, ?3, ?4, ?5 FROM json_each(?1)').bind(JSON.stringify(rowIds), ctx.now.toISOString(), ctx.actor.name, action, detail.slice(0, DETAIL_MAX));
}

/**
 * 番号で引く卓（まだidが分からない、いま入れる卓）に履歴を書く文。firstの番号からn件。
 * firstがnullなら、グループの次の番号から（まとめて登録するとき。番号を進める文の前に流す）
 */
export function historyForSeqStmt(ctx: Pick<Ctx, 'db' | 'now' | 'actor' | 'group'>, first: number | null, n: number, action: string, detail: string): D1PreparedStatement {
  const from = first === null ? '(SELECT next_session_seq FROM groups WHERE id = ?1)' : '?7';
  return ctx.db
    .prepare(INSERT + ` SELECT id, ?3, ?4, ?5, ?6 FROM sessions WHERE group_id = ?1 AND seq >= ${from} AND seq < ${from} + ?2`)
    .bind(ctx.group.id, n, ctx.now.toISOString(), ctx.actor.name, action, detail.slice(0, DETAIL_MAX), ...(first === null ? [] : [first]));
}

/** 登録したときの文。「開催 10/12（月） 20:00〜23:00」「募集 10/3（土）〜10/17（土）」 */
export function createdText(status: string, date: string | null, start: string, end: string, windowFrom: string | null, windowTo: string | null): string {
  const w = windowInfo(windowFrom, windowTo)?.label ?? '';
  return status + (date ? ' ' + fmtDateJa(date) + (start || end ? ' ' + timeText(start, end) : '') : w ? ' ' + w : '');
}

const dayText = (d: string | null) => (d ? fmtDateJa(d) : '未定');
const timeText = (a: string, b: string) => (a || b ? (a || '？') + '〜' + b : '未定');

/** 卓を変えたときの、変わったところの文。「開催日 10/12（月）→10/13（火）、参加者 +こまち −ソラ」。変わっていなければ空 */
export function changeText(ctx: Pick<Ctx, 'scenarios'>, old: Session, next: {
  name: string; status: string; date: string | null; start: string; end: string; place: string; memo: string; series: string;
  gm: string; members: string[]; windowFrom: string | null; windowTo: string | null; scenarioId: number | null; capacity: number | null; recruitDue: string | null;
}): string {
  const out: string[] = [];
  const arrow = (label: string, a: string, b: string) => { if (a !== b) out.push(label + ' ' + (a || 'なし') + '→' + (b || 'なし')); };
  arrow('名前', old.name, next.name);
  arrow('状態', old.status, next.status);
  if (old.date !== next.date) out.push('開催日 ' + dayText(old.date) + '→' + dayText(next.date));
  if (old.start !== next.start || old.end !== next.end) out.push('時間 ' + timeText(old.start, old.end) + '→' + timeText(next.start, next.end));
  const ow = windowInfo(old.windowFrom, old.windowTo)?.label ?? '', nw = windowInfo(next.windowFrom, next.windowTo)?.label ?? '';
  arrow('期間', ow, nw);
  arrow('GM', old.gm, next.gm);
  const add = next.members.filter((n) => !old.members.includes(n)), gone = old.members.filter((n) => !next.members.includes(n));
  if (add.length || gone.length) out.push('参加者' + add.map((n) => ' +' + n).join('') + gone.map((n) => ' −' + n).join(''));
  arrow('場所', old.place, next.place);
  if (old.memo !== next.memo) out.push('メモを変更');
  arrow('シリーズ', old.series, next.series);
  const sc = (id: number | null) => (id === null ? '' : ctx.scenarios.find((x) => x.id === id)?.name ?? '');
  arrow('シナリオ', sc(old.scenarioId), sc(next.scenarioId));
  arrow('定員', old.capacity ? old.capacity + '人' : '', next.capacity ? next.capacity + '人' : '');
  arrow('締め切り', old.recruitDue ? fmtDateJa(old.recruitDue) : '', next.recruitDue ? fmtDateJa(next.recruitDue) : '');
  return out.join('、');
}

/** 卓の履歴を読む（新しい順）。form: { id } */
export async function getSessionHistory(ctx: Ctx, form: Form) {
  const s = findSession(ctx, form.id);
  const rows = (await ctx.db
    .prepare('SELECT at, by_name, action, detail FROM session_history WHERE session_id = ? ORDER BY id DESC LIMIT ?')
    .bind(s.rowId, HISTORY_KEEP)
    .all<{ at: string; by_name: string; action: string; detail: string }>()).results;
  return { ok: true, id: s.id, items: rows.map((r) => ({ at: stampText(r.at), by: r.by_name, action: r.action, detail: r.detail })) };
}
