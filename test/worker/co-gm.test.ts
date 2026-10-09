// 共同GM（サブGM・KP補佐）: 決める・外す、GMと同じことができる（秘匿HO・開催日・記録・繰り上げ）、
// 秘匿HOのある卓では顔ぶれを変えられる人を絞る、知らせ・通過・購読URL・予定表・あなたの予定にもGMとして出る
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SYSTEM_ACTOR } from '../../src/worker/auth/guard';
import { pollReadyPayload, sessionEmbed } from '../../src/worker/discord/payloads';
import { agendaOf } from '../../src/worker/domain/agenda';
import { calendarItem, calendarSessions } from '../../src/worker/domain/calendar';
import { loadGroup } from '../../src/worker/domain/load';
import { bookedMap, pollVoters } from '../../src/worker/domain/model';
import { sendUrges } from '../../src/worker/domain/patrol';
import { addDays } from '../../src/worker/lib/jst';
import { fail, ok, setupGroup, today } from './helpers';

const CH = '123456789012345678';
let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
});
afterEach(() => vi.restoreAllMocks());

const sessionOf = (r: Record<string, any>, id = 'S001') => r.data.sessions.find((s: any) => s.id === id);
const save = (sid: string, o: Record<string, unknown>) => ok(sid, G.id, 'saveSession', { name: '港', gm: 'ひより', date: T(5), status: '開催', ...o });
const ctxNow = (day = T(0)) => loadGroup(env.DB, G.id, SYSTEM_ACTOR, 'https://yoki.test/g/' + G.id + '/', new Date(day + 'T20:00:00+09:00'), { token: 'test-bot-token', clientId: 'c' });

