// キャンセル待ちと繰り上げ: 定員に達した募集に並ぶ、空きが出たら前の人から繰り上がる（Discordで呼ぶ）、
// 開催・調整中にしても並んだまま残る、GMか管理者が「繰り上げる」で参加者にする、本人がやめる
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SYSTEM_ACTOR } from '../../src/worker/auth/guard';
import { absencePayload, recruitDuePayload, sessionEmbed, waitPromotedPayload } from '../../src/worker/discord/payloads';
import { loadGroup } from '../../src/worker/domain/load';
import { addDays } from '../../src/worker/lib/jst';
import { fail, ok, setupGroup, today } from './helpers';

const CH = '123456789012345678';
let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
let posts: { url: string; content: string }[];
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
  // ひより（管理者）がGMの、定員2人の募集。もう1人のメンバー（ユズ。DiscordのIDだけ）を足す
  await env.DB.prepare("INSERT INTO members (group_id, name, discord_id, created_at) VALUES (?1, 'ユズ', '400000000000000013', 'x')").bind(G.id).run();
  await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'ひより', status: '募集', capacity: 2 });
  posts = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    posts.push({ url, content: JSON.parse(String(init?.body)).content });
    return Response.json({ id: 'm1' });
  });
});
afterEach(() => vi.restoreAllMocks());

const sessionOf = (r: Record<string, any>) => r.data.sessions[0];
const want = (sid: string, name: string) => ok(sid, G.id, 'setInterest', { id: 'S001', name, level: 'want' });
/** ユズはログインしないので、管理者が代わりに入れる道が無い。DBに直に並べる */
async function yuzuWants() {
  await env.DB.prepare(
    "INSERT INTO session_people (session_id, role, pos, member_id) SELECT s.id, 'want', 99, m.id FROM sessions s, members m WHERE s.seq = 1 AND m.name = 'ユズ'",
  ).run();
}
const history = async () => (await ok(G.admin, G.id, 'getSessionHistory', { id: 'S001' })).items.map((x: any) => x.action + ' ' + x.detail);
const useChannel = () => env.DB.prepare('UPDATE groups SET channel_id = ?1 WHERE id = ?2').bind(CH, G.id).run();

describe('募集のキャンセル待ち', () => {
  test('定員に達したら、参加希望はキャンセル待ちに並ぶ（番号を返す）。出し直しても順は変わらない', async () => {
    await want(G.sora, 'ソラ');
    await want(G.komachi, 'こまち');
    await yuzuWants();
    const r = await want(G.sora, 'ソラ');
    expect(r.message).toBe('「古城」に参加希望を出しました: ソラ');
    expect(sessionOf(r).want).toEqual(['ソラ', 'こまち', 'ユズ']);
    expect(r.waiting).toBe(0);
    // ひよりはGMなので、別の募集で確かめる
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ソラ', status: '募集', capacity: 1 });
    await ok(G.komachi, G.id, 'setInterest', { id: 'S002', name: 'こまち', level: 'want' });
    const w = await ok(G.admin, G.id, 'setInterest', { id: 'S002', name: 'ひより', level: 'want' });
    expect(w.message).toBe('「港」は定員（1人）に達しているので、キャンセル待ちに並びました（1番目）: ひより');
    expect(w.waiting).toBe(1);
  });

  test('参加希望の人が外れたら、キャンセル待ちの前の人が繰り上がり、Discordで呼ぶ。履歴に残る', async () => {
    await useChannel();
    await want(G.sora, 'ソラ');
    await want(G.komachi, 'こまち');
    await yuzuWants();
    const r = await ok(G.sora, G.id, 'setInterest', { id: 'S001', name: 'ソラ', level: 'interest' });
    expect(r.message).toBe('「古城」に興味ありを付けました: ソラ　キャンセル待ちのユズが参加希望に繰り上がりました。　繰り上げの知らせをDiscordに送りました。');
    expect(sessionOf(r)).toMatchObject({ want: ['こまち', 'ユズ'], interest: ['ソラ'] });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.content).toBe('🎟️ 「古城」に空きが出たので、キャンセル待ちから参加希望に繰り上がりました: <@400000000000000013>\n🔗 https://yoki.test/g/' + G.id + '/');
    expect((await history())[0]).toBe('繰り上げ ユズを参加希望に');
  });

  test('送り先が無ければ、繰り上げても送らない', async () => {
    await want(G.sora, 'ソラ');
    await want(G.komachi, 'こまち');
    await yuzuWants();
    const r = await ok(G.komachi, G.id, 'setInterest', { id: 'S001', name: 'こまち', level: 'none' });
    expect(r.message).toBe('「古城」への希望を取り消しました: こまち　キャンセル待ちのユズが参加希望に繰り上がりました。');
    expect(r.notified).toBeNull();
    expect(posts).toEqual([]);
  });

  test('定員を増やすと繰り上がる（GMが卓を保存したとき）。減らすと、外に出た人はキャンセル待ちになる', async () => {
    await useChannel();
    await want(G.sora, 'ソラ');
    await want(G.komachi, 'こまち');
    await yuzuWants();
    let r = await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '古城', gm: 'ひより', status: '募集', capacity: 1 });
    expect(r.message).toBe('更新しました: 古城（S001）');
    expect(posts).toEqual([]);
    r = await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '古城', gm: 'ひより', status: '募集', capacity: '' });
    expect(r.message).toBe('更新しました: 古城（S001）　キャンセル待ちのこまち、ユズが参加希望に繰り上がりました。　繰り上げの知らせをDiscordに送りました。');
    expect(posts[0]!.content).toContain('繰り上がりました: <@400000000000000012> <@400000000000000013>');
    expect((await history())[0]).toBe('繰り上げ こまち、ユズを参加希望に');
  });
});

