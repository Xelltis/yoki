// 運営者への知らせ: BotからのDM・止める/試しに送る・Botのトークンの確かめ・新しいバージョン・見回りの失敗・運営の管理画面の様子
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AdminOverview, NoticeLast } from '../../src/shared/admin';
import { sendDm } from '../../src/worker/discord/dm';
import { overview } from '../../src/worker/domain/admin';
import { checkBot, NOTICE_KEYS, notifyOperators, testNotice } from '../../src/worker/domain/operator-notice';
import { patrol, runPatrol } from '../../src/worker/domain/patrol';
import type { Bindings } from '../../src/worker/env';
import type { UpdateApi } from '../../src/worker/update/api';
import type { UpdateDeps } from '../../src/worker/update/config';
import { APP_VERSION } from '../../src/worker/version';
import { call, loginAs, postJson } from './helpers';

const OP = { id: '400000000000000099', name: '運営' };
const OPS = ['400000000000000098', '400000000000000099'];
const DAY = '2026-10-10';
const at = (hhmm: string, day = DAY) => Date.parse(day + 'T' + hhmm + ':00+09:00');
const E = env as unknown as Bindings;
const meta = (key: string) => env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first<string>('value');
const lastNotice = async () => JSON.parse((await meta(NOTICE_KEYS.last))!) as NoticeLast;

type Req = { url: string; method: string; body: Record<string, unknown> | null };
let reqs: Req[] = [];
/** DiscordのAPIを差し替える。replyは道ごとの返事（無ければ、DMのチャンネルはidを付けた200、そのほかは200） */
function mockDiscord(reply: (r: Req) => Response | undefined = () => undefined) {
  reqs = [];
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const r: Req = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null };
    reqs.push(r);
    const own = reply(r);
    if (own) return own;
    if (url.endsWith('/users/@me/channels')) return Response.json({ id: 'dm-' + String(r.body!.recipient_id) });
    return Response.json({});
  });
}
/** DMで書いた文（送り先のDMのチャンネルと本文） */
const dms = () => reqs.filter((r) => r.url.includes('/channels/dm-')).map((r) => ({ to: r.url.split('/channels/dm-')[1]!.split('/')[0], content: String(r.body!.content) }));

/** 元のリポジトリの最新のReleaseを返す、偽のGitHub。呼ばれた数を数える */
function github(version: string | null, migrations = false) {
  const calls = { n: 0 };
  const api: UpdateApi = {
    async latestRelease() {
      calls.n++;
      return version === null ? null : { tag: 'v' + version, name: 'v' + version, url: 'https://github.com/o/u/releases/tag/v' + version, publishedAt: '2026-10-01T00:00:00Z', body: '' };
    },
    async changedFiles() { return migrations ? ['migrations/0099_x.sql'] : ['src/x.ts']; },
    async dispatch() {},
    async runs() { return []; },
  };
  const deps: UpdateDeps = { api, upstream: 'o/u', repo: '', token: '' };
  return { deps, calls };
}
const noWait = async () => {};

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mockDiscord();
});
afterEach(() => vi.restoreAllMocks());

describe('DMを送る', () => {
  test('DMのチャンネルを開いてから書く。メンションは効かせない', async () => {
    expect(await sendDm('tok', '1', 'こんにちは')).toEqual({ ok: true, status: 200, error: '' });
    expect(reqs).toEqual([
      { url: 'https://discord.com/api/v10/users/@me/channels', method: 'POST', body: { recipient_id: '1' } },
      { url: 'https://discord.com/api/v10/channels/dm-1/messages', method: 'POST', body: { content: 'こんにちは', allowed_mentions: { parse: [] } } },
    ]);
  });

  test('断られたら、直せる文にする', async () => {
    mockDiscord((r) => (r.url.endsWith('/channels') ? new Response('', { status: 401 }) : undefined));
    expect((await sendDm('tok', '1', 'x')).error).toBe('Botのトークンが使えません（HTTP 401）');
    mockDiscord((r) => (r.url.endsWith('/messages') ? Response.json({ code: 50007 }, { status: 403 }) : undefined));
    expect((await sendDm('tok', '1', 'x')).error).toContain('DMを受け取れない設定です');
    mockDiscord((r) => (r.url.endsWith('/messages') ? Response.json({ code: 50001 }, { status: 403 }) : undefined));
    expect((await sendDm('tok', '1', 'x')).error).toBe('HTTP 403・50001');
    mockDiscord((r) => (r.url.endsWith('/channels') ? new Response('混雑', { status: 500 }) : undefined));
    expect((await sendDm('tok', '1', 'x')).error).toBe('HTTP 500');
    // チャンネルのIDが読めない
    mockDiscord((r) => (r.url.endsWith('/channels') ? new Response('<html>') : undefined));
    expect((await sendDm('tok', '1', 'x')).error).toBe('HTTP 200');
    expect(reqs).toHaveLength(1);
  });

  test('通信が切れても投げない', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network down')).mockRejectedValueOnce('切れた');
    expect(await sendDm('tok', '1', 'x')).toEqual({ ok: false, status: 0, error: '通信が切れました（network down）' });
    expect((await sendDm('tok', '1', 'x')).error).toBe('通信が切れました（切れた）');
  });
});

