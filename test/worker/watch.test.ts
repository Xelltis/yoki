// 見学の枠: 参加はしないが見る人。定員にも参加者にも数えない。募集・調整中・これからの開催の卓で、本人が付け外しする。
// 開催前の知らせ・日程が決まった知らせではメンションし、購読URL・あなたの予定にも出す。日程調整には答えない
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SYSTEM_ACTOR } from '../../src/worker/auth/guard';
import { decidedPayload, mentionsOf, sessionEmbed } from '../../src/worker/discord/payloads';
import { agendaOf } from '../../src/worker/domain/agenda';
import { calendarSessions } from '../../src/worker/domain/calendar';
import { loadGroup } from '../../src/worker/domain/load';
import { pollVoters } from '../../src/worker/domain/model';
import { addDays } from '../../src/worker/lib/jst';
import { fail, ok, setupGroup, today } from './helpers';

let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
});
afterEach(() => vi.restoreAllMocks());

const sessionOf = (r: Record<string, any>, id = 'S001') => r.data.sessions.find((s: any) => s.id === id);
const watch = (sid: string, name: string, id = 'S001', level = 'watch') => ok(sid, G.id, 'setInterest', { id, name, level });
const ctxNow = () => loadGroup(env.DB, G.id, SYSTEM_ACTOR, '', new Date());

describe('付け外し', () => {
  test('募集の卓: 見学を付けると参加希望・興味ありから外れる（どれか1つ）。定員に数えない', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'ひより', status: '募集', capacity: 1 });
    await ok(G.sora, G.id, 'setInterest', { id: 'S001', name: 'ソラ', level: 'want' });
    let r = await watch(G.komachi, 'こまち');
    expect(r.message).toBe('「古城」に見学を付けました: こまち');
    expect(sessionOf(r)).toMatchObject({ want: ['ソラ'], watch: ['こまち'] });
    r = await watch(G.sora, 'ソラ');
    expect(sessionOf(r)).toMatchObject({ want: [], watch: ['こまち', 'ソラ'] });
    r = await ok(G.sora, G.id, 'setInterest', { id: 'S001', name: 'ソラ', level: 'interest' });
    expect(sessionOf(r)).toMatchObject({ interest: ['ソラ'], watch: ['こまち'] });
    expect((await fail(G.admin, G.id, 'setInterest', { id: 'S001', name: 'ひより', level: 'watch' })).error).toBe('ひよりはすでにこの卓のGMです。');
  });

  test('開催にしても残る。参加者に入れたら外れる', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'ひより', status: '募集' });
    await watch(G.sora, 'ソラ');
    await watch(G.komachi, 'こまち');
    let r = await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '古城', gm: 'ひより', status: '開催', date: T(5) });
    expect(sessionOf(r)).toMatchObject({ members: [], watch: ['ソラ', 'こまち'] });
    r = await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '古城', gm: 'ひより', status: '開催', date: T(5), members: ['ソラ'] });
    expect(sessionOf(r)).toMatchObject({ members: ['ソラ'], watch: ['こまち'] });
  });

  test('調整中とこれからの開催の卓でも付け外しできる。過ぎた卓・終わった卓・見学していない人の取り消しは断る', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', status: '開催', date: T(5) });
    await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', status: '調整中' });
    await ok(G.admin, G.id, 'saveSession', { name: '昨日', gm: 'ひより', status: '開催', date: T(-1) });
    await ok(G.admin, G.id, 'saveSession', { name: '終わり', gm: 'ひより', status: '終了', date: T(-3) });
    expect(sessionOf(await watch(G.sora, 'ソラ', 'S001'), 'S001').watch).toEqual(['ソラ']);
    expect(sessionOf(await watch(G.sora, 'ソラ', 'S002'), 'S002').watch).toEqual(['ソラ']);
    let r = await watch(G.sora, 'ソラ', 'S001', 'none');
    expect(r.message).toBe('「港」の見学を取り消しました: ソラ');
    expect(sessionOf(r, 'S001').watch).toEqual([]);
    expect((await fail(G.sora, G.id, 'setInterest', { id: 'S001', name: 'ソラ', level: 'none' })).error).toBe('「港」は募集中ではありません（開催）。');
    expect((await fail(G.sora, G.id, 'setInterest', { id: 'S001', name: 'ソラ', level: 'want' })).error).toBe('「港」は募集中ではありません（開催）。');
    expect((await fail(G.sora, G.id, 'setInterest', { id: 'S003', name: 'ソラ', level: 'watch' })).error).toContain('募集中ではありません');
    expect((await fail(G.sora, G.id, 'setInterest', { id: 'S004', name: 'ソラ', level: 'watch' })).error).toContain('募集中ではありません');
    r = await ok(G.admin, G.id, 'getConsoleData');
    expect(r.sessions.find((s: any) => s.id === 'S002').watch).toEqual(['ソラ']);
  });
});

describe('知らせ・購読URL・あなたの予定', () => {
  beforeEach(async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', members: ['こまち'], status: '開催', date: T(5) });
    await watch(G.sora, 'ソラ');
  });

  test('内訳に見学を書く。開催前の知らせ・日程が決まった知らせではメンションする（ほかの知らせではしない）', async () => {
    const ctx = await ctxNow(), s = ctx.sessions[0]!;
    expect(sessionEmbed(ctx, s).description).toContain('参加者: こまち\n見学: ソラ');
    expect(mentionsOf(ctx, [s])).toBe('<@400000000000000010> <@400000000000000012>');
    expect(mentionsOf(ctx, [s], true)).toBe('<@400000000000000010> <@400000000000000012> <@400000000000000011>');
    expect(decidedPayload(ctx, s).content).toContain('<@400000000000000011>');
  });

  test('本人の購読URL・あなたの予定に出る。日程調整には答えない（答える番にも出ない）', async () => {
    const ctx = await ctxNow();
    expect(calendarSessions(ctx, 'ソラ').map((x) => x.id)).toEqual(['S001']);
    await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', members: ['こまち'], status: '調整中' });
    await watch(G.sora, 'ソラ', 'S002');
    await ok(G.admin, G.id, 'startPoll', { id: 'S002', dates: [T(7)] });
    const c2 = await ctxNow();
    expect(pollVoters(c2, c2.sessions[1]!)).toEqual(['ひより', 'こまち']);
    const user = (await env.DB.prepare("SELECT user_id FROM members WHERE name = 'ソラ'").first<string>('user_id'))!;
    expect((await agendaOf(env.DB, user, [G.id], new Date())).items.map((x) => x.kind + ':' + x.id)).toEqual(['session:S001']);
  });

  test('書き出しに入る', async () => {
    expect((await ok(G.admin, G.id, 'exportGroup')).export.sessions[0].watch).toEqual(['ソラ']);
  });
});
