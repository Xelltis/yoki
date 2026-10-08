// 行けなくなった（開催の卓の参加者が、GMに伝える）と、その印の片付け・通過とカレンダーへの効き目
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { calendarSessions } from '../../src/worker/domain/calendar';
import { loadGroup } from '../../src/worker/domain/load';
import { SYSTEM_ACTOR } from '../../src/worker/auth/guard';
import { addDays, fmtDateJa } from '../../src/worker/lib/jst';
import { fail, ok, setupGroup, today } from './helpers';

const CH = '123456789012345678';
let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
let posts: string[] = [];
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
  await env.DB.prepare('UPDATE groups SET channel_id = ?').bind(CH).run();
  await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', members: ['ソラ', 'こまち'], date: T(3), start: '20:00', end: '23:00', status: '開催' });
  posts = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
    posts.push(JSON.parse(String(init?.body)).content);
    return new Response('{}', { status: 200 });
  });
});
afterEach(() => vi.restoreAllMocks());
const absentOf = (r: Record<string, any>, id = 'S001') => r.data.sessions.find((s: any) => s.id === id).absent.map((a: any) => [a.name, a.note]);

describe('行けなくなった', () => {
  test('参加者が付けると、GMに一言を添えて知らせる。一言を直しても、もう一度は知らせない。取り消せる', async () => {
    let r = await ok(G.sora, G.id, 'setAbsence', { id: 'S001', name: 'ソラ', note: '急な出張が入りました @everyone' });
    expect(r).toMatchObject({ notified: true, message: '「港」に行けなくなったことを、GMに伝えました。　GMへの知らせをDiscordに送りました。' });
    expect(absentOf(r)).toEqual([['ソラ', '急な出張が入りました @everyone']]);
    expect(posts).toEqual(['🙇 「港」（' + fmtDateJa(T(3)) + ' 20:00〜23:00）に、ソラが行けなくなりました。 <@400000000000000010>\n💬 急な出張が入りました @​everyone\n'
      + 'Yokiで「日を組み直す」か、参加者を見直してください。\n🔗 https://yoki.test/g/grp/']);
    expect(r.data.log[0]).toMatchObject({ kind: '行けなくなった', target: '港' });
    r = await ok(G.sora, G.id, 'setAbsence', { id: 'S001', name: 'ソラ', note: '出張です' });
    expect(r.message).toBe('「港」への一言を直しました。');
    expect(absentOf(r)).toEqual([['ソラ', '出張です']]);
    expect(posts).toHaveLength(1);
    r = await ok(G.sora, G.id, 'setAbsence', { id: 'S001', name: 'ソラ', absent: false });
    expect(r.message).toBe('「港」の「行けなくなった」を取り消しました。');
    expect(absentOf(r)).toEqual([]);
  });

  test('知らせのチャンネルが無ければ、印だけ付ける。埋め込みにも行けなくなった人が出る', async () => {
    await env.DB.prepare("UPDATE groups SET channel_id = ''").run();
    const r = await ok(G.komachi, G.id, 'setAbsence', { id: 'S001', name: 'こまち' });
    expect(r).toMatchObject({ notified: null, message: '「港」に行けなくなったことを、GMに伝えました。' });
    expect(posts).toHaveLength(0);
    await env.DB.prepare('UPDATE groups SET channel_id = ?').bind(CH).run();
    await ok(G.sora, G.id, 'setAbsence', { id: 'S001', name: 'ソラ' });
    expect(posts[0]).not.toContain('💬');
  });

  test('付けられるのは本人で、これから開く卓の参加者だけ。GMは付けられない。一言は200文字まで', async () => {
    expect((await fail(G.admin, G.id, 'setAbsence', { id: 'S001', name: 'ソラ' })).error).toBe('入れられるのは自分のぶんだけです。');
    expect((await fail(G.admin, G.id, 'setAbsence', { id: 'S001', name: 'ひより' })).error).toContain('GMは、卓の「日を組み直す」');
    await ok(G.admin, G.id, 'saveSession', { name: '別', gm: 'ひより', members: ['ソラ'], date: T(4), status: '開催' });
    expect((await fail(G.komachi, G.id, 'setAbsence', { id: 'S002', name: 'こまち' })).error).toBe('こまちは「別」の参加者ではありません。');
    expect((await fail(G.sora, G.id, 'setAbsence', { id: 'S001', name: 'ソラ', note: 'あ'.repeat(201) })).error).toBe('一言は200文字までです。');
    await ok(G.admin, G.id, 'saveSession', { name: '募集', gm: 'ひより', status: '募集' });
    expect((await fail(G.sora, G.id, 'setAbsence', { id: 'S003', name: 'ソラ' })).error).toBe('「募集」は、これから開く卓ではありません。');
    await env.DB.prepare("UPDATE sessions SET date = ? WHERE name = '別'").bind(T(-1)).run();
    expect((await fail(G.sora, G.id, 'setAbsence', { id: 'S002', name: 'ソラ' })).error).toBe('「別」は、これから開く卓ではありません。');
    await env.DB.prepare("UPDATE sessions SET date = NULL WHERE name = '別'").run();
    expect((await fail(G.sora, G.id, 'setAbsence', { id: 'S002', name: 'ソラ' })).error).toContain('これから開く卓ではありません');
  });
});