describe('運営者みんなに送る', () => {
  test('OPERATOR_IDSの人みんなに送り、結果を控える。届かなかった人がいれば理由を残す', async () => {
    mockDiscord((r) => (r.body?.recipient_id === OPS[0] ? new Response('', { status: 401 }) : undefined));
    const r = await notifyOperators(E, '新しいバージョン', '本文', new Date(at('10:00')));
    expect(r).toEqual({ at: new Date(at('10:00')).toISOString(), kind: '新しいバージョン', sent: 1, failed: 1, error: 'Botのトークンが使えません（HTTP 401）' });
    expect(await lastNotice()).toEqual(r);
    expect(dms()).toEqual([{ to: OPS[1], content: '本文' }]);
  });

  test('止めている・運営者がいないときは送らない。Botのトークンが無ければ、届かなかったことを控える', async () => {
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('operator_dm', '0')").run();
    expect(await notifyOperators(E, 'k', 'x', new Date())).toBeNull();
    await env.DB.prepare("DELETE FROM meta WHERE key = 'operator_dm'").run();
    expect(await notifyOperators({ ...E, OPERATOR_IDS: '' }, 'k', 'x', new Date())).toBeNull();
    expect(reqs).toEqual([]);
    expect(await notifyOperators({ ...E, DISCORD_BOT_TOKEN: '' }, 'k', 'x', new Date())).toMatchObject({ sent: 0, failed: 2, error: 'Botのトークンがありません' });
    expect(reqs).toEqual([]);
  });
});

describe('運営の管理画面', () => {
  const overviewOf = async (sid: string) => (await (await call('/api/admin/overview', { sid })).json()) as AdminOverview;

  test('止める・使う。様子に、送る相手の数・Botの様子・最後の知らせが出る', async () => {
    const op = await loginAs(OP, []);
    let o = await overviewOf(op);
    expect(o.notices).toEqual({ on: true, operators: 2, bot: { state: 'unknown', at: '', since: '' }, version: '', last: null });
    let res = await postJson('/api/admin/operator-notice', { on: false }, op);
    expect(await res.json()).toEqual({ ok: true, message: '運営者への知らせを止めました。' });
    expect((await overviewOf(op)).notices.on).toBe(false);
    res = await postJson('/api/admin/operator-notice', { on: true }, op);
    expect(((await res.json()) as { message: string }).message).toBe('運営者への知らせを、DiscordのDMで送ります。');
    await notifyOperators(E, '見回りの失敗', 'x', new Date(at('10:00')));
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('bot_check', ?1), ('operator_notice_version', '9.9.9')").bind(JSON.stringify({ ok: false, at: 'a', since: 's' })).run();
    o = await overviewOf(op);
    expect(o.notices).toMatchObject({ on: true, bot: { state: 'bad', at: 'a', since: 's' }, version: '9.9.9', last: { kind: '見回りの失敗', sent: 2, failed: 0 } });
    await env.DB.prepare("UPDATE meta SET value = ?1 WHERE key = 'bot_check'").bind(JSON.stringify({ ok: true, at: 'b', since: '' })).run();
    expect((await overviewOf(op)).notices.bot.state).toBe('ok');
    expect((await overview(env.DB, { operators: 0, botToken: false })).notices.bot.state).toBe('missing');
    // 控えが壊れていても読める
    await env.DB.prepare("UPDATE meta SET value = '{' WHERE key = 'bot_check'").run();
    expect((await overviewOf(op)).notices.bot.state).toBe('unknown');
  });

  test('試しに送る: 押した運営者にだけ送る（止めていても）。届かなければ理由を返す。運営者でなければ403', async () => {
    const op = await loginAs(OP, []);
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('operator_dm', '0')").run();
    let res = await postJson('/api/admin/operator-notice/test', {}, op);
    expect(await res.json()).toEqual({ ok: true, message: 'DMを送りました。Discordで届いたかを確かめてください。' });
    expect(dms()).toEqual([{ to: OP.id, content: '🔔 Yokiからの試しのDMです。運営者への知らせは、このように届きます。' }]);
    expect(await lastNotice()).toMatchObject({ kind: '試し', sent: 1 });
    mockDiscord((r) => (r.url.endsWith('/messages') ? Response.json({ code: 50007 }, { status: 403 }) : undefined));
    res = await postJson('/api/admin/operator-notice/test', {}, op);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('DMを送れませんでした（DMを受け取れない設定です。');
    await expect(testNotice({ ...E, DISCORD_BOT_TOKEN: '' }, OP.id, new Date())).rejects.toThrow('YokiのBotのトークンが無いので、DMを送れません。');
    const other = await loginAs({ id: '400000000000000011', name: 'ソラ' }, []);
    expect((await postJson('/api/admin/operator-notice/test', {}, other)).status).toBe(403);
    expect((await postJson('/api/admin/operator-notice', { on: true }, other)).status).toBe(403);
  });
});

