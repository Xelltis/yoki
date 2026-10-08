// 卓の登録の窓の「くり返しで足す」が作る日（src/client/features/console/form/model.tsのrepeatDates）
import { expect, test } from 'vitest';
import { repeatDates } from '../../src/client/features/console/form/model';

test('毎週・2週ごとは、開催日から7日・14日ずつ', () => {
  expect(repeatDates('2026-10-10', 'week', 3)).toEqual(['2026-10-17', '2026-10-24', '2026-10-31']);
  expect(repeatDates('2026-12-26', 'week2', 2)).toEqual(['2027-01-09', '2027-01-23']);
});

test('毎月は、同じ「第Nの曜日」。その月に無ければ飛ばす', () => {
  // 2026-10-10は第2土曜
  expect(repeatDates('2026-10-10', 'month', 3)).toEqual(['2026-11-14', '2026-12-12', '2027-01-09']);
  // 2026-10-31は第5土曜。11月・12月には無く、2027年1月は第5土曜（1/30）がある
  expect(repeatDates('2026-10-31', 'month', 1)).toEqual(['2027-01-30']);
});
