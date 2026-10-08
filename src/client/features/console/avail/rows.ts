// メンバーの予定のタブで見せる人と日（絞り込みを当てたもの）。画面のデータdと絞り込みを受け取って計算するだけ
import type { ConsoleData, ConsoleSession } from '../../../../shared/api';
import { holidayName, parseYmd } from '../model/dates';
import type { Part } from '../../../../shared/parts';
import { active, bookedOn, candidatesOf, dayParts, markOn, memberOrder, targetPeople, windowByDay } from '../model/model';

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

/**
 * 表とリストの1日分。partsは見る時間帯（昼と夜に分けるグループは昼と夜、ほかは ''）、freePartsは全員が空いている時間帯、
 * freeはどれかの時間帯で全員が空いているか
 */
export type Row = {
  key: string; date: Date; dow: number; hol: string; wk: boolean;
  marks: Record<string, string>; bk: Record<string, string>; list: ConsoleSession[]; wins: ConsoleSession[];
  parts: (Part | '')[]; freeParts: (Part | '')[]; free: boolean; notes: Record<string, { text: string; at: string }>;
};

/** その人のその時間帯の印（△ か ×）。分けないグループや、分けていない日は1日の印 */
export function markAtRow(d: ConsoleData, r: Row, n: string, part: Part | ''): Mark { return markIn({ [n]: markOn(d, r.key, n, part) }, n); }
/** 「全員空き」「昼は全員空き」 */
export function freeText(r: Row): string { return r.freeParts.length === 1 && r.freeParts[0] ? r.freeParts[0] + 'は全員空き' : '全員空き'; }

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
    // 昼と夜に分けるグループでは、時間帯ごとに見て、どれかの時間帯で合えば出す
    const parts = dayParts(d);
    if (f.cond === 'soft' && !(names.length && parts.some((p) => names.every((n) => !bookedOn(d, key, n, p) && markOn(d, key, n, p) !== '×')))) return;
    const freeParts = names.length ? parts.filter((p) => names.every((n) => !bookedOn(d, key, n, p) && !markIn({ [n]: markOn(d, key, n, p) }, n))) : [];
    const free = freeParts.length > 0;
    if (f.hol && !(wk || hol)) return;
    if (f.free && !free) return;
    rows.push({ key, date, dow, hol, wk, marks, bk, list, wins: wbd[key] || [], parts, freeParts, free, notes: (d.availNotes || {})[key] || {} });
  });
  return rows;
}
