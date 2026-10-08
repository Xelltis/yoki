// Discordのボタン（Interactions）: 署名の確かめ・受け口・押されたボタンの処理・運営者の入り切り・知らせに付けるボタン
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { customId, parseCustomId, pollComponents, recruitComponents } from '../../src/worker/discord/buttons';
import { type ComponentInteraction, handleComponent, setButtons, verifySignature } from '../../src/worker/discord/interactions';
import { askPayload, changePayload, pollPayload } from '../../src/worker/discord/payloads';
import { loadGroup } from '../../src/worker/domain/load';
import type { Bindings } from '../../src/worker/env';
import { addDays } from '../../src/worker/lib/jst';
import { call, GUILD, loginAs, ok, postJson, setupGroup, today } from './helpers';

const SORA = '400000000000000011';
const OP = { id: '400000000000000099', name: '運営' };
const noSleep = async () => {};
let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
});
afterEach(() => vi.restoreAllMocks());

const toHex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
/** 署名の鍵を作り、Public Keyをmetaに控える（運営者がボタンを入れたあとと同じ） */
async function keys(on = true) {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = toHex((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer);
  await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('discord_verify_key', ?1), ('discord_buttons', ?2)").bind(pub, on ? '1' : '0').run();
  const sign = async (body: string, ts = '1700000000') => ({ 'X-Signature-Ed25519': toHex(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(ts + body))), 'X-Signature-Timestamp': ts });
  return { pub, sign };
}
/** Discordが送ってくる形で、受け口にPOSTする */
async function post(body: object, headers: Record<string, string>) {
  const text = JSON.stringify(body);
  return call('/api/discord/interactions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: text });
}
const press = (id: string, values?: string[], user = SORA, guild = GUILD): ComponentInteraction => ({
  application_id: 'app', token: 'tok', guild_id: guild, member: { user: { id: user } }, data: { custom_id: id, values },
});
const handle = (it: ComponentInteraction) => handleComponent(env as unknown as Bindings, it, 'https://yoki.test', new Date(), noSleep);

describe('ボタンのIDと署名', () => {
  test('IDはグループ・卓の番号・操作。知らない形は読まない', () => {
    expect(customId('grp', 12, 'fill')).toBe('yoki:grp:12:fill');
    expect(parseCustomId('yoki:grp:12:fill')).toEqual({ groupId: 'grp', seq: 12, action: 'fill' });
    expect([parseCustomId('yoki:grp:12:jump'), parseCustomId('other:grp:1:fill'), parseCustomId(undefined)]).toEqual([null, null, null]);
  });

  test('Ed25519の署名を確かめる。形の違う鍵や署名は通さない', async () => {
    const { pub, sign } = await keys();
    const h = await sign('{"a":1}');
    expect(await verifySignature(pub, h['X-Signature-Ed25519'], h['X-Signature-Timestamp'], '{"a":1}')).toBe(true);
    expect(await verifySignature(pub, h['X-Signature-Ed25519'], h['X-Signature-Timestamp'], '{"a":2}')).toBe(false);
    expect(await verifySignature('zz', h['X-Signature-Ed25519'], '1', 'x')).toBe(false);
    expect(await verifySignature(pub.slice(2), h['X-Signature-Ed25519'], '1', 'x')).toBe(false);
    expect(await verifySignature(pub, 'ab', '1', 'x')).toBe(false);
    expect(await verifySignature(pub, h['X-Signature-Ed25519'], '', 'x')).toBe(false);
  });
});

describe('受け口（/api/discord/interactions）', () => {
  test('署名が無い・違う・鍵を控えていなければ401', async () => {
    expect((await post({ type: 1 }, {})).status).toBe(401);
    const { sign } = await keys();
    expect((await post({ type: 1 }, {})).status).toBe(401);
    expect((await post({ type: 1 }, await sign('{"type":2}'))).status).toBe(401);
    await env.DB.prepare("DELETE FROM meta WHERE key = 'discord_verify_key'").run();
    expect((await post({ type: 1 }, await sign('{"type":1}'))).status).toBe(401);
  });

  test('確かめ（PING）には、ボタンを止めていてもPONGで返す', async () => {
    const { sign } = await keys(false);
    const res = await post({ type: 1 }, await sign('{"type":1}'));
    expect(await res.json()).toEqual({ type: 1 });
  });

  test('ボタンを止めているとき・ボタンでないものには、本人にだけ見える断りを返す', async () => {
    const { sign } = await keys(false);
    const body = { type: 3, application_id: 'app', token: 'tok', data: { custom_id: 'x' } };
    expect(await (await post(body, await sign(JSON.stringify(body)))).json()).toMatchObject({ type: 4, data: { flags: 64 } });
    await env.DB.prepare("UPDATE meta SET value = '1' WHERE key = 'discord_buttons'").run();
    const cmd = { type: 2 };
    expect(await (await post(cmd, await sign(JSON.stringify(cmd)))).json()).toMatchObject({ type: 4 });
  });

  test('ボタンには「考え中」を返し、返事のあとで処理して書き直す。思わぬ失敗でも書き直す', async () => {
    const { sign } = await keys();
    const edits: { url: string; body: any }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      edits.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response('{}');
    });
    await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'ひより', status: '募集' });
    const body = { type: 3, ...press(customId(G.id, 1, 'want')) };
    const res = await post(body, await sign(JSON.stringify(body)));
    expect(await res.json()).toEqual({ type: 5, data: { flags: 64 } });
    await vi.waitFor(() => expect(edits).toHaveLength(1));
    expect(edits[0]).toEqual({ url: 'https://discord.com/api/v10/webhooks/app/tok/messages/@original', body: { content: '「古城」に参加希望を出しました: ソラ', allowed_mentions: { parse: [] } } });
    // 読み込みが壊れたとき
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const proto = Object.getPrototypeOf(env.DB) as { prepare: (sql: string) => D1PreparedStatement };
    const orig = proto.prepare;
    vi.spyOn(proto, 'prepare').mockImplementation(function (this: D1Database, sql: string) {
      if (sql.includes('INSERT INTO session_people')) throw new Error('壊れた');
      return orig.call(this, sql);
    });
    await post(body, await sign(JSON.stringify(body)));
    await vi.waitFor(() => expect(edits).toHaveLength(2));
    expect(edits[1]!.body.content).toBe('うまくいきませんでした。Yokiの画面から操作してください。');
    expect(err).toHaveBeenCalled();
  });
});

