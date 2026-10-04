// 画面から 1 回ずつ送る Discord（sendDiscordStep）。知らせの種類ごとの文と送り先、断るとき
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { addDays, fmtDateJa } from '../../src/worker/lib/jst';
import { fail, ok, setupGroup, today } from './helpers';

let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
  // 基本のチャンネルと募集のチャンネル
  await ok(G.admin, G.id, 'saveConsoleSettings', { webhook: HOOK(1), kindWebhook: { kind: 'recruit', url: HOOK(2) } });
});
afterEach(() => vi.restoreAllMocks());

const HOOK = (n: number) => 'https://discord.com/api/webhooks/12345678901234567' + n + '/token' + n;
const ID = { ひより: '<@400000000000000010>', ソラ: '<@400000000000000011>', こまち: '<@400000000000000012>' };

/** Discord の Webhook の返事を差し替える（いつも 204）。送った先・本文・埋め込みの数を記録する */
function mockWebhook() {
  const posts: { url: string; content: string; embeds: number }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(String(init?.body));
    posts.push({ url, content: body.content, embeds: (body.embeds ?? []).length });
    return new Response(null, { status: 204 });
  });
  return posts;
}

/** 最後の送信記録 */
const lastLog = () => env.DB.prepare('SELECT kind, target, result FROM notify_log ORDER BY id DESC').first<{ kind: string; target: string; result: string }>();

const send = (sid: string, form: Record<string, unknown>) => ok(sid, G.id, 'sendDiscordStep', form);
const refuse = async (form: Record<string, unknown>) => (await fail(G.admin, G.id, 'sendDiscordStep', form)).error;

describe('接続テスト', () => {
  test('シリーズを選べば、そのシリーズのチャンネルだけへ送る。専用の Webhook が無ければ断る', async () => {
    await ok(G.admin, G.id, 'saveSeriesNotify', { series: '港', webhook: HOOK(3), alsoBase: true });
    await ok(G.admin, G.id, 'saveSeriesNotify', { series: '迷宮', days: '2' });
    const posts = mockWebhook();
    const r = await send(G.sora, { kind: 'test', series: '港' });
    expect(r).toMatchObject({ ok: true, targetCount: 1, targetLabel: 'シリーズ「港」のチャンネル' });
    expect(posts).toEqual([{ url: HOOK(3), content: '✅ 卓予定管理から接続テスト（テストの卓 / シリーズ「港」）', embeds: 0 }]);
    expect(await lastLog()).toEqual({ kind: '接続テスト', target: '-（シリーズ「港」のチャンネル）', result: 'OK (204)' });
    expect(await refuse({ kind: 'test', series: '古城' })).toBe('シリーズ「古城」には専用の Webhook URL がありません。');
    // 日時だけ変えたシリーズにも、専用のチャンネルは無い
    expect(await refuse({ kind: 'test', series: '迷宮' })).toBe('シリーズ「迷宮」には専用の Webhook URL がありません。');
  });

  test('知らせの種類のチャンネルを選べば、そこへ送る。そのチャンネルが無ければ断る（基本のチャンネルへは回さない）', async () => {
    const posts = mockWebhook();
    const r = await send(G.sora, { kind: 'test', channel: 'recruit' });
    expect(r.targetLabel).toBe('募集のチャンネル');
    expect(posts[0]).toEqual({ url: HOOK(2), content: '✅ 卓予定管理から接続テスト（テストの卓 / 募集のチャンネル）', embeds: 0 });
    expect((await lastLog())!.target).toBe('-（募集のチャンネル）');
    expect(await refuse({ kind: 'test', channel: 'remind' })).toBe('開催前の知らせのチャンネルの Webhook URL がありません。');

    await ok(G.admin, G.id, 'saveConsoleSettings', { kindWebhook: { kind: 'remind', url: HOOK(4) } });
    await send(G.sora, { kind: 'test', channel: 'remind' });
    expect(posts[1]).toEqual({ url: HOOK(4), content: '✅ 卓予定管理から接続テスト（テストの卓 / 開催前の知らせのチャンネル）', embeds: 0 });

    await ok(G.admin, G.id, 'saveConsoleSettings', { webhook: '', clearWebhook: true, kindWebhook: { kind: 'recruit', clear: true } });
    expect(await refuse({ kind: 'test', channel: 'recruit' })).toBe('募集のチャンネルの Webhook URL がありません。');
  });
});

describe('卓の知らせ', () => {
  test('変更の知らせは、メンションせずに卓の埋め込みを付ける', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', members: ['ソラ'], date: T(3), status: '開催' });
    const posts = mockWebhook();
    await send(G.admin, { kind: 'change', verb: '変更', id: 'S001' });
    expect(posts).toEqual([{ url: HOOK(1), content: '✏️ 卓の予定が変更されました（ひより）', embeds: 1 }]);
    expect(await lastLog()).toMatchObject({ kind: '変更通知', target: '港' });
  });

  test('削除の知らせは、消した卓の名前・状態・シリーズから送り先を選ぶ', async () => {
    await ok(G.admin, G.id, 'saveSeriesNotify', { series: '港', webhook: HOOK(3), alsoBase: false });
    expect(await refuse({ kind: 'delete' })).toBe('消した卓の名前がありません。');
    const posts = mockWebhook();
    await send(G.admin, { kind: 'delete', name: '古城', status: '募集' });
    expect(posts[0]).toEqual({ url: HOOK(2), content: '🗑️ 卓の予定が削除されました（ひより）：古城', embeds: 0 });
    expect(await lastLog()).toMatchObject({ kind: '削除通知', target: '古城（募集のチャンネル）' });
    await send(G.admin, { kind: 'delete', name: '港 #1', series: '港', status: '開催' });
    await send(G.admin, { kind: 'delete', name: '単発', status: '開催' });
    expect(posts.slice(1).map((p) => p.url)).toEqual([HOOK(3), HOOK(1)]);
  });

  test('参加確認は、募集中の卓に、500 文字までの一言でだけ送る', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', date: T(3), status: '開催' });
    await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'こまち', status: '募集' });
    await ok(G.sora, G.id, 'setInterest', { id: 'S002', name: 'ソラ', level: 'interest' });
    expect(await refuse({ kind: 'ask', id: 'S001' })).toBe('「港」は募集中ではありません（開催）。');
    expect(await refuse({ kind: 'ask', id: 'S002', message: 'あ'.repeat(501) })).toBe('添える一言は 500 文字までです。');
  });
});

