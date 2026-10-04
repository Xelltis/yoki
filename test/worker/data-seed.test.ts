// 画面データの形（§12）とサンプルデータ、日本時間の小道具
import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { addDays, daysBetween, fmtDateJa, jst, normTime, parseYmd, stampText } from '../../src/worker/lib/jst';
import { seedSample } from '../../src/worker/seed/sample';
import { makeGroup, ok, setupGroup, today } from './helpers';

describe('日本時間の小道具', () => {
  test('UTC の 15:00 は日本時間の翌日 0 時', () => {
    expect(jst(new Date('2026-09-30T15:00:00Z'))).toMatchObject({ ymd: '2026-10-01', hour: 0, minute: 0, dow: 4 });
  });
  test('日付の計算と書き方', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-10-03', '2026-10-17')).toBe(14);
    expect(fmtDateJa('2026-10-03')).toBe('10/3（土）');
    expect(stampText('2026-09-15T12:23:00Z')).toBe('2026/09/15（火） 21:23');
    expect(parseYmd('2026/2/31')).toBeNull();
    expect(parseYmd('2026年10月3日')).toBe('2026-10-03');
    expect(normTime('9')).toBe('09:00');
    expect(normTime('21：30')).toBe('21:30');
  });
});

describe('画面データ', () => {
  test('形は GAS 版のまま（外したものと足したもの以外）', async () => {
    const G = await setupGroup();
    const d = await ok(G.sora, G.id, 'getConsoleData');
    expect(Object.keys(d).sort()).toEqual([
      'admins', 'appUrl', 'availDays', 'availNotes', 'avail', 'booked', 'group', 'isAdmin', 'loadedAt', 'log', 'me', 'members', 'notes',
      'notifyDefault', 'notifySetter', 'recruitWebhookSet', 'remindWebhookSet', 'seriesNotify', 'sessions', 'settings', 'statuses', 'title', 'today', 'webhookSet',
    ].sort());
    expect(d).toMatchObject({ me: { name: 'ソラ', isAdmin: false }, isAdmin: false, appUrl: 'https://yoki.test/g/grp/', today: await today() });
    expect(d.loadedAt).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
    expect(d.members.map((m: any) => m.name)).toEqual(['ひより', 'ソラ', 'こまち']);
    expect(d.statuses).toEqual(['募集', '調整中', '開催', '終了', '中止']);
    expect((await ok(G.admin, G.id, 'getConsoleData')).isAdmin).toBe(true);
  });

  test('開催日が過ぎた「開催」の卓は、読み込んだときに「終了」になる（設定が ON のとき）', async () => {
    const G = await setupGroup();
    await ok(G.admin, G.id, 'saveSession', { name: '昨日の卓', gm: 'ひより', date: addDays(await today(), -1), status: '開催' });
    await ok(G.admin, G.id, 'saveSession', { name: '今日の卓', gm: 'ひより', date: await today(), status: '開催' });
    const d = await ok(G.admin, G.id, 'getConsoleData');
    expect(d.sessions.map((s: any) => s.status)).toEqual(['終了', '開催']);
  });
});

describe('画面データの細かいところ', () => {
  test('開催前の知らせが ON で、ON にした人の控えが無ければ「有効」と出す', async () => {
    const G = await setupGroup();
    // DB を手で直したときなど
    await env.DB.prepare("UPDATE groups SET remind_enabled = 1, remind_set_by = ''").run();
    const d = await ok(G.sora, G.id, 'getConsoleData');
    expect(d.notifySetter).toBe('有効');
    expect(d.settings).toMatchObject({ remind: true, setter: '有効' });
  });

  test('予定の日数を減らすと、範囲の外の印は画面に出ない（消えはしない）', async () => {
    const G = await setupGroup();
    const t0 = await today();
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: addDays(t0, 6), mark: '×' });
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: addDays(t0, 30), mark: '△' });
    const r = await ok(G.admin, G.id, 'saveConsoleSettings', { availDays: '7' });
    expect(r.data.availDays).toHaveLength(7);
    expect(r.data.avail).toEqual({ [addDays(t0, 6)]: { ソラ: '×' } });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM availability').first('n')).toBe(2);
  });
});

describe('サンプルデータ', () => {
  test('メンバー 6 人と卓 11 件ができ、画面データが組める', async () => {
    await makeGroup('sample', 'dev-guild');
    await seedSample(env.DB, 'sample', 'https://yoki.test/g/sample/');
    const n = (sql: string) => env.DB.prepare(sql).first('n');
    expect(await n("SELECT count(*) AS n FROM members WHERE group_id = 'sample'")).toBe(6);
    expect(await n("SELECT count(*) AS n FROM sessions WHERE group_id = 'sample'")).toBe(11);
    expect(await n('SELECT count(*) AS n FROM poll_votes')).toBeGreaterThan(0);
    expect(await n('SELECT count(*) AS n FROM availability')).toBeGreaterThan(10);
    const names = (await env.DB.prepare("SELECT name, status FROM sessions WHERE group_id = 'sample' ORDER BY seq").all()).results;
    expect(names.slice(0, 4).map((r: any) => r.name)).toEqual(['鉄鳴界の夜明け #1', '鉄鳴界の夜明け #2', '鉄鳴界の夜明け #3', '鉄鳴界の夜明け #4']);
  });
});
