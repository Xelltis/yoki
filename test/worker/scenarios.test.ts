// シナリオと通過: シナリオの登録・変更・削除、通過の印、卓のシナリオ、「終了」の卓を消したときに通過を残す
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import { addDays } from '../../src/worker/lib/jst';
import { fail, ok, setupGroup, today } from './helpers';

let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
});
const scenarioOf = (body: any, name: string) => body.data.scenarios.find((s: any) => s.name === name);
const sessionOf = (body: any, id: string) => body.data.sessions.find((s: any) => s.id === id);
const marks = async () =>
  (await env.DB.prepare('SELECT m.name, ms.kind FROM member_scenarios ms JOIN members m ON m.id = ms.member_id ORDER BY m.name').all<{ name: string; kind: string }>()).results;

/** シナリオを登録して、そのIDを返す */
async function addScenario(sid: string, o: Record<string, unknown> = {}): Promise<string> {
  return (await ok(sid, G.id, 'saveScenario', { name: '狂気山脈', ...o })).id;
}

describe('シナリオの登録と変更', () => {
  test('メンバーならだれでも登録できる。中身は画面データに名前の順で出る。登録した人は名前で出る', async () => {
    const r = await ok(G.sora, G.id, 'saveScenario', {
      name: '狂気山脈', system: 'クトゥルフ神話TRPG', playersMin: '3', playersMax: 5, hours: '8時間', url: 'https://example.com/a', memo: '長編',
    });
    expect(r.message).toBe('シナリオを登録しました: 狂気山脈');
    await addScenario(G.komachi, { name: 'あの日の約束' });
    const d = await ok(G.sora, G.id, 'getConsoleData');
    expect(d.scenarios.map((s: any) => s.name)).toEqual(['あの日の約束', '狂気山脈']);
    expect(d.scenarios[1]).toEqual({
      id: r.id, name: '狂気山脈', system: 'クトゥルフ神話TRPG', playersMin: 3, playersMax: 5, hours: '8時間', url: 'https://example.com/a', memo: '長編',
      createdBy: 'ソラ', marks: {},
    });
  });

  test('変更する。人数とURLは空にできる。同じ名前はほかのシナリオと重ねられない', async () => {
    const id = await addScenario(G.sora, { playersMin: 2, url: 'http://example.com' });
    await addScenario(G.sora, { name: '別' });
    const r = await ok(G.komachi, G.id, 'saveScenario', { id, name: '狂気山脈（改）', playersMin: '', url: '' });
    expect(r.message).toBe('シナリオを更新しました: 狂気山脈（改）');
    expect(scenarioOf(r, '狂気山脈（改）')).toMatchObject({ id, playersMin: null, url: '', createdBy: 'ソラ' });
    // 自分の名前のままの保存はできる
    await ok(G.komachi, G.id, 'saveScenario', { id, name: '狂気山脈（改）' });
    expect((await fail(G.sora, G.id, 'saveScenario', { id, name: '別' })).error).toBe('同じ名前のシナリオがあります: 別');
    expect((await fail(G.sora, G.id, 'saveScenario', { name: '別' })).error).toBe('同じ名前のシナリオがあります: 別');
  });

  test('入れられない値は断る', async () => {
    const bad = async (o: Record<string, unknown>) => (await fail(G.sora, G.id, 'saveScenario', { name: 'x', ...o })).error;
    expect(await bad({ name: '' })).toBe('シナリオの名前を入れてください。');
    expect(await bad({ name: 'あ'.repeat(101) })).toBe('シナリオの名前は100文字までです。');
    expect(await bad({ system: 'あ'.repeat(51) })).toBe('システムは50文字までです。');
    expect(await bad({ hours: 'あ'.repeat(21) })).toBe('時間の目安は20文字までです。');
    expect(await bad({ memo: 'あ'.repeat(501) })).toBe('メモは500文字までです。');
    expect(await bad({ url: 'https://example.com/' + 'a'.repeat(490) })).toBe('URLは500文字までです。');
    expect(await bad({ url: 'javascript:alert(1)' })).toBe('URLは、http:// か https:// で始まるアドレスを入れてください。');
    expect(await bad({ url: 'example.com' })).toBe('URLは、http:// か https:// で始まるアドレスを入れてください。');
    expect(await bad({ playersMin: '0' })).toBe('PLの人数（下限）は1〜20の数で入れてください。');
    expect(await bad({ playersMax: '2.5' })).toBe('PLの人数（上限）は1〜20の数で入れてください。');
    expect(await bad({ playersMax: '21' })).toBe('PLの人数（上限）は1〜20の数で入れてください。');
    expect(await bad({ playersMin: 4, playersMax: 3 })).toBe('PLの人数は、下限を上限より大きくできません。');
    expect((await fail(G.sora, G.id, 'saveScenario', { id: '999', name: 'x' })).error).toBe('シナリオが見つかりません: 999');
  });

  test('1つのグループに200件まで（変更はできる）', async () => {
    await env.DB.prepare(
      `INSERT INTO scenarios (group_id, name, updated_at) SELECT 'grp', 's' || value, '2026-01-01' FROM json_each(?)`,
    ).bind(JSON.stringify(Array.from({ length: 200 }, (_, i) => i))).run();
    expect((await fail(G.sora, G.id, 'saveScenario', { name: '201件目' })).error).toBe('シナリオは200件までです。使わないシナリオを消してから登録してください。');
    const id = (await env.DB.prepare("SELECT id FROM scenarios WHERE name = 's0'").first<number>('id'))!;
    await ok(G.sora, G.id, 'saveScenario', { id: String(id), name: 's0（改）' });
  });
});

