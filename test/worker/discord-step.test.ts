// 画面から1回ずつ送るDiscord（sendDiscordStep）。知らせの種類ごとの文と送り先、断るとき
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { addDays, fmtDateJa } from '../../src/worker/lib/jst';
import { fail, GUILD, ok, setupGroup, today } from './helpers';

const CH = (n: number) => '12345678901234567' + n;
const ID = { ひより: '<@400000000000000010>', ソラ: '<@400000000000000011>', こまち: '<@400000000000000012>' };

type Call = { method: string; url: string; auth: string | null; body: Record<string, any> | null };

/**
 * DiscordのAPI（Bot）の返事を差し替える。チャンネルを読むと、このグループのサーバーのテキストチャンネルとして返す。
 * メッセージを送ると、いつも200。呼んだ先・Authorization・本文を記録する
 */
function mockBot() {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    calls.push({ method, url, auth: new Headers(init?.headers).get('Authorization'), body: init?.body ? JSON.parse(String(init.body)) : null });
    const id = url.split('/')[6]!;
    if (method === 'GET') return Response.json({ id, name: 'ch' + id.slice(-1), type: 0, guild_id: GUILD });
    return Response.json({ id: '900000000000000001', channel_id: id });
  });
  /** 送ったメッセージ（送り先のチャンネル・本文・埋め込みの数） */
  const posts = () => calls.filter((c) => c.method === 'POST').map((c) => ({ channel: c.url.split('/')[6], content: c.body!.content, embeds: (c.body!.embeds ?? []).length }));
  return { calls, posts };
}

let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
let bot: ReturnType<typeof mockBot>;
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
  bot = mockBot();
  // 基本のチャンネルと募集のチャンネル
  await ok(G.admin, G.id, 'saveConsoleSettings', { channelId: CH(1), kindChannel: { kind: 'recruit', channelId: CH(2) } });
});
afterEach(() => vi.restoreAllMocks());

/** 最後の送信記録 */
const lastLog = () => env.DB.prepare('SELECT kind, target, result FROM notify_log ORDER BY id DESC').first<{ kind: string; target: string; result: string }>();

const send = (sid: string, form: Record<string, unknown>) => ok(sid, G.id, 'sendDiscordStep', form);
const refuse = async (form: Record<string, unknown>) => (await fail(G.admin, G.id, 'sendDiscordStep', form)).error;

describe('接続テスト', () => {
  test('基本のチャンネルへ、YokiのBotで送る。メンションは人だけにする', async () => {
    const r = await send(G.sora, { kind: 'test', attempt: 1 });
    expect(r).toMatchObject({ ok: true, code: 200, result: 'OK (200)', to: 0, targetCount: 1, targetLabel: '基本のチャンネル' });
    expect(bot.calls.at(-1)).toEqual({
      method: 'POST',
      url: 'https://discord.com/api/v10/channels/' + CH(1) + '/messages',
      auth: 'Bot test-bot-token',
      body: { content: '✅ Yokiから接続テスト（テストの卓）', allowed_mentions: { parse: ['users'] } },
    });
    expect(await lastLog()).toEqual({ kind: '接続テスト', target: '-', result: 'OK (200)' });
  });

  test('シリーズを選べば、そのシリーズのチャンネルだけへ送る。専用のチャンネルが無ければ断る', async () => {
    await ok(G.admin, G.id, 'saveSeriesNotify', { series: '港', channelId: CH(3), alsoBase: true });
    await ok(G.admin, G.id, 'saveSeriesNotify', { series: '迷宮', days: '2' });
    const r = await send(G.sora, { kind: 'test', series: '港' });
    expect(r).toMatchObject({ ok: true, targetCount: 1, targetLabel: 'シリーズ「港」のチャンネル' });
    expect(bot.posts()).toEqual([{ channel: CH(3), content: '✅ Yokiから接続テスト（テストの卓 / シリーズ「港」）', embeds: 0 }]);
    expect(await lastLog()).toEqual({ kind: '接続テスト', target: '-（シリーズ「港」のチャンネル）', result: 'OK (200)' });
    expect(await refuse({ kind: 'test', series: '古城' })).toBe('シリーズ「古城」には専用のチャンネルがありません。');
    // 日時だけ変えたシリーズにも、専用のチャンネルは無い
    expect(await refuse({ kind: 'test', series: '迷宮' })).toBe('シリーズ「迷宮」には専用のチャンネルがありません。');
  });

  test('知らせの種類のチャンネルを選べば、そこへ送る。そのチャンネルが無ければ断る（基本のチャンネルへは回さない）', async () => {
    const r = await send(G.sora, { kind: 'test', channel: 'recruit' });
    expect(r.targetLabel).toBe('募集のチャンネル');
    expect(bot.posts()[0]).toEqual({ channel: CH(2), content: '✅ Yokiから接続テスト（テストの卓 / 募集のチャンネル）', embeds: 0 });
    expect((await lastLog())!.target).toBe('-（募集のチャンネル）');
    expect(await refuse({ kind: 'test', channel: 'remind' })).toBe('開催前の知らせのチャンネルが決まっていません。');

    await ok(G.admin, G.id, 'saveConsoleSettings', { kindChannel: { kind: 'remind', channelId: CH(4) } });
    await send(G.sora, { kind: 'test', channel: 'remind' });
    expect(bot.posts()[1]).toEqual({ channel: CH(4), content: '✅ Yokiから接続テスト（テストの卓 / 開催前の知らせのチャンネル）', embeds: 0 });

    await ok(G.admin, G.id, 'saveConsoleSettings', { channelId: '', kindChannel: { kind: 'recruit', channelId: '' } });
    expect(await refuse({ kind: 'test', channel: 'recruit' })).toBe('募集のチャンネルが決まっていません。');
    expect(await refuse({ kind: 'test' })).toBe('送り先のチャンネルが決まっていません。管理画面の「知らせ」でチャンネルを選んでから送ってください。');
  });

  test('送り先が2か所なら、toで1か所ずつ送る。範囲の外のtoは端に寄せる', async () => {
    await ok(G.admin, G.id, 'saveSeriesNotify', { series: '港', channelId: CH(3), alsoBase: true });
    await ok(G.admin, G.id, 'saveSession', { name: '港 #1', series: '港', gm: 'ひより', date: T(3), status: '開催' });
    const r0 = await send(G.admin, { kind: 'announce', id: 'S001', to: 0 });
    expect(r0).toMatchObject({ to: 0, targetCount: 2, targetLabel: 'シリーズ「港」のチャンネル' });
    const r1 = await send(G.admin, { kind: 'announce', id: 'S001', to: 9, attempt: 2 });
    expect(r1).toMatchObject({ to: 1, targetCount: 2, targetLabel: '基本のチャンネル', attempt: 2, result: 'OK (200)（2回目）' });
    expect((await send(G.admin, { kind: 'announce', id: 'S001', to: -1 })).to).toBe(0);
    expect(bot.posts().map((p) => p.channel)).toEqual([CH(3), CH(1), CH(3)]);
  });
});