describe('日程調整の知らせ', () => {
  beforeEach(async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', members: ['ソラ'], status: '調整中' });
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', date: T(3), status: '開催' });
  });

  test('候補日を出していない卓や、調整中でない卓には送らない', async () => {
    expect(await refuse({ kind: 'poll', id: 'S001' })).toBe('「迷宮」は日程調整をしていません。');
    expect(await refuse({ kind: 'pollReady', id: 'S002' })).toBe('「港」は日程調整をしていません。');
  });

  test('始めた知らせは GM と参加者を呼ぶ。回答がそろった知らせは GM だけを呼ぶ', async () => {
    // 出した GM（ひより）の候補日には ◯ が付く
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5), T(6)], start: '20:00', end: '23:00' });
    const posts = mockWebhook();
    await send(G.admin, { kind: 'poll', id: 'S001' });
    expect(posts[0]!.content).toBe(
      '🗓️ 「迷宮」の日程を決めます。' + ID.ひより + ' ' + ID.ソラ + '\n' +
      '候補日: ' + fmtDateJa(T(5)) + '、' + fmtDateJa(T(6)) + '　20:00〜23:00\n' +
      '卓予定の「募集・調整」タブで、候補日ごとに ◯ か × を押してください。全員の回答がそろったら、GM が開催日を選びます。　by ひより\nhttps://yoki.test/g/grp/',
    );
    expect(await lastLog()).toMatchObject({ kind: '日程調整', target: '迷宮' });

    await send(G.sora, { kind: 'pollReady', id: 'S001' });
    expect(posts[1]!.content.split('\n')).toEqual([
      '📝 「迷宮」の日程調整の回答がそろいました。' + ID.ひより,
      '・' + fmtDateJa(T(5)) + '　◯ 1/2',
      '・' + fmtDateJa(T(6)) + '　◯ 1/2',
      '卓予定の「募集・調整」タブで、開催日を選んでください。',
      'https://yoki.test/g/grp/',
    ]);
    expect(posts[1]!.embeds).toBe(0);
    expect(await lastLog()).toMatchObject({ kind: '回答そろい', target: '迷宮' });
  });

  test('日程が決まった知らせは、開催日のある卓にだけ送る', async () => {
    expect(await refuse({ kind: 'decided', id: 'S001' })).toBe('「迷宮」の開催日がまだ決まっていません。');
    const posts = mockWebhook();
    await send(G.admin, { kind: 'decided', id: 'S002' });
    expect(posts[0]).toEqual({
      url: HOOK(1),
      content: '✅ 「港」の日程が決まりました: ' + fmtDateJa(T(3)) + ' 時間未定\n' + ID.ひより + '\n🔗 卓予定: https://yoki.test/g/grp/',
      embeds: 1,
    });
    expect(await lastLog()).toMatchObject({ kind: '日程決定', target: '港' });
  });
});

describe('まとめての変更', () => {
  test('複数日の登録は、その回の GM と参加者をメンションする。同じ送り先は 1 つにまとめる', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '港 #1', gm: 'ひより', members: ['ソラ'], date: T(3), status: '開催' });
    await ok(G.admin, G.id, 'saveSession', { name: '港 #2', gm: 'こまち', date: T(10), status: '開催' });
    const posts = mockWebhook();
    const r = await send(G.admin, { kind: 'bulk', names: ['港 #1', '港 #2'], ids: ['S001', 'S002'], label: '登録' });
    expect(r.targetCount).toBe(1);
    expect(posts).toEqual([{ url: HOOK(1), content: '🔁 卓の予定を一括で登録（ひより）\n・港 #1\n・港 #2\n' + ID.ひより + ' ' + ID.ソラ + ' ' + ID.こまち, embeds: 0 }]);
    expect(await lastLog()).toMatchObject({ kind: '一括変更', target: '港 #1、港 #2' });
  });

  test('卓が分からなければ、シリーズか基本のチャンネルへ。対象の名前が無ければ断る', async () => {
    await ok(G.admin, G.id, 'saveSeriesNotify', { series: '港', webhook: HOOK(3), alsoBase: false });
    expect(await refuse({ kind: 'bulk', names: [] })).toBe('対象の卓がありません。');
    const posts = mockWebhook();
    await send(G.admin, { kind: 'bulk', names: ['港 #9'], series: '港' });
    expect(posts).toEqual([{ url: HOOK(3), content: '🔁 卓の予定を一括で変更（ひより）\n・港 #9', embeds: 0 }]);
  });
});

test('知らない種類は断る', async () => {
  expect(await refuse({ kind: '謎' })).toBe('送る種類が不正です: 謎');
});
