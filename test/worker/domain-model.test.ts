// 読み込んだデータから計算するだけの小道具（src/worker/domain/model.ts）。DB を使わずに、作った卓で確かめる
import { describe, expect, test } from 'vitest';
import { STATUS } from '../../src/worker/domain/constants';
import { bookedMap } from '../../src/worker/domain/model';
import type { Session } from '../../src/worker/domain/types';

/** 卓を 1 つ作る。指定しない項目は空 */
function session(over: Partial<Session>): Session {
  return {
    rowId: 0, id: 'S000', seq: 0, name: '卓', gm: '', members: [], want: [], interest: [], date: null, start: '', end: '',
    status: STATUS.HELD, place: '', memo: '', series: '', seriesEnd: null, windowFrom: null, windowTo: null, candidates: [],
    editor: '', updatedAt: '', notifiedAt: null, askedAt: null, urgedAt: null, soonAt: null, pollReadyAt: null,
    ...over,
  };
}

describe('予定表の「参」「GM」（bookedMap）', () => {
  test('同じ日に GM の卓と参加者の卓があれば GM。GM のいない卓は参加者だけ。開催でない卓と日付の無い卓は数えない', () => {
    const day = '2026-10-10';
    const booked = bookedMap([
      session({ date: day, gm: 'こまち', members: ['ソラ'] }),
      session({ date: day, gm: '', members: ['こまち', 'ひより'] }),
      session({ date: '2026-10-11', status: STATUS.RECRUIT, gm: 'ひより' }),
      session({ date: null, gm: 'ひより' }),
    ]);
    expect(booked).toEqual({ [day]: { こまち: 'GM', ソラ: '参', ひより: '参' } });
  });
});
