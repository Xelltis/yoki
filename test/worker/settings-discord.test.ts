// 設定（§18・39・41・44）と、画面から 1 回ずつ送る Discord（§7・16・25・26・27・32・42）
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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

const HOOK = (n: number) => 'https://discord.com/api/webhooks/12345678901234567' + n + '/token' + n;

/** Discord の Webhook の返事を差し替える。codes を順に返し、尽きたら 204 */
function mockWebhook(codes: number[] = []) {
  const posts: { url: string; content: string }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    posts.push({ url, content: JSON.parse(String(init?.body)).content });
    const code = codes.shift() ?? 204;
    return new Response(code === 429 ? '{"retry_after": 1.5}' : null, { status: code });
  });
  return posts;
}

describe('設定', () => {
  test('Webhook URL は Discord の形だけ。画面には伏せて渡す', async () => {
    expect((await fail(G.admin, G.id, 'saveConsoleSettings', { webhook: 'https://example.com/hook' })).error).toContain('Webhook URL の形');
    const r = await ok(G.admin, G.id, 'saveConsoleSettings', { webhook: HOOK(1) });
    expect(r.message).toBe('保存しました: Webhook URL');
    expect(r.data.webhookSet).toBe(true);
    expect(r.data.settings.webhookMasked).toBe(HOOK(1).slice(0, 40) + '…' + HOOK(1).slice(-4));
    expect(JSON.stringify(r.data)).not.toContain(HOOK(1));
  });

  test('開催前の知らせの日時・有効にする・ほかの値。範囲の外は断る', async () => {
    let r = await ok(G.admin, G.id, 'saveConsoleSettings', { days: '2', hour: '9' });
    expect(r.message).toBe('保存しました: 開催前の知らせ 2 日前の 9 時台');
    r = await ok(G.admin, G.id, 'saveConsoleSettings', { remind: true });
    expect(r.message).toBe('開催前の知らせを有効にしました。開催日の2 日前の 9 時台に送ります（シリーズで変えた卓はその日時）。');
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
    let r = await ok(G.admin, G.id, 'saveConsoleSettings', { kindWebhook: { kind: 'recruit', url: HOOK(2) } });
    expect(r.data.recruitWebhookSet).toBe(true);
    r = await ok(G.admin, G.id, 'saveSeriesNotify', { series: '鉄鳴界', webhook: HOOK(3), alsoBase: false, days: '0', hour: '' });
    expect(r.message).toBe('「鉄鳴界」の通知を保存しました: 専用のチャンネルへ、開催日の当日の 20 時台に送ります。');
    expect(r.data.seriesNotify).toEqual([{ series: '鉄鳴界', hasWebhook: true, webhookMasked: expect.any(String), alsoBase: false, days: 0, hour: null }]);
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
  beforeEach(async () => {
    await ok(G.admin, G.id, 'saveConsoleSettings', { webhook: HOOK(1), kindWebhook: { kind: 'recruit', url: HOOK(2) } });
  });

  test('接続テストは基本のチャンネルへ。送信記録に残る', async () => {
    const posts = mockWebhook();
    const r = await ok(G.sora, G.id, 'sendDiscordStep', { kind: 'test', attempt: 1 });
    expect(r).toMatchObject({ ok: true, code: 204, to: 0, targetCount: 1, targetLabel: '基本のチャンネル' });
    expect(posts[0]).toEqual({ url: HOOK(1), content: '✅ 卓予定管理から接続テスト（テストの卓）' });
    const d = await ok(G.sora, G.id, 'getConsoleData');
    expect(d.log[0]).toMatchObject({ kind: '接続テスト', target: '-', result: 'OK (204)' });
  });

  test('429 は送り直してよい。待つ時間は Retry-After（retry_after）を見る。3 回目で打ち止め', async () => {
    mockWebhook([429, 429, 429]);
    const r1 = await ok(G.sora, G.id, 'sendDiscordStep', { kind: 'test', attempt: 1 });
    expect(r1).toMatchObject({ ok: false, code: 429, retryable: true, waitMs: 3000, attempt: 1, maxTries: 3 });
    expect(r1.reason.label).toBe('Discord 側の制限');
    const r3 = await ok(G.sora, G.id, 'sendDiscordStep', { kind: 'test', attempt: 3 });
    expect(r3).toMatchObject({ ok: false, retryable: false, waitMs: 0 });
    expect(r3.result).toContain('打ち止め');
  });

  test('登録の知らせは GM と参加者をメンションし、募集中の卓は募集のチャンネルへ送る', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', members: ['ソラ'], date: T(3), status: '開催' });
    await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'こまち', status: '募集' });
    const posts = mockWebhook();
    await ok(G.admin, G.id, 'sendDiscordStep', { kind: 'change', verb: '登録', id: 'S001' });
    expect(posts[0]!.url).toBe(HOOK(1));
    expect(posts[0]!.content).toBe('🆕 卓の予定が登録されました（ひより）\n<@400000000000000010> <@400000000000000011>');
    await ok(G.admin, G.id, 'sendDiscordStep', { kind: 'change', verb: '登録', id: 'S002' });
    expect(posts[1]!.url).toBe(HOOK(2));
    expect(posts[1]!.content).toContain('🔗 参加希望は卓予定の「募集・調整」タブから: https://yoki.test/g/grp/');
  });

  test('参加確認を送ると、卓に「確認文を送りました」の日時が付く', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'こまち', status: '募集' });
    expect((await fail(G.admin, G.id, 'sendDiscordStep', { kind: 'ask', id: 'S001' })).error).toContain('興味ありの人がいません');
    await ok(G.sora, G.id, 'setInterest', { id: 'S001', name: 'ソラ', level: 'interest' });
    const posts = mockWebhook();
    const r = await ok(G.komachi, G.id, 'sendDiscordStep', { kind: 'ask', id: 'S001', message: 'ボイスありです' });
    expect(posts[0]!.content).toContain('に参加できそうですか？ <@400000000000000011>');
    expect(posts[0]!.content).toContain('💬 ボイスありです（こまち）');
    expect(r.asked).toMatch(/^\d{4}\/\d{2}\/\d{2}（.）/);
    expect(r.data.sessions[0].asked).toBe(r.asked);
  });

  test('今日が開催前の知らせの日の卓を案内すると、開催前の知らせ済みになる', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '明日の卓', gm: 'ひより', date: T(1), status: '開催' });
    mockWebhook();
    const r = await ok(G.admin, G.id, 'sendDiscordStep', { kind: 'announce', id: 'S001' });
    expect(r.notified).toBe(true);
    expect(r.data.sessions[0].notified).not.toBe('');
  });

  test('まとめての変更は、対象の卓それぞれの送り先へ（シリーズの専用チャンネルも）', async () => {
    await ok(G.admin, G.id, 'saveSeriesNotify', { series: '港', webhook: HOOK(3), alsoBase: false });
    await ok(G.admin, G.id, 'saveSession', { name: '港 #1', series: '港', gm: 'ひより', date: T(3), status: '開催' });
    await ok(G.admin, G.id, 'saveSession', { name: '単発', gm: 'ひより', date: T(4), status: '開催' });
    const r = await ok(G.admin, G.id, 'sendDiscordStep', { kind: 'bulk', names: ['港 #1', '単発'], ids: ['S001', 'S002'], label: '変更', to: 0 });
    expect(r.targetCount).toBe(2);
    expect(r.targetLabel).toBe('シリーズ「港」のチャンネル');
  });

  test('Webhook が無ければ断る', async () => {
    await ok(G.admin, G.id, 'saveConsoleSettings', { webhook: '', clearWebhook: true });
    expect((await fail(G.admin, G.id, 'sendDiscordStep', { kind: 'test' })).error).toContain('Webhook URL が空');
  });
});

describe('権限', () => {
  test('管理者だけの操作は、ただのメンバーには ADMIN: で断る', async () => {
    for (const fn of ['deleteSession', 'bulkUpdateSessions', 'deleteMember', 'setAdmin', 'saveConsoleSettings', 'saveSeriesNotify', 'renameGroup']) {
      const r = await fail(G.sora, G.id, fn, {});
      expect(r.status, fn).toBe(403);
      expect(r.error, fn).toMatch(/^ADMIN:/);
    }
  });

  test('知らない操作は 404。ほかのグループには入れない', async () => {
    expect((await fail(G.sora, G.id, 'login', {})).status).toBe(404);
    const other = await setupGroup('other');
    await env.DB.prepare("UPDATE groups SET guild_id = 'elsewhere' WHERE id = 'other'").run();
    expect((await fail(other.sora, 'other', 'getConsoleData')).status).toBe(403);
  });
});
