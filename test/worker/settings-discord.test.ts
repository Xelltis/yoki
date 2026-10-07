// 設定（§18・39・41・44）と、画面から1回ずつ送るDiscord（§7・16・25・26・27・32・42）
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { addDays } from '../../src/worker/lib/jst';
import { fail, GUILD, mockBotGuilds, ok, setupGroup, today } from './helpers';

let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
});
afterEach(() => vi.restoreAllMocks());

const CH = (n: number) => '12345678901234567' + n;
const NAMES: Record<string, string> = { [CH(1)]: '卓の知らせ', [CH(2)]: '募集', [CH(3)]: '鉄鳴界' };

/**
 * DiscordのAPI（Bot）の返事を差し替える。チャンネルを読むと、このグループのサーバーのテキストチャンネルとして返す。
 * メッセージを送るとcodesを順に返し、尽きたら200。送った先・Authorization・本文を記録する
 */
function mockBot(codes: number[] = []) {
  const posts: { channel: string; auth: string | null; content: string; mentions: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const id = url.split('/')[6]!;
    if ((init?.method ?? 'GET') === 'GET') return Response.json({ id, name: NAMES[id], type: 0, guild_id: GUILD });
    const body = JSON.parse(String(init?.body));
    posts.push({ channel: id, auth: new Headers(init?.headers).get('Authorization'), content: body.content, mentions: body.allowed_mentions });
    const code = codes.shift() ?? 200;
    return new Response(code === 429 ? '{"retry_after": 1.5}' : null, { status: code });
  });
  return posts;
}

describe('設定', () => {
  test('基本のチャンネルは、IDの形で、Botが見られるものだけ。画面にはチャンネルのIDとBotの様子を渡す', async () => {
    mockBot();
    expect((await fail(G.admin, G.id, 'saveConsoleSettings', { channelId: 'https://discord.com/api/webhooks/1/x' })).error).toBe('チャンネルのIDが正しくありません。');
    let r = await ok(G.admin, G.id, 'getConsoleData');
    expect(r).toMatchObject({ channelSet: false, settings: { channelId: '' } });
    expect(r.bot).toEqual({ ready: true, inviteUrl: 'https://discord.com/oauth2/authorize?client_id=test-client&scope=bot&permissions=19456&guild_id=guild-t&disable_guild_select=true' });
    r = await ok(G.admin, G.id, 'saveConsoleSettings', { channelId: CH(1) });
    expect(r.message).toBe('保存しました: 基本のチャンネルを「#卓の知らせ」に');
    expect(r.data.channelSet).toBe(true);
    expect(r.data.settings.channelId).toBe(CH(1));
  });

  test('開催前の知らせの日時・有効にする・ほかの値。範囲の外は断る', async () => {
    let r = await ok(G.admin, G.id, 'saveConsoleSettings', { days: '2', hour: '9' });
    expect(r.message).toBe('保存しました: 開催前の知らせを2日前の9時台に');
    r = await ok(G.admin, G.id, 'saveConsoleSettings', { remind: true });
    expect(r.message).toBe('開催前の知らせを有効にしました。開催日の2日前の9時台に送ります（シリーズで変えた卓はその日時）。');
    expect(r.data.settings).toMatchObject({ remind: true, notifyDays: 2, notifyHour: 9 });
    expect(r.data.notifySetter).toMatch(/^ひより \/ /);
    r = await ok(G.admin, G.id, 'saveConsoleSettings', { soon: true, soonMinutes: '45', calMonths: '3', availDays: '90', autoFinish: false, urge: false });
    expect(r.data.settings).toMatchObject({ soon: true, soonMinutes: 45, calMonths: 3, availDays: 90, autoFinish: false, urge: false });
    expect(r.data.availDays).toHaveLength(90);
    expect((await fail(G.admin, G.id, 'saveConsoleSettings', { hour: '24' })).error).toContain('0〜23');
    expect((await fail(G.admin, G.id, 'saveConsoleSettings', { soonMinutes: '3' })).error).toContain('5〜720');
    expect((await fail(G.sora, G.id, 'saveConsoleSettings', { urge: true })).error).toBe('ADMIN: 設定を変えることができるのは管理者だけです。');
  });

  test('種類ごとのチャンネルと、シリーズごとの知らせ', async () => {
    mockBot();
    let r = await ok(G.admin, G.id, 'saveConsoleSettings', { kindChannel: { kind: 'recruit', channelId: CH(2) } });
    expect(r.message).toBe('保存しました: 募集のチャンネルを「#募集」に');
    expect(r.data).toMatchObject({ channelSet: false, remindChannelSet: false, recruitChannelSet: true, settings: { remindChannelId: '', recruitChannelId: CH(2) } });
    r = await ok(G.admin, G.id, 'saveSeriesNotify', { series: '鉄鳴界', channelId: CH(3), alsoBase: false, days: '0', hour: '' });
    expect(r.message).toBe('「鉄鳴界」の通知を保存しました: 専用のチャンネルへ、開催日の当日の20時台に送ります。');
    expect(r.data.seriesNotify).toEqual([{ series: '鉄鳴界', channelId: CH(3), alsoBase: false, days: 0, hour: null }]);
    r = await ok(G.admin, G.id, 'saveSeriesNotify', { series: '鉄鳴界', remove: true });
    expect(r.data.seriesNotify).toEqual([]);
  });

  test('グループの名前を変える', async () => {
    const r = await ok(G.admin, G.id, 'renameGroup', { name: '新しい名前' });
    expect(r.data.title).toBe('新しい名前');
    expect((await fail(G.admin, G.id, 'renameGroup', { name: '' })).error).toContain('名前を入れて');
  });
});

