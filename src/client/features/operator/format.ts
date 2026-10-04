// 運営者の管理画面の日時の書き方

const JST = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
/** 日時（日本時間）。空なら —。読めない値はそのまま */
export function fmt(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : JST.format(d);
}
/** どれくらい前か（3 分前・2 時間前・5 日前） */
export function ago(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!iso || Number.isNaN(ms)) return '';
  if (ms < 60_000) return 'たったいま';
  if (ms < 3600_000) return Math.floor(ms / 60_000) + ' 分前';
  if (ms < 86400_000) return Math.floor(ms / 3600_000) + ' 時間前';
  return Math.floor(ms / 86400_000) + ' 日前';
}
/** '2026-10-04' → '2026年10月4日' */
export const longDate = (ymd: string) => ymd.replace(/^(\d+)-0?(\d+)-0?(\d+)$/, '$1年$2月$3日');
