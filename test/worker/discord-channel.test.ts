// DiscordのチャンネルとBot: IDの形・招くURL・APIの読み方・チャンネルの一覧、知らせのチャンネルを選ぶときの確かめ、一覧を読む呼び出し
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Actor } from '../../src/worker/auth/guard';
import { BOT_PERMISSIONS, botGet, botInviteUrl, getChannel, isChannelId, listChannels } from '../../src/worker/discord/channel';
import { loadGroup } from '../../src/worker/domain/load';
import { getDiscordChannels, saveConsoleSettings, saveSeriesNotify } from '../../src/worker/domain/settings';
import { fail, GUILD, ok, setupGroup } from './helpers';

const API = 'https://discord.com/api/v10';
const CH = (n: number) => '12345678901234567' + n;
afterEach(() => vi.restoreAllMocks());

type Call = { method: string; url: string; auth: string | null };

/** DiscordのAPIの返事を差し替える。replyがURLから返事を決める。呼んだ先とAuthorizationを記録する */
function mockApi(reply: (url: string) => Response) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ method: init?.method ?? 'GET', url, auth: new Headers(init?.headers).get('Authorization') });
    return reply(url);
  });
  return calls;
}

describe('チャンネルのIDと、Botを招くURL', () => {
  test('チャンネルのIDは17〜20桁の数字だけ', () => {
    for (const id of ['12345678901234567', CH(1), '12345678901234567890']) expect(isChannelId(id), id).toBe(true);
    for (const id of ['', '1234567890123456', '123456789012345678901', '12345678901234567a', ' ' + CH(1), 'https://discord.com/api/webhooks/123456789012345678/x']) {
      expect(isChannelId(id), id).toBe(false);
    }
  });

  test('招くURLは、グループのサーバーを選んだ形で、見る・送る・埋め込みの権限を求める。Client IDが無ければ空', () => {
    expect(BOT_PERMISSIONS).toBe(1024 + 2048 + 16384);
    const u = new URL(botInviteUrl('app-1', GUILD));
    expect(u.origin + u.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: 'app-1', scope: 'bot', permissions: '19456', guild_id: GUILD, disable_guild_select: 'true' });
    expect(botInviteUrl('', GUILD)).toBe('');
  });
});

describe('DiscordのAPIをBotで読む', () => {
  test('Botのトークンを添えて読み、状態と本文を返す。JSONでない本文はnull', async () => {
    const calls = mockApi((url) => (url.endsWith('/a') ? Response.json({ x: 1 }) : new Response('<html>Bad Gateway</html>', { status: 502 })));
    expect(await botGet('tok', '/a')).toEqual({ status: 200, body: { x: 1 } });
    expect(await botGet('tok', '/b')).toEqual({ status: 502, body: null });
    expect(calls).toEqual([{ method: 'GET', url: API + '/a', auth: 'Bot tok' }, { method: 'GET', url: API + '/b', auth: 'Bot tok' }]);
  });

  test('チャンネルの一覧は、送れる種類（テキストとアナウンス）だけを、カテゴリーごとにDiscordの並び順で返す', async () => {
    const ch = (id: string, name: string, type: number, position: number, parent_id: string | null = null) => ({ id, name, type, position, parent_id, guild_id: GUILD });
    const calls = mockApi(() =>
      Response.json([
        ch('c-play', '卓', 4, 1),
        ch('c-chat', '雑談', 4, 0),
        ch('t1', '卓の知らせ', 0, 2, 'c-play'),
        ch('t2', '募集', 0, 0, 'c-play'),
        ch('v1', 'ボイス', 2, 1, 'c-play'),
        ch('a1', 'お知らせ', 5, 1, 'c-chat'),
        ch('f1', 'フォーラム', 15, 0, 'c-chat'),
        ch('t4', 'ルール', 0, 5),
        ch('t6', 'ようこそ', 0, 3),
        // カテゴリーが一覧に無い（見られない）ときは、カテゴリーの無いものの後ろに、名前を空にして並べる
        ch('t5', '迷子', 0, 0, 'c-gone'),
      ]),
    );
    expect(await listChannels('tok', GUILD)).toEqual([
      { id: 't6', name: 'ようこそ', category: '' },
      { id: 't4', name: 'ルール', category: '' },
      { id: 't5', name: '迷子', category: '' },
      { id: 'a1', name: 'お知らせ', category: '雑談' },
      { id: 't2', name: '募集', category: '卓' },
      { id: 't1', name: '卓の知らせ', category: '卓' },
    ]);
    expect(calls).toEqual([{ method: 'GET', url: API + '/guilds/' + GUILD + '/channels', auth: 'Bot tok' }]);
  });

  test('Botがサーバーにいない・見られないときはnull。そのほかの失敗は投げる', async () => {
    const replies = [
      Response.json({ message: 'Missing Access', code: 50001 }, { status: 403 }),
      Response.json({ message: 'Unknown Guild', code: 10004 }, { status: 404 }),
      new Response('oops', { status: 500 }),
      Response.json({ message: 'ok?' }),
    ];
    mockApi(() => replies.shift()!);
    expect(await listChannels('tok', GUILD)).toBeNull();
    expect(await listChannels('tok', GUILD)).toBeNull();
    await expect(listChannels('tok', GUILD)).rejects.toThrow('Discordのチャンネルの一覧を読めませんでした（HTTP 500）');
    // 一覧でない返事も読めないことにする
    await expect(listChannels('tok', GUILD)).rejects.toThrow('（HTTP 200）');
  });

  test('1つのチャンネルを読む。送れない種類・見られない・読めない返事ならnull', async () => {
    const replies: Record<string, Response> = {
      [CH(1)]: Response.json({ id: CH(1), name: '卓の知らせ', type: 0, position: 0, parent_id: null, guild_id: GUILD }),
      [CH(2)]: Response.json({ id: CH(2), name: 'お知らせ', type: 5, position: 0, parent_id: null }),
      [CH(3)]: Response.json({ id: CH(3), name: 'ボイス', type: 2, position: 0, parent_id: null, guild_id: GUILD }),
      [CH(4)]: Response.json({ message: 'Unknown Channel', code: 10003 }, { status: 404 }),
      [CH(5)]: new Response('not json'),
    };
    const calls = mockApi((url) => replies[url.split('/').at(-1)!]!);
    expect(await getChannel('tok', CH(1))).toEqual({ id: CH(1), name: '卓の知らせ', guildId: GUILD });
    // サーバーのIDが無い返事は、どのサーバーのチャンネルでもないことにする
    expect(await getChannel('tok', CH(2))).toEqual({ id: CH(2), name: 'お知らせ', guildId: '' });
    for (const n of [3, 4, 5]) expect(await getChannel('tok', CH(n)), CH(n)).toBeNull();
    expect(calls[0]).toEqual({ method: 'GET', url: API + '/channels/' + CH(1), auth: 'Bot tok' });
  });
});

