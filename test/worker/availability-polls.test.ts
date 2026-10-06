// 予定（§14・17・22・31・36）と日程調整（§37・48）
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { addDays, dowOf, fmtDateJa } from '../../src/worker/lib/jst';
import { fail, ok, setupGroup, today } from './helpers';

let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
});
afterEach(() => vi.restoreAllMocks());

describe('予定', () => {
  test('自分の予定に △ × を付けて外せる。ほかの人のぶんは、管理者も入れられない', async () => {
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(2), mark: '×' });
    let d = await ok(G.sora, G.id, 'getConsoleData');
    expect(d.avail[T(2)]).toEqual({ ソラ: '×' });
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(2), mark: '' });
    d = await ok(G.sora, G.id, 'getConsoleData');
    expect(d.avail[T(2)]).toBeUndefined();
    expect(await fail(G.sora, G.id, 'setAvailability', { name: 'こまち', ymd: T(2), mark: '△' })).toEqual({ status: 403, error: '入れられるのは自分のぶんだけです。' });
    expect((await fail(G.admin, G.id, 'setAvailability', { name: 'こまち', ymd: T(2), mark: '△' })).error).toBe('入れられるのは自分のぶんだけです。');
    expect((await fail(G.admin, G.id, 'setAvailabilityBulk', { name: 'こまち', from: T(0), to: T(2), mark: '×' })).error).toBe('入れられるのは自分のぶんだけです。');
    expect((await fail(G.admin, G.id, 'setAvailNote', { name: 'こまち', ymd: T(2), text: 'メモ' })).error).toBe('入れられるのは自分のぶんだけです。');
  });

  test('○ は付けられない。範囲の外の日と、卓に入っている日は変えられない', async () => {
    expect((await fail(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(1), mark: '○' })).error).toContain('△ か ×');
    expect((await fail(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(400), mark: '×' })).error).toContain('範囲外');
    await ok(G.admin, G.id, 'saveSession', { name: '卓', gm: 'ひより', members: ['ソラ'], date: T(4), status: '開催' });
    expect((await fail(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(4), mark: '×' })).error).toContain('卓に入っている日');
    const d = await ok(G.sora, G.id, 'getConsoleData');
    expect(d.booked[T(4)]).toEqual({ ひより: 'GM', ソラ: '参' });
  });

  test('まとめて入れる: 曜日で絞り、卓の日と入力済み（残すとき）は飛ばす', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '卓', gm: 'ソラ', date: T(7), status: '開催' });
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(14), mark: '△' });
    const wd = dowOf(T(0));
    const r = await ok(G.sora, G.id, 'setAvailabilityBulk', { name: 'ソラ', from: T(0), to: T(20), weekdays: [wd], mark: '×', keep: true });
    // T(0)・T(7)・T(14) が同じ曜日。T(7) は卓、T(14) は入力済み
    expect(r).toMatchObject({ count: 1, skippedBooked: 1, skippedKeep: 1 });
    expect(r.message).toBe('ソラの1日に「×」を入れました。（卓のある日を1日、入力済みの日を1日飛ばしました）');
    expect(r.data.avail[T(0)]).toEqual({ ソラ: '×' });
  });

  test('まとめて: 曜日を省くと毎日。同じ印のマスは数えない。空欄にすると消える', async () => {
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(1), mark: '△' });
    let r = await ok(G.sora, G.id, 'setAvailabilityBulk', { name: 'ソラ', from: T(0), to: T(2), mark: '△' });
    expect(r).toMatchObject({ count: 2, skippedBooked: 0, skippedKeep: 0, message: 'ソラの2日に「△」を入れました。' });
    expect([T(0), T(1), T(2), T(3)].map((d) => r.data.avail[d])).toEqual([{ ソラ: '△' }, { ソラ: '△' }, { ソラ: '△' }, undefined]);
    // もう一度入れても、書くマスが無い
    r = await ok(G.sora, G.id, 'setAvailabilityBulk', { name: 'ソラ', from: T(0), to: T(2), mark: '△' });
    expect(r).toMatchObject({ count: 0, message: 'ソラの0日に「△」を入れました。' });
    r = await ok(G.sora, G.id, 'setAvailabilityBulk', { name: 'ソラ', from: T(1), to: T(2), mark: '' });
    expect(r.message).toBe('ソラの2日に「空欄」を入れました。');
    expect([T(0), T(1), T(2)].map((d) => r.data.avail[d])).toEqual([{ ソラ: '△' }, undefined, undefined]);
  });

  test('予定のメモは、空にすると消える', async () => {
    await ok(G.sora, G.id, 'setAvailNote', { name: 'ソラ', ymd: T(8), text: '21時から' });
    const r = await ok(G.sora, G.id, 'setAvailNote', { name: 'ソラ', ymd: T(8), text: '' });
    expect(r.message).toBe(fmtDateJa(T(8)) + ' ソラのメモを消しました。');
    expect(r.data.availNotes[T(8)]).toBeUndefined();
  });

  test('予定のメモ（200文字まで）と日付メモ（500文字まで）', async () => {
    let r = await ok(G.sora, G.id, 'setAvailNote', { name: 'ソラ', ymd: T(8), text: '21時から' });
    expect(r.data.availNotes[T(8)].ソラ.text).toBe('21時から');
    expect((await fail(G.sora, G.id, 'setAvailNote', { name: 'ソラ', ymd: T(8), text: 'あ'.repeat(201) })).error).toContain('200文字');
    r = await ok(G.komachi, G.id, 'setDayNote', { ymd: T(5), text: '合宿' });
    expect(r.data.notes[T(5)]).toMatchObject({ text: '合宿', by: 'こまち' });
    r = await ok(G.komachi, G.id, 'setDayNote', { ymd: T(5), text: '' });
    expect(r.data.notes[T(5)]).toBeUndefined();
  });
});

