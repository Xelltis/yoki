// メンバーの予定のタブで見せる人と日（絞り込みを当てたもの）。画面のデータdと絞り込みを受け取って計算するだけ
import type { ConsoleData, ConsoleSession } from '../../../../shared/api';
import { holidayName, parseYmd } from '../model/dates';
import { active, candidatesOf, memberOrder, targetPeople, windowByDay } from '../model/model';

export type Mark = '' | '△' | '×';
/** 印の言い方（読み上げと日ごとのリスト）と、押したときの次の印 */
export const MARK_WORD: Record<Mark, string> = { '': '参加できる', '△': '調整すれば行ける', '×': '行けない' };
export const MARK_NEXT: Record<Mark, Mark> = { '': '△', '△': '×', '×': '' };
/** その人の印（△ か ×）。旧い印（○・参・GM）は空欄とみなす。卓に入っている日はd.bookedを見る */
export function markIn(marks: Record<string, string>, n: string): Mark { const v = marks[n] || ''; return v === '△' || v === '×' ? v : ''; }

/** 絞り込み。members・wds・from・to・condは「絞り込み」の中、hol・free・mineOnlyは表の上のチップ、target・onlyは卓で絞る */
export type AvailFilter = {
  members: string[] | null; wds: number[]; hol: boolean; free: boolean; mineOnly: boolean;
  from: string; to: string; cond: string; target: string; only: boolean;
};

/** 卓を選んだら、その卓のGMと参加者（募集なら参加希望も）だけにする。「（なし）」「全員」なら絞らない */
export function targetNames(d: ConsoleData, f: AvailFilter): string[] | null {
  const v = f.target;
  if (!v || v === '（なし）' || v === '全員') return null;
  const people = targetPeople(d, v);
  return people.length ? people : null;
}
/** チェックを付けると、どれかの卓（募集・調整中・開催のどれでも）に入っている人だけにする */
export function activeNames(d: ConsoleData, f: AvailFilter): string[] | null {
  if (!f.only) return null;
  const out: string[] = [];
  active(d).forEach((s) => { candidatesOf(s).forEach((n) => { if (out.indexOf(n) < 0) out.push(n); }); });
  return out;
}
/** 列に出す人 */
export function visibleNames(d: ConsoleData, f: AvailFilter, mine: string, sortByLoad: boolean): string[] {
  if (f.mineOnly && mine) return [mine];
  let all = memberOrder(d, d.members.map((m) => m.name), sortByLoad);
  [targetNames(d, f), activeNames(d, f)].forEach((only) => { if (only) all = all.filter((n) => only.indexOf(n) >= 0); });
  if (!f.members) return all;
  const members = f.members;
  return all.filter((n) => members.indexOf(n) >= 0);
}

/** 表とリストの1日分 */
export type Row = {
  key: string; date: Date; dow: number; hol: string; wk: boolean;
  marks: Record<string, string>; bk: Record<string, string>; list: ConsoleSession[]; wins: ConsoleSession[];
  free: boolean; notes: Record<string, { text: string; at: string }>;
};

/** 出す日（予定表の範囲から、絞り込みに合う日） */
export function availRows(d: ConsoleData, f: AvailFilter, names: string[]): Row[] {
  const byDay: Record<string, ConsoleSession[]> = {};
  active(d).forEach((s) => { if (s.date) (byDay[s.date] = byDay[s.date] || []).push(s); });
  const wbd = windowByDay(d), rows: Row[] = [];
  d.availDays.forEach((key) => {
    const date = parseYmd(key), dow = date.getDay(), hol = holidayName(key), wk = dow === 0 || dow === 6;
    const marks = d.avail[key] || {}, bk = d.booked[key] || {}, list = byDay[key] || [];
    if (f.from && key < f.from) return;
    if (f.to && key > f.to) return;
    if (f.wds.indexOf(dow) < 0) return;
    if (f.cond === 'has' && !list.length) return;
    if (f.cond === 'free' && list.length) return;
    if (f.cond === 'soft' && !(names.length && names.every((n) => !bk[n] && markIn(marks, n) !== '×'))) return;
    const free = names.length > 0 && names.every((n) => !bk[n] && !markIn(marks, n));
    if (f.hol && !(wk || hol)) return;
    if (f.free && !free) return;
    rows.push({ key, date, dow, hol, wk, marks, bk, list, wins: wbd[key] || [], free, notes: (d.availNotes || {})[key] || {} });
  });
  return rows;
}
