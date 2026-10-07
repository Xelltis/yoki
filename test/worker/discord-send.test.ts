// Discordへ送る: 1回の送信・失敗の種類分け・待つ時間・送り直し・いくつかの送り先
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Payload } from '../../src/worker/discord/payloads';
import { classifyFailure, discordAttempt, type LogTo, postDiscord, postToTargets, realSleep, SAMPLE_CHANNEL } from '../../src/worker/discord/send';
import type { Target } from '../../src/worker/discord/targets';
import { makeGroup } from './helpers';

const CH = (n: number) => '12345678901234567' + n;
const MESSAGES = (id: string) => 'https://discord.com/api/v10/channels/' + id + '/messages';
const AT = '2026-10-10T11:00:00.000Z';
const LOG: LogTo = { db: env.DB, groupId: 'g', token: env.DISCORD_BOT_TOKEN, now: () => new Date(AT) };
const P: Payload = { content: '📣 卓の案内: 港' };

beforeEach(async () => {
  await makeGroup('g', 'guild');
});
afterEach(() => vi.restoreAllMocks());

type Post = { method?: string; url: string; auth: string | null; type: string | null; body: unknown };

/** Discordの返事を差し替える。repliesを順に返し（Errorなら投げる）、尽きたら200。送った先・Authorization・本文を記録する */
function mockFetch(replies: (number | Response | Error)[] = []) {
  const posts: Post[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const h = new Headers(init?.headers);
    posts.push({ method: init?.method, url, auth: h.get('Authorization'), type: h.get('Content-Type'), body: JSON.parse(String(init?.body)) });
    const r = replies.shift() ?? 200;
    if (r instanceof Error) throw r;
    return typeof r === 'number' ? new Response(null, { status: r }) : r;
  });
  return posts;
}

const logs = async () =>
  (await env.DB.prepare("SELECT at, kind, target, result FROM notify_log WHERE group_id = 'g' ORDER BY id").all<{ at: string; kind: string; target: string; result: string }>()).results;
const results = async () => (await logs()).map((l) => l.result);

describe('失敗の種類分け', () => {
  test('HTTPの状態と、通信のエラーの文から分ける', () => {
    const kind = (code: number, err = '') => classifyFailure(code, err).kind;
    expect([429, 500, 503, 401, 403, 404, 400, 418].map((c) => kind(c))).toEqual(
      ['rate_limit', 'discord_down', 'discord_down', 'bad_bot', 'no_permission', 'no_channel', 'bad_payload', 'unknown'],
    );
    expect(kind(0, 'TypeError: Network connection lost')).toBe('network');
    expect(kind(0, 'Error: DNS lookup failed')).toBe('network');
    expect(kind(0, 'Error: could not resolve host')).toBe('network');
    expect(kind(0, 'Error: 何かおかしい')).toBe('unknown');
  });

  test('Botとチャンネルの問題は、送らなかったときとDiscordに断られたときで、説明を分ける', () => {
    expect(classifyFailure(401, '')).toMatchObject({ kind: 'bad_bot', label: 'Botの設定', text: 'YokiのBotのトークンが正しくありません。' });
    expect(classifyFailure(0, 'DiscordのBotが設定されていません')).toMatchObject({ kind: 'bad_bot', label: 'Botの設定', text: 'YokiのBotが設定されていません。' });
    expect(classifyFailure(403, '')).toMatchObject({ kind: 'no_permission', label: 'チャンネルの権限', text: 'Botがそのチャンネルを見られないか、書き込めません。' });
    expect(classifyFailure(404, '')).toMatchObject({ kind: 'no_channel', label: 'チャンネル', text: 'チャンネルが見つかりません（消されたか、Botがサーバーから外されています）。' });
    expect(classifyFailure(0, 'チャンネルのIDが正しくありません')).toMatchObject({ kind: 'no_channel', label: 'チャンネル', text: 'チャンネルのIDが正しくありません。' });
  });

  test('ツールの不具合かもしれないのは、本文を断られたときと原因不明のときだけ', () => {
    expect(classifyFailure(400, '')).toMatchObject({ label: '本文', toolFault: true });
    expect(classifyFailure(0, '')).toMatchObject({ label: '原因不明', toolFault: true });
    for (const [code, err] of [[429, ''], [500, ''], [401, ''], [403, ''], [404, ''], [0, 'timed out']] as const) expect(classifyFailure(code, err).toolFault).toBe(false);
  });
});

