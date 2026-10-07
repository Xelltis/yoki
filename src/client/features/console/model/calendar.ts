// 卓をGoogleカレンダーに1件ずつ足すリンク。Googleの「予定を作成」の画面を、中身を入れた形で開く（連携しなくても使える）。
// 時刻は日本時間のまま渡す（ctz）。終わりの時刻が無ければ3時間、終わりが開始より前なら次の日（購読URLと同じ決まり）
import type { ConsoleSession } from '../../../../shared/api';
import { addDaysYmd, pad } from './dates';

const DEFAULT_MINUTES = 180;

function minutesOf(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h > 23 || mi > 59 ? null : h * 60 + mi;
}

const compact = (ymd: string) => ymd.replace(/-/g, '');
const stamp = (ymd: string, min: number) => compact(ymd) + 'T' + pad(Math.floor(min / 60)) + pad(min % 60) + '00';

export function googleAddUrl(s: ConsoleSession, groupTitle: string, appUrl: string): string {
  const start = minutesOf(s.start);
  let dates: string;
  if (start === null) {
    dates = compact(s.date) + '/' + compact(addDaysYmd(s.date, 1));
  } else {
    let end = minutesOf(s.end) ?? start + DEFAULT_MINUTES;
    if (end <= start) end += 1440;
    dates = stamp(s.date, start) + '/' + stamp(addDaysYmd(s.date, Math.floor(end / 1440)), end % 1440);
  }
  const details = [s.gm ? 'GM: ' + s.gm : '', s.members.length ? '参加: ' + s.members.join('、') : '', s.memo, groupTitle + '（Yoki）: ' + appUrl].filter(Boolean).join('\n');
  const q = new URLSearchParams({ action: 'TEMPLATE', text: s.name, dates, details, location: s.place, ctz: 'Asia/Tokyo' });
  return 'https://calendar.google.com/calendar/render?' + q.toString();
}
