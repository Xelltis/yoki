// 卓ごとのスレッド: 最初の知らせのメッセージからスレッドを作り、次からはスレッドへ送る。スレッドが消えたらチャンネルへ送り直す
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { postSessionNotice, startThread, threadTarget } from '../../src/worker/discord/threads';
import { loadGroup } from '../../src/worker/domain/load';
import { SYSTEM_ACTOR } from '../../src/worker/auth/guard';
import { addDays } from '../../src/worker/lib/jst';
import { ok, setupGroup, today } from './helpers';

const CH = '123456789012345678', TH = '223456789012345678';
const MSG = (ch: string) => 'https://discord.com/api/v10/channels/' + ch + '/messages';
let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
let calls: { url: string; method: string; body: any }[] = [];
/** Discordの返事を差し替える。スレッドを作る要求にはTHを返し、ほかはrepliesを順に（尽きたらメッセージのIDつきの200） */
function mockDiscord(replies: (number | Response)[] = []) {
  calls = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    const r = replies.shift();
    if (r instanceof Response) return r;
    if (r) return new Response('{}', { status: r });
    return Response.json(url.endsWith('/threads') ? { id: TH } : { id: 'm' + calls.length });
  });
}
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
  await env.DB.prepare('UPDATE groups SET channel_id = ?, threads = 1').bind(CH).run();
  await ok(G.admin, G.id, 'saveSession', { name: '港の卓', gm: 'ひより', members: ['ソラ'], date: T(3), status: '開催' });
});
afterEach(() => vi.restoreAllMocks());
const load = () => loadGroup(env.DB, G.id, SYSTEM_ACTOR, 'https://yoki.test/g/grp/', new Date(), { token: 'test-bot-token' });
const thread = () => env.DB.prepare('SELECT thread_id, thread_parent FROM sessions').first<{ thread_id: string | null; thread_parent: string | null }>();

