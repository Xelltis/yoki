// 卓の期間と、iCalendar（RFC 5545）の文。購読URL（/cal/<token>.ics）と、Googleカレンダーへの書き込みが使う
import { addDays, minutesOfTime } from './jst';

const JST_MS = 9 * 3600_000;

/** 終わりの時刻が無い卓の長さ（分） */
export const DEFAULT_MINUTES = 180;

/** 卓の期間。開始時刻が無ければ終日（endは次の日）。時刻があればUTCのミリ秒（終わりが開始より前なら、次の日の時刻とみる） */
export type Span = { allDay: true; date: string; endDate: string } | { allDay: false; startMs: number; endMs: number };

/** 日本時間の日付と0時からの分を、UTCのミリ秒に */
export function jstMs(ymd: string, minutes: number): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!, 0, minutes) - JST_MS;
}

export function sessionSpan(date: string, start: string, end: string): Span {
  const s = minutesOfTime(start);
  if (s === null) return { allDay: true, date, endDate: addDays(date, 1) };
  let e = minutesOfTime(end) ?? s + DEFAULT_MINUTES;
  if (e <= s) e += 1440;
  return { allDay: false, startMs: jstMs(date, s), endMs: jstMs(date, e) };
}

/** iCalendarに載せる卓 */
export type IcsEvent = {
  uid: string;
  span: Span;
  summary: string;
  location: string;
  description: string;
  url: string;
  /** 最後に変えた日時（ISO） */
  updated: string;
};

/** テキストの値に書けない文字（\ ; , と改行）を逃がす */
export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** 1行を75オクテットまでで折り返す（続きの行は空白1つで始める）。UTF-8の文字の途中では切らない */
export function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '', size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      size = 0;
    }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** UTCの日時（20261010T110000Zの形） */
export function utcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

const compactDate = (ymd: string) => ymd.replace(/-/g, '');

function eventLines(e: IcsEvent, stamp: string): string[] {
  const when = e.span.allDay
    ? ['DTSTART;VALUE=DATE:' + compactDate(e.span.date), 'DTEND;VALUE=DATE:' + compactDate(e.span.endDate)]
    : ['DTSTART:' + utcStamp(e.span.startMs), 'DTEND:' + utcStamp(e.span.endMs)];
  return [
    'BEGIN:VEVENT',
    'UID:' + e.uid,
    'DTSTAMP:' + stamp,
    'LAST-MODIFIED:' + utcStamp(Date.parse(e.updated)),
    ...when,
    'SUMMARY:' + escapeText(e.summary),
    ...(e.location ? ['LOCATION:' + escapeText(e.location)] : []),
    ...(e.description ? ['DESCRIPTION:' + escapeText(e.description)] : []),
    'URL:' + e.url,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
  ];
}

/** カレンダー1つ分の文（行の区切りはCRLF） */
export function buildCalendar(name: string, events: IcsEvent[], now: Date): string {
  const stamp = utcStamp(now.getTime());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Yoki//Yoki//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escapeText(name),
    'X-WR-TIMEZONE:Asia/Tokyo',
    // 読み直す間隔の目安（従うかはカレンダーのアプリ次第。Googleカレンダーは従わない）
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...events.flatMap((e) => eventLines(e, stamp)),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