describe('シナリオの削除', () => {
  test('登録した人と管理者だけが消せる。卓からは外れて、卓は残る', async () => {
    const id = await addScenario(G.sora);
    await ok(G.sora, G.id, 'saveSession', { name: '卓', gm: 'ひより', date: T(3), status: '開催', scenarioId: id });
    expect((await fail(G.komachi, G.id, 'deleteScenario', { id })).error).toBe('ADMIN: ほかの人が登録したシナリオの削除ができるのは管理者だけです。');
    const r = await ok(G.sora, G.id, 'deleteScenario', { id });
    expect(r.message).toBe('シナリオを削除しました: 狂気山脈（1件の卓から外しました）');
    expect(sessionOf(r, 'S001').scenarioId).toBe('');
    const other = await addScenario(G.komachi, { name: '別' });
    expect((await ok(G.admin, G.id, 'deleteScenario', { id: other })).message).toBe('シナリオを削除しました: 別');
  });

  test('登録した人がメンバーでなくなったら、管理者だけが消せる（登録した人は空で出る）', async () => {
    const id = await addScenario(G.komachi);
    await ok(G.admin, G.id, 'deleteMember', { name: 'こまち' });
    const d = await ok(G.admin, G.id, 'getConsoleData');
    expect(scenarioOf({ data: d }, '狂気山脈').createdBy).toBe('');
    expect((await fail(G.sora, G.id, 'deleteScenario', { id })).status).toBe(403);
  });
});

