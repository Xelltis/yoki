// 卓の変更の履歴: 登録・変更（変わったところ）・まとめての変更・日程調整・行けなくなったを残し、新しい順に読む
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import { changeText, HISTORY_KEEP } from '../../src/worker/domain/history';
import { cleanup } from '../../src/worker/domain/patrol';
import type { Session } from '../../src/worker/domain/types';
import { addDays, fmtDateJa } from '../../src/worker/lib/jst';
import { fail, ok, setupGroup, today } from './helpers';

let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
});
const history = async (id = 'S001') => ((await ok(G.sora, G.id, 'getSessionHistory', { id })).items as { by: string; action: string; detail: string; at: string }[]);
const brief = async (id = 'S001') => (await history(id)).map((h) => [h.action, h.detail]);

describe('卓の変更の履歴', () => {
  test('登録と変更を、だれがしたかと一緒に、新しい順に読む。変わっていない保存は残さない', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', members: ['ソラ'], date: T(3), start: '20:00', end: '23:00', status: '開催' });
    await ok(G.sora, G.id, 'saveSession', { id: 'S001', name: '港', gm: 'ひより', members: ['ソラ', 'こまち'], date: T(4), start: '20:00', end: '23:00', status: '開催' });
    await ok(G.sora, G.id, 'saveSession', { id: 'S001', name: '港', gm: 'ひより', members: ['ソラ', 'こまち'], date: T(4), start: '20:00', end: '23:00', status: '開催' });
    const h = await history();
    expect(h.map((x) => [x.by, x.action, x.detail])).toEqual([
      ['ソラ', '変更', '開催日 ' + fmtDateJa(T(3)) + '→' + fmtDateJa(T(4)) + '、参加者 +こまち'],
      ['ひより', '登録', '開催 ' + fmtDateJa(T(3)) + ' 20:00〜23:00'],
    ]);
    expect(h[0]!.at).toMatch(/^\d{4}\/\d{2}\/\d{2}（.）\d{2}:\d{2}$/);
    expect((await fail(G.sora, G.id, 'getSessionHistory', { id: 'S009' })).status).toBe(404);
  });

  test('募集の登録は期間、日の無い登録は状態だけ。まとめて登録した卓には、それぞれに残す', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'ひより', status: '募集', windowFrom: T(10), windowTo: T(20) });
    await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', status: '調整中' });
    await ok(G.admin, G.id, 'saveSession', { name: '一日の卓', gm: 'ひより', date: T(2), status: '開催' });
    await ok(G.admin, G.id, 'saveSession', { name: '連続 1', gm: 'ひより', status: '開催', dates: [T(5), T(6)], date: T(5) });
    expect(await brief('S001')).toEqual([['登録', '募集 ' + fmtDateJa(T(10)) + '〜' + fmtDateJa(T(20))]]);
    expect(await brief('S002')).toEqual([['登録', '調整中']]);
    expect(await brief('S003')).toEqual([['登録', '開催 ' + fmtDateJa(T(2))]]);
    expect([await brief('S004'), await brief('S005')]).toEqual([[['登録', '開催（2回分をまとめて）']], [['登録', '開催（2回分をまとめて）']]]);
  });

  test('まとめての変更・日程調整・行けなくなったも残す', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', members: ['ソラ'], status: '調整中' });
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(3), T(4)] });
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(3)] });
    await ok(G.admin, G.id, 'cancelPoll', { id: 'S001' });
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5)] });
    await ok(G.admin, G.id, 'decidePoll', { id: 'S001', ymd: T(5) });
    await ok(G.sora, G.id, 'setAbsence', { id: 'S001', name: 'ソラ', note: 'ごめん' });
    await ok(G.sora, G.id, 'setAbsence', { id: 'S001', name: 'ソラ', note: '直した' });
    await ok(G.sora, G.id, 'setAbsence', { id: 'S001', name: 'ソラ', absent: false });
    await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'shiftDays', value: '1' });
    expect((await brief()).slice(0, 8)).toEqual([
      ['まとめての変更', '開催日を+1日'],
      ['行けなくなったを取り消し', 'ソラ'],
      ['行けなくなった', 'ソラ'],
      ['日程決定', fmtDateJa(T(5))],
      ['日程調整', '候補日を出した: ' + fmtDateJa(T(5))],
      ['日程調整', 'やめた'],
      ['日程調整', '候補日を選び直した: ' + fmtDateJa(T(3))],
      ['日程調整', '候補日を出した: ' + fmtDateJa(T(3)) + '、' + fmtDateJa(T(4))],
    ]);
    // 卓を消すと、履歴も消える
    await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'delete' });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM session_history').first('n')).toBe(0);
  });

  test('毎日の片付けで、卓ごとに新しい50件だけを残す', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', date: T(3), status: '開催' });
    await env.DB.prepare(
      "INSERT INTO session_history (session_id, at, by_name, action, detail) SELECT (SELECT id FROM sessions), 'x', '', '変更', value FROM json_each(?)",
    ).bind(JSON.stringify(Array.from({ length: 60 }, (_, i) => 'd' + i))).run();
    await cleanup(env.DB, new Date());
    const h = await history();
    expect(h).toHaveLength(HISTORY_KEEP);
    expect(h[0]!.detail).toBe('d59');
  });

  test('変わったところの文', () => {
    const base = {
      name: '港', status: '開催', date: '2026-10-10', start: '20:00', end: '23:00', place: 'A', memo: 'm', series: '', gm: 'ひより', members: ['ソラ'],
      windowFrom: null, windowTo: null, scenarioId: null, capacity: null, recruitDue: null,
    };
    const old = base as unknown as Session;
    const ctx = { scenarios: [{ id: 1, name: '狂気山脈' }] } as any;
    expect(changeText(ctx, old, base)).toBe('');
    expect(changeText(ctx, old, {
      ...base, name: '港2', status: '募集', date: null, start: '', end: '', place: '', memo: '', series: 'S', gm: '', members: [],
      windowFrom: '2026-10-12', windowTo: '2026-10-11', scenarioId: 1, capacity: 3, recruitDue: '2026-10-09',
    })).toBe('名前 港→港2、状態 開催→募集、開催日 10/10（土）→未定、時間 20:00〜23:00→未定、期間 なし→10/11（日）〜10/12（月）、GM ひより→なし、参加者 −ソラ、'
      + '場所 A→なし、メモを変更、シリーズ なし→S、シナリオ なし→狂気山脈、定員 なし→3人、締め切り なし→10/9（金）');
    expect(changeText(ctx, { ...base, scenarioId: 9, capacity: 2, recruitDue: '2026-10-09', start: '', end: '23:00' } as unknown as Session, { ...base, start: '21:00' }))
      .toBe('時間 ？〜23:00→21:00〜23:00、定員 2人→なし、締め切り 10/9（金）→なし');
  });
});
