// Discord へ送る: 1 回の送信・失敗の種類分け・待つ時間・送り直し・いくつかの送り先
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Payload } from '../../src/worker/discord/payloads';
import { classifyFailure, discordAttempt, type LogTo, postDiscord, postToTargets, realSleep, SAMPLE_WEBHOOK } from '../../src/worker/discord/send';
import type { Target } from '../../src/worker/discord/targets';
import { makeGroup } from './helpers';

const HOOK = 'https://discord.com/api/webhooks/123456789012345678/base';
const SERIES_HOOK = 'https://discord.com/api/webhooks/123456789012345679/series';
const AT = '2026-10-10T11:00:00.000Z';
const LOG: LogTo = { db: env.DB, groupId: 'g', now: () => new Date(AT) };
const P: Payload = { content: '📣 卓の案内: 港' };

beforeEach(async () => {
  await makeGroup('g', 'guild');
});
afterEach(() => vi.restoreAllMocks());

/** Discord の返事を差し替える。replies を順に返し（Error なら投げる）、尽きたら 204。送った先と本文を記録する */
function mockFetch(replies: (number | Response | Error)[] = []) {
  const posts: { url: string; method?: string; body: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    posts.push({ url, method: init?.method, body: JSON.parse(String(init?.body)) });
    const r = replies.shift() ?? 204;
    if (r instanceof Error) throw r;
    return typeof r === 'number' ? new Response(null, { status: r }) : r;
  });
  return posts;
}

const logs = async () =>
  (await env.DB.prepare("SELECT at, kind, target, result FROM notify_log WHERE group_id = 'g' ORDER BY id").all<{ at: string; kind: string; target: string; result: string }>()).results;
const results = async () => (await logs()).map((l) => l.result);

describe('失敗の種類分け', () => {
  test('HTTP の状態と、通信のエラーの文から分ける', () => {
    const kind = (code: number, err = '') => classifyFailure(code, err).kind;
    expect([429, 500, 503, 401, 403, 404, 400, 418].map((c) => kind(c))).toEqual(
      ['rate_limit', 'discord_down', 'discord_down', 'bad_url', 'bad_url', 'bad_url', 'bad_payload', 'unknown'],
    );
    expect(kind(0, 'TypeError: Network connection lost')).toBe('network');
    expect(kind(0, 'Error: DNS lookup failed')).toBe('network');
    expect(kind(0, 'Error: could not resolve host')).toBe('network');
    expect(kind(0, 'Error: 何かおかしい')).toBe('unknown');
    // Discord の形でない URL は、URL の問題として出す（ツールの不具合ではない）
    expect(classifyFailure(0, 'Discord の Webhook URL ではありません')).toMatchObject({ kind: 'bad_url', toolFault: false, text: 'Webhook URL が Discord のものではありません。' });
  });

  test('ツールの不具合かもしれないのは、本文を断られたときと原因不明のときだけ', () => {
    expect(classifyFailure(400, '')).toMatchObject({ label: '本文', toolFault: true });
    expect(classifyFailure(0, '')).toMatchObject({ label: '原因不明', toolFault: true });
    for (const [code, err] of [[429, ''], [500, ''], [404, ''], [0, 'timed out']] as const) expect(classifyFailure(code, err).toolFault).toBe(false);
  });
});

