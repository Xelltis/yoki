// 画面から来た値が正しくないときに断ること（卓・日程調整・予定・メンバー）。断ったときは何も書かない
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
type Form = Record<string, unknown>;
const count = (table: string) => env.DB.prepare('SELECT count(*) AS n FROM ' + table).first<number>('n');

describe('卓', () => {
  test('まとめての登録は新規だけ。読めない日付があれば 1 件も入れない', async () => {
    await ok(G.sora, G.id, 'saveSession', { name: 'A', date: T(1), status: '開催' });
    expect((await fail(G.sora, G.id, 'saveSession', { id: 'S001', name: 'A', dates: [T(1), T(2)], status: '開催' })).error).toBe('複数日をまとめて登録できるのは新規のときだけです。');
    expect((await fail(G.sora, G.id, 'saveSession', { name: 'B', dates: [T(1), '2026-13-01'], status: '開催' })).error).toBe('開催日の形式が読めません: 2026-13-01');
    expect(await count('sessions')).toBe(1);
  });

  test('期間の日付が読めなければ断る', async () => {
    expect((await fail(G.sora, G.id, 'saveSession', { name: 'x', status: '募集', windowFrom: 'あした', windowTo: T(3) })).error).toBe('期間の日付が読めません: あした〜' + T(3));
  });

  test('無い卓は 404。ID を送らなくても同じ', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: 'A', status: '募集' });
    expect(await fail(G.admin, G.id, 'deleteSession', { id: 'S404' })).toEqual({ status: 404, error: 'その卓が見つかりません: S404' });
    expect(await fail(G.admin, G.id, 'deleteSession', {})).toEqual({ status: 404, error: 'その卓が見つかりません: ' });
    expect(await count('sessions')).toBe(1);
  });

  test('参加希望: 自分でない名前・知らない操作・GM 本人は断る', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '募集の卓', gm: 'ひより', status: '募集' });
    expect((await fail(G.admin, G.id, 'setInterest', { id: 'S001', name: '', level: 'want' })).error).toBe('入れられるのは自分のぶんだけです。');
    expect((await fail(G.sora, G.id, 'setInterest', { id: 'S001', name: 'ソラ', level: 'maybe' })).error).toBe('操作が不正です: maybe');
    expect((await fail(G.admin, G.id, 'setInterest', { id: 'S001', name: 'ひより', level: 'interest' })).error).toBe('ひより はすでにこの卓のGMです。');
  });

  test('まとめての変更: 卓が選ばれていない・見つからない・値が正しくないときは、何も変えない', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: 'A', gm: 'ひより', status: '募集' });
    const bulk = (form: Form) => fail(G.admin, G.id, 'bulkUpdateSessions', form);
    expect(await bulk({ ids: [], action: 'delete' })).toEqual({ status: 400, error: '卓を選んでください。' });
    expect(await bulk({ ids: ['S404'], action: 'delete' })).toEqual({ status: 404, error: '選んだ卓が見つかりません。' });
    expect((await bulk({ ids: ['S001'], action: 'status', value: '予定' })).error).toBe('状態が不正です: 予定');
    expect((await bulk({ ids: ['S001'], action: 'addMember', value: ' ' })).error).toBe('名前を選んでください。');
    expect((await bulk({ ids: ['S001'], action: 'rename', value: 'B' })).error).toBe('操作が不正です: rename');
    expect((await bulk({ ids: ['S001'] })).error).toBe('操作が不正です: ');
    const d = await ok(G.admin, G.id, 'getConsoleData');
    expect(d.sessions).toMatchObject([{ id: 'S001', name: 'A', status: '募集', members: [] }]);
  });
});

