// 記録のタブの「あなたの記録」（src/client/features/console/records/ledger.tsのmyStats）
import { expect, test } from 'vitest';
import type { ConsoleData, ConsoleSession } from '../../src/shared/api';
import { myStats } from '../../src/client/features/console/records/ledger';

const session = (o: Partial<ConsoleSession>): ConsoleSession => ({
  id: 'S001', name: '卓', gm: '', coGms: [], members: [], status: '終了', date: '2026-10-01', start: '', end: '', scenarioId: '', absent: [], ...o,
}) as ConsoleSession;
const data = (sessions: ConsoleSession[]): ConsoleData => ({
  today: '2026-10-10',
  sessions,
  scenarios: [{ id: '1', name: '狂気山脈', system: 'クトゥルフ神話TRPG' }, { id: '2', name: '古城', system: '' }],
  members: [],
}) as unknown as ConsoleData;

test('GM（共同GMも）とPLの回数、最初と最後の日。行けなくなった卓・終わっていない卓は数えない', () => {
  const d = data([
    session({ id: 'S001', date: '2026-09-01', gm: 'ひより', members: ['ソラ'], scenarioId: '1' }),
    session({ id: 'S002', date: '2026-09-15', gm: 'こまち', coGms: ['ひより'], members: ['ソラ'] }),
    session({ id: 'S003', date: '2026-10-01', gm: 'ソラ', members: ['ひより'], scenarioId: '2' }),
    session({ id: 'S004', date: '2026-10-05', gm: 'ソラ', members: ['ひより'], absent: [{ name: 'ひより', note: '', at: '' }] }),
    session({ id: 'S005', date: '2026-10-20', status: '開催', gm: 'ひより' }),
  ]);
  expect(myStats(d, 'ひより')).toEqual({
    gm: 2, pl: 1, first: '2026-09-01', last: '2026-10-01',
    systems: [
      { system: 'クトゥルフ神話TRPG', gm: 1, pl: 0 }, { system: 'システム未設定', gm: 0, pl: 1 }, { system: 'シナリオ未設定', gm: 1, pl: 0 },
    ],
    partners: [{ name: 'ソラ', n: 3 }, { name: 'こまち', n: 1 }],
  });
});

test('卓に入っていなければ空。一緒に遊んだ人は3人まで、行けなくなった人は数えない', () => {
  expect(myStats(data([]), 'ひより')).toEqual({ gm: 0, pl: 0, first: '', last: '', systems: [], partners: [] });
  const d = data([
    session({ gm: 'ひより', members: ['あ', 'い', 'う', 'え'], absent: [{ name: 'え', note: '', at: '' }] }),
    session({ id: 'S002', date: '2026-10-02', gm: 'ひより', members: ['う'] }),
  ]);
  expect(myStats(d, 'ひより').partners).toEqual([{ name: 'う', n: 2 }, { name: 'あ', n: 1 }, { name: 'い', n: 1 }]);
});
