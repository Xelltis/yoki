// 時間帯（昼・夜）。グループの管理者が「昼と夜に分ける」を入れたグループだけ、予定の印を昼と夜に分けて持つ
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import { addDays, fmtDateJa } from '../../src/worker/lib/jst';
import { fail, ok, setupGroup, today } from './helpers';

let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
});
const rows = async () =>
  (await env.DB.prepare("SELECT date, part, mark, source FROM availability WHERE member_id = (SELECT id FROM members WHERE name = 'ソラ') ORDER BY date, CASE part WHEN '' THEN 0 WHEN '昼' THEN 1 ELSE 2 END").all<Record<string, string>>())
    .results.map((r) => [r.date, r.part, r.mark + (r.source ? ':' + r.source : '')]);

describe('設定', () => {
  test('管理者が入れ切りでき、画面データに出る', async () => {
    let r = await ok(G.admin, G.id, 'saveConsoleSettings', { dayParts: true });
    expect(r.message).toContain('予定の昼と夜を分けるのをON');
    expect(r.data.settings.dayParts).toBe(true);
    r = await ok(G.admin, G.id, 'saveConsoleSettings', { dayParts: false });
    expect(r.data.settings.dayParts).toBe(false);
  });
});

describe('昼と夜に分けて入れる', () => {
  beforeEach(async () => { await env.DB.prepare('UPDATE groups SET day_parts = 1').run(); });

  test('時間帯の印を入れると、その日の終日の印は昼と夜に分かれる。画面データには時間帯の印と、まとめた印が出る', async () => {
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(2), mark: '△' });
    let r = await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(2), part: '昼', mark: '×' });
    expect(r).toMatchObject({ part: '昼', mark: '×' });
    expect(await rows()).toEqual([[T(2), '昼', '×'], [T(2), '夜', '△']]);
    r = await ok(G.sora, G.id, 'getConsoleData');
    expect(r.availParts[T(2)]).toEqual({ ソラ: ['×', '△'] });
    expect(r.avail[T(2)]).toEqual({ ソラ: '△' });
    // 夜を空けると、昼だけが残る。両方 × ならまとめた印も ×
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(2), part: '夜', mark: '' });
    expect(await rows()).toEqual([[T(2), '昼', '×']]);
    r = await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(2), part: '夜', mark: '×' });
    expect((await ok(G.sora, G.id, 'getConsoleData')).avail[T(2)]).toEqual({ ソラ: '×' });
    // 終日の印を入れると、時間帯の印は消える
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(2), mark: '△' });
    expect(await rows()).toEqual([[T(2), '', '△']]);
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(2), mark: '' });
    expect(await rows()).toEqual([]);
  });

  test('卓は開始時刻の時間帯だけをふさぐ。時刻の無い卓は両方', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '昼の卓', gm: 'ひより', members: ['ソラ'], date: T(3), start: '14:00', status: '開催' });
    await ok(G.admin, G.id, 'saveSession', { name: '一日の卓', gm: 'ひより', members: ['ソラ'], date: T(4), status: '開催' });
    expect((await fail(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(3), part: '昼', mark: '×' })).error).toBe(fmtDateJa(T(3)) + 'の昼はソラが卓に入っている時間帯なので、都合は変えられません。');
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(3), part: '夜', mark: '×' });
    expect((await fail(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(4), part: '夜', mark: '×' })).error).toContain('の夜はソラが卓に入っている時間帯');
    expect((await fail(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(3), mark: '×' })).error).toContain('は' + 'ソラが卓に入っている日');
    const d = await ok(G.sora, G.id, 'getConsoleData');
    expect([d.bookedParts[T(3)], d.bookedParts[T(4)]]).toEqual([{ ひより: '昼', ソラ: '昼' }, { ひより: '', ソラ: '' }]);
  });

  test('時間帯は「昼」か「夜」だけ', async () => {
    expect((await fail(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(2), part: '朝', mark: '×' })).error).toBe('時間帯は「昼」か「夜」です。');
  });

  test('まとめて入れる: 時間帯を選べる。その時間帯に卓のある日は飛ばす', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '夜の卓', gm: 'ひより', members: ['ソラ'], date: T(1), start: '20:00', status: '開催' });
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(2), mark: '△' });
    let r = await ok(G.sora, G.id, 'setAvailabilityBulk', { name: 'ソラ', from: T(0), to: T(2), part: '夜', mark: '×' });
    expect(r.message).toBe('ソラの2日（夜）に「×」を入れました。（卓のある日を1日飛ばしました）');
    expect(await rows()).toEqual([[T(0), '夜', '×'], [T(2), '昼', '△'], [T(2), '夜', '×']]);
    r = await ok(G.sora, G.id, 'setAvailabilityBulk', { name: 'ソラ', from: T(0), to: T(2), part: '昼', mark: '×', keep: true });
    // 昼の卓は無いので、T(1)の昼にも入る。T(2)の昼は入力済みなので残す
    expect(await rows()).toEqual([[T(0), '昼', '×'], [T(0), '夜', '×'], [T(1), '昼', '×'], [T(2), '昼', '△'], [T(2), '夜', '×']]);
  });

  test('Googleから入れた印を、時間帯で消すと、その日はもうGoogleから入れない', async () => {
    const id = await env.DB.prepare("SELECT id FROM members WHERE name = 'ソラ'").first<number>('id');
    await env.DB.prepare("INSERT INTO availability (member_id, date, part, mark, source) VALUES (?, ?, '', '×', 'google')").bind(id, T(2)).run();
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(2), part: '夜', mark: '' });
    expect(await rows()).toEqual([[T(2), '昼', '×:google']]);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM google_dismissed').first('n')).toBe(1);
  });

  test('昼と夜の両方にGoogleから入れた日も、Googleの印の人は1回だけ出す', async () => {
    const id = await env.DB.prepare("SELECT id FROM members WHERE name = 'ソラ'").first<number>('id');
    await env.DB.prepare("INSERT INTO availability (member_id, date, part, mark, source) VALUES (?1, ?2, '昼', '×', 'google'), (?1, ?2, '夜', '△', 'google')").bind(id, T(2)).run();
    const d = await ok(G.sora, G.id, 'getConsoleData');
    expect([d.availGoogle[T(2)], d.availParts[T(2)], d.avail[T(2)]]).toEqual([['ソラ'], { ソラ: ['×', '△'] }, { ソラ: '△' }]);
  });
});

