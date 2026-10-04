// 日本時間の日付と時刻。Workers は UTC で動くので、日本時間（UTC+9、夏時間なし）を明示して扱う。
// 暦日は 'YYYY-MM-DD' の文字列で持ち、計算は Date.UTC で行う（new Date(y, m, d) は使わない）
const JST_MS = 9 * 3600_000;
export const WD = ['日', '月', '火', '水', '木', '金', '土'];

const pad2 = (n: number) => String(n).padStart(2, '0');

export type JstParts = { ymd: string; year: number; month: number; day: number; hour: number; minute: number; dow: number };

/** その瞬間の日本時間 */
export function jst(at: Date): JstParts {
  const d = new Date(at.getTime() + JST_MS);
  const year = d.getUTCFullYear(), month = d.getUTCMonth() + 1, day = d.getUTCDate();
  return { ymd: year + '-' + pad2(month) + '-' + pad2(day), year, month, day, hour: d.getUTCHours(), minute: d.getUTCMinutes(), dow: d.getUTCDay() };
}

function ymdParts(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split('-').map(Number);
  return [y!, m!, d!];
}

function ymdOfUtc(ms: number): string {
  const d = new Date(ms);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymdParts(ymd);
  return ymdOfUtc(Date.UTC(y, m - 1, d + n));
}

/** a から b まで何日（b が後なら正） */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = ymdParts(a);
  const [by, bm, bd] = ymdParts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400_000);
}

export function dowOf(ymd: string): number {
  const [y, m, d] = ymdParts(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 'YYYY-MM-DD'・'YYYY/MM/DD'・'YYYY年M月D日'（と時刻つき）を 'YYYY-MM-DD' にする。読めない・無い日付なら null */
export function parseYmd(v: unknown): string | null {
  const m = /^(\d{4})[/\-.年](\d{1,2})[/\-.月](\d{1,2})/.exec(String(v ?? '').trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const ymd = ymdOfUtc(Date.UTC(y, mo - 1, d));
  return ymd === y + '-' + pad2(mo) + '-' + pad2(d) ? ymd : null;
}

/** '10/3（土）'（GAS 版 fmtDateJa_） */
export function fmtDateJa(ymd: string): string {
  const [, m, d] = ymdParts(ymd);
  return m + '/' + d + '（' + WD[dowOf(ymd)] + '）';
}

/** '2026年10月3日' */
export function fmtDateLong(ymd: string): string {
  const [y, m, d] = ymdParts(ymd);
  return y + '年' + m + '月' + d + '日';
}

/** '2026/10/03' */
export function fmtYmdSlash(ymd: string): string {
  return ymd.replace(/-/g, '/');
}

/** 日時を '2026/09/15 21:23'（日本時間）に（GAS 版 fmtDateTime_） */
export function fmtDateTime(at: Date): string {
  const p = jst(at);
  return fmtYmdSlash(p.ymd) + ' ' + pad2(p.hour) + ':' + pad2(p.minute);
}

/** ISO の日時を '2026/09/15（火） 21:23'（日本時間）に。空なら ''（GAS 版 stampText_） */
export function stampText(iso: string | null | undefined): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const p = jst(at);
  return fmtYmdSlash(p.ymd) + '（' + WD[p.dow] + '） ' + pad2(p.hour) + ':' + pad2(p.minute);
}

/** 時刻の入力を 'HH:MM' に（'9' → '09:00'、'21：30' → '21:30'）。読めなければそのまま（GAS 版 normTime_） */
export function normTime(v: unknown): string {
  const s = String(v ?? '').trim().replace(/：/g, ':');
  const m = /^(\d{1,2})(?::(\d{2}))?/.exec(s);
  if (!m) return s;
  return pad2(Number(m[1])) + ':' + (m[2] ?? '00');
}

/** 'HH:MM' を 0 時からの分に。読めなければ null（GAS 版 minutesOfTime_） */
export function minutesOfTime(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** '20:00〜23:00'・'時間未定'（GAS 版 timeRange_） */
export function timeRange(s: { start: string; end: string }): string {
  if (!s.start && !s.end) return '時間未定';
  return (s.start || '？') + '〜' + (s.end || '');
}
