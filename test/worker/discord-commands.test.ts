// Discordのスラッシュコマンド（/yoki）: 日付の読み方、あなたの予定・その日の空き、受け口、運営者の入り切り
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { COMMANDS, type CommandInteraction, handleCommand, readDay } from '../../src/worker/discord/commands';
import type { Bindings } from '../../src/worker/env';
import { addDays, fmtDateJa } from '../../src/worker/lib/jst';
import { call, GUILD, loginAs, makeGroup, ok, postJson, setupGroup, today } from './helpers';

const SORA = '400000000000000011';
const OP = { id: '400000000000000099', name: '運営' };
const BASE = 'https://yoki.test';
const E = env as unknown as Bindings;
let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
});
afterEach(() => vi.restoreAllMocks());

/** /yoki <sub> を、そのサーバーで、その人が打った */
const cmd = (sub: string, day?: string, user = SORA): CommandInteraction => ({
  application_id: 'app', token: 'tok', guild_id: GUILD, member: { user: { id: user } },
  data: { name: 'yoki', options: [{ name: sub, options: day === undefined ? [] : [{ name: 'day', value: day }] }] },
});
const run = (it: CommandInteraction) => handleCommand(E, it, BASE, new Date());

describe('日付の読み方', () => {
  test('省くと今日。今日・明日・あさって、YYYY-MM-DD、M/D、M月D日（全角も）。年の無い日が過ぎていれば来年。読めなければnull', () => {
    const t = '2026-10-10';
    expect(['', '今日', '明日', 'あさって', '明後日'].map((v) => readDay(v, t))).toEqual([t, t, '2026-10-11', '2026-10-12', '2026-10-12']);
    expect(readDay('2027-01-05', t)).toBe('2027-01-05');
    expect(readDay('10/12', t)).toBe('2026-10-12');
    expect(readDay('１０／１２', t)).toBe('2026-10-12');
    expect(readDay('10月12日', t)).toBe('2026-10-12');
    expect(readDay('10/9', t)).toBe('2027-10-09');
    expect(readDay('2/29', '2027-03-01')).toBeNull();
    expect(readDay('13/40', t)).toBeNull();
    expect(readDay('あした', t)).toBeNull();
  });
});