describe('決める・外す', () => {
  test('GMと別に、名前の一覧か「、」区切りで入れる。参加者からは外す。GMと同じ人は外す。送らなければそのまま、空なら外す。履歴に残る', async () => {
    let r = await save(G.admin, { coGms: ['こまち', 'ひより'], members: ['ソラ', 'こまち'] });
    expect(sessionOf(r)).toMatchObject({ gm: 'ひより', coGms: ['こまち'], members: ['ソラ'] });
    r = await save(G.admin, { id: 'S001', members: ['ソラ'] });
    expect(sessionOf(r).coGms).toEqual(['こまち']);
    r = await save(G.admin, { id: 'S001', coGms: 'こまち、ソラ', members: ['ソラ'] });
    expect(sessionOf(r)).toMatchObject({ coGms: ['こまち', 'ソラ'], members: [] });
    r = await save(G.admin, { id: 'S001', coGms: [] });
    expect(sessionOf(r).coGms).toEqual([]);
    const h = (await ok(G.admin, G.id, 'getSessionHistory', { id: 'S001' })).items.map((x: any) => x.detail);
    expect(h[0]).toBe('共同GM こまち、ソラ→なし');
    expect(h[1]).toBe('共同GM こまち→こまち、ソラ、参加者 −ソラ');
  });

  test('GMがいなければ置けない。3人まで。まとめて登録した卓にも入る', async () => {
    expect((await fail(G.admin, G.id, 'saveSession', { name: '港', gm: '', coGms: ['こまち'], status: '募集' })).error).toBe('共同GMを入れるときは、GMも入れてください。');
    expect((await fail(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', coGms: ['a', 'b', 'c', 'd'], status: '募集' })).error).toBe('共同GMは3人までです。');
    const r = await ok(G.admin, G.id, 'saveSession', { name: '港 #1', gm: 'ひより', coGms: ['こまち'], members: ['ソラ'], dates: [T(5), T(12)], status: '開催' });
    expect(r.data.sessions.map((s: any) => s.coGms)).toEqual([['こまち'], ['こまち']]);
  });

  test('まとめてGMを替えても、共同GMはそのまま。新しいGMが共同GMにいれば、そこから外す', async () => {
    await save(G.admin, { coGms: ['こまち', 'ソラ'] });
    const r = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'setGm', value: 'こまち' });
    expect(sessionOf(r)).toMatchObject({ gm: 'こまち', coGms: ['ソラ'] });
  });

  test('共同GMは、参加希望・興味あり・行けなくなったを付けられない（GMと同じ）', async () => {
    await save(G.admin, { coGms: ['ソラ'], members: ['こまち'] });
    expect((await fail(G.sora, G.id, 'setAbsence', { id: 'S001', name: 'ソラ', note: '' })).error).toBe('GMと共同GMは、卓の「日を組み直す」か「編集」で、開催日を変えるか中止にしてください。');
    await ok(G.admin, G.id, 'saveSession', { name: '募集', gm: 'ひより', coGms: ['ソラ'], status: '募集' });
    expect((await fail(G.sora, G.id, 'setInterest', { id: 'S002', name: 'ソラ', level: 'want' })).error).toBe('ソラはすでにこの卓の共同GMです。');
  });
});

describe('GMと同じことができる', () => {
  test('開催日を決める・キャンセル待ちを繰り上げる・記録を書く', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', coGms: ['ソラ'], members: ['こまち'], status: '調整中' });
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5)] });
    await ok(G.sora, G.id, 'decidePoll', { id: 'S001', ymd: T(5) });
    await env.DB.prepare(
      "INSERT INTO session_people (session_id, role, pos, guest_name) SELECT id, 'want', 0, 'ゲスト' FROM sessions WHERE seq = 1",
    ).run();
    const r = await ok(G.sora, G.id, 'promoteWaiter', { id: 'S001', name: 'ゲスト' });
    expect(sessionOf(r).members).toEqual(['こまち', 'ゲスト']);
    await env.DB.prepare("UPDATE sessions SET status = '終了'").run();
    await ok(G.sora, G.id, 'saveRecord', { id: 'S001', recap: '共同GMが書いた' });
    expect((await fail(G.komachi, G.id, 'saveRecord', { id: 'S001', recap: 'x' })).error).toContain('ADMIN:');
  });

  test('秘匿HOを読み書きできる（GMと同じ）。参加者のほかの人には見えない', async () => {
    await save(G.admin, { coGms: ['ソラ'], members: ['こまち'] });
    await ok(G.admin, G.id, 'savePrep', { id: 'S001', slots: [{ pos: 1, label: 'HO1', summary: '' }] });
    await ok(G.sora, G.id, 'saveSlotSecret', { id: 'S001', pos: 1, secret: '共同GMが書いた秘匿HO' });
    const prepOf = async (sid: string) => sessionOf({ data: await ok(sid, G.id, 'getConsoleData') }).prep.slots[0];
    expect((await prepOf(G.sora)).secret).toBe('共同GMが書いた秘匿HO');
    expect((await prepOf(G.admin)).secret).toBe('共同GMが書いた秘匿HO');
    expect((await prepOf(G.komachi)).secret).toBeNull();
  });

  test('秘匿HOのある卓では、GMと共同GMの顔ぶれを変えられるのは、今のGMか共同GMだけ（並べ替えだけならよい）', async () => {
    // ソラがGM、こまちが共同GM。ひより（管理者）はどちらでもない
    await save(G.admin, { gm: 'ソラ', coGms: ['こまち'] });
    await ok(G.admin, G.id, 'savePrep', { id: 'S001', slots: [{ pos: 1, label: 'HO1', summary: '' }] });
    await ok(G.sora, G.id, 'saveSlotSecret', { id: 'S001', pos: 1, secret: 'ないしょ' });
    const msg = '「港」には秘匿HOがあるので、GMと共同GMを替えられるのは今のGMか共同GM（ソラ、こまち）だけです。';
    expect((await fail(G.admin, G.id, 'saveSession', { id: 'S001', name: '港', gm: 'ソラ', coGms: ['こまち', 'ひより'], date: T(5), status: '開催' })).error).toBe(msg);
    expect((await fail(G.admin, G.id, 'saveSession', { id: 'S001', name: '港', gm: 'ソラ', coGms: [], date: T(5), status: '開催' })).error).toBe(msg);
    expect((await fail(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'setGm', value: 'ひより' })).error).toBe(msg);
    // 並べ替えだけなら、管理者でもよい
    await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '港', gm: 'こまち', coGms: ['ソラ'], date: T(5), status: '開催' });
    // 共同GMは、顔ぶれを変えられる
    await ok(G.sora, G.id, 'saveSession', { id: 'S001', name: '港', gm: 'こまち', coGms: ['ソラ', 'ひより'], date: T(5), status: '開催' });
  });
});

