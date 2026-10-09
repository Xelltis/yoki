// 読み込んだデータから計算するだけの小道具（src/worker/domain/model.ts）。DBを使わずに、作った卓で確かめる
import { describe, expect, test } from 'vitest';
import { STATUS } from '../../src/worker/domain/constants';
import { bookedMap, pollVoters } from '../../src/worker/domain/model';
import type { Member, Session } from '../../src/worker/domain/types';

/** 卓を1つ作る。指定しない項目は空 */
function session(over: Partial<Session>): Session {
  return {
    rowId: 0, id: 'S000', seq: 0, name: '卓', gm: '', members: [], want: [], interest: [], date: null, start: '', end: '',
    status: STATUS.HELD, place: '', memo: '', series: '', seriesEnd: null, windowFrom: null, windowTo: null, candidates: [],
    editor: '', updatedAt: '', notifiedAt: null, askedAt: null, urgedAt: null, soonAt: null, pollReadyAt: null, pollDue: null, pollUrgedAt: null, pollClosedAt: null, scenarioId: null, sheetDue: null, sheetUrgedAt: null, slots: [], sheets: [], capacity: null, recruitDue: null, dueUrgedAt: null, absent: [], threadId: null, threadParent: null, logUrl: '', recap: '',
    ...over,
  };
}

describe('予定表の「参」「GM」（bookedMap）', () => {
  test('同じ日にGMの卓と参加者の卓があればGM。GMのいない卓は参加者だけ。開催でない卓と日付の無い卓は数えない', () => {
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

describe('日程調整に答えられる人（pollVoters）', () => {
  test('GMと参加者のうち、ログインしたかDiscordのIDがあるメンバーだけ。ゲストとDiscordの無いメンバーは入らない', () => {
    const member = (id: number, name: string, discordId: string, userId: string | null): Member => ({ id, name, discordId, note: '', isAdmin: false, userId, other: [], shareBusy: false, dmKinds: '', dmError: '' });
    const memberByName = new Map(
      [member(1, 'ひより', '', 'u1'), member(2, 'ソラ', '400000000000000011', null), member(3, 'こまち', '', null)].map((m) => [m.name, m]),
    );
    expect(pollVoters({ memberByName }, { gm: 'ひより', members: ['ソラ', 'こまち', 'ゲスト太郎'] })).toEqual(['ひより', 'ソラ']);
    expect(pollVoters({ memberByName }, { gm: '', members: ['こまち', 'ゲスト太郎'] })).toEqual([]);
  });
});