describe('開催・調整中にしたあと', () => {
  beforeEach(async () => {
    await want(G.sora, 'ソラ');
    await want(G.komachi, 'こまち');
    await yuzuWants();
  });

  test('開催にすると、定員までの人が参加者に入り、キャンセル待ちは並んだまま残る', async () => {
    const r = await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '古城', gm: 'ひより', status: '開催', date: T(5) });
    expect(r.message).toBe('更新しました: 古城（S001）　参加希望のソラ、こまちを参加者に加えました。　キャンセル待ちのユズは、そのまま並んでいます。');
    expect(sessionOf(r)).toMatchObject({ members: ['ソラ', 'こまち'], want: ['ユズ'], capacity: 0 });
    // 保存し直しても残る。参加者に入れたら外れる
    let s = sessionOf(await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '古城', gm: 'ひより', status: '開催', date: T(5), members: ['ソラ', 'こまち'] }));
    expect(s.want).toEqual(['ユズ']);
    s = sessionOf(await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '古城', gm: 'ひより', status: '開催', date: T(5), members: ['ソラ', 'こまち', 'ユズ'] }));
    expect(s.want).toEqual([]);
  });

  test('まとめて状態を変えても同じ。定員の無い募集は、みな参加者に入る', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', status: '募集' });
    await ok(G.sora, G.id, 'setInterest', { id: 'S002', name: 'ソラ', level: 'want' });
    const r = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001', 'S002'], action: 'status', value: '調整中' });
    expect(r.data.sessions.map((x: any) => [x.members, x.want])).toEqual([[['ソラ', 'こまち'], ['ユズ']], [['ソラ'], []]]);
    // 調整中から開催にしても、キャンセル待ちは残る
    const again = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'status', value: '中止' });
    expect(sessionOf(again).want).toEqual(['ユズ']);
  });

  test('並んでいる本人はやめられる。ほかの操作は、募集でなければできない', async () => {
    await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '古城', gm: 'ひより', status: '開催', date: T(5) });
    await env.DB.prepare("UPDATE session_people SET member_id = (SELECT id FROM members WHERE name = 'こまち') WHERE role = 'want'").run();
    await ok(G.sora, G.id, 'saveSession', { id: 'S001', name: '古城', gm: 'ひより', status: '開催', date: T(5), members: ['ソラ'] });
    expect((await fail(G.komachi, G.id, 'setInterest', { id: 'S001', name: 'こまち', level: 'interest' })).error).toBe('「古城」は募集中ではありません（開催）。');
    const r = await ok(G.komachi, G.id, 'setInterest', { id: 'S001', name: 'こまち', level: 'none' });
    expect(r.message).toBe('「古城」のキャンセル待ちをやめました: こまち');
    expect(sessionOf(r).want).toEqual([]);
    expect((await fail(G.komachi, G.id, 'setInterest', { id: 'S001', name: 'こまち', level: 'none' })).error).toBe('「古城」は募集中ではありません（開催）。');
  });

  test('GMか管理者が「繰り上げる」と参加者に入り、Discordで呼ぶ。履歴に残る', async () => {
    await useChannel();
    await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '古城', gm: 'ひより', status: '開催', date: T(5) });
    expect((await fail(G.sora, G.id, 'promoteWaiter', { id: 'S001', name: 'ユズ' })).error).toBe('ADMIN: GMのほかがキャンセル待ちの人を繰り上げることができるのは管理者だけです。');
    expect((await fail(G.admin, G.id, 'promoteWaiter', { id: 'S001', name: 'ソラ' })).error).toBe('ソラは「古城」のキャンセル待ちにいません。');
    const r = await ok(G.admin, G.id, 'promoteWaiter', { id: 'S001', name: 'ユズ' });
    expect(r.message).toBe('「古城」のキャンセル待ちから、ユズを参加者にしました。　繰り上げの知らせをDiscordに送りました。');
    expect(sessionOf(r)).toMatchObject({ members: ['ソラ', 'こまち', 'ユズ'], want: [] });
    expect(posts[0]!.content.split('\n')[0]).toBe('🎟️ 「古城」のキャンセル待ちから、参加者に繰り上がりました: <@400000000000000013>');
    expect((await history())[0]).toBe('繰り上げ ユズを参加者に');
  });

  test('GMなら管理者でなくても繰り上げられる。募集・終了の卓では使えない', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ソラ', status: '募集' });
    expect((await fail(G.sora, G.id, 'promoteWaiter', { id: 'S002', name: 'ユズ' })).error).toBe('「港」は、開催・調整中の卓ではありません（募集）。');
    // ソラをGMにすると、ソラは参加希望から外れる。定員1人なら、こまちが参加者に入り、ユズが並んだまま残る
    await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '古城', gm: 'ひより', status: '募集', capacity: 1 });
    await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '古城', gm: 'ソラ', status: '調整中' });
    const r = await ok(G.sora, G.id, 'promoteWaiter', { id: 'S001', name: 'ユズ' });
    expect(r.notified).toBeNull();
    expect(sessionOf(r).members).toContain('ユズ');
  });
});