describe('コマンドの処理', () => {
  test('知らないコマンド・サーバーの外・締め出した人・グループのメンバーでない人には、そう返す', async () => {
    expect(await run({ ...cmd('agenda'), data: { name: 'other', options: [{ name: 'agenda' }] } })).toBe('このコマンドは使えません。');
    expect(await run({ ...cmd('agenda'), data: { name: 'yoki' } })).toBe('このコマンドは使えません。');
    expect(await run(cmd('dice'))).toBe('このコマンドは使えません。');
    expect(await run({ ...cmd('agenda'), guild_id: undefined })).toBe('Discordサーバーの中で使ってください。');
    expect(await run(cmd('agenda', undefined, '400000000000000077'))).toBe('このサーバーのYokiのグループに、まだ入っていません。Yokiでグループを開いてから使ってください: https://yoki.test/');
    // DMなどでuserで届いたときも、その人で読む
    expect(await run({ ...cmd('agenda'), member: undefined, user: { id: '400000000000000077' } })).toContain('まだ入っていません');
    expect(await run({ ...cmd('agenda'), member: undefined })).toContain('まだ入っていません');
    await env.DB.prepare("UPDATE users SET banned_at = 'x' WHERE id = ?").bind(SORA).run();
    expect(await run(cmd('agenda'))).toBe('このアカウントでは使えません。');
  });

  test('予定: あなたの番と、これからの卓。無ければそう返す。ログインしたことが無ければ出せない', async () => {
    expect(await run(cmd('agenda'))).toBe('📅 これからの卓と、あなたの番はありません。\n🔗 https://yoki.test/');
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', members: ['ソラ'], date: T(2), start: '20:00', end: '23:00', status: '開催' });
    await ok(G.admin, G.id, 'savePrep', { id: 'S001', sheetDue: T(1) });
    await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', members: ['ソラ'], status: '調整中' });
    await ok(G.admin, G.id, 'startPoll', { id: 'S002', dates: [T(5)], due: T(3) });
    expect(await run(cmd('agenda'))).toBe([
      'あなたの予定',
      '📝 キャラシの締め切り ' + fmtDateJa(T(1)) + ': 港',
      '🗳️ 日程調整に答えてください（締め切り ' + fmtDateJa(T(3)) + '）: 迷宮',
      '📅 ' + fmtDateJa(T(2)) + ' 20:00〜23:00 港',
      '🔗 https://yoki.test/',
    ].join('\n'));
    await ok(G.admin, G.id, 'startPoll', { id: 'S002', dates: [T(5)], due: '' });
    await ok(G.sora, G.id, 'setPollVote', { id: 'S002', name: 'ソラ', ymd: T(5), vote: '◯' });
    // GMは、回答がそろったら開催日を選ぶ番
    expect(await run(cmd('agenda', undefined, '400000000000000010'))).toContain('🗳️ 回答がそろいました。開催日を選んでください: 迷宮');
    // 日程調整の締め切りが無ければ添えない
    await env.DB.prepare('DELETE FROM poll_votes').run();
    expect(await run(cmd('agenda'))).toContain('🗳️ 日程調整に答えてください: 迷宮');
    // DiscordのIDだけのメンバー（ログインしたことが無い）
    await env.DB.prepare("INSERT INTO members (group_id, name, discord_id, created_at) VALUES (?, 'ユズ', '400000000000000013', 'x')").bind(G.id).run();
    expect(await run(cmd('agenda', undefined, '400000000000000013'))).toBe('Yokiに一度ログインすると、あなたの予定が出ます: https://yoki.test/');
  });

  test('予定: 同じサーバーにグループが2つあれば、グループの名前を添える。多ければ、残りの数を出す', async () => {
    await makeGroup('grp2', GUILD, 'もう1つの卓');
    await ok(G.sora, 'grp2', 'getConsoleData');
    for (let i = 0; i < 16; i++) await ok(G.admin, G.id, 'saveSession', { name: '卓' + i, gm: 'ひより', members: ['ソラ'], date: T(1 + i), status: '開催' });
    await ok(G.sora, 'grp2', 'saveSession', { name: '別', gm: 'ソラ', date: T(40), status: '開催' });
    const lines = (await run(cmd('agenda'))).split('\n');
    expect(lines[1]).toBe('📅 【テストの卓】' + fmtDateJa(T(1)) + ' 時間未定 卓0');
    expect(lines.slice(-2)).toEqual(['ほか2件', '🔗 https://yoki.test/']);
  });

  test('空き: その日のメンバーの予定と、全員空きか。卓とメモも添える', async () => {
    expect(await run(cmd('free'))).toBe([
      '📅 ' + fmtDateJa(T(0)) + 'の予定', '→ 全員空きです', '空き: ひより、ソラ、こまち', '🔗 https://yoki.test/g/grp/',
    ].join('\n'));
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(3), mark: '△' });
    expect((await run(cmd('free', fmtDateJa(T(3)).replace(/（.+/, '')))).split('\n').slice(1, 4)).toEqual(['→ △ の人がいます（ほかは空き）', '空き: ひより、こまち', '△: ソラ']);
    await ok(G.komachi, G.id, 'setAvailability', { name: 'こまち', ymd: T(3), mark: '×' });
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', date: T(3), start: '20:00', status: '開催' });
    await ok(G.admin, G.id, 'setDayNote', { ymd: T(2), to: T(4), text: '連休' });
    await ok(G.admin, G.id, 'setDayNote', { ymd: T(3), text: '部屋は前日に' });
    expect(await run(cmd('free', T(3)))).toBe([
      '📅 ' + fmtDateJa(T(3)) + 'の予定', '→ × か卓のある人がいます', '空き: なし', '△: ソラ', '×: こまち', '卓あり: ひより',
      'この日の卓: 港（20:00〜）', 'メモ: 連休／部屋は前日に', '🔗 https://yoki.test/g/grp/',
    ].join('\n'));
    // ログインしたことの無いメンバー（DiscordのIDだけ）も見られる
    await env.DB.prepare("INSERT INTO members (group_id, name, discord_id, created_at) VALUES (?, 'ユズ', '400000000000000013', 'x')").bind(G.id).run();
    expect(await run(cmd('free', T(3), '400000000000000013'))).toContain('空き: ユズ');
  });

  test('空き: 昼と夜に分けるグループは時間帯ごと。予定表の範囲の外・読めない日は、そう返す', async () => {
    await ok(G.admin, G.id, 'saveConsoleSettings', { dayParts: true });
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(1), mark: '×', part: '夜' });
    expect((await run(cmd('free', '明日'))).split('\n').slice(1, 6)).toEqual(['【昼】→ 全員空きです', '空き: ひより、ソラ、こまち', '【夜】→ × か卓のある人がいます', '空き: ひより、こまち', '×: ソラ']);
    expect(await run(cmd('free', T(-1)))).toBe('📅 ' + fmtDateJa(T(-1)) + 'の予定\n予定表の範囲（今日から60日）の外の日です。');
    expect(await run(cmd('free', 'そのうち'))).toBe('日付が読めません: そのうち（10/12 や 2026-10-12 の形で入れてください）');
  });

  test('空き: 同じサーバーのグループは2つまで（グループの名前を添える）。残りはYokiで', async () => {
    await makeGroup('grp2', GUILD, '二つ目');
    await makeGroup('grp3', GUILD, '三つ目');
    for (const g of ['grp2', 'grp3']) await ok(G.sora, g, 'getConsoleData');
    const text = await run(cmd('free'));
    expect(text.split('\n\n').map((x) => x.split('\n')[0])).toEqual(['【テストの卓】📅 ' + fmtDateJa(T(0)) + 'の予定', '【二つ目】📅 ' + fmtDateJa(T(0)) + 'の予定', 'ほかのグループは、Yokiで見てください: https://yoki.test/']);
  });
});

