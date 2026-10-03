// 日付（YYYY-MM-DD の文字列）。画面は見る人の手元の暦で扱う（サーバーが日本時間の今日を D.today で渡す）

export const WD = ['日', '月', '火', '水', '木', '金', '土'];

export function pad(n: number): string { return ('0' + n).slice(-2); }
/** 月は 0 から（Date と同じ） */
export function ymdOf(y: number, m: number, d: number): string { return y + '-' + pad(m + 1) + '-' + pad(d); }
export function parseYmd(s: string): Date { const p = s.split('-'); return new Date(+p[0]!, +p[1]! - 1, +p[2]!); }
export function addDaysYmd(s: string, n: number): string { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymdOf(d.getFullYear(), d.getMonth(), d.getDate()); }
export function daysBetween(a: string, b: string): number { return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86400000); }
/** 10/3（土） */
export function fmtJa(s: string): string { const d = parseYmd(s); return (d.getMonth() + 1) + '/' + d.getDate() + '（' + WD[d.getDay()] + '）'; }
/** 21:00〜23:00。時刻が無ければ「時間未定」 */
export function timeRange(s: { start: string; end: string }): string { if (!s.start && !s.end) return '時間未定'; return (s.start || '？') + '〜' + (s.end || ''); }
/** 期間の見出し。10/3（土）〜10/17（土） */
export function winLabel(from: string, to: string): string { return from && to ? fmtJa(from) + '〜' + fmtJa(to) : ''; }
/** 2026/10/03（土） 21:16 → 21:16 */
export function hhmm(t: string): string { return String(t || '').slice(11, 16); }

/* 日本の祝日。振替休日と国民の休日を含む。春分・秋分は 1980〜2099 年の近似式 */
const HOLIDAYS: Record<number, Record<string, string>> = {};
export function jpHolidays(year: number): Record<string, string> {
  if (HOLIDAYS[year]) return HOLIDAYS[year];
  const base: Record<string, string> = {};
  const add = (m: number, d: number, name: string) => { base[ymdOf(year, m - 1, d)] = name; };
  add(1, 1, '元日'); add(2, 11, '建国記念の日'); add(2, 23, '天皇誕生日'); add(4, 29, '昭和の日');
  add(5, 3, '憲法記念日'); add(5, 4, 'みどりの日'); add(5, 5, 'こどもの日'); add(8, 11, '山の日'); add(11, 3, '文化の日'); add(11, 23, '勤労感謝の日');
  const nthMon = (m: number, n: number) => { const first = new Date(year, m - 1, 1).getDay(); return 1 + ((8 - first) % 7) + (n - 1) * 7; };
  add(1, nthMon(1, 2), '成人の日'); add(7, nthMon(7, 3), '海の日'); add(9, nthMon(9, 3), '敬老の日'); add(10, nthMon(10, 2), 'スポーツの日');
  add(3, Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4)), '春分の日');
  add(9, Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4)), '秋分の日');
  const out: Record<string, string> = { ...base };
  Object.keys(base).forEach((k) => {
    const d = parseYmd(k);
    if (d.getDay() !== 0) return;
    const x = new Date(d.getTime());
    do { x.setDate(x.getDate() + 1); } while (base[ymdOf(x.getFullYear(), x.getMonth(), x.getDate())]);
    const kk = ymdOf(x.getFullYear(), x.getMonth(), x.getDate());
    if (!out[kk]) out[kk] = '振替休日';
  });
  for (const d = new Date(year, 0, 1); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
    const k = ymdOf(year, d.getMonth(), d.getDate());
    if (out[k] || d.getDay() === 0) continue;
    if (base[addDaysYmd(k, -1)] && base[addDaysYmd(k, 1)]) out[k] = '国民の休日';
  }
  HOLIDAYS[year] = out;
  return out;
}
export function holidayName(key: string): string { return jpHolidays(+key.slice(0, 4))[key] || ''; }