describe('卓の知らせ', () => {
  test('変更の知らせは、メンションせずに卓の埋め込みを付ける', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', members: ['ソラ'], date: T(3), status: '開催' });
    await send(G.admin, { kind: 'change', verb: '変更', id: 'S001' });
    expect(bot.posts()).toEqual([{ channel: CH(1), content: '✏️ 卓の予定が変更されました（ひより）', embeds: 1 }]);
    expect(await lastLog()).toMatchObject({ kind: '変更通知', target: '港' });
  });

  test('削除の知らせは、消した卓の名前・状態・シリーズから送り先を選ぶ', async () => {
    await ok(G.admin, G.id, 'saveSeriesNotify', { series: '港', channelId: CH(3), alsoBase: false });
    expect(await refuse({ kind: 'delete' })).toBe('消した卓の名前がありません。');
    await send(G.admin, { kind: 'delete', name: '古城', status: '募集' });
    expect(bot.posts()[0]).toEqual({ channel: CH(2), content: '🗑️ 卓の予定が削除されました（ひより）：古城', embeds: 0 });
    expect(await lastLog()).toMatchObject({ kind: '削除通知', target: '古城（募集のチャンネル）' });
    await send(G.admin, { kind: 'delete', name: '港 #1', series: '港', status: '開催' });
    await send(G.admin, { kind: 'delete', name: '単発', status: '開催' });
    expect(bot.posts().slice(1).map((p) => p.channel)).toEqual([CH(3), CH(1)]);
    // 卓を消せるのは管理者だけなので、削除の知らせも管理者だけ
    expect((await fail(G.sora, G.id, 'sendDiscordStep', { kind: 'delete', name: '偽の卓', status: '開催' })).error).toBe('ADMIN: 卓の削除の知らせができるのは管理者だけです。');
    expect(bot.posts()).toHaveLength(3);
  });

  test('参加確認は、募集中の卓に、500文字までの一言でだけ送る', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', date: T(3), status: '開催' });
    await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'こまち', status: '募集' });
    await ok(G.sora, G.id, 'setInterest', { id: 'S002', name: 'ソラ', level: 'interest' });
    expect(await refuse({ kind: 'ask', id: 'S001' })).toBe('「港」は募集中ではありません（開催）。');
    expect(await refuse({ kind: 'ask', id: 'S002', message: 'あ'.repeat(501) })).toBe('添える一言は500文字までです。');
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

  test('始めた知らせはGMと参加者を呼ぶ。回答がそろった知らせはGMだけを呼ぶ', async () => {
    // 出したGM（ひより）の候補日には ◯ が付く
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5), T(6)], start: '20:00', end: '23:00' });
    await send(G.admin, { kind: 'poll', id: 'S001' });
    expect(bot.posts()[0]!.content).toBe(
      '🗓️ 「迷宮」の日程を決めます。' + ID.ひより + ' ' + ID.ソラ + '\n' +
      '候補日: ' + fmtDateJa(T(5)) + '、' + fmtDateJa(T(6)) + '　20:00〜23:00\n' +
      'Yokiの「募集・調整」タブで、候補日ごとに ◯ か × を押してください。全員の回答がそろったら、GMが開催日を選びます。　by ひより\nhttps://yoki.test/g/grp/',
    );
    expect(await lastLog()).toMatchObject({ kind: '日程調整', target: '迷宮' });

    await send(G.sora, { kind: 'pollReady', id: 'S001' });
    const ready = bot.posts()[1]!;
    expect(ready.content.split('\n')).toEqual([
      '📝 「迷宮」の日程調整の回答がそろいました。' + ID.ひより,
      '・' + fmtDateJa(T(5)) + '　◯ 1/2',
      '・' + fmtDateJa(T(6)) + '　◯ 1/2',
      'Yokiの「募集・調整」タブで、開催日を選んでください。',
      'https://yoki.test/g/grp/',
    ]);
    expect(ready.embeds).toBe(0);
    expect(await lastLog()).toMatchObject({ kind: '回答そろい', target: '迷宮' });
  });

  test('日程が決まった知らせは、開催日のある卓にだけ送る', async () => {
    expect(await refuse({ kind: 'decided', id: 'S001' })).toBe('「迷宮」の開催日がまだ決まっていません。');
    await send(G.admin, { kind: 'decided', id: 'S002' });
    expect(bot.posts()[0]).toEqual({
      channel: CH(1),
      content: '✅ 「港」の日程が決まりました: ' + fmtDateJa(T(3)) + ' 時間未定\n' + ID.ひより + '\n🔗 Yoki: https://yoki.test/g/grp/',
      embeds: 1,
    });
    expect(await lastLog()).toMatchObject({ kind: '日程決定', target: '港' });
  });
});