describe('通過の印', () => {
  test('本人が通過・GMできるを付け、外せる。印は画面データに名前で出る', async () => {
    const id = await addScenario(G.sora);
    expect((await ok(G.sora, G.id, 'setScenarioMark', { id, name: 'ソラ', kind: 'played' })).message).toBe('狂気山脈 ソラ: 通過にしました');
    const r = await ok(G.komachi, G.id, 'setScenarioMark', { id, name: 'こまち', kind: 'gm' });
    expect(r.message).toBe('狂気山脈 こまち: GMできるにしました');
    expect(scenarioOf(r, '狂気山脈').marks).toEqual({ ソラ: 'played', こまち: 'gm' });
    // 印はシナリオごと
    const other = await addScenario(G.sora, { name: '別' });
    const r2 = await ok(G.sora, G.id, 'setScenarioMark', { id: other, name: 'ソラ', kind: 'gm' });
    expect(scenarioOf(r2, '別').marks).toEqual({ ソラ: 'gm' });
    await ok(G.sora, G.id, 'deleteScenario', { id: other });
    await ok(G.sora, G.id, 'setScenarioMark', { id, name: 'ソラ', kind: 'gm' });
    expect(await marks()).toEqual([{ name: 'こまち', kind: 'gm' }, { name: 'ソラ', kind: 'gm' }]);
    expect((await ok(G.sora, G.id, 'setScenarioMark', { id, name: 'ソラ', kind: '' })).message).toBe('狂気山脈 ソラ: 未通過にしました');
    expect(await marks()).toEqual([{ name: 'こまち', kind: 'gm' }]);
  });

  test('ほかの人の印は、管理者だけが付けられる。知らない人・知らない印・知らないシナリオは断る', async () => {
    const id = await addScenario(G.sora);
    expect((await fail(G.sora, G.id, 'setScenarioMark', { id, name: 'こまち', kind: 'played' })).status).toBe(403);
    await ok(G.admin, G.id, 'setScenarioMark', { id, name: 'こまち', kind: 'played' });
    expect(await marks()).toEqual([{ name: 'こまち', kind: 'played' }]);
    expect((await fail(G.admin, G.id, 'setScenarioMark', { id, name: 'だれか', kind: 'played' })).error).toBe('メンバーが見つかりません: だれか');
    expect((await fail(G.sora, G.id, 'setScenarioMark', { id, name: 'ソラ', kind: 'pl' })).error).toBe('通過の印は「通過」か「GMできる」です。');
    expect((await fail(G.sora, G.id, 'setScenarioMark', { id: '0', name: 'ソラ', kind: 'played' })).status).toBe(404);
  });

  test('「終了」の卓で通過した人は、未通過に戻せない', async () => {
    const id = await addScenario(G.sora);
    await ok(G.sora, G.id, 'saveSession', { name: '終わった卓', gm: 'ひより', members: ['ソラ'], date: T(-3), status: '終了', scenarioId: id });
    // シナリオも開催日も無い卓は、通過の計算に入らない
    await ok(G.sora, G.id, 'saveSession', { name: '募集の卓', members: ['こまち'], status: '募集' });
    expect((await fail(G.sora, G.id, 'setScenarioMark', { id, name: 'ソラ', kind: '' })).error)
      .toBe('ソラは「狂気山脈」の卓（S001）で通過しているので、未通過にはできません。');
    // 通過していない人は外せる（印が無くても）
    await ok(G.komachi, G.id, 'setScenarioMark', { id, name: 'こまち', kind: '' });
  });

  test('メンバーを外すと、その人の印も消える', async () => {
    const id = await addScenario(G.sora);
    await ok(G.komachi, G.id, 'setScenarioMark', { id, name: 'こまち', kind: 'played' });
    await ok(G.admin, G.id, 'deleteMember', { name: 'こまち' });
    expect(await marks()).toEqual([]);
  });
});