describe('分けないグループ', () => {
  test('時間帯を送っても、終日の印として入れる。前に分けて入れた印は、まとめた印で見える', async () => {
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(2), part: '昼', mark: '×' });
    expect(await rows()).toEqual([[T(2), '', '×']]);
    const id = await env.DB.prepare("SELECT id FROM members WHERE name = 'ソラ'").first<number>('id');
    await env.DB.prepare("INSERT INTO availability (member_id, date, part, mark) VALUES (?, ?, '昼', '×')").bind(id, T(3)).run();
    const d = await ok(G.sora, G.id, 'getConsoleData');
    expect([d.avail[T(3)], d.availParts[T(3)]]).toEqual([{ ソラ: '△' }, { ソラ: ['×', ''] }]);
  });
});

describe('日程調整の「予定表から入れる」', () => {
  test('卓の開始時刻の時間帯の印と卓で決める', async () => {
    await env.DB.prepare('UPDATE groups SET day_parts = 1').run();
    await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', members: ['ソラ'], status: '調整中' });
    await ok(G.admin, G.id, 'saveSession', { name: '昼の卓', gm: 'こまち', members: ['ソラ'], date: T(4), start: '13:00', status: '開催' });
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(3), T(4)], start: '20:00' });
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(3), part: '昼', mark: '×' });
    const r = await ok(G.sora, G.id, 'setPollVoteFromAvail', { id: 'S001', name: 'ソラ' });
    expect(r.data.sessions[0].votes).toMatchObject({ [T(3)]: { ソラ: '◯' }, [T(4)]: { ソラ: '◯' } });
  });
});