describe('まとめての変更', () => {
  test('複数日の登録は、その回のGMと参加者をメンションする。同じ送り先は1つにまとめる', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '港 #1', gm: 'ひより', members: ['ソラ'], date: T(3), status: '開催' });
    await ok(G.admin, G.id, 'saveSession', { name: '港 #2', gm: 'こまち', date: T(10), status: '開催' });
    const r = await send(G.admin, { kind: 'bulk', names: ['港 #1', '港 #2'], ids: ['S001', 'S002'], label: '登録' });
    expect(r.targetCount).toBe(1);
    expect(bot.posts()).toEqual([{ channel: CH(1), content: '🔁 卓の予定を一括で登録（ひより）\n・港 #1\n・港 #2\n' + ID.ひより + ' ' + ID.ソラ + ' ' + ID.こまち, embeds: 0 }]);
    expect(await lastLog()).toMatchObject({ kind: '一括変更', target: '港 #1、港 #2' });
  });

  test('卓が分からなければ、シリーズか基本のチャンネルへ。対象の名前が無ければ断る', async () => {
    await ok(G.admin, G.id, 'saveSeriesNotify', { series: '港', channelId: CH(3), alsoBase: false });
    expect(await refuse({ kind: 'bulk', names: [] })).toBe('対象の卓がありません。');
    await send(G.admin, { kind: 'bulk', names: ['港 #9'], series: '港' });
    expect(bot.posts()).toEqual([{ channel: CH(3), content: '🔁 卓の予定を一括で変更（ひより）\n・港 #9', embeds: 0 }]);
  });

  test('管理者でない人は、画面の名前と見出しを使えない。送った卓のIDから名前を引き、「登録」として送る', async () => {
    await ok(G.sora, G.id, 'saveSession', { name: '港 #1', gm: 'ソラ', date: T(3), status: '開催' });
    await send(G.sora, { kind: 'bulk', names: ['<@400000000000000099> 偽の知らせ'], ids: ['S001'], label: '全員集合' });
    expect(bot.posts()).toEqual([{ channel: CH(1), content: '🔁 卓の予定を一括で登録（ソラ）\n・港 #1\n' + ID.ソラ, embeds: 0 }]);
    // 卓が無ければ送らない
    expect((await fail(G.sora, G.id, 'sendDiscordStep', { kind: 'bulk', names: ['偽'], ids: ['S999'] })).error).toBe('対象の卓がありません。');
  });

  test('管理者が送る名前と見出しも、1行にしてメンションにならない形にする', async () => {
    await send(G.admin, { kind: 'bulk', names: ['<@400000000000000011>\n@everyone 港'], label: '@here 状態を「中止」に' });
    expect(bot.posts()[0]!.content).toBe('🔁 卓の予定を一括で@\u200bhere 状態を「中止」に（ひより）\n・<@\u200b400000000000000011> @\u200beveryone 港');
  });
});

test('知らない種類は断る', async () => {
  expect(await refuse({ kind: '謎' })).toBe('送る種類が不正です: 謎');
});