describe('押されたボタンの処理', () => {
  test('日程調整: 予定表から答える・どの日でもいい・行ける日を選ぶ', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', members: ['ソラ'], status: '調整中' });
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(3), T(4), T(5)] });
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(4), mark: '×' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'));
    expect(await handle(press(customId(G.id, 1, 'fill')))).toContain('ソラ: 予定表から3日に答えました（◯ 2日・× 1日）');
    expect(await handle(press(customId(G.id, 1, 'any')))).toContain('すべてに ◯ を付けました');
    expect(await handle(press(customId(G.id, 1, 'days'), [T(5)]))).toMatch(/^ソラ: 「迷宮」に、.+は ◯、ほかの日は × で答えました/);
    expect(await handle(press(customId(G.id, 1, 'days'), []))).toContain('どの日も × で答えました');
    expect(await handle({ ...press(customId(G.id, 1, 'days')), data: { custom_id: customId(G.id, 1, 'days') } })).toContain('どの日も ×');
    expect(await handle(press(customId(G.id, 1, 'days'), [T(3), T(4), T(5)]))).toContain('どの日も ◯ で答えました');
    const d = await ok(G.sora, G.id, 'getConsoleData');
    expect(Object.values(d.sessions[0].votes).map((v: any) => v.ソラ)).toEqual(['◯', '◯', '◯']);
  });

  test('行ける日を選ぶ: GMか参加者だけ。これからの候補日が無ければ断る', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', members: ['ソラ'], status: '調整中' });
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(3)] });
    expect(await handle(press(customId(G.id, 1, 'days'), [T(3)], '400000000000000012'))).toBe('こまちは「迷宮」のGMでも参加者でもないので、回答できません。');
    await env.DB.prepare('UPDATE sessions SET candidates = ?').bind(JSON.stringify([T(-1)])).run();
    expect(await handle(press(customId(G.id, 1, 'days'), []))).toBe('「迷宮」には、これからの候補日がありません。');
  });

  test('募集: 参加希望・興味あり・取り消す。断られたら、その理由を返す', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'ひより', status: '募集', capacity: 1 });
    expect(await handle(press(customId(G.id, 1, 'interest')))).toBe('「古城」に興味ありを付けました: ソラ');
    expect(await handle(press(customId(G.id, 1, 'none')))).toBe('「古城」への希望を取り消しました: ソラ');
    await ok(G.komachi, G.id, 'setInterest', { id: 'S001', name: 'こまち', level: 'want' });
    expect(await handle(press(customId(G.id, 1, 'want')))).toBe('「古城」は定員（1人）に達しています。「興味あり」なら付けられます。');
    expect(await handle(press(customId(G.id, 9, 'want')))).toBe('その卓が見つかりません: S009');
  });

  test('グループ・メンバーを確かめる。ほかのサーバーから押したボタン、締め出した人、まだメンバーでない人は断る', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'ひより', status: '募集' });
    expect(await handle(press('zzz'))).toBe('このボタンは使えません。Yokiの画面から操作してください。');
    expect(await handle(press(customId('nope', 1, 'want')))).toBe('このボタンのグループが見つかりません。');
    expect(await handle(press(customId(G.id, 1, 'want'), undefined, SORA, 'other-guild'))).toBe('このボタンのグループが見つかりません。');
    expect(await handle({ ...press(customId(G.id, 1, 'want')), guild_id: undefined })).toBe('このボタンのグループが見つかりません。');
    expect(await handle(press(customId(G.id, 1, 'want'), undefined, '400000000000000077'))).toBe('まだこのグループのメンバーではありません。一度Yokiでグループを開いてから、もう一度押してください: https://yoki.test/g/grp/');
    // DMなどでuserで届いたときも、その人で読む
    expect(await handle({ ...press(customId(G.id, 1, 'want')), member: undefined, user: { id: '400000000000000077' } })).toContain('まだこのグループのメンバーではありません');
    expect(await handle({ ...press(customId(G.id, 1, 'want')), member: undefined })).toContain('まだこのグループのメンバーではありません');
    await env.DB.prepare("UPDATE users SET banned_at = 'x' WHERE id = ?").bind(SORA).run();
    expect(await handle(press(customId(G.id, 1, 'want')))).toBe('このアカウントでは使えません。');
  });

  test('Botのトークンが無くても、回答は書ける（そろった知らせは送れずに記録する）', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', members: ['ソラ'], status: '調整中' });
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(3)] });
    await env.DB.prepare("UPDATE groups SET channel_id = '123456789012345678'").run();
    const r = await handleComponent({ ...(env as unknown as Bindings), DISCORD_BOT_TOKEN: undefined }, press(customId(G.id, 1, 'any')), 'https://yoki.test', new Date(), noSleep);
    expect(r).toContain('全員の回答がそろいました。　GMへの知らせをDiscordに送れませんでした。');
  });

  test('ログインしたことが無くても、管理者がDiscordのIDを入れたメンバーなら、その人として押せる', async () => {
    await ok(G.admin, G.id, 'saveMember', { name: 'エマ', discordId: '400000000000000050' });
    await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'ひより', status: '募集' });
    expect(await handle(press(customId(G.id, 1, 'want'), undefined, '400000000000000050'))).toBe('「古城」に参加希望を出しました: エマ');
  });
});

