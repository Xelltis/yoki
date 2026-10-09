// 購読URL（/cal/<token>.ics）と、iCalendarの文の作り方
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import { calendarItem, calendarSessions } from '../../src/worker/domain/calendar';
import { buildCalendar, escapeText, fold, jstMs, sessionSpan, utcStamp } from '../../src/worker/lib/ics';
import { addDays } from '../../src/worker/lib/jst';
import { call, ok, setupGroup, today } from './helpers';

describe('iCalendarの文', () => {
  test('テキストの \\ ; , と改行を逃がす', () => {
    expect(escapeText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
    // CRだけの改行も、行を切らないように\nにする
    expect(escapeText('g\rh')).toBe('g\\nh');
  });

  test('75オクテットで折り返し、続きの行は空白で始める。日本語の文字の途中では切らない', () => {
    expect(fold('a'.repeat(75))).toBe('a'.repeat(75));
    expect(fold('a'.repeat(76))).toBe('a'.repeat(75) + '\r\n a');
    const jp = 'あ'.repeat(30); // 1文字3オクテット
    const lines = fold('SUMMARY:' + jp).split('\r\n');
    expect(lines.length).toBe(2);
    for (const [i, l] of lines.entries()) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(i ? 75 : 75);
    expect(lines.map((l, i) => (i ? l.slice(1) : l)).join('')).toBe('SUMMARY:' + jp);
  });

  test('卓の期間: 開始時刻が無ければ終日、終わりが無ければ3時間、終わりが開始より前なら次の日', () => {
    expect(sessionSpan('2026-10-10', '', '')).toEqual({ allDay: true, date: '2026-10-10', endDate: '2026-10-11' });
    expect(sessionSpan('2026-10-10', '未定', '23:00')).toEqual({ allDay: true, date: '2026-10-10', endDate: '2026-10-11' });
    expect(sessionSpan('2026-10-10', '20:00', '')).toEqual({ allDay: false, startMs: jstMs('2026-10-10', 1200), endMs: jstMs('2026-10-10', 1380) });
    expect(sessionSpan('2026-10-10', '22:00', '02:00')).toEqual({ allDay: false, startMs: jstMs('2026-10-10', 1320), endMs: jstMs('2026-10-11', 120) });
    expect(utcStamp(jstMs('2026-10-10', 1200))).toBe('20261010T110000Z');
  });

  test('カレンダーの形。終日と時刻つき、場所と説明は空なら書かない', () => {
    const text = buildCalendar('卓', [
      { uid: 'a@yoki', span: { allDay: true, date: '2026-10-10', endDate: '2026-10-11' }, summary: 'A', location: '', description: '', url: 'https://x/', updated: '2026-10-01T00:00:00.000Z' },
      { uid: 'b@yoki', span: sessionSpan('2026-10-11', '20:00', '23:00'), summary: 'B, 卓', location: 'ユドナリウム', description: 'GM: ひより', url: 'https://x/', updated: '2026-10-01T00:00:00.000Z' },
    ], new Date('2026-10-05T00:00:00Z'));
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text).toContain('X-WR-CALNAME:卓\r\n');
    expect(text).toContain('DTSTART;VALUE=DATE:20261010\r\nDTEND;VALUE=DATE:20261011\r\n');
    expect(text).toContain('DTSTART:20261011T110000Z\r\nDTEND:20261011T140000Z\r\n');
    expect(text).toContain('SUMMARY:B\\, 卓\r\nLOCATION:ユドナリウム\r\nDESCRIPTION:GM: ひより\r\n');
    expect(text).toContain('DTSTAMP:20261005T000000Z\r\nLAST-MODIFIED:20261001T000000Z\r\n');
    expect(text.split('BEGIN:VEVENT').length).toBe(3);
    expect(text.match(/LOCATION:/g)?.length).toBe(1);
  });
});

describe('載せる卓と中身', () => {
  const base = {
    rowId: 1, id: 'S001', seq: 1, want: [], interest: [], start: '20:00', end: '', place: '', memo: '', series: '', seriesEnd: null,
    windowFrom: null, windowTo: null, candidates: [], editor: '', updatedAt: '2026-10-01T00:00:00.000Z', notifiedAt: null, askedAt: null,
    urgedAt: null, soonAt: null, pollReadyAt: null, absent: [],
  } as const;
  const s = (o: Record<string, unknown>) => ({ ...base, name: 'A', gm: 'ひより', coGms: [], watch: [], members: ['ソラ'], date: '2026-10-10', status: '開催', ...o }) as any;

  test('開催と終了だけ。過ぎた卓は180日前まで。名前を渡せば、その人がGMか参加者の卓だけ', () => {
    const sessions = [
      s({ rowId: 1 }), s({ rowId: 2, status: '終了', date: '2026-04-10' }), s({ rowId: 3, status: '中止' }),
      s({ rowId: 4, status: '募集', date: null }), s({ rowId: 5, gm: 'こまち', members: [] }), s({ rowId: 6, status: '終了', date: '2026-04-01' }),
    ];
    const ctx = { sessions, today: '2026-10-05' };
    expect(calendarSessions(ctx, '').map((x) => x.rowId)).toEqual([1, 2, 5]);
    expect(calendarSessions(ctx, 'ソラ').map((x) => x.rowId)).toEqual([1, 2]);
    expect(calendarSessions(ctx, 'こまち').map((x) => x.rowId)).toEqual([5]);
  });

  test('説明にGM・参加者・メモ・グループの画面のURL。いなければ行ごと書かない', () => {
    const ctx = { appUrl: 'https://yoki.test/g/grp/', group: { title: 'テストの卓' } as any };
    expect(calendarItem(ctx, s({ memo: '持ち物: ダイス' })).description).toBe('GM: ひより\n参加: ソラ\n\n持ち物: ダイス\n\nテストの卓（Yoki）: https://yoki.test/g/grp/');
    expect(calendarItem(ctx, s({ gm: '', members: [] })).description).toBe('テストの卓（Yoki）: https://yoki.test/g/grp/');
  });
});