describe('知らせのチャンネルを選ぶ', () => {
  let G: Awaited<ReturnType<typeof setupGroup>>;
  let calls: Call[];
  beforeEach(async () => {
    G = await setupGroup();
    // CH(1)〜CH(2) はこのグループのサーバーのチャンネル。CH(3) はほかのサーバー。CH(4) はボイス。CH(5) はBotが見られない。ほかは無い
    const channels: Record<string, object> = {
      [CH(1)]: { name: '卓の知らせ', type: 0, guild_id: GUILD },
      [CH(2)]: { name: 'お知らせ', type: 5, guild_id: GUILD },
      [CH(3)]: { name: 'よその卓', type: 0, guild_id: 'other-guild' },
      [CH(4)]: { name: 'ボイス', type: 2, guild_id: GUILD },
    };
    calls = mockApi((url) => {
      const id = url.split('/').at(-1)!;
      if (id === CH(5)) return Response.json({ message: 'Missing Access', code: 50001 }, { status: 403 });
      const c = channels[id];
      return c ? Response.json({ id, position: 0, parent_id: null, ...c }) : Response.json({ message: 'Unknown Channel', code: 10003 }, { status: 404 });
    });
  });

  const save = (form: Record<string, unknown>) => ok(G.admin, G.id, 'saveConsoleSettings', form);
  const refuse = async (fn: string, form: Record<string, unknown>) => (await fail(G.admin, G.id, fn, form)).error;
  const NOT_SEEN = 'Botがそのチャンネルを見られません。サーバーにBotを招き、チャンネルの権限を確かめてください。';
  const OTHER = 'このグループのDiscordサーバーのチャンネルではありません。';

  test('基本のチャンネルを選ぶと、Botで確かめて名前を返事に出す。空にすると外す', async () => {
    let r = await save({ channelId: CH(1) });
    expect(r.message).toBe('保存しました: 基本のチャンネルを「#卓の知らせ」に');
    expect(r.data).toMatchObject({ channelSet: true, settings: { channelId: CH(1) } });
    expect(calls).toEqual([{ method: 'GET', url: API + '/channels/' + CH(1), auth: 'Bot test-bot-token' }]);
    r = await save({ channelId: '' });
    expect(r.message).toBe('保存しました: 基本のチャンネルを外す');
    expect(r.data).toMatchObject({ channelSet: false, settings: { channelId: '' } });
    // 外すときはDiscordに聞かない
    expect(calls).toHaveLength(1);
  });

  test('種類ごとのチャンネル（アナウンスのチャンネルも選べる）。空にすると基本へ戻す。知らない種類は断る', async () => {
    let r = await save({ channelId: CH(1), kindChannel: { kind: 'remind', channelId: CH(2) } });
    expect(r.message).toBe('保存しました: 基本のチャンネルを「#卓の知らせ」に、開催前の知らせのチャンネルを「#お知らせ」に');
    expect(r.data).toMatchObject({ channelSet: true, remindChannelSet: true, recruitChannelSet: false, settings: { remindChannelId: CH(2) } });
    r = await save({ kindChannel: { kind: 'remind', channelId: '' } });
    expect(r.message).toBe('保存しました: 開催前の知らせのチャンネルを外して基本へ');
    expect(r.data).toMatchObject({ channelSet: true, remindChannelSet: false });
    expect(await refuse('saveConsoleSettings', { kindChannel: { kind: 'soon', channelId: CH(1) } })).toBe('知らせの種類が不正です: soon');
  });

  test('今と同じチャンネルを送っても、Discordに聞かず、変更に数えない', async () => {
    await save({ channelId: CH(1), kindChannel: { kind: 'remind', channelId: CH(2) } });
    expect(calls).toHaveLength(2);
    expect((await save({ channelId: CH(1), kindChannel: { kind: 'remind', channelId: CH(2) } })).message).toBe('変更はありません。');
    // 選んでいない種類のチャンネルを空にしても、外したことにしない
    expect((await save({ kindChannel: { kind: 'recruit', channelId: '' } })).message).toBe('変更はありません。');
    // ほかの項目が変わったときは、その項目だけを知らせる
    expect((await save({ channelId: CH(1), urge: false })).message).toBe('保存しました: 期間前の催促をOFF');
    expect(calls).toHaveLength(2);
    expect((await save({ channelId: '' })).message).toBe('保存しました: 基本のチャンネルを外す');
    expect((await save({ channelId: '' })).message).toBe('変更はありません。');
    expect(calls).toHaveLength(2);
  });

  test('IDの形でなければ、Discordに聞かずに断る', async () => {
    for (const id of ['abc', '1234', 'https://discord.com/api/webhooks/123456789012345678/x']) {
      expect(await refuse('saveConsoleSettings', { channelId: id }), id).toBe('チャンネルのIDが正しくありません。');
    }
    expect(await refuse('saveConsoleSettings', { kindChannel: { kind: 'recruit', channelId: '#募集' } })).toBe('チャンネルのIDが正しくありません。');
    expect(await refuse('saveSeriesNotify', { series: '港', channelId: '港' })).toBe('チャンネルのIDが正しくありません。');
    expect(calls).toEqual([]);
  });

  test('Botが見られないチャンネル・送れない種類・無いチャンネル・ほかのサーバーのチャンネルは断り、何も保存しない', async () => {
    for (const n of [4, 5, 9]) expect(await refuse('saveConsoleSettings', { channelId: CH(n) }), CH(n)).toBe(NOT_SEEN);
    // Botはほかのサーバーにもいるので、そのチャンネルには送らせない
    expect(await refuse('saveConsoleSettings', { channelId: CH(3), urge: false })).toBe(OTHER);
    expect(await refuse('saveConsoleSettings', { kindChannel: { kind: 'recruit', channelId: CH(3) } })).toBe(OTHER);
    expect(await refuse('saveSeriesNotify', { series: '港', channelId: CH(3) })).toBe(OTHER);
    const d = await ok(G.admin, G.id, 'getConsoleData');
    expect(d).toMatchObject({ channelSet: false, recruitChannelSet: false, seriesNotify: [], settings: { urge: true } });
  });

  test('シリーズのチャンネルは、送らなければ今のまま。空なら外して基本のチャンネルへ', async () => {
    let r = await ok(G.admin, G.id, 'saveSeriesNotify', { series: '港', channelId: CH(1), alsoBase: true });
    expect(r.message).toBe('「港」の通知を保存しました: 専用のチャンネルへ（基本のチャンネルにも）、基本と同じ日時（開催日の前日の20時台）に送ります。');
    r = await ok(G.admin, G.id, 'saveSeriesNotify', { series: '港', days: '2' });
    expect(r.data.seriesNotify).toEqual([{ series: '港', channelId: CH(1), alsoBase: true, days: 2, hour: null }]);
    // 今と同じチャンネルを送り直しても、確かめ直さない
    await ok(G.admin, G.id, 'saveSeriesNotify', { series: '港', channelId: CH(1), alsoBase: false });
    expect(calls).toHaveLength(1);
    r = await ok(G.admin, G.id, 'saveSeriesNotify', { series: '港', channelId: CH(2) });
    expect(r.data.seriesNotify).toEqual([{ series: '港', channelId: CH(2), alsoBase: false, days: 2, hour: null }]);
    expect(calls.map((c) => c.url)).toEqual([API + '/channels/' + CH(1), API + '/channels/' + CH(2)]);
    r = await ok(G.admin, G.id, 'saveSeriesNotify', { series: '港', channelId: '', alsoBase: true });
    expect(r.message).toBe('「港」の通知を保存しました: 基本のチャンネルへ、開催日の2日前の20時台に送ります。');
    expect(r.data.seriesNotify).toEqual([{ series: '港', channelId: '', alsoBase: true, days: 2, hour: null }]);
  });

  test('Botが設定されていなければ、新しいチャンネルは確かめられないので断る。今のままにする・外すことはできる', async () => {
    await env.DB.prepare('UPDATE groups SET channel_id = ? WHERE id = ?').bind(CH(1), G.id).run();
    const m = await env.DB.prepare("SELECT id FROM members WHERE group_id = ? AND name = 'ひより'").bind(G.id).first<{ id: number }>();
    const actor: Actor = { memberId: m!.id, name: 'ひより', isAdmin: true, userId: '400000000000000010' };
    // Botを渡さずに読み込むと、トークンは空
    const ctx = await loadGroup(env.DB, G.id, actor, '', new Date());
    const why = 'YokiのBotが設定されていないので、チャンネルを確かめられません。運営者に知らせてください。';
    await expect(saveConsoleSettings(ctx, { channelId: CH(2) })).rejects.toThrow(why);
    await expect(saveConsoleSettings(ctx, { kindChannel: { kind: 'recruit', channelId: CH(2) } })).rejects.toThrow(why);
    await expect(saveSeriesNotify(ctx, { series: '港', channelId: CH(2) })).rejects.toThrow(why);
    // 今のチャンネルのままなら、確かめないので断らない
    expect(await saveConsoleSettings(ctx, { channelId: CH(1) })).toEqual({ ok: true, message: '変更はありません。' });
    expect(await saveConsoleSettings(ctx, { channelId: '' })).toEqual({ ok: true, message: '保存しました: 基本のチャンネルを外す' });
    expect(calls).toEqual([]);
  });
});