describe('1 回だけ送る', () => {
  test('送れたら OK と記録する。2 回目以降なら何回目かも書く', async () => {
    const posts = mockFetch([204]);
    const r = await discordAttempt(LOG, P, '案内', '港', 2, HOOK);
    expect(r).toMatchObject({ ok: true, code: 204, retryable: false, waitMs: 0, reason: null, attempt: 2, maxTries: 3, result: 'OK (204)（2 回目）' });
    expect(posts).toEqual([{ url: HOOK, method: 'POST', body: P }]);
    expect(await logs()).toEqual([{ at: AT, kind: '案内', target: '港', result: 'OK (204)（2 回目）' }]);
  });

  test('URL が空なら送らず、記録もしない', async () => {
    const posts = mockFetch();
    const r = await discordAttempt(LOG, P, '案内', '港', 1, '');
    expect(r).toMatchObject({ ok: false, code: 0, retryable: false, result: '送らず: Discord Webhook URL が空', reason: null });
    expect(posts).toHaveLength(0);
    expect(await logs()).toEqual([]);
  });

  test('サンプルのグループの Webhook には、送らずに届いたことにする', async () => {
    const posts = mockFetch();
    const r = await discordAttempt(LOG, P, '接続テスト', '-', 1, SAMPLE_WEBHOOK);
    expect(r).toMatchObject({ ok: true, code: 204 });
    expect(posts).toHaveLength(0);
    expect(await results()).toEqual(['OK (204)']);
  });

  test('Discord の形でない URL には送らない', async () => {
    const posts = mockFetch();
    const r = await discordAttempt(LOG, P, '案内', '港', 1, 'https://example.com/hook');
    expect(posts).toHaveLength(0);
    expect(r).toMatchObject({ ok: false, code: 0, retryable: false, raw: 'ERROR Discord の Webhook URL ではありません' });
    expect(r.reason!.kind).toBe('bad_url');
    expect(r.result).toBe('送信失敗（Webhook URL）: ERROR Discord の Webhook URL ではありません（1 回目）　→ Webhook URL が Discord のものではありません。 管理画面の「知らせ」で貼り直して「接続テスト」を。　このツールの不具合ではありません。');
  });

  test('本文を断られたら（400）送り直さない。ツールの不具合かもしれないので、ツールのせいではないとは書かない', async () => {
    mockFetch([new Response('{"message": "Invalid Form Body"}', { status: 400 })]);
    const r = await discordAttempt(LOG, P, '案内', '港', 1, HOOK);
    expect(r).toMatchObject({ ok: false, code: 400, retryable: false, waitMs: 0, raw: 'HTTP 400 {"message": "Invalid Form Body"}' });
    expect(r.result).toBe(
      '送信失敗（本文）: HTTP 400 {"message": "Invalid Form Body"}（1 回目）　→ Discord が本文を受け付けませんでした。 ' +
      '卓名やメモが極端に長くないか確かめてください。直らなければツール側の問題かもしれないので、送信記録の詳細を添えて知らせてください。',
    );
  });

  test('通信が切れたら（名前を引けないときも）送り直す。原因の分からないエラーは送り直さない', async () => {
    mockFetch([new Error('could not resolve host'), new TypeError('Network connection lost'), new Error('何かおかしい')]);
    const r0 = await discordAttempt(LOG, P, '案内', '港', 1, HOOK);
    expect(r0).toMatchObject({ ok: false, retryable: true, waitMs: 3000 });
    expect(r0.reason!.kind).toBe('network');
    const r1 = await discordAttempt(LOG, P, '案内', '港', 1, HOOK);
    expect(r1).toMatchObject({ ok: false, code: 0, retryable: true, waitMs: 3000, raw: 'ERROR TypeError: Network connection lost' });
    expect(r1.reason!.kind).toBe('network');
    expect(r1.result).toBe('ERROR TypeError: Network connection lost（1 回目、3 秒後に送り直し）');
    const r2 = await discordAttempt(LOG, P, '案内', '港', 1, HOOK);
    expect(r2).toMatchObject({ ok: false, retryable: false, waitMs: 0 });
    expect(r2.result).toBe('送信失敗（原因不明）: ERROR Error: 何かおかしい（1 回目）　→ 原因を判別できませんでした。 送信記録の詳細を添えて知らせてください。');
  });

  test('待つ時間は Retry-After（秒）を見る。読めなければ本文の retry_after（100 を超えればミリ秒）。15 秒までにする', async () => {
    mockFetch([
      new Response(null, { status: 429, headers: { 'Retry-After': '12' } }),
      new Response(null, { status: 429, headers: { 'Retry-After': '60' } }),
      new Response('{"retry_after": 9.5}', { status: 429, headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' } }),
      new Response('{"retry_after": 9000}', { status: 429 }),
      new Response('{"retry_after": 1.5}', { status: 429 }),
      new Response('Service Unavailable', { status: 503 }),
    ]);
    const waits: number[] = [];
    for (const attempt of [1, 1, 1, 1, 1, 2]) waits.push((await discordAttempt(LOG, P, '案内', '港', attempt, HOOK)).waitMs);
    // 短すぎる値は、決まった待ち時間（1 回目のあと 3 秒、2 回目のあと 8 秒）まで延ばす
    expect(waits).toEqual([12000, 15000, 9500, 9000, 3000, 8000]);
    expect((await results())[5]).toBe('HTTP 503 Service Unavailable（2 回目、8 秒後に送り直し）');
  });

  test('何回目かは 1〜3 に丸める。3 回目は打ち止め。Discord 側の問題なら、ツールの不具合ではないと書く', async () => {
    mockFetch([500, 404]);
    expect(await discordAttempt(LOG, P, '案内', '港', 0, HOOK)).toMatchObject({ attempt: 1, retryable: true, waitMs: 3000 });
    const r = await discordAttempt(LOG, P, '案内', '港', 9, HOOK);
    expect(r).toMatchObject({ attempt: 3, retryable: false });
    expect(r.result).toBe(
      '送信失敗（Webhook URL）: HTTP 404 （3 回目、打ち止め）　→ Webhook URL が違うか、Discord 側でウェブフックが消されています。 管理画面の「知らせ」で貼り直して「接続テスト」を。　このツールの不具合ではありません。',
    );
  });
});

describe('送り直しも含めて送る', () => {
  test('429 と 5xx は待って送り直す。届いたらそこで止める', async () => {
    const posts = mockFetch([429, 502, 204]);
    const sleeps: number[] = [];
    expect(await postDiscord(LOG, P, '案内', '港', HOOK, async (ms) => { sleeps.push(ms); })).toBe(true);
    expect(posts).toHaveLength(3);
    expect(sleeps).toEqual([3000, 8000]);
    expect(await results()).toEqual(['HTTP 429 （1 回目、3 秒後に送り直し）', 'HTTP 502 （2 回目、8 秒後に送り直し）', 'OK (204)（3 回目）']);
  });

  test('3 回とも失敗したら諦める。送り直さない失敗なら 1 回で止める', async () => {
    const posts = mockFetch([500, 500, 500, 403]);
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    expect(await postDiscord(LOG, P, '案内', '港', HOOK, sleep)).toBe(false);
    expect(posts).toHaveLength(3);
    expect(sleeps).toEqual([3000, 8000]);
    expect(await postDiscord(LOG, P, '案内', '港', HOOK, sleep)).toBe(false);
    expect(posts).toHaveLength(4);
    expect(sleeps).toHaveLength(2);
  });

  test('待ち方を渡さなければ、setTimeout で本当に待つ', async () => {
    mockFetch();
    expect(await postDiscord(LOG, P, '案内', '港', HOOK)).toBe(true);
    const timer = vi.spyOn(globalThis, 'setTimeout');
    await realSleep(5);
    expect(timer).toHaveBeenCalledWith(expect.any(Function), 5);
  });
});

describe('いくつかの送り先へ', () => {
  const series: Target = { url: SERIES_HOOK, label: 'シリーズ「港」のチャンネル', series: '港' };
  const base: Target = { url: HOOK, label: '基本のチャンネル', series: '' };

  test('1 か所でも届かなければ false。残りの送り先にも送る。記録の対象に送り先を添える', async () => {
    const posts = mockFetch([404, 204]);
    expect(await postToTargets(LOG, P, '案内', '港 #1', [series, base], async () => {})).toBe(false);
    expect(posts.map((p) => p.url)).toEqual([SERIES_HOOK, HOOK]);
    expect((await logs()).map((l) => l.target)).toEqual(['港 #1（シリーズ「港」のチャンネル）', '港 #1']);
  });

  test('すべて届けば true。送り先が無ければ false', async () => {
    mockFetch();
    expect(await postToTargets(LOG, P, '案内', '港', [series, base])).toBe(true);
    expect(await postToTargets(LOG, P, '案内', '港', [])).toBe(false);
  });
});