describe('1回だけ送る', () => {
  test('Botのトークンで、チャンネルにメッセージを書く。メンションは人だけにする', async () => {
    const posts = mockFetch([200]);
    const p: Payload = { content: '@everyone <@&123> <@400000000000000010>', embeds: [{ title: '港', description: 'd', color: 1, footer: { text: 'f' } }] };
    await discordAttempt(LOG, p, '案内', '港', 1, CH(1));
    expect(posts).toEqual([{ method: 'POST', url: MESSAGES(CH(1)), auth: 'Bot test-bot-token', type: 'application/json', body: { ...p, allowed_mentions: { parse: ['users'] } } }]);
  });

  test('送れたらOKと記録する。2回目以降なら何回目かも書く', async () => {
    const posts = mockFetch([200]);
    const r = await discordAttempt(LOG, P, '案内', '港', 2, CH(1));
    expect(r).toMatchObject({ ok: true, code: 200, retryable: false, waitMs: 0, reason: null, attempt: 2, maxTries: 3, result: 'OK (200)（2回目）' });
    expect(posts).toHaveLength(1);
    expect(await logs()).toEqual([{ at: AT, kind: '案内', target: '港', result: 'OK (200)（2回目）' }]);
  });

  test('チャンネルが空なら送らず、記録もしない', async () => {
    const posts = mockFetch();
    const r = await discordAttempt(LOG, P, '案内', '港', 1, '');
    expect(r).toMatchObject({ ok: false, code: 0, retryable: false, result: '送らず: 送り先のチャンネルが未設定', reason: null });
    expect(posts).toHaveLength(0);
    expect(await logs()).toEqual([]);
  });

  test('サンプルのグループのチャンネルには、送らずに届いたことにする（Botが無くても）', async () => {
    const posts = mockFetch();
    const r = await discordAttempt({ ...LOG, token: '' }, P, '接続テスト', '-', 1, SAMPLE_CHANNEL);
    expect(r).toMatchObject({ ok: true, code: 200 });
    expect(posts).toHaveLength(0);
    expect(await results()).toEqual(['OK (200)']);
  });

  test('Botのトークンが無ければ送らない。運営者に知らせるように書く', async () => {
    const posts = mockFetch();
    const r = await discordAttempt({ ...LOG, token: '' }, P, '案内', '港', 1, CH(1));
    expect(posts).toHaveLength(0);
    expect(r).toMatchObject({ ok: false, code: 0, retryable: false, raw: 'ERROR DiscordのBotが設定されていません' });
    expect(r.reason!.kind).toBe('bad_bot');
    expect(r.result).toBe('送信失敗（Botの設定）: ERROR DiscordのBotが設定されていません（1回目）　→ YokiのBotが設定されていません。Yokiを設置した運営者に知らせてください。　このツールの不具合ではありません。');
  });

  test('チャンネルのIDの形でないもの（前のWebhook URLなど）には送らない', async () => {
    const posts = mockFetch();
    for (const id of ['https://discord.com/api/webhooks/123456789012345678/x', '1234', '12345678901234567a']) {
      const r = await discordAttempt(LOG, P, '案内', '港', 1, id);
      expect(r, id).toMatchObject({ ok: false, code: 0, retryable: false, raw: 'ERROR チャンネルのIDが正しくありません' });
      expect(r.reason!.kind).toBe('no_channel');
    }
    expect(posts).toHaveLength(0);
    expect((await results())[0]).toBe('送信失敗（チャンネル）: ERROR チャンネルのIDが正しくありません（1回目）　→ チャンネルのIDが正しくありません。管理画面の「知らせ」でチャンネルを選び直して「接続テスト」を。　このツールの不具合ではありません。');
  });

  test('Botが書き込めない（403）・トークンが違う（401）なら送り直さない。直し方を書く', async () => {
    mockFetch([new Response('{"message": "Missing Access", "code": 50001}', { status: 403 }), 401]);
    const r1 = await discordAttempt(LOG, P, '案内', '港', 1, CH(1));
    expect(r1).toMatchObject({ ok: false, code: 403, retryable: false, waitMs: 0 });
    expect(r1.result).toBe(
      '送信失敗（チャンネルの権限）: HTTP 403 {"message": "Missing Access", "code": 50001}（1回目）　→ Botがそのチャンネルを見られないか、書き込めません。' +
      '管理画面の「知らせ」からBotをサーバーに招き、チャンネルの権限で「チャンネルを見る」「メッセージを送信」「埋め込みリンク」を許可してください。　このツールの不具合ではありません。',
    );
    const r2 = await discordAttempt(LOG, P, '案内', '港', 1, CH(1));
    expect(r2).toMatchObject({ ok: false, code: 401, retryable: false });
    expect(r2.result).toBe('送信失敗（Botの設定）: HTTP 401（1回目）　→ YokiのBotのトークンが正しくありません。Yokiを設置した運営者に知らせてください。　このツールの不具合ではありません。');
  });

  test('本文を断られたら（400）送り直さない。ツールの不具合かもしれないので、ツールのせいではないとは書かない', async () => {
    mockFetch([new Response('{"message": "Invalid Form Body"}', { status: 400 })]);
    const r = await discordAttempt(LOG, P, '案内', '港', 1, CH(1));
    expect(r).toMatchObject({ ok: false, code: 400, retryable: false, waitMs: 0, raw: 'HTTP 400 {"message": "Invalid Form Body"}' });
    expect(r.result).toBe(
      '送信失敗（本文）: HTTP 400 {"message": "Invalid Form Body"}（1回目）　→ Discordが本文を受け付けませんでした。' +
      '卓名やメモが極端に長くないか確かめてください。直らなければツール側の問題かもしれないので、送信記録の詳細を添えて知らせてください。',
    );
  });

  test('通信が切れたら（名前を引けないときも）送り直す。原因の分からないエラーは送り直さない', async () => {
    mockFetch([new Error('could not resolve host'), new TypeError('Network connection lost'), new Error('何かおかしい')]);
    const r0 = await discordAttempt(LOG, P, '案内', '港', 1, CH(1));
    expect(r0).toMatchObject({ ok: false, retryable: true, waitMs: 3000 });
    expect(r0.reason!.kind).toBe('network');
    const r1 = await discordAttempt(LOG, P, '案内', '港', 1, CH(1));
    expect(r1).toMatchObject({ ok: false, code: 0, retryable: true, waitMs: 3000, raw: 'ERROR TypeError: Network connection lost' });
    expect(r1.reason!.kind).toBe('network');
    expect(r1.result).toBe('ERROR TypeError: Network connection lost（1回目、3秒後に送り直し）');
    const r2 = await discordAttempt(LOG, P, '案内', '港', 1, CH(1));
    expect(r2).toMatchObject({ ok: false, retryable: false, waitMs: 0 });
    expect(r2.result).toBe('送信失敗（原因不明）: ERROR Error: 何かおかしい（1回目）　→ 原因を判別できませんでした。送信記録の詳細を添えて知らせてください。');
  });

  test('待つ時間はRetry-After（秒）を見る。読めなければ本文のretry_after（100を超えればミリ秒）。15秒までにする', async () => {
    mockFetch([
      new Response(null, { status: 429, headers: { 'Retry-After': '12' } }),
      new Response(null, { status: 429, headers: { 'Retry-After': '60' } }),
      new Response('{"retry_after": 9.5}', { status: 429, headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' } }),
      new Response('{"retry_after": 9000}', { status: 429 }),
      new Response('{"retry_after": 1.5}', { status: 429 }),
      new Response('{"message": "You are being rate limited.", "global": false}', { status: 429 }),
      new Response('Service Unavailable', { status: 503 }),
    ]);
    const waits: number[] = [];
    for (const attempt of [1, 1, 1, 1, 1, 1, 2]) waits.push((await discordAttempt(LOG, P, '案内', '港', attempt, CH(1))).waitMs);
    // 短すぎる値や、待つ時間の書いていない返事は、決まった待ち時間（1回目のあと3秒、2回目のあと8秒）まで延ばす
    expect(waits).toEqual([12000, 15000, 9500, 9000, 3000, 3000, 8000]);
    expect((await results())[6]).toBe('HTTP 503 Service Unavailable（2回目、8秒後に送り直し）');
  });

  test('何回目かは1〜3に丸める。3回目は打ち止め。Discord側の問題なら、ツールの不具合ではないと書く', async () => {
    mockFetch([500, 404]);
    expect(await discordAttempt(LOG, P, '案内', '港', 0, CH(1))).toMatchObject({ attempt: 1, retryable: true, waitMs: 3000 });
    const r = await discordAttempt(LOG, P, '案内', '港', 9, CH(1));
    expect(r).toMatchObject({ attempt: 3, retryable: false });
    expect(r.result).toBe(
      '送信失敗（チャンネル）: HTTP 404（3回目、打ち止め）　→ チャンネルが見つかりません（消されたか、Botがサーバーから外されています）。管理画面の「知らせ」でチャンネルを選び直して「接続テスト」を。　このツールの不具合ではありません。',
    );
  });
});

describe('送り直しも含めて送る', () => {
  test('429と5xxは待って送り直す。届いたらそこで止める', async () => {
    const posts = mockFetch([429, 502, 200]);
    const sleeps: number[] = [];
    expect(await postDiscord(LOG, P, '案内', '港', CH(1), async (ms) => { sleeps.push(ms); })).toBe(true);
    expect(posts.map((p) => p.url)).toEqual([MESSAGES(CH(1)), MESSAGES(CH(1)), MESSAGES(CH(1))]);
    expect(sleeps).toEqual([3000, 8000]);
    expect(await results()).toEqual(['HTTP 429（1回目、3秒後に送り直し）', 'HTTP 502（2回目、8秒後に送り直し）', 'OK (200)（3回目）']);
  });

  test('3回とも失敗したら諦める。送り直さない失敗なら1回で止める', async () => {
    const posts = mockFetch([500, 500, 500, 403]);
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    expect(await postDiscord(LOG, P, '案内', '港', CH(1), sleep)).toBe(false);
    expect(posts).toHaveLength(3);
    expect(sleeps).toEqual([3000, 8000]);
    expect(await postDiscord(LOG, P, '案内', '港', CH(1), sleep)).toBe(false);
    expect(posts).toHaveLength(4);
    expect(sleeps).toHaveLength(2);
  });

  test('Botが無いときは、送り直さずに1回だけ記録する', async () => {
    const posts = mockFetch();
    const sleeps: number[] = [];
    expect(await postDiscord({ ...LOG, token: '' }, P, '案内', '港', CH(1), async (ms) => { sleeps.push(ms); })).toBe(false);
    expect(posts).toHaveLength(0);
    expect(sleeps).toEqual([]);
    expect(await results()).toHaveLength(1);
  });

  test('待ち方を渡さなければ、setTimeoutで本当に待つ。日時を渡さなければ今の日時で記録する', async () => {
    mockFetch();
    const before = Date.now();
    expect(await postDiscord({ db: env.DB, groupId: 'g', token: 't' }, P, '案内', '港', CH(1))).toBe(true);
    const at = Date.parse((await logs())[0]!.at);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
    const timer = vi.spyOn(globalThis, 'setTimeout');
    await realSleep(5);
    expect(timer).toHaveBeenCalledWith(expect.any(Function), 5);
  });
});

describe('いくつかの送り先へ', () => {
  const series: Target = { channelId: CH(3), label: 'シリーズ「港」のチャンネル', series: '港' };
  const recruit: Target = { channelId: CH(2), label: '募集のチャンネル', series: '', kind: 'recruit' };
  const base: Target = { channelId: CH(1), label: '基本のチャンネル', series: '' };

  test('1か所でも届かなければfalse。残りの送り先にも送る。記録の対象に送り先を添える', async () => {
    const posts = mockFetch([404, 200, 200]);
    expect(await postToTargets(LOG, P, '案内', '港 #1', [series, recruit, base], async () => {})).toBe(false);
    expect(posts.map((p) => p.url)).toEqual([MESSAGES(CH(3)), MESSAGES(CH(2)), MESSAGES(CH(1))]);
    expect((await logs()).map((l) => l.target)).toEqual(['港 #1（シリーズ「港」のチャンネル）', '港 #1（募集のチャンネル）', '港 #1']);
  });

  test('すべて届けばtrue。送り先が無ければfalse', async () => {
    mockFetch();
    expect(await postToTargets(LOG, P, '案内', '港', [series, base])).toBe(true);
    expect(await postToTargets(LOG, P, '案内', '港', [])).toBe(false);
  });
});