describe('送り先に選べるチャンネルの一覧（getDiscordChannels）', () => {
  let G: Awaited<ReturnType<typeof setupGroup>>;
  beforeEach(async () => {
    G = await setupGroup();
  });

  test('Botがサーバーにいれば、送れるチャンネルの一覧を返す', async () => {
    const calls = mockApi(() =>
      Response.json([
        { id: CH(9), name: '卓', type: 4, position: 0, parent_id: null },
        { id: CH(1), name: '卓の知らせ', type: 0, position: 1, parent_id: CH(9) },
        { id: CH(2), name: '雑談', type: 0, position: 0, parent_id: null },
      ]),
    );
    const r = await ok(G.admin, G.id, 'getDiscordChannels');
    expect(r).toEqual({ ok: true, botReady: true, inGuild: true, channels: [{ id: CH(2), name: '雑談', category: '' }, { id: CH(1), name: '卓の知らせ', category: '卓' }] });
    expect(calls).toEqual([{ method: 'GET', url: API + '/guilds/' + GUILD + '/channels', auth: 'Bot test-bot-token' }]);
    // 画面のデータは付けない
    expect(r.data).toBeUndefined();
  });

  test('BotがサーバーにいなければinGuild: false（画面は招くURLを出す）', async () => {
    mockApi(() => Response.json({ message: 'Missing Access', code: 50001 }, { status: 403 }));
    expect(await ok(G.admin, G.id, 'getDiscordChannels')).toEqual({ ok: true, botReady: true, inGuild: false, channels: [] });
  });

  test('管理者だけが読める', async () => {
    const calls = mockApi(() => Response.json([]));
    const r = await fail(G.sora, G.id, 'getDiscordChannels');
    expect(r).toEqual({ status: 403, error: 'ADMIN: 知らせのチャンネルの一覧を読むことができるのは管理者だけです。' });
    expect(calls).toEqual([]);
  });

  test('Botが設定されていなければbotReady: false。Discordには聞かない', async () => {
    const calls = mockApi(() => Response.json([]));
    const actor: Actor = { memberId: 1, name: 'ひより', isAdmin: true, userId: '400000000000000010' };
    const ctx = await loadGroup(env.DB, G.id, actor, '', new Date());
    expect(await getDiscordChannels(ctx)).toEqual({ ok: true, botReady: false, inGuild: false, channels: [] });
    expect(calls).toEqual([]);
  });
});