describe('卓ごとのスレッド', () => {
  test('使うのは、スレッドを入れたグループで、卓のスレッドがその送り先のチャンネルにあるときだけ', () => {
    const t = { channelId: CH, label: '基本のチャンネル', series: '' };
    const s = { threadId: TH, threadParent: CH };
    expect(threadTarget({ group: { threads: 1 } as any }, s, t)).toEqual({ channelId: TH, label: '卓のスレッド', series: '', thread: true });
    expect(threadTarget({ group: { threads: 0 } as any }, s, t)).toBe(t);
    expect(threadTarget({ group: { threads: 1 } as any }, { ...s, threadParent: 'x' }, t)).toBe(t);
    expect(threadTarget({ group: { threads: 1 } as any }, { threadId: null, threadParent: null }, t)).toBe(t);
  });

  test('最初の知らせのメッセージからスレッドを作り、次からはスレッドへ送る', async () => {
    mockDiscord();
    let ctx = await load();
    const targets = [{ channelId: CH, label: '基本のチャンネル', series: '' }];
    expect(await postSessionNotice(ctx, ctx.sessions[0]!, { content: 'a' }, '案内', targets, async () => {})).toBe(true);
    expect(calls.map((c) => [c.method, c.url])).toEqual([['POST', MSG(CH)], ['POST', 'https://discord.com/api/v10/channels/' + CH + '/messages/m1/threads']]);
    expect(calls[1]!.body).toEqual({ name: '港の卓', auto_archive_duration: 10080 });
    expect(await thread()).toEqual({ thread_id: TH, thread_parent: CH });
    ctx = await load();
    await postSessionNotice(ctx, ctx.sessions[0]!, { content: 'b' }, '案内', targets, async () => {});
    expect(calls[2]!.url).toBe(MSG(TH));
    expect((await ctx.db.prepare('SELECT target FROM notify_log ORDER BY id DESC').first('target'))).toBe('港の卓（卓のスレッド）');
  });

  test('スレッドが消えていたら（404）、控えを消してチャンネルへ送り直し、スレッドを作り直す', async () => {
    await env.DB.prepare('UPDATE sessions SET thread_id = ?, thread_parent = ?').bind('999999999999999999', CH).run();
    mockDiscord([404]);
    const ctx = await load();
    expect(await postSessionNotice(ctx, ctx.sessions[0]!, { content: 'a' }, '案内', [{ channelId: CH, label: '基本のチャンネル', series: '' }], async () => {})).toBe(true);
    expect(calls.map((c) => c.url)).toEqual([MSG('999999999999999999'), MSG(CH), 'https://discord.com/api/v10/channels/' + CH + '/messages/m2/threads']);
    expect(await thread()).toEqual({ thread_id: TH, thread_parent: CH });
  });

  test('スレッドを作れなければ記録し、知らせはチャンネルに送り続ける。2つ目の送り先にはスレッドを作らない', async () => {
    mockDiscord([200]);
    const ctx = await load();
    const two = [{ channelId: CH, label: '基本のチャンネル', series: '' }, { channelId: '323456789012345678', label: '募集のチャンネル', series: '', kind: 'recruit' as const }];
    expect(await postSessionNotice(ctx, ctx.sessions[0]!, { content: 'a' }, '案内', two, async () => {})).toBe(true);
    expect(calls.filter((c) => c.url.endsWith('/threads'))).toHaveLength(0);
    // 1通目は {} で返ったのでメッセージのIDが無く、スレッドを作らない。送り直して作ろうとして断られる
    mockDiscord([Response.json({ id: 'm1' }), 403]);
    await postSessionNotice(ctx, ctx.sessions[0]!, { content: 'a' }, '案内', two.slice(0, 1), async () => {});
    expect(await ctx.db.prepare("SELECT result FROM notify_log WHERE kind = 'スレッド'").first('result')).toBe('作れませんでした: HTTP 403（Botに「公開スレッドの作成」の権限がありません。管理画面の「知らせ」から招き直してください）');
    mockDiscord([Response.json({ nope: 1 })]);
    await startThread(ctx, ctx.sessions[0]!, CH, 'm9');
    expect(await ctx.db.prepare("SELECT result FROM notify_log WHERE kind = 'スレッド' ORDER BY id DESC").first('result')).toBe('作れませんでした: HTTP 200');
    mockDiscord([new Response('x', { status: 200 })]);
    await startThread(ctx, ctx.sessions[0]!, CH, 'm9');
    mockDiscord([new Response('x', { status: 500 })]);
    await startThread(ctx, ctx.sessions[0]!, CH, 'm9');
    expect(await thread()).toEqual({ thread_id: null, thread_parent: null });
  });

  test('画面から送る知らせ（sendDiscordStep）も、スレッドを作ってスレッドへ送る。スレッドが消えていればチャンネルへ', async () => {
    mockDiscord();
    let r = await ok(G.admin, G.id, 'sendDiscordStep', { kind: 'announce', id: 'S001' });
    expect(r).toMatchObject({ ok: true, targetLabel: '基本のチャンネル' });
    expect(await thread()).toEqual({ thread_id: TH, thread_parent: CH });
    r = await ok(G.admin, G.id, 'sendDiscordStep', { kind: 'announce', id: 'S001' });
    expect(r).toMatchObject({ ok: true, targetLabel: '卓のスレッド' });
    expect(calls.at(-1)!.url).toBe(MSG(TH));
    mockDiscord([404]);
    r = await ok(G.admin, G.id, 'sendDiscordStep', { kind: 'announce', id: 'S001' });
    expect(r).toMatchObject({ ok: true, targetLabel: '基本のチャンネル' });
    expect(calls.map((c) => c.url.replace('https://discord.com/api/v10/channels/', ''))).toEqual([TH + '/messages', CH + '/messages', CH + '/messages/m2/threads']);
    // 卓の無い知らせ（接続テスト）は、チャンネルへ
    mockDiscord();
    r = await ok(G.admin, G.id, 'sendDiscordStep', { kind: 'test' });
    expect(calls.map((c) => c.url)).toEqual([MSG(CH)]);
  });

  test('設定で入れ切りでき、画面データに出る。スレッドの権限を付けて招くURLもある', async () => {
    let r = await ok(G.admin, G.id, 'saveConsoleSettings', { threads: false });
    expect(r.data.settings.threads).toBe(false);
    expect(r.message).toContain('卓ごとのスレッドをOFF');
    r = await ok(G.admin, G.id, 'saveConsoleSettings', { threads: true });
    expect(r.data.settings.threads).toBe(true);
    expect(new URL(r.data.bot.threadsInviteUrl).searchParams.get('permissions')).toBe(String(1024 + 2048 + 16384 + 2 ** 35 + 2 ** 38));
  });
});
