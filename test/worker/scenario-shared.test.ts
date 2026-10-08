// シナリオの通過と遊べる日の計算（src/shared/scenario.ts。画面とサーバーの両方で使う）
import { describe, expect, test } from 'vitest';
import { bookedAt, bookedPartsOf, combineMarks, markAt, partOf } from '../../src/shared/parts';
import { passesOf, plannedOf, playableDays, type ScenarioSession, sessionPasses } from '../../src/shared/scenario';

const S = (o: Partial<ScenarioSession>): ScenarioSession => ({ id: 'S001', scenarioId: '1', status: '終了', date: '', gm: '', members: [], ...o });
const NAMES = new Set(['ひより', 'ソラ', 'こまち', 'ツバキ']);

describe('卓から出す通過', () => {
  test('そのシナリオの「終了」の卓のGMはgm、参加者はplayed。メンバーでない人・ほかのシナリオ・終了でない卓は数えない', () => {
    const sessions = [
      S({ id: 'S001', gm: 'ひより', members: ['ソラ', 'ゲスト'] }),
      S({ id: 'S002', scenarioId: '2', gm: 'こまち' }),
      S({ id: 'S003', status: '開催', members: ['ツバキ'] }),
    ];
    expect(sessionPasses('1', sessions, NAMES)).toEqual({ ひより: { kind: 'gm', from: 'S001' }, ソラ: { kind: 'played', from: 'S001' } });
    // シナリオが無い（空）なら、何も出さない
    expect(sessionPasses('', [S({ scenarioId: '', gm: 'ひより' })], NAMES)).toEqual({});
  });

  test('何度か遊んだら、最初の卓を残す。あとでGMをしたらgmにする', () => {
    const sessions = [S({ id: 'S001', members: ['ソラ'] }), S({ id: 'S002', members: ['ソラ'] }), S({ id: 'S003', gm: 'ソラ' })];
    expect(sessionPasses('1', sessions, NAMES)).toEqual({ ソラ: { kind: 'gm', from: 'S001' } });
  });
});

describe('通過をまとめる', () => {
  test('印と卓からの通過の強いほう。fromは卓からの通過があれば残る。メンバーでない人の印は数えない', () => {
    const sessions = [S({ id: 'S001', gm: 'こまち', members: ['ソラ'] })];
    const passes = passesOf({ id: '1', marks: { ソラ: 'gm', こまち: 'played', ツバキ: 'played', 元メンバー: 'gm' } }, sessions, NAMES);
    expect(passes).toEqual({
      ソラ: { kind: 'gm', from: 'S001' },
      こまち: { kind: 'gm', from: 'S001' },
      ツバキ: { kind: 'played', from: '' },
    });
  });
});

describe('遊ぶ予定の人', () => {
  test('そのシナリオの「開催」「調整中」の卓のGMと参加者。最初の卓を残す', () => {
    const sessions = [
      S({ id: 'S001', status: '開催', gm: 'ひより', members: ['ソラ'] }),
      S({ id: 'S002', status: '調整中', members: ['ソラ', 'こまち'] }),
      S({ id: 'S003', status: '募集', members: ['ツバキ'] }),
      S({ id: 'S004', status: '開催', scenarioId: '2', members: ['ツバキ'] }),
    ];
    expect(plannedOf('1', sessions)).toEqual({ ひより: 'S001', ソラ: 'S001', こまち: 'S002' });
    expect(plannedOf('', [S({ scenarioId: '', status: '開催', gm: 'ひより' })])).toEqual({});
  });
});