describe('Botのトークンの確かめ', () => {
  const bot = async () => JSON.parse((await meta('bot_check'))!);

  test('使えなくなったら控え（始まりの時刻は保つ）、また使えるようになったら運営者に知らせる', async () => {
    mockDiscord((r) => (r.url.endsWith('/users/@me') ? new Response('', { status: 401 }) : undefined));
    await checkBot(E, new Date(at('10:00')));
    await checkBot(E, new Date(at('11:00')));
    expect(await bot()).toEqual({ ok: false, at: new Date(at('11:00')).toISOString(), since: new Date(at('10:00')).toISOString() });
    expect(dms()).toEqual([]);
    mockDiscord();
    await checkBot(E, new Date(at('12:00')));
    expect(await bot()).toEqual({ ok: true, at: new Date(at('12:00')).toISOString(), since: '' });
    expect(dms().map((d) => d.to)).toEqual(OPS);
    expect(dms()[0]!.content).toBe('✅ YokiのBotのトークンが、また使えるようになりました。\n2026-10-10 10:00ごろから使えなかったので、そのあいだのDiscordへの知らせは届いていません（各グループの「送信の記録」に残っています）。');
    // 使えるあいだは知らせない
    mockDiscord();
    await checkBot(E, new Date(at('13:00')));
    expect(dms()).toEqual([]);
  });

  test('トークンが無い・Discordが混んでいる・通信が切れたときは、控えを変えない', async () => {
    await checkBot({ ...E, DISCORD_BOT_TOKEN: '' }, new Date());
    expect(reqs).toEqual([]);
    mockDiscord(() => new Response('', { status: 503 }));
    await checkBot(E, new Date());
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('down'));
    await checkBot(E, new Date());
    expect(await meta('bot_check')).toBeNull();
  });
});

