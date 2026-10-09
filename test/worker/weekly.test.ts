// いつもの予定: 曜日ごとの印を決めると、予定表の印の無い日に入る。見回りが毎日、予定表に新しく入った日に入れる（本人が消した日には入れ直さない）
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import { cleanup } from '../../src/worker/domain/patrol';
import { addDays, dowOf } from '../../src/worker/lib/jst';
import { fail, ok, setupGroup, today } from './helpers';

let G: Awaited<ReturnType<typeof setupGroup>>;
let t0: string;
const T = (n: number) => addDays(t0, n);
beforeEach(async () => {
  G = await setupGroup();
  t0 = await today();
  // 予定表は14日
  await env.DB.prepare('UPDATE groups SET avail_days = 14 WHERE id = ?').bind(G.id).run();
});

/** ソラの印{ 日: 印 } */
async function marks(): Promise<Record<string, string>> {
  const rows = (await env.DB.prepare("SELECT a.date, a.mark FROM availability a JOIN members m ON m.id = a.member_id WHERE m.name = 'ソラ' AND a.part = ''").all<{ date: string; mark: string }>()).results;
  return Object.fromEntries(rows.map((r) => [r.date, r.mark]));
}
/** 今日からn日のうち、その曜日の日 */
const daysOf = (dow: number, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => T(from + i)).filter((d) => dowOf(d) === dow);
const weekly = (sid: string, w: Record<string, string>) => ok(sid, G.id, 'setWeekly', { name: sid === G.sora ? 'ソラ' : 'こまち', weekly: w });

describe('決める', () => {
  test('予定表の、印の無い日に入れる（印のある日・卓のある日は除く）。画面データに出る（本人の分だけ）', async () => {
    const wed = daysOf(3, 0, 13), sat = daysOf(6, 0, 13);
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: wed[0], mark: '△' });
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', members: ['ソラ'], date: sat[0], status: '開催' });
    const r = await weekly(G.sora, { 6: '△', 3: '×' });
    expect(r.message).toBe('いつもの予定を保存しました（水 ×・土 △）。予定表の、印の無い' + (wed.length - 1 + sat.length - 1) + '日に入れました。これから予定表に入る日にも、毎日入ります。');
    expect(r.data.me.weekly).toEqual({ 3: '×', 6: '△' });
    const m = await marks();
    expect(m[wed[0]!]).toBe('△');
    expect(wed.slice(1).every((d) => m[d] === '×')).toBe(true);
    expect(m[sat[0]!]).toBeUndefined();
    expect(sat.slice(1).every((d) => m[d] === '△')).toBe(true);
    expect((await ok(G.komachi, G.id, 'getConsoleData')).me.weekly).toEqual({});
  });

  test('止めると、入れた印はそのまま残る。曜日と印を確かめる', async () => {
    await weekly(G.sora, { 3: '×' });
    const r = await weekly(G.sora, {});
    expect(r.message).toBe('いつもの予定を止めました（入れた印はそのまま残ります）。');
    expect(r.data.me.weekly).toEqual({});
    expect(Object.values(await marks())).toContain('×');
    expect((await fail(G.sora, G.id, 'setWeekly', { name: 'ソラ', weekly: { 7: '×' } })).error).toBe('曜日が読めません: 7');
    expect((await fail(G.sora, G.id, 'setWeekly', { name: 'ソラ', weekly: { 1: '◯' } })).error).toContain('印は △ か × です');
    expect((await fail(G.sora, G.id, 'setWeekly', { name: 'こまち', weekly: {} })).error).toContain('自分');
    // 空の印の曜日は決めないのと同じ。形の違う値も
    expect((await ok(G.sora, G.id, 'setWeekly', { name: 'ソラ', weekly: { 1: '', 2: '△' } })).data.me.weekly).toEqual({ 2: '△' });
    expect((await ok(G.sora, G.id, 'setWeekly', { name: 'ソラ', weekly: ['×'] })).data.me.weekly).toEqual({});
  });
});

describe('見回りが毎日入れる', () => {
  test('予定表に新しく入った日だけに入れる。本人が消した日・卓のある日・印のある日には入れない', async () => {
    await weekly(G.sora, { 0: '×', 1: '×', 2: '×', 3: '×', 4: '×', 5: '×', 6: '×' });
    // 予定表の中の1日を本人が消す
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(2), mark: '' });
    // 3日後には、T(14)〜T(16) が新しく入る。T(15)は卓、T(16)は印がある
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', members: ['ソラ'], date: T(15), status: '開催' });
    await env.DB.prepare("INSERT INTO availability (member_id, date, part, mark) SELECT id, ?, '', '△' FROM members WHERE name = 'ソラ'").bind(T(16)).run();
    await cleanup(env.DB, new Date(T(3) + 'T05:00:00+09:00'));
    const m = await marks();
    expect([m[T(2)], m[T(14)], m[T(15)], m[T(16)], m[T(17)]]).toEqual([undefined, '×', undefined, '△', undefined]);
    // 同じ日にもう一度回しても変わらない。こまち（決めていない）には入らない
    await cleanup(env.DB, new Date(T(3) + 'T05:00:00+09:00'));
    expect(await marks()).toEqual(m);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM availability a JOIN members m ON m.id = a.member_id WHERE m.name = 'こまち'").first('n')).toBe(0);
  });

  test('予定表の日数を増やしたら、増えた日にも入る', async () => {
    await weekly(G.sora, { 0: '×', 1: '×', 2: '×', 3: '×', 4: '×', 5: '×', 6: '×' });
    await env.DB.prepare('UPDATE groups SET avail_days = 20 WHERE id = ?').bind(G.id).run();
    await cleanup(env.DB, new Date(t0 + 'T05:00:00+09:00'));
    const m = await marks();
    expect([m[T(13)], m[T(14)], m[T(19)], m[T(20)]]).toEqual(['×', '×', '×', undefined]);
  });
});