describe('運営者がボタンを入れ切りする', () => {
  test('入れると、Public Keyを控えて受け口のURLをDiscordアプリに入れる。止められる', async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
      return Response.json({ verify_key: 'ab'.repeat(32) });
    });
    const op = await loginAs(OP, []);
    let res = await postJson('/api/admin/discord-buttons', { on: true }, op);
    expect(await res.json()).toEqual({ ok: true, message: '知らせにボタンを付けます。日程調整と募集の知らせから、Discordで答えられます。' });
    expect(calls).toEqual([
      { url: 'https://discord.com/api/v10/applications/@me', method: 'GET', body: null },
      { url: 'https://discord.com/api/v10/applications/@me', method: 'PATCH', body: { interactions_endpoint_url: 'https://yoki.test/api/discord/interactions' } },
    ]);
    expect(((await (await call('/api/admin/overview', { sid: op })).json()) as { discordButtons: boolean }).discordButtons).toBe(true);
    expect((await ok(G.admin, G.id, 'getConsoleData')).bot).toBeDefined();
    res = await postJson('/api/admin/discord-buttons', { on: false }, op);
    expect(((await res.json()) as { message: string }).message).toBe('知らせにボタンを付けるのをやめました。');
    expect((await postJson('/api/admin/discord-buttons', { on: true }, G.admin)).status).toBe(403);
  });

  test('Botのトークンが無い・Public Keyを読めない・URLを受け付けないときは断る', async () => {
    const e = env as unknown as Bindings;
    await expect(setButtons({ ...e, DISCORD_BOT_TOKEN: '' }, true, 'https://yoki.test')).rejects.toThrow('Botのトークンが無いので');
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('nope', { status: 401 }));
    await expect(setButtons(e, true, 'https://yoki.test')).rejects.toThrow('Public Keyを読めませんでした（HTTP 401）');
    fetch.mockImplementation(async (_i, init) => (init?.method === 'PATCH' ? new Response('{}', { status: 400 }) : Response.json({ verify_key: 'ab'.repeat(32) })));
    await expect(setButtons(e, true, 'http://localhost:5173')).rejects.toThrow('受け口のURL（http://localhost:5173/api/discord/interactions）を受け付けませんでした（HTTP 400）');
    expect(await env.DB.prepare("SELECT value FROM meta WHERE key = 'discord_buttons'").first('value')).toBeNull();
  });
});