describe('見回りの中の知らせ', () => {
  test('毎時Botを確かめ、10時台に1日1回、新しいバージョンを知らせる。同じ版は2度知らせない', async () => {
    const g = github('99.0.0', true);
    await patrol(E, at('09:00'), { sleep: noWait, operator: { github: g.deps } });
    expect(reqs.map((r) => r.url)).toEqual(['https://discord.com/api/v10/users/@me']);
    expect(g.calls.n).toBe(0);
    mockDiscord();
    await patrol(E, at('10:00'), { sleep: noWait, operator: { github: g.deps } });
    expect(g.calls.n).toBe(1);
    expect(dms().map((d) => d.to)).toEqual(OPS);
    expect(dms()[0]!.content).toBe('📦 Yokiの新しいバージョンv99.0.0が出ました（いまはv' + APP_VERSION + '）。表の変更があります。\n変わったこと: https://github.com/o/u/releases/tag/v99.0.0\n運営の管理画面の「更新」から更新できます: https://yoki.test/admin/update/');
    expect(await meta('operator_notice_version')).toBe('99.0.0');
    // 同じ日にはもう見ない。次の日も、同じ版なら知らせない
    mockDiscord();
    await patrol(E, at('11:00'), { sleep: noWait, operator: { github: g.deps } });
    await env.DB.prepare("DELETE FROM meta WHERE key = 'update_check'").run();
    await patrol(E, at('10:00', '2026-10-11'), { sleep: noWait, operator: { github: g.deps } });
    expect(g.calls.n).toBe(2);
    expect(dms()).toEqual([]);
  });

  test('だれにも届かなければ、次の日にまた知らせる。表の変更が無く、アドレスが分からなければ、その文は付けない', async () => {
    const g = github('99.0.0');
    mockDiscord((r) => (r.url.endsWith('/messages') ? new Response('', { status: 500 }) : undefined));
    await patrol(E, at('10:00'), { sleep: noWait, operator: { github: g.deps } });
    expect(await meta('operator_notice_version')).toBeNull();
    mockDiscord();
    await env.DB.prepare("DELETE FROM meta WHERE key = 'update_check'").run();
    await patrol({ ...E, APP_URL: '' }, at('10:00', '2026-10-11'), { sleep: noWait, operator: { github: g.deps } });
    expect(dms()[0]!.content).toBe('📦 Yokiの新しいバージョンv99.0.0が出ました（いまはv' + APP_VERSION + '）。\n変わったこと: https://github.com/o/u/releases/tag/v99.0.0');
  });

  test('新しい版が無い・止めている・運営者がいないときは知らせない（止めていればGitHubも読まない）', async () => {
    let g = github(APP_VERSION);
    await patrol(E, at('10:00'), { sleep: noWait, operator: { github: g.deps } });
    g = github(null);
    await env.DB.prepare("DELETE FROM meta WHERE key IN ('operator_daily', 'update_check')").run();
    await patrol(E, at('10:00'), { sleep: noWait, operator: { github: g.deps } });
    expect(g.calls.n).toBe(1);
    g = github('99.0.0');
    await env.DB.prepare("DELETE FROM meta WHERE key IN ('operator_daily', 'update_check')").run();
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('operator_dm', '0')").run();
    await patrol(E, at('10:00'), { sleep: noWait, operator: { github: g.deps } });
    await env.DB.prepare("DELETE FROM meta WHERE key IN ('operator_daily', 'operator_dm')").run();
    await patrol({ ...E, OPERATOR_IDS: '' }, at('10:00'), { sleep: noWait, operator: { github: g.deps } });
    expect(g.calls.n).toBe(0);
    expect(dms()).toEqual([]);
  });
});

describe('見回りの失敗', () => {
  const boom = async () => { throw new Error('D1が応えない'); };
  const fail = (hhmm: string, e: Bindings = E) => expect(runPatrol(e, at(hhmm), { sleep: noWait }, boom)).rejects.toThrow('D1が応えない');
  const okRun = (hhmm: string) => runPatrol(E, at(hhmm), { sleep: noWait }, async () => {});
  const fails = async () => JSON.parse((await meta('patrol'))!).fails;

  test('続けて3回失敗したら1回だけ知らせる。うまくいけば数え直す', async () => {
    await okRun('20:00');
    expect(await fails()).toBe(0);
    await fail('20:05');
    await fail('20:10');
    expect(dms()).toEqual([]);
    await fail('20:15');
    expect(await fails()).toBe(3);
    expect(dms().map((d) => d.to)).toEqual(OPS);
    expect(dms()[0]!.content).toBe('⚠️ Yokiの知らせの見回りが、3回続けて失敗しています（最後は2026-10-10 20:15）。\n理由: D1が応えない\n運営の管理画面: https://yoki.test/admin/');
    mockDiscord();
    await fail('20:20');
    expect(dms()).toEqual([]);
    await okRun('20:25');
    await fail('20:30');
    expect(await fails()).toBe(1);
  });

  test('前の版の記録（failsが無い）は、失敗なら1回と数える。アドレスが分からなければリンクを付けない', async () => {
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('patrol', ?1)").bind(JSON.stringify({ at: 'x', ms: 1, ok: false, error: 'e' })).run();
    await fail('20:05');
    await fail('20:10', { ...E, APP_URL: '' });
    expect(dms()[0]!.content).toBe('⚠️ Yokiの知らせの見回りが、3回続けて失敗しています（最後は2026-10-10 20:10）。\n理由: D1が応えない');
    // 記録が壊れていたら、数え直す
    await env.DB.prepare("UPDATE meta SET value = '{' WHERE key = 'patrol'").run();
    await fail('20:15');
    expect(await fails()).toBe(1);
  });
});
