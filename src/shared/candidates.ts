// 日程調整の候補。ふだんは日付（YYYY-MM-DD）。昼と夜に分けるグループでは、時間帯を付けた「YYYY-MM-DD 昼」「YYYY-MM-DD 夜」も候補にできる。
// 回答（poll_votes.date）も、この形の候補ごとに持つ。文字の大小は日付の順と同じなので、「これからの候補か」は今日の日付と文字で比べてよい。
// 画面とサーバーの両方で使う
import { PARTS, type Part } from './parts';

/** 候補の日付 */
export const candDay = (k: string): string => k.slice(0, 10);
/** 候補の時間帯（付いていなければ ''） */
export const candPart = (k: string): Part | '' => (k.length > 11 ? (k.slice(11) as Part) : '');

/** 候補を読む。「YYYY-MM-DD」か「YYYY-MM-DD 昼|夜」。dayは日付を確かめて直す関数（読めなければnull） */
export function parseCandidate(v: unknown, day: (s: string) => string | null): string | null {
  const m = /^(\S+?)(?:\s+(\S+))?$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const d = day(m[1]!);
  if (!d || (m[2] && !(PARTS as string[]).includes(m[2]))) return null;
  return m[2] ? d + ' ' + m[2] : d;
}

const PART_ORDER: Record<string, number> = { '': 0, 昼: 1, 夜: 2 };
/** 候補を、日付の順、同じ日は 1日・昼・夜 の順に並べる */
export function sortCandidates(list: string[]): string[] {
  return list.slice().sort((a, b) => candDay(a).localeCompare(candDay(b)) || PART_ORDER[candPart(a)]! - PART_ORDER[candPart(b)]!);
}

/** 候補の書き方。fmtで日付を書き、時間帯があれば「の夜」を足す（10/12（月）の夜） */
export function candLabel(k: string, fmt: (day: string) => string): string {
  const p = candPart(k);
  return fmt(candDay(k)) + (p ? 'の' + p : '');
}