describe('受け口と、運営者の入り切り', () => {
  const toHex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  /** 署名の鍵を作り、Public Keyと「コマンドを受ける」をmetaに入れる */
  async function keys(commands = true) {
    const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const pub = toHex((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer);
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('discord_verify_key', ?1), ('discord_commands', ?2)").bind(pub, commands ? '1' : '0').run();
    return async (body: string, ts = '1700000000') => ({ 'X-Signature-Ed25519': toHex(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(ts + body))), 'X-Signature-Timestamp': ts });
  }
  const post = async (body: object, headers: Record<string, string>) =>
    call('/api/discord/interactions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

  test('コマンドには「考え中」を返し、返事のあとで書き直す。止めていれば断る', async () => {
    const sign = await keys();
    const edits: { url: string; body: any }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      edits.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response('{}');
    });
    const body = { type: 2, ...cmd('free') };
    const res = await post(body, await sign(JSON.stringify(body)));
    expect(await res.json()).toEqual({ type: 5, data: { flags: 64 } });
    await vi.waitFor(() => expect(edits).toHaveLength(1));
    expect(edits[0]!.url).toBe('https://discord.com/api/v10/webhooks/app/tok/messages/@original');
    expect(edits[0]!.body.content).toContain('→ 全員空きです');
    await env.DB.prepare("UPDATE meta SET value = '0' WHERE key = 'discord_commands'").run();
    expect(await (await post(body, await sign(JSON.stringify(body)))).json()).toMatchObject({ type: 4, data: { flags: 64 } });
  });

  test('運営者が入れると、受け口を入れてからコマンドを登録する。止めると登録を消す。運営者でなければ403', async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    let putStatus = 200;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
      if (init?.method === 'PUT') return new Response('{}', { status: putStatus });
      return Response.json({ id: 'app-id', verify_key: 'ab'.repeat(32) });
    });
    const op = await loginAs(OP, []);
    let res = await postJson('/api/admin/discord-commands', { on: true }, op);
    expect(await res.json()).toEqual({ ok: true, message: 'スラッシュコマンド（/yoki）を使えるようにしました。Discordで「/yoki 予定」「/yoki 空き」と打つと、本人にだけ返事が出ます。' });
    expect(calls.map((x) => x.method + ' ' + x.url)).toEqual([
      'GET https://discord.com/api/v10/applications/@me',
      'PATCH https://discord.com/api/v10/applications/@me',
      'PUT https://discord.com/api/v10/applications/app-id/commands',
    ]);
    expect(calls[2]!.body).toEqual(COMMANDS);
    expect(((await (await call('/api/admin/overview', { sid: op })).json()) as { discordCommands: boolean }).discordCommands).toBe(true);
    res = await postJson('/api/admin/discord-commands', { on: false }, op);
    expect(((await res.json()) as { message: string }).message).toBe('スラッシュコマンドを止めました。');
    expect(calls[3]).toEqual({ url: 'https://discord.com/api/v10/applications/test-client/commands', method: 'PUT', body: [] });
    // 消せなくても止める。登録を受け付けなければ断る
    putStatus = 500;
    res = await postJson('/api/admin/discord-commands', { on: false }, op);
    expect(((await res.json()) as { message: string }).message).toBe('スラッシュコマンドを止めました。（Discordからコマンドを消せませんでした。HTTP 500）');
    res = await postJson('/api/admin/discord-commands', { on: true }, op);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('Discordがコマンドを受け付けませんでした（HTTP 500）。');
    expect((await postJson('/api/admin/discord-commands', { on: true }, G.admin)).status).toBe(403);
  });

  test('Botのトークンが無ければ、止めるときは印だけ外し、入れるときは断る', async () => {
    const { setCommands } = await import('../../src/worker/discord/commands');
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(await setCommands({ ...E, DISCORD_BOT_TOKEN: '' }, false, BASE)).toBe('スラッシュコマンドを止めました。');
    expect(fetch).not.toHaveBeenCalled();
    await expect(setCommands({ ...E, DISCORD_BOT_TOKEN: '' }, true, BASE)).rejects.toThrow('YokiのBotのトークンが無いので、スラッシュコマンドを使えません。');
  });
});