describe('卓のシナリオ', () => {
  test('登録・変更でシナリオを付け、外せる。送らなければ今のまま。ほかのグループのシナリオは付けられない', async () => {
    const id = await addScenario(G.sora);
    const r = await ok(G.sora, G.id, 'saveSession', { name: '卓', gm: 'ひより', date: T(3), status: '開催', scenarioId: id });
    expect(sessionOf(r, 'S001').scenarioId).toBe(id);
    const kept = await ok(G.sora, G.id, 'saveSession', { id: 'S001', name: '卓', gm: 'ひより', date: T(3), status: '開催' });
    expect(sessionOf(kept, 'S001').scenarioId).toBe(id);
    const cleared = await ok(G.sora, G.id, 'saveSession', { id: 'S001', name: '卓', gm: 'ひより', date: T(3), status: '開催', scenarioId: '' });
    expect(sessionOf(cleared, 'S001').scenarioId).toBe('');
    // 新しい卓で送らなければ、シナリオは無い
    expect(sessionOf(await ok(G.sora, G.id, 'saveSession', { name: '別', status: '募集' }), 'S002').scenarioId).toBe('');
    await env.DB.prepare("INSERT INTO groups (id, guild_id, guild_name, title, created_by, created_at) VALUES ('other', 'g2', 's', 't', 'x', '2026-01-01')").run();
    const foreign = (await env.DB.prepare("INSERT INTO scenarios (group_id, name, updated_at) VALUES ('other', 'よそ', '2026-01-01') RETURNING id").first<number>('id'))!;
    expect((await fail(G.sora, G.id, 'saveSession', { name: 'x', status: '募集', scenarioId: String(foreign) })).error).toBe('シナリオが見つかりません: ' + foreign);
  });

  test('何日かまとめて登録しても、どの回にもシナリオが付く', async () => {
    const id = await addScenario(G.sora);
    const r = await ok(G.sora, G.id, 'saveSession', { name: '長編 1', gm: 'ひより', status: '開催', dates: [T(3), T(10)], scenarioId: id });
    expect(r.ids.map((x: string) => sessionOf(r, x).scenarioId)).toEqual([id, id]);
  });

  test('まとめての変更で、シナリオを付け・外す。知らないシナリオは断る', async () => {
    const id = await addScenario(G.sora);
    await ok(G.sora, G.id, 'saveSession', { name: 'A', status: '募集' });
    await ok(G.sora, G.id, 'saveSession', { name: 'B', status: '募集' });
    const r = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001', 'S002'], action: 'setScenario', value: id });
    expect(r.label).toBe('シナリオを「狂気山脈」に');
    expect(r.message).toBe('2件の卓のシナリオを「狂気山脈」にしました: A、B');
    expect(r.data.sessions.map((s: any) => s.scenarioId)).toEqual([id, id]);
    const off = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'setScenario', value: '' });
    expect(off.label).toBe('シナリオを外す');
    expect(off.message).toBe('1件の卓のシナリオを外しました: A');
    expect(sessionOf(off, 'S001').scenarioId).toBe('');
    expect((await fail(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'setScenario', value: '0' })).status).toBe(404);
  });
});

describe('「終了」の卓を消しても、通過は残る', () => {
  test('1つ消す: GMはgm、参加者（メンバー）はplayed。ゲストは残らない。終了でない卓では残さない', async () => {
    const id = await addScenario(G.sora);
    await ok(G.sora, G.id, 'saveSession', { name: '予定の卓', gm: 'ソラ', members: ['こまち'], date: T(3), status: '開催', scenarioId: id });
    await ok(G.admin, G.id, 'deleteSession', { id: 'S001' });
    expect(await marks()).toEqual([]);
    await ok(G.sora, G.id, 'saveSession', { name: '終わった卓', gm: 'ひより', members: ['ソラ'], extra: 'ゲスト', date: T(-3), status: '終了', scenarioId: id });
    await ok(G.admin, G.id, 'deleteSession', { id: 'S002' });
    expect(await marks()).toEqual([{ name: 'ひより', kind: 'gm' }, { name: 'ソラ', kind: 'played' }]);
    // シナリオの無い「終了」の卓は、そのまま消す
    await ok(G.sora, G.id, 'saveSession', { name: 'ただの卓', gm: 'こまち', date: T(-3), status: '終了' });
    await ok(G.admin, G.id, 'deleteSession', { id: 'S003' });
    expect(await marks()).toHaveLength(2);
  });

  test('まとめて消す: 終了の卓だけから残す。もう印があれば、gmのほうを残す', async () => {
    const id = await addScenario(G.sora);
    await ok(G.sora, G.id, 'setScenarioMark', { id, name: 'ソラ', kind: 'gm' });
    await ok(G.komachi, G.id, 'setScenarioMark', { id, name: 'こまち', kind: 'played' });
    await ok(G.sora, G.id, 'saveSession', { name: '1', gm: 'こまち', members: ['ソラ'], date: T(-5), status: '終了', scenarioId: id });
    await ok(G.sora, G.id, 'saveSession', { name: '2', gm: 'ひより', members: [], date: T(4), status: '開催', scenarioId: id });
    await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001', 'S002'], action: 'delete' });
    expect(await marks()).toEqual([{ name: 'こまち', kind: 'gm' }, { name: 'ソラ', kind: 'gm' }]);
    // 終了の卓が無ければ、書き写さない
    await ok(G.sora, G.id, 'saveSession', { name: '3', gm: 'ひより', date: T(4), status: '開催', scenarioId: id });
    await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S003'], action: 'delete' });
    expect(await marks()).toHaveLength(2);
  });
});