describe('知らせに付けるボタン', () => {
  const ctxOf = async (buttons: boolean, appUrl = 'https://yoki.test/g/grp/') => ({ ...(await loadGroup(env.DB, G.id, { memberId: 0, name: '', isAdmin: true, userId: '' }, appUrl)), buttons });

  test('日程調整の知らせ: 予定表から答える・どの日でもいい・Yokiで答える、と行ける日を選ぶ欄（これからの候補日だけ）', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', members: ['ソラ'], status: '調整中' });
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(3), T(4)] });
    const ctx = await ctxOf(true), s = ctx.sessions[0]!;
    const p = pollPayload(ctx, s, 'ひより');
    expect(p.content).toContain('下のボタンでも答えられます。');
    expect(p.components).toEqual([
      { type: 1, components: [
        { type: 2, style: 1, label: '予定表から答える', custom_id: 'yoki:grp:1:fill' }, { type: 2, style: 2, label: 'どの日でもいい', custom_id: 'yoki:grp:1:any' },
        { type: 2, style: 5, label: 'Yokiで答える', url: 'https://yoki.test/g/grp/' },
      ] },
      { type: 1, components: [{ type: 3, custom_id: 'yoki:grp:1:days', placeholder: '行ける日を選ぶ（選ばなかった日は ×）', min_values: 0, max_values: 2, options: expect.any(Array) }] },
    ]);
    expect(pollPayload(await ctxOf(false), s, '').components).toBeUndefined();
    expect(pollComponents({ ...ctx, appUrl: '' }, { ...s, candidates: [T(-1)] })).toBeUndefined();
    expect(pollComponents({ ...ctx, appUrl: '' }, s)![0]!.components).toHaveLength(2);
  });

  test('募集の知らせ: 登録・変更・興味ありの人に聞く。消したときと、募集でない卓には付けない', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'ひより', status: '募集' });
    await ok(G.sora, G.id, 'setInterest', { id: 'S001', name: 'ソラ', level: 'interest' });
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', date: T(3), status: '開催' });
    const ctx = await ctxOf(true), [rec, held] = ctx.sessions as [any, any];
    const labels = (c: ReturnType<typeof recruitComponents>) => c?.[0]?.components.map((x) => ('label' in x ? x.label : ''));
    expect(labels(changePayload(ctx, rec, '登録', 'ひより').components)).toEqual(['参加希望', '興味あり', '取り消す', 'Yokiで見る']);
    expect(labels(askPayload(ctx, rec, 'ひより', '').components)).toHaveLength(4);
    expect(changePayload(ctx, rec, '削除', 'ひより').components).toBeUndefined();
    expect(changePayload(ctx, held, '変更', 'ひより').components).toBeUndefined();
    expect(labels(recruitComponents({ ...ctx, appUrl: '' }, rec))).toEqual(['参加希望', '興味あり', '取り消す']);
  });
});