describe('GMとして出る', () => {
  test('知らせ（内訳・回答そろい・期間前の催促）では、GMと共同GMを呼ぶ', async () => {
    await env.DB.prepare('UPDATE groups SET channel_id = ?1, urge = 1, notify_hour = 20 WHERE id = ?2').bind(CH, G.id).run();
    await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', coGms: ['ソラ'], members: ['こまち'], status: '調整中', windowFrom: T(1), windowTo: T(9) });
    const ctx = await ctxNow(), s = ctx.sessions[0]!;
    expect(sessionEmbed(ctx, s).description).toContain('GM: ひより、ソラ');
    expect(pollReadyPayload(ctx, s).content.split('\n')[0]).toBe('📝 「迷宮」の日程調整の回答がそろいました。<@400000000000000010> <@400000000000000011>');
    const posts: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_i, init) => { posts.push(JSON.parse(String(init?.body)).content); return Response.json({ id: 'm' }); });
    await sendUrges(ctx, 20, { sleep: async () => {} });
    expect(posts[0]).toContain('まだ開催日が決まっていません。 <@400000000000000010> <@400000000000000011>');
  });

  test('日程調整に答える人・予定表の「GM」・購読URL・あなたの予定・通過にも、GMとして入る', async () => {
    const sc = (await ok(G.admin, G.id, 'saveScenario', { name: '狂気山脈' })).id;
    await save(G.admin, { coGms: ['ソラ'], members: ['こまち'], scenarioId: sc });
    const ctx = await ctxNow(), s = ctx.sessions[0]!;
    expect(pollVoters(ctx, s)).toEqual(['ひより', 'ソラ', 'こまち']);
    expect(bookedMap(ctx.sessions)[T(5)]).toEqual({ ひより: 'GM', ソラ: 'GM', こまち: '参' });
    expect(calendarSessions(ctx, 'ソラ').map((x) => x.id)).toEqual(['S001']);
    expect(calendarItem(ctx, calendarSessions(ctx, '')[0]!).description.split('\n')[0]).toBe('GM: ひより、ソラ');
    const user = (await env.DB.prepare("SELECT user_id FROM members WHERE name = 'ソラ'").first<string>('user_id'))!;
    expect((await agendaOf(env.DB, user, [G.id], new Date())).items.map((x) => x.id)).toEqual(['S001']);
    // 終わったら、共同GMも卓から通過が付く（未通過には戻せない）。卓を消すときは「GMできる」の印として残る
    await env.DB.prepare("UPDATE sessions SET status = '終了'").run();
    expect((await fail(G.sora, G.id, 'setScenarioMark', { id: sc, name: 'ソラ', kind: '' })).error).toBe('ソラは「狂気山脈」の卓（S001）で通過しているので、未通過にはできません。');
    const r = await ok(G.admin, G.id, 'deleteSession', { id: 'S001' });
    expect(r.data.scenarios[0].marks).toEqual({ ひより: 'gm', ソラ: 'gm', こまち: 'played' });
  });

  test('書き出しに入る', async () => {
    await save(G.admin, { coGms: ['ソラ'] });
    expect((await ok(G.admin, G.id, 'exportGroup')).export.sessions[0].coGms).toEqual(['ソラ']);
  });
});