describe('行けなくなった印の片付け', () => {
  const form = { id: 'S001', name: '港', gm: 'ひより', members: ['ソラ', 'こまち'], date: '', start: '20:00', end: '23:00', status: '開催' };
  beforeEach(async () => {
    await ok(G.sora, G.id, 'setAbsence', { id: 'S001', name: 'ソラ' });
    await ok(G.komachi, G.id, 'setAbsence', { id: 'S001', name: 'こまち' });
  });

  test('卓の保存: 開催日がそのままなら残し、外した参加者の分は消す。開催日を変えるか、開催でなくすと全部消す', async () => {
    let r = await ok(G.admin, G.id, 'saveSession', { ...form, date: T(3), memo: 'メモ' });
    expect(absentOf(r)).toEqual([['ソラ', ''], ['こまち', '']]);
    r = await ok(G.admin, G.id, 'saveSession', { ...form, date: T(3), members: ['ソラ'] });
    expect(absentOf(r)).toEqual([['ソラ', '']]);
    r = await ok(G.admin, G.id, 'saveSession', { ...form, date: T(5), members: ['ソラ'] });
    expect(absentOf(r)).toEqual([]);
    await ok(G.sora, G.id, 'setAbsence', { id: 'S001', name: 'ソラ' });
    r = await ok(G.admin, G.id, 'saveSession', { ...form, date: '', status: '調整中', members: ['ソラ'] });
    expect(absentOf(r)).toEqual([]);
  });

  test('まとめての変更: 参加者から外すとその人の分、開催日をずらすか状態を変えると全部消す', async () => {
    let r = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'removeMember', value: 'こまち' });
    expect(absentOf(r)).toEqual([['ソラ', '']]);
    r = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'shiftDays', value: '1' });
    expect(absentOf(r)).toEqual([]);
    await ok(G.sora, G.id, 'setAbsence', { id: 'S001', name: 'ソラ' });
    r = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'status', value: '中止' });
    expect(absentOf(r)).toEqual([]);
  });

  test('まとめて消すときは、片付けずに卓ごと消える', async () => {
    await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'delete' });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM session_absences').first('n')).toBe(0);
  });
});

describe('行けなくなった人は、遊んだことにしない', () => {
  test('自分のカレンダー（購読URL・Google）から外れる', async () => {
    await ok(G.sora, G.id, 'setAbsence', { id: 'S001', name: 'ソラ' });
    const ctx = await loadGroup(env.DB, G.id, SYSTEM_ACTOR, '');
    expect(calendarSessions(ctx, 'ソラ').map((s) => s.name)).toEqual([]);
    expect(calendarSessions(ctx, 'こまち').map((s) => s.name)).toEqual(['港']);
    expect(calendarSessions(ctx, '').map((s) => s.name)).toEqual(['港']);
  });

  test('「終了」の卓のシナリオの通過にならない（卓を消して印に写すときも）', async () => {
    const sc = (await ok(G.sora, G.id, 'saveScenario', { name: '狂気山脈' })).id;
    await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '港', gm: 'ひより', members: ['ソラ', 'こまち'], date: T(3), status: '開催', scenarioId: sc });
    await ok(G.sora, G.id, 'setAbsence', { id: 'S001', name: 'ソラ' });
    // 見回りの自動終了と同じく、印を残したまま「終了」にする
    await env.DB.prepare("UPDATE sessions SET status = '終了'").run();
    // ソラは通過していないので、未通過のまま印を外せる。こまちは卓から通過している
    await ok(G.sora, G.id, 'setScenarioMark', { id: sc, name: 'ソラ', kind: '' });
    expect((await fail(G.komachi, G.id, 'setScenarioMark', { id: sc, name: 'こまち', kind: '' })).error).toContain('通過しているので');
    await ok(G.admin, G.id, 'deleteSession', { id: 'S001' });
    const rows = (await env.DB.prepare('SELECT m.name, ms.kind FROM member_scenarios ms JOIN members m ON m.id = ms.member_id ORDER BY m.name').all()).results;
    expect(rows).toEqual([{ name: 'こまち', kind: 'played' }, { name: 'ひより', kind: 'gm' }]);
  });
});