describe('日程調整', () => {
  beforeEach(async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', members: ['ソラ'], status: '調整中' });
  });
  /** 調整を始めたあとで日が過ぎ、候補日に昨日が入っていることにする */
  const withPastCandidate = () => env.DB.prepare('UPDATE sessions SET candidates = ?').bind(JSON.stringify([T(-1), T(5)])).run();

  test('始めるとき: 調整中でない卓・参加者のいない卓・読めない日付・候補日なしは断る', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '募集の卓', gm: 'ひより', status: '募集' });
    await ok(G.admin, G.id, 'saveSession', { name: 'ひとり', gm: 'ひより', status: '調整中' });
    const start = async (form: Form) => (await fail(G.admin, G.id, 'startPoll', form)).error;
    expect(await start({ id: 'S002', dates: [T(5)] })).toBe('「募集の卓」は日程調整中ではありません（募集）。');
    expect(await start({ id: 'S003', dates: [T(5)] })).toBe('「ひとり」には参加者がいません。参加者を入れてから日程を調整してください。');
    expect(await start({ id: 'S001', dates: [T(5), 'いつか'] })).toBe('日付が読めません: いつか');
    expect(await start({ id: 'S001', dates: [] })).toBe('候補日を 1 日以上選んでください。');
    expect(await start({ id: 'S001' })).toBe('候補日を 1 日以上選んでください。');
    expect(await count('poll_votes')).toBe(0);
  });

  test('回答するとき: 自分でない名前・◯ × でない・読めない日付・過ぎた候補日は断る', async () => {
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5)] });
    const vote = async (sid: string, form: Form) => (await fail(sid, G.id, 'setPollVote', { id: 'S001', ...form })).error;
    expect(await vote(G.admin, { ymd: T(5), name: '', vote: '◯' })).toBe('入れられるのは自分のぶんだけです。');
    // 似た字の ○ は受け付けない
    expect(await vote(G.sora, { ymd: T(5), name: 'ソラ', vote: '○' })).toBe('回答は ◯ か × です。');
    expect(await vote(G.sora, { ymd: 'あした', name: 'ソラ', vote: '◯' })).toBe('日付が読めません: あした');
    await withPastCandidate();
    expect(await vote(G.sora, { ymd: T(-1), name: 'ソラ', vote: '◯' })).toBe('過ぎた候補日には回答できません。');
    expect(await count('poll_votes')).toBe(1);
  });

  test('おまかせ: 自分でない名前・◯ のほか・GM でも参加者でもない人・これからの候補日が無いときは断る', async () => {
    const all = async (sid: string, form: Form) => (await fail(sid, G.id, 'setPollVoteAll', { id: 'S001', ...form })).error;
    expect(await all(G.sora, { name: 'ソラ' })).toBe('「迷宮」には、これからの候補日がありません。');
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5)] });
    expect(await all(G.admin, { name: '' })).toBe('入れられるのは自分のぶんだけです。');
    expect(await all(G.sora, { name: 'ソラ', vote: '×' })).toBe('おまかせで付けられるのは ◯ だけです。');
    expect(await all(G.komachi, { name: 'こまち' })).toBe('こまち は「迷宮」の GM でも参加者でもないので、回答できません。');
    // 候補日が、過ぎた日だけになった
    await env.DB.prepare('UPDATE sessions SET candidates = ?').bind(JSON.stringify([T(-2), T(-1)])).run();
    expect(await all(G.sora, { name: 'ソラ' })).toBe('「迷宮」には、これからの候補日がありません。');
  });

  test('開催日を決めるとき: 読めない日付・候補日でない日・過ぎた候補日は断る', async () => {
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5)] });
    const decide = async (ymd: string) => (await fail(G.admin, G.id, 'decidePoll', { id: 'S001', ymd })).error;
    expect(await decide('いつか')).toBe('日付が読めません: いつか');
    expect(await decide(T(6))).toBe(fmtDateJa(T(6)) + ' は「迷宮」の候補日ではありません。');
    await withPastCandidate();
    expect(await decide(T(-1))).toBe('過ぎた候補日には決められません。');
    const d = await ok(G.admin, G.id, 'getConsoleData');
    expect(d.sessions[0]).toMatchObject({ status: '調整中', date: '' });
  });
});

describe('予定', () => {
  test('1 マス: 自分でない名前（空・ゲスト）・読めない日付は断る', async () => {
    const set = async (form: Form) => (await fail(G.admin, G.id, 'setAvailability', form)).error;
    expect(await set({ name: '', ymd: T(1), mark: '×' })).toBe('入れられるのは自分のぶんだけです。');
    expect(await set({ name: 'ゲスト太郎', ymd: T(1), mark: '×' })).toBe('入れられるのは自分のぶんだけです。');
    expect(await set({ name: 'ひより', ymd: '来週', mark: '×' })).toBe('日付が読めません: 来週');
    expect(await count('availability')).toBe(0);
  });

  test('まとめて: 期間が無い・逆さま・曜日が選ばれていないときは断る', async () => {
    const bulk = async (form: Form) => (await fail(G.sora, G.id, 'setAvailabilityBulk', { name: 'ソラ', mark: '×', ...form })).error;
    expect(await bulk({ from: T(0) })).toBe('期間を入れてください。');
    expect(await bulk({ from: T(5), to: T(1) })).toBe('期間の始まりが終わりより後になっています。');
    expect(await bulk({ from: T(0), to: T(6), weekdays: [] })).toBe('曜日を選んでください。');
    // 0〜6 の外は数えない
    expect(await bulk({ from: T(0), to: T(6), weekdays: [7, -1] })).toBe('曜日を選んでください。');
    expect(await count('availability')).toBe(0);
  });

  test('メモ: 読めない日付と、500 文字を超える日付メモは断る', async () => {
    expect((await fail(G.sora, G.id, 'setAvailNote', { name: 'ソラ', ymd: 'x', text: 'a' })).error).toBe('日付が読めません: x');
    expect((await fail(G.sora, G.id, 'setDayNote', { ymd: 'x', text: 'a' })).error).toBe('日付が読めません: x');
    expect((await fail(G.sora, G.id, 'setDayNote', { ymd: T(1), text: 'あ'.repeat(501) })).error).toBe('メモは 500 文字までです。');
    const r = await ok(G.sora, G.id, 'setDayNote', { ymd: T(1), text: 'あ'.repeat(500) });
    expect(r.data.notes[T(1)].text).toHaveLength(500);
  });
});

describe('メンバー', () => {
  test('名前が空は断る。無い人の変更・削除・管理者の付け外しは 404', async () => {
    expect((await fail(G.admin, G.id, 'saveMember', { name: ' ' })).error).toBe('名前を入れてください。');
    expect(await fail(G.admin, G.id, 'saveMember', { oldName: 'だれか', name: 'エマ' })).toEqual({ status: 404, error: '編集対象が見つかりません: だれか' });
    expect(await fail(G.admin, G.id, 'deleteMember', { name: 'だれか' })).toEqual({ status: 404, error: '見つかりません: だれか' });
    expect(await fail(G.admin, G.id, 'setAdmin', { name: 'だれか', admin: true })).toEqual({ status: 404, error: 'メンバーに「だれか」はいません。' });
    expect(await count('members')).toBe(3);
  });
});