describe('知らせの文', () => {
  const ctxNow = () => loadGroup(env.DB, G.id, SYSTEM_ACTOR, '', new Date());

  test('募集の卓の内訳と締め切りの知らせに、キャンセル待ちを書く', async () => {
    await want(G.sora, 'ソラ');
    await want(G.komachi, 'こまち');
    await yuzuWants();
    await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '古城', gm: 'ひより', status: '募集', capacity: 2, recruitDue: T(0) });
    const ctx = await ctxNow(), s = ctx.sessions[0]!;
    expect(sessionEmbed(ctx, s).description).toContain('参加希望: ソラ、こまち（2/2人）\nキャンセル待ち: ユズ');
    expect(recruitDuePayload(ctx, s).content).toContain('参加希望: ソラ、こまち（2/2人）　キャンセル待ち: ユズ');
  });

  test('行けなくなった知らせに、キャンセル待ちを添える。繰り上げの知らせは、URLが無ければ添えない', async () => {
    await want(G.sora, 'ソラ');
    await want(G.komachi, 'こまち');
    await yuzuWants();
    await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '古城', gm: 'ひより', status: '開催', date: T(5) });
    const ctx = await ctxNow(), s = ctx.sessions[0]!;
    expect(absencePayload(ctx, s, 'ソラ', '').content).toContain('\nキャンセル待ち: ユズ（Yokiの「繰り上げる」で参加者にできます）\n');
    expect(waitPromotedPayload(ctx, s, ['ユズ'], false).content).toBe('🎟️ 「古城」のキャンセル待ちから、参加者に繰り上がりました: <@400000000000000013>');
  });
});