describe('日程調整', () => {
  const CH = '123456789012345678';
  beforeEach(async () => {
    await env.DB.prepare('UPDATE groups SET channel_id = ?').bind(CH).run();
    await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', members: ['ソラ'], status: '調整中' });
  });
  const posts: string[] = [];
  const urls: string[] = [];
  /** Botの送信を差し替える。送った文と送り先を残す */
  const mockBot = () => {
    posts.length = 0;
    urls.length = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      urls.push(String(input));
      posts.push(JSON.parse(String(init?.body)).content);
      return new Response('{}', { status: 200 });
    });
  };

  test('始めると、出した人（GMか参加者）の候補日に ◯ が付く。過ぎた日や21日以上は断る', async () => {
    const r = await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(6), T(5), T(5)], start: '20', end: '23:00' });
    expect(r.dates).toEqual([T(5), T(6)]);
    const s = r.data.sessions[0];
    expect(s).toMatchObject({ candidates: [T(5), T(6)], start: '20:00', end: '23:00' });
    expect(s.votes).toEqual({ [T(5)]: { ひより: '◯' }, [T(6)]: { ひより: '◯' } });
    expect((await fail(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(-1)] })).error).toContain('過ぎた日');
    expect((await fail(G.admin, G.id, 'startPoll', { id: 'S001', dates: Array.from({ length: 21 }, (_, i) => T(i + 1)) })).error).toContain('20日まで');
  });

  test('選び直すと、外した日の回答だけ消える', async () => {
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5), T(6)] });
    await ok(G.sora, G.id, 'setPollVote', { id: 'S001', ymd: T(5), name: 'ソラ', vote: '×' });
    const r = await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5), T(7)] });
    expect(r.data.sessions[0].votes).toEqual({ [T(5)]: { ひより: '◯', ソラ: '×' }, [T(7)]: { ひより: '◯' } });
  });

  test('全員の回答がそろったら、サーバーがGMに1回だけ知らせる。取り消してそろい直せば、また知らせる', async () => {
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5), T(6)] });
    mockBot();
    let r = await ok(G.sora, G.id, 'setPollVote', { id: 'S001', ymd: T(5), name: 'ソラ', vote: '◯' });
    expect(r.ready).toBe(false);
    r = await ok(G.sora, G.id, 'setPollVote', { id: 'S001', ymd: T(6), name: 'ソラ', vote: '×' });
    expect(r).toMatchObject({ ready: true, notified: true });
    expect(r.message).toContain('全員の回答がそろいました。　GMへの知らせをDiscordに送りました。');
    expect(posts).toHaveLength(1);
    expect(urls).toEqual(['https://discord.com/api/v10/channels/' + CH + '/messages']);
    expect(posts[0]).toContain('「迷宮」の日程調整の回答がそろいました。');
    expect(posts[0]).toContain('◯ 2/2（全員 ◯）');
    // 同じ回答をもう一度書いても、二重には送らない
    await ok(G.sora, G.id, 'setPollVote', { id: 'S001', ymd: T(6), name: 'ソラ', vote: '◯' });
    expect(posts).toHaveLength(1);
    await ok(G.sora, G.id, 'setPollVote', { id: 'S001', ymd: T(6), name: 'ソラ', vote: '' });
    r = await ok(G.sora, G.id, 'setPollVoteAll', { id: 'S001', name: 'ソラ' });
    expect(r.ready).toBe(true);
    expect(posts).toHaveLength(2);
  });

  test('回答できるのはGMと参加者だけ。候補日でない日は断る', async () => {
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5)] });
    expect((await fail(G.komachi, G.id, 'setPollVote', { id: 'S001', ymd: T(5), name: 'こまち', vote: '◯' })).error).toContain('GMでも参加者でもない');
    expect((await fail(G.sora, G.id, 'setPollVote', { id: 'S001', ymd: T(9), name: 'ソラ', vote: '◯' })).error).toContain('候補日ではありません');
  });

  test('開催日を決められるのはGMか管理者。決めると「開催」になり、日程が決まった知らせが届く', async () => {
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5), T(6)] });
    await ok(G.admin, G.id, 'saveMember', { oldName: 'ひより', name: 'ひより' });
    await env.DB.prepare("UPDATE members SET is_admin = 0").run();
    expect((await fail(G.sora, G.id, 'decidePoll', { id: 'S001', ymd: T(5) })).error).toBe('ADMIN: GMのほかが開催日を決めることができるのは管理者だけです。');
    mockBot();
    const r = await ok(G.admin, G.id, 'decidePoll', { id: 'S001', ymd: T(6) });
    expect(r.data.sessions[0]).toMatchObject({ status: '開催', date: T(6), candidates: [], votes: {}, window: '' });
    expect(r.notified).toBe(true);
    expect(posts[0]).toContain('「迷宮」の日程が決まりました');
    expect(r.data.log.some((l: any) => l.kind === '日程決定')).toBe(true);
  });

  test('回答は本人だけ。ゲストとDiscordの無いメンバーは、管理者も代わりに入れられず、「そろった」にも数えない', async () => {
    await ok(G.admin, G.id, 'saveMember', { name: 'エマ' });
    await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '迷宮', gm: 'ひより', members: ['ソラ', 'エマ'], extra: 'ゲスト太郎', status: '調整中' });
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5)] });
    mockBot();
    for (const name of ['ゲスト太郎', 'エマ', 'ソラ']) {
      expect((await fail(G.admin, G.id, 'setPollVote', { id: 'S001', ymd: T(5), name, vote: '◯' })).error).toBe('入れられるのは自分のぶんだけです。');
      expect((await fail(G.admin, G.id, 'setPollVoteAll', { id: 'S001', name })).error).toBe('入れられるのは自分のぶんだけです。');
    }
    // 答えられるのはひよりとソラ。ソラが答えればそろう
    const r = await ok(G.sora, G.id, 'setPollVote', { id: 'S001', ymd: T(5), name: 'ソラ', vote: '◯' });
    expect(r).toMatchObject({ ready: true, notified: true });
    expect(r.data.sessions[0].votes).toEqual({ [T(5)]: { ひより: '◯', ソラ: '◯' } });
    expect(posts[0]).toContain('◯ 2/2（全員 ◯）');
  });

  test('おまかせを取り消すと、自分の回答が全部消える', async () => {
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5), T(6)] });
    mockBot();
    await ok(G.sora, G.id, 'setPollVote', { id: 'S001', ymd: T(5), name: 'ソラ', vote: '×' });
    const r = await ok(G.sora, G.id, 'setPollVoteAll', { id: 'S001', name: 'ソラ', vote: '' });
    expect(r.message).toBe('ソラ: 「迷宮」の回答を取り消しました');
    expect(r.data.sessions[0].votes).toEqual({ [T(5)]: { ひより: '◯' }, [T(6)]: { ひより: '◯' } });
  });

  test('チャンネルが無ければ、回答がそろっても送らない（そろいの印は付ける）', async () => {
    await env.DB.prepare("UPDATE groups SET channel_id = ''").run();
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5)] });
    mockBot();
    const r = await ok(G.sora, G.id, 'setPollVoteAll', { id: 'S001', name: 'ソラ', vote: '◯' });
    expect(r).toMatchObject({ ready: true, notified: null, message: 'ソラ: 候補日1日すべてに ◯ を付けました（どの日でもいい）　全員の回答がそろいました。' });
    expect(posts).toHaveLength(0);
    expect(await env.DB.prepare('SELECT poll_ready_at FROM sessions').first('poll_ready_at')).not.toBeNull();
  });

  test('GMへの知らせが届かなければ、そろいの印を外す（画面から送り直せるように）', async () => {
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5)] });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ message: 'Unknown Channel', code: 10003 }, { status: 404 }));
    const r = await ok(G.sora, G.id, 'setPollVote', { id: 'S001', ymd: T(5), name: 'ソラ', vote: '◯' });
    expect(r).toMatchObject({ ready: true, notified: false });
    expect(r.message).toBe(fmtDateJa(T(5)) + ' ソラ: ◯　全員の回答がそろいました。　GMへの知らせをDiscordに送れませんでした。');
    expect(await env.DB.prepare('SELECT poll_ready_at FROM sessions').first('poll_ready_at')).toBeNull();
    expect(r.data.log[0]).toMatchObject({ kind: '回答そろい', target: '迷宮' });
    expect(r.data.log[0].result).toContain('送信失敗（チャンネル）');
  });

  test('同じときの別の回答が先にそろいの印を取っていたら、二重には送らない', async () => {
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5)] });
    // 別の呼び出しが、先に印を取ったことにする
    await env.DB.prepare("UPDATE sessions SET poll_ready_at = '2026-01-01T00:00:00.000Z'").run();
    mockBot();
    const r = await ok(G.sora, G.id, 'setPollVote', { id: 'S001', ymd: T(5), name: 'ソラ', vote: '◯' });
    expect(r).toMatchObject({ ready: true, message: fmtDateJa(T(5)) + ' ソラ: ◯　全員の回答がそろいました。' });
    expect(r.notified).toBeUndefined();
    expect(posts).toHaveLength(0);
  });

  test('やめると、候補日と回答が消える（調整中のまま）', async () => {
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5)] });
    const r = await ok(G.sora, G.id, 'cancelPoll', { id: 'S001' });
    expect(r.data.sessions[0]).toMatchObject({ status: '調整中', candidates: [], votes: {} });
  });
});
