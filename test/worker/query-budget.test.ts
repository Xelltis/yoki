// 1回の呼び出しで使うD1の問い合わせの数。無料のプランは1回の呼び出しで50までなので、余裕を残して上限を決める。
// 文（prepare）の数を数える（batchの中の文も1つずつ数える）
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { addDays } from '../../src/worker/lib/jst';
import { ok, setupGroup, today } from './helpers';

const LIMIT = 45;
let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
});
afterEach(() => vi.restoreAllMocks());

/** fnを呼ぶあいだに作った文の数 */
async function statements(fn: () => Promise<unknown>): Promise<number> {
  const spy = vi.spyOn(Object.getPrototypeOf(env.DB), 'prepare');
  await fn();
  const n = spy.mock.calls.length;
  spy.mockRestore();
  return n;
}

test('どの呼び出しも、D1の問い合わせを上限より少なく使う', async () => {
  const counts: Record<string, number> = {};
  counts.getConsoleData = await statements(() => ok(G.sora, G.id, 'getConsoleData'));
  counts.saveSession = await statements(() => ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', members: ['ソラ', 'こまち'], status: '調整中' }));
  counts.startPoll = await statements(() => ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(3), T(4)] }));
  counts.setPollVote = await statements(() => ok(G.sora, G.id, 'setPollVote', { id: 'S001', ymd: T(3), name: 'ソラ', vote: '◯' }));
  counts.setPollVoteAll = await statements(() => ok(G.komachi, G.id, 'setPollVoteAll', { id: 'S001', name: 'こまち' }));
  counts.decidePoll = await statements(() => ok(G.admin, G.id, 'decidePoll', { id: 'S001', ymd: T(3) }));
  counts.saveSessionDates = await statements(() => ok(G.admin, G.id, 'saveSession', { name: '続き 1', gm: 'ひより', members: ['ソラ'], status: '開催', dates: [T(5), T(6), T(7)] }));
  counts.bulkUpdateSessions = await statements(() => ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S002', 'S003'], action: 'status', value: '中止' }));
  counts.deleteSession = await statements(() => ok(G.admin, G.id, 'deleteSession', { id: 'S004' }));
  // 上限を超えた呼び出しの名前と数（空であること）
  expect(Object.entries(counts).filter(([, n]) => n > LIMIT)).toEqual([]);
  // 日程調整の書き込みは、読み直した中身を返事に使い、画面データをもう一度読まない（読み込みは1回14文）
  expect(counts.decidePoll! - counts.startPoll!).toBeLessThan(14);
});
