// グループの書き出し（管理者だけ）: 中身をJSONにする。秘匿HOは入れない
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import { addDays } from '../../src/worker/lib/jst';
import { APP_VERSION } from '../../src/worker/version';
import { fail, ok, setupGroup, today } from './helpers';

let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
});

describe('グループの書き出し', () => {
  test('管理者だけ', async () => {
    expect((await fail(G.sora, G.id, 'exportGroup')).error).toBe('ADMIN: グループを書き出すことができるのは管理者だけです。');
  });

  test('卓・メンバー・予定（過ぎた日も）・メモ・シナリオ・記録・履歴を入れる。秘匿HOは入れない', async () => {
    const sc = (await ok(G.sora, G.id, 'saveScenario', { name: '狂気山脈' })).id;
    await ok(G.sora, G.id, 'setScenarioMark', { id: sc, name: 'ソラ', kind: 'played' });
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', members: ['ソラ'], date: T(3), start: '20:00', status: '開催', scenarioId: sc });
    await ok(G.admin, G.id, 'savePrep', { id: 'S001', sheetDue: T(2), slots: [{ pos: 1, label: 'HO1', summary: '公開' }] });
    await ok(G.admin, G.id, 'saveSlotSecret', { id: 'S001', pos: 1, secret: 'ないしょの秘匿HO' });
    await ok(G.admin, G.id, 'assignSlots', { id: 'S001', assign: { 1: 'ソラ' } });
    await ok(G.sora, G.id, 'submitSheet', { id: 'S001', name: 'ソラ', url: 'https://example.com/s', pc: 'A' });
    await ok(G.sora, G.id, 'setAbsence', { id: 'S001', name: 'ソラ', note: '急用' });
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(1), mark: '×' });
    await ok(G.sora, G.id, 'setAvailNote', { name: 'ソラ', ymd: T(1), text: '旅行' });
    await ok(G.komachi, G.id, 'setDayNote', { ymd: T(5), to: T(6), text: '合宿' });
    await env.DB.prepare("INSERT INTO availability (member_id, date, part, mark) SELECT id, ?, '', '△' FROM members WHERE name = 'こまち'").bind(T(-5)).run();
    const r = await ok(G.admin, G.id, 'exportGroup');
    const x = r.export;
    expect(r.message).toBe('グループを書き出しました（卓1件・メンバー3人）。');
    expect(r.data).toBeUndefined();
    expect(x).toMatchObject({ format: 'yoki-group-export', version: APP_VERSION, group: { id: G.id, title: 'テストの卓', guildName: 'サーバー' } });
    expect(x.members.map((m: any) => m.name)).toEqual(['ひより', 'ソラ', 'こまち']);
    expect(x.sessions[0]).toMatchObject({
      id: 'S001', name: '港', gm: 'ひより', members: ['ソラ'], date: T(3), start: '20:00', scenario: '狂気山脈',
      prep: { sheetDue: T(2), slots: [{ label: 'HO1', summary: '公開', assigned: 'ソラ' }], sheets: { ソラ: { url: 'https://example.com/s', pc: 'A', outcome: '' } } },
      record: { logUrl: '', recap: '' }, absent: [{ name: 'ソラ', note: '急用' }],
    });
    expect(x.sessions[0].history[0]).toMatchObject({ by: 'ひより', action: '登録' });
    expect(x.availability).toEqual([{ date: T(-5), name: 'こまち', part: '', mark: '△' }, { date: T(1), name: 'ソラ', part: '', mark: '×' }]);
    expect(x.availNotes).toEqual([{ date: T(1), name: 'ソラ', text: '旅行' }]);
    expect(x.dayNotes).toEqual([{ date: T(5), to: T(6), text: '合宿', by: 'こまち' }]);
    expect(x.scenarios).toEqual([{ name: '狂気山脈', system: '', playersMin: null, playersMax: null, hours: '', url: '', memo: '', marks: { ソラ: 'played' } }]);
    expect(JSON.stringify(x)).not.toContain('ないしょの秘匿HO');
  });

  test('シナリオを付けていない卓・割り当てていないHO・履歴の無い卓（履歴を残す前に作った卓）', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', status: '募集' });
    await ok(G.admin, G.id, 'savePrep', { id: 'S001', slots: [{ pos: 1, label: 'HO1', summary: '' }] });
    await env.DB.prepare('DELETE FROM session_history').run();
    const x = (await ok(G.admin, G.id, 'exportGroup')).export;
    expect(x.sessions[0]).toMatchObject({ scenario: '', date: '', prep: { slots: [{ assigned: '' }] }, history: [] });
  });
});
