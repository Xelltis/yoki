// 読み込んだデータから計算するだけの小道具（GAS 版 Model.js・Polls.js の一部）。DB には触らない
import { badRequest, notFound } from '../lib/errors';
import { fmtDateJa, fmtYmdSlash, parseYmd } from '../lib/jst';
import { uniq } from '../lib/text';
import { DATED, STATUS } from './constants';
import type { Ctx, Session } from './types';

/** GM と参加者（GAS 版 peopleOf_） */
export function peopleOf(s: Pick<Session, 'gm' | 'members'>): string[] {
  return uniq((s.gm ? [s.gm] : []).concat(s.members));
}

export function findSession(ctx: Ctx, id: unknown): Session {
  const s = ctx.sessions.find((x) => x.id === String(id ?? ''));
  if (!s) throw notFound('その卓が見つかりません: ' + String(id ?? ''));
  return s;
}

export type WindowInfo = { from: string; to: string; text: string; label: string };

/** 期間（順が逆なら直す）。text は '2026/10/03〜2026/10/17'、label は '10/3（土）〜10/17（土）'（GAS 版 windowOf_） */
export function windowInfo(from: string | null, to: string | null): WindowInfo | null {
  if (!from || !to) return null;
  const [a, b] = from <= to ? [from, to] : [to, from];
  return { from: a, to: b, text: fmtYmdSlash(a) + '〜' + fmtYmdSlash(b), label: fmtDateJa(a) + '〜' + fmtDateJa(b) };
}

/** フォームの期間を読む。両方空なら null、片方だけや読めない日付は弾く（GAS 版 windowTextOf_） */
export function readWindow(from: unknown, to: unknown): WindowInfo | null {
  const a = String(from ?? '').trim(), b = String(to ?? '').trim();
  if (!a && !b) return null;
  if (!a || !b) throw badRequest('期間は、始まりと終わりの両方の日を入れてください。');
  const da = parseYmd(a), db = parseYmd(b);
  if (!da || !db) throw badRequest('期間の日付が読めません: ' + a + '〜' + b);
  return windowInfo(da, db);
}

/** 「開催」の卓に入っている人 { 'YYYY-MM-DD': { 名前: '参' | 'GM' } }（GAS 版 bookedMap_） */
export function bookedMap(sessions: Session[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const s of sessions) {
    if (!DATED.includes(s.status) || !s.date) continue;
    const day = (out[s.date] ??= {});
    if (s.gm) day[s.gm] = 'GM';
    for (const n of s.members) if (day[n] !== 'GM') day[n] = '参';
  }
  return out;
}

/** まだ回答していない候補日がある人（過ぎた候補日は数えない）（GAS 版 pollPending_） */
export function pollPending(ctx: Ctx, s: Session): string[] {
  const votes = ctx.votes.get(s.rowId) ?? {};
  const future = s.candidates.filter((k) => k >= ctx.today);
  return peopleOf(s).filter((n) => future.some((k) => !votes[k]?.[n]));
}

/** 全員が、これからの候補日すべてに答えたか（GAS 版 pollComplete_） */
export function pollComplete(ctx: Ctx, s: Session): boolean {
  return peopleOf(s).length > 0 && s.candidates.some((k) => k >= ctx.today) && pollPending(ctx, s).length === 0;
}

/** 日程調整中の卓を探す（GAS 版 findAdjusting_） */
export function findAdjusting(ctx: Ctx, id: unknown): Session {
  const s = findSession(ctx, id);
  if (s.status !== STATUS.ADJUSTING) throw badRequest('「' + s.name + '」は日程調整中ではありません（' + s.status + '）。');
  return s;
}