describe('遊べる日', () => {
  const base = { members: ['ひより', 'ソラ', 'こまち', 'ツバキ'], planned: {}, avail: {}, availParts: {}, booked: {}, min: 2, dayParts: false };
  test('× の人・ほかの卓がある人・通過した人・予定の人はPLに数えない。△ はたぶん。GMの印の人はGMに数える', () => {
    const days = playableDays({
      ...base,
      days: ['2026-10-10', '2026-10-11'],
      passes: { ひより: { kind: 'gm', from: '' }, ツバキ: { kind: 'played', from: 'S001' } },
      planned: {},
      avail: { '2026-10-10': { こまち: '△' }, '2026-10-11': { ひより: '×' } },
      booked: { '2026-10-11': { ソラ: '' } },
    });
    expect(days).toEqual([
      { date: '2026-10-10', part: '', players: ['ソラ'], maybe: ['こまち'], gms: ['ひより'], ok: false },
      { date: '2026-10-11', part: '', players: ['こまち'], maybe: [], gms: [], ok: false },
    ]);
  });

  test('PLが下限以上で、GMにできる人がいれば遊べる。予定の人は数えない', () => {
    const [day] = playableDays({ ...base, days: ['2026-10-10'], passes: { ひより: { kind: 'gm', from: '' } }, planned: { ツバキ: 'S009' } });
    expect(day).toEqual({ date: '2026-10-10', part: '', players: ['ソラ', 'こまち'], maybe: [], gms: ['ひより'], ok: true });
  });

  test('昼と夜に分けるグループでは、日ごとに昼と夜を別々に数える。卓は時間帯だけをふさぎ、終日の印はどちらにも効く', () => {
    const days = playableDays({
      ...base, min: 1, dayParts: true, days: ['2026-10-10'], passes: {},
      avail: { '2026-10-10': { ひより: '△', ソラ: '×' } },
      availParts: { '2026-10-10': { ひより: ['×', ''] } },
      booked: { '2026-10-10': { こまち: '昼' } },
    });
    expect(days.map((x) => [x.part, x.players, x.maybe])).toEqual([['昼', ['ツバキ'], []], ['夜', ['ひより', 'こまち', 'ツバキ'], []]]);
  });

  test('だれもGMの印を持っていなければ、GMは問わない。下限が無ければ1人から', () => {
    const [day] = playableDays({ ...base, min: null, days: ['2026-10-10'], passes: {}, avail: { '2026-10-10': { ひより: '×', ソラ: '×', こまち: '×' } } });
    expect(day).toEqual({ date: '2026-10-10', part: '', players: ['ツバキ'], maybe: [], gms: [], ok: true });
  });
});

describe('時間帯（src/shared/parts.ts）', () => {
  test('卓の時間帯は開始時刻で決まる。17:00からは夜、時刻が無ければ終日', () => {
    expect([partOf(''), partOf('16:59'), partOf('17:00'), partOf('21:00')]).toEqual(['', '昼', '夜', '夜']);
  });

  test('昼と夜の印をまとめると、両方 × なら ×、どちらかに印があれば △', () => {
    expect([combineMarks('×', '×'), combineMarks('×', ''), combineMarks('', '△'), combineMarks('', '')]).toEqual(['×', '△', '△', '']);
  });

  test('時間帯の印は、分けた日はその時間帯、分けていない日は1日の印', () => {
    const avail = { d: { A: '△', B: '×' } }, parts = { d: { A: ['×', ''] as [string, string] } };
    expect([markAt(avail, parts, 'd', 'A', '昼'), markAt(avail, parts, 'd', 'A', '夜'), markAt(avail, parts, 'd', 'A', ''), markAt(avail, parts, 'd', 'B', '夜'), markAt(avail, parts, 'x', 'B', '夜')])
      .toEqual(['×', '', '△', '×', '']);
  });

  test('卓の時間帯を集める。昼と夜の両方に卓があれば終日', () => {
    const b = bookedPartsOf([{ date: 'd', start: '14:00', names: ['A', 'B'] }, { date: 'd', start: '20:00', names: ['B'] }, { date: 'e', start: '', names: ['A'] }]);
    expect(b).toEqual({ d: { A: '昼', B: '' }, e: { A: '' } });
    expect([bookedAt(b, 'd', 'A', '昼'), bookedAt(b, 'd', 'A', '夜'), bookedAt(b, 'd', 'A', ''), bookedAt(b, 'e', 'A', '夜'), bookedAt(b, 'd', 'C', '')]).toEqual([true, false, true, true, false]);
  });
});