describe('sendDiscordStep', () => {
  /** 送り先のチャンネルを選んだあと、Discordの返事をcodesにする */
  async function withChannels(codes: number[] = []) {
    const posts = mockBot(codes);
    await ok(G.admin, G.id, 'saveConsoleSettings', { channelId: CH(1), kindChannel: { kind: 'recruit', channelId: CH(2) } });
    return posts;
  }

  test('接続テストは基本のチャンネルへ、YokiのBotで送る。送信記録に残る', async () => {
    const posts = await withChannels();
    const r = await ok(G.sora, G.id, 'sendDiscordStep', { kind: 'test', attempt: 1 });
    expect(r).toMatchObject({ ok: true, code: 200, to: 0, targetCount: 1, targetLabel: '基本のチャンネル' });
    expect(posts[0]).toEqual({ channel: CH(1), auth: 'Bot test-bot-token', content: '✅ Yokiから接続テスト（テストの卓）', mentions: { parse: ['users'] } });
    const d = await ok(G.sora, G.id, 'getConsoleData');
    expect(d.log[0]).toMatchObject({ kind: '接続テスト', target: '-', result: 'OK (200)' });
  });

  test('429は送り直してよい。待つ時間はRetry-After（retry_after）を見る。3回目で打ち止め', async () => {
    await withChannels([429, 429, 429]);
    const r1 = await ok(G.sora, G.id, 'sendDiscordStep', { kind: 'test', attempt: 1 });
    expect(r1).toMatchObject({ ok: false, code: 429, retryable: true, waitMs: 3000, attempt: 1, maxTries: 3 });
    expect(r1.reason.label).toBe('Discord側の制限');
    const r3 = await ok(G.sora, G.id, 'sendDiscordStep', { kind: 'test', attempt: 3 });
    expect(r3).toMatchObject({ ok: false, retryable: false, waitMs: 0 });
    expect(r3.result).toContain('打ち止め');
  });

  test('登録の知らせはGMと参加者をメンションし、募集中の卓は募集のチャンネルへ送る', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', members: ['ソラ'], date: T(3), status: '開催' });
    await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'こまち', status: '募集' });
    const posts = await withChannels();
    await ok(G.admin, G.id, 'sendDiscordStep', { kind: 'change', verb: '登録', id: 'S001' });
    expect(posts[0]!.channel).toBe(CH(1));
    expect(posts[0]!.content).toBe('🆕 卓の予定が登録されました（ひより）\n<@400000000000000010> <@400000000000000011>');
    await ok(G.admin, G.id, 'sendDiscordStep', { kind: 'change', verb: '登録', id: 'S002' });
    expect(posts[1]!.channel).toBe(CH(2));
    expect(posts[1]!.content).toContain('🔗 参加希望はYokiの「募集・調整」タブから: https://yoki.test/g/grp/');
  });

  test('参加確認を送ると、卓に「確認文を送りました」の日時が付く', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'こまち', status: '募集' });
    expect((await fail(G.admin, G.id, 'sendDiscordStep', { kind: 'ask', id: 'S001' })).error).toContain('興味ありの人がいません');
    await ok(G.sora, G.id, 'setInterest', { id: 'S001', name: 'ソラ', level: 'interest' });
    const posts = await withChannels();
    const r = await ok(G.komachi, G.id, 'sendDiscordStep', { kind: 'ask', id: 'S001', message: 'ボイスありです' });
    expect(posts[0]!.content).toContain('に参加できそうですか？ <@400000000000000011>');
    expect(posts[0]!.content).toContain('💬 ボイスありです（こまち）');
    expect(r.asked).toMatch(/^\d{4}\/\d{2}\/\d{2}（.）/);
    expect(r.data.sessions[0].asked).toBe(r.asked);
  });

  test('今日が開催前の知らせの日の卓を案内すると、開催前の知らせ済みになる', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '明日の卓', gm: 'ひより', date: T(1), status: '開催' });
    await withChannels();
    const r = await ok(G.admin, G.id, 'sendDiscordStep', { kind: 'announce', id: 'S001' });
    expect(r.notified).toBe(true);
    expect(r.data.sessions[0].notified).not.toBe('');
  });

  test('まとめての変更は、対象の卓それぞれの送り先へ（シリーズの専用チャンネルも）', async () => {
    await withChannels();
    await ok(G.admin, G.id, 'saveSeriesNotify', { series: '港', channelId: CH(3), alsoBase: false });
    await ok(G.admin, G.id, 'saveSession', { name: '港 #1', series: '港', gm: 'ひより', date: T(3), status: '開催' });
    await ok(G.admin, G.id, 'saveSession', { name: '単発', gm: 'ひより', date: T(4), status: '開催' });
    const r = await ok(G.admin, G.id, 'sendDiscordStep', { kind: 'bulk', names: ['港 #1', '単発'], ids: ['S001', 'S002'], label: '変更', to: 0 });
    expect(r.targetCount).toBe(2);
    expect(r.targetLabel).toBe('シリーズ「港」のチャンネル');
  });

  test('基本のチャンネルを外したら、送り先が無いので断る', async () => {
    await withChannels();
    const r = await ok(G.admin, G.id, 'saveConsoleSettings', { channelId: '' });
    expect(r.message).toBe('保存しました: 基本のチャンネルを外す');
    expect(r.data.channelSet).toBe(false);
    expect((await fail(G.admin, G.id, 'sendDiscordStep', { kind: 'test' })).error).toContain('送り先のチャンネルが決まっていません');
  });
});

describe('権限', () => {
  test('管理者だけの操作は、ただのメンバーにはADMIN: で断る', async () => {
    for (const fn of ['deleteSession', 'bulkUpdateSessions', 'deleteMember', 'setAdmin', 'saveConsoleSettings', 'saveSeriesNotify', 'renameGroup', 'getDiscordChannels']) {
      const r = await fail(G.sora, G.id, fn, {});
      expect(r.status, fn).toBe(403);
      expect(r.error, fn).toMatch(/^ADMIN:/);
    }
  });

  test('知らない操作は404。ほかのグループには入れない', async () => {
    expect((await fail(G.sora, G.id, 'login', {})).status).toBe(404);
    const other = await setupGroup('other');
    await env.DB.prepare("UPDATE groups SET guild_id = 'elsewhere' WHERE id = 'other'").run();
    // Botはそのサーバーにいない（控えで決める）
    const bot = mockBotGuilds();
    expect((await fail(other.sora, 'other', 'getConsoleData')).status).toBe(403);
    bot.restore();
  });
});