describe('購読URL', () => {
  let G: Awaited<ReturnType<typeof setupGroup>>;
  let T: (n: number) => string;
  beforeEach(async () => {
    G = await setupGroup();
    const t0 = await today();
    T = (n) => addDays(t0, n);
    await ok(G.admin, G.id, 'saveSession', { name: 'ソラの卓', gm: 'ひより', members: ['ソラ'], date: T(3), start: '20', end: '23', status: '開催', place: 'ユドナリウム' });
    await ok(G.admin, G.id, 'saveSession', { name: 'こまちの卓', gm: 'こまち', members: [], date: T(4), status: '開催' });
    await ok(G.admin, G.id, 'saveSession', { name: '中止の卓', gm: 'ソラ', date: T(5), status: '中止' });
  });
  const feedUrl = (body: any) => body.data.calendar.feed?.url as string;
  const fetchFeed = (url: string) => call(new URL(url).pathname);

  test('作るとURLが出る。自分の卓だけなら、自分が入る開催の卓だけが載る', async () => {
    const r = await ok(G.sora, G.id, 'saveCalendarFeed', { scope: 'mine' });
    expect(r.message).toBe('購読URLを作りました。');
    expect(r.data.calendar.feed.scope).toBe('mine');
    expect(feedUrl(r)).toMatch(/^https:\/\/yoki\.test\/cal\/[A-Za-z0-9_-]{43}\.ics$/);
    const res = await fetchFeed(feedUrl(r));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    const text = await res.text();
    expect(text).toContain('X-WR-CALNAME:テストの卓（自分の卓）');
    expect(text).toContain('SUMMARY:ソラの卓');
    expect(text).toContain('LOCATION:ユドナリウム');
    expect(text).not.toContain('こまちの卓');
    expect(text).not.toContain('中止の卓');
    const fetched = await env.DB.prepare('SELECT fetched_at FROM calendar_feeds').first<string>('fetched_at');
    expect(fetched).not.toBeNull();
  });

  test('載せる卓を変えるとURLはそのままで中身が変わる。作り直すとURLが変わり、前のURLは404', async () => {
    const first = feedUrl(await ok(G.sora, G.id, 'saveCalendarFeed', { scope: 'mine' }));
    const all = await ok(G.sora, G.id, 'saveCalendarFeed', { scope: 'all' });
    expect(all.message).toBe('購読URLに載せる卓を「グループの卓すべて」にしました。');
    expect(feedUrl(all)).toBe(first);
    const text = await (await fetchFeed(first)).text();
    expect(text).toContain('X-WR-CALNAME:テストの卓（Yoki）');
    expect(text).toContain('SUMMARY:こまちの卓');
    const renewed = await ok(G.sora, G.id, 'saveCalendarFeed', { scope: 'all', renew: true });
    expect(renewed.message).toContain('作り直しました');
    expect(feedUrl(renewed)).not.toBe(first);
    expect((await fetchFeed(first)).status).toBe(404);
    expect((await fetchFeed(feedUrl(renewed))).status).toBe(200);
  });

  test('止めるとURLは404。画面には出なくなる', async () => {
    const url = feedUrl(await ok(G.sora, G.id, 'saveCalendarFeed', {}));
    const r = await ok(G.sora, G.id, 'deleteCalendarFeed');
    expect(r.message).toContain('止めました');
    expect(r.data.calendar.feed).toBeNull();
    expect((await fetchFeed(url)).status).toBe(404);
  });

  test('URLは人とグループごと。ほかの人の画面には出ない', async () => {
    await ok(G.sora, G.id, 'saveCalendarFeed', {});
    const other = await ok(G.komachi, G.id, 'getConsoleData');
    expect(other.calendar.feed).toBeNull();
    // テストは開発の形で動き、Googleの値が空なので、開発用の偽のGoogleが使える
    expect(other.calendar.googleReady).toBe(true);
    expect(other.calendar.google).toBeNull();
    expect(other.availGoogle).toEqual({});
  });

  test('形の違うURL・知らないtokenは404', async () => {
    expect((await call('/cal/short.ics')).status).toBe(404);
    expect((await call('/cal/' + 'a'.repeat(43))).status).toBe(404);
    expect((await call('/cal/' + 'a'.repeat(43) + '.ics')).status).toBe(404);
  });

  test('メンバーから外された・締め出された・サーバーの控えが無い人のURLは404', async () => {
    const url = feedUrl(await ok(G.sora, G.id, 'saveCalendarFeed', {}));
    await env.DB.prepare("DELETE FROM user_guilds WHERE user_id = '400000000000000011'").run();
    expect((await fetchFeed(url)).status).toBe(404);
    await env.DB.prepare("INSERT INTO user_guilds (user_id, guild_id, name, can_manage) VALUES ('400000000000000011', 'guild-t', 'T', 0)").run();
    expect((await fetchFeed(url)).status).toBe(200);
    await env.DB.prepare("UPDATE users SET banned_at = '2026-01-01T00:00:00Z' WHERE id = '400000000000000011'").run();
    expect((await fetchFeed(url)).status).toBe(404);
    await env.DB.prepare("UPDATE users SET banned_at = NULL WHERE id = '400000000000000011'").run();
    await env.DB.prepare("UPDATE members SET user_id = NULL WHERE name = 'ソラ'").run();
    expect((await fetchFeed(url)).status).toBe(404);
  });
});
