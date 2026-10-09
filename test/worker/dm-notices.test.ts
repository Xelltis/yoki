// 自分あてのDMの知らせ: 本人が選ぶ・試しに送る、知らせと一緒に積む（受け取ると決めた人だけ）、見回りが少しずつ送る（チャンネルの控え・届かない理由・送り直し）
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SYSTEM_ACTOR } from '../../src/worker/auth/guard';
import { DM_PER_RUN, DM_TRIES, dmStmt, sendQueuedDms, testDm } from '../../src/worker/domain/dm-notices';
import { consoleData } from '../../src/worker/domain/console-data';
import { loadGroup } from '../../src/worker/domain/load';
import { patrol, sendPollDue, sendReminders, sendSheetUrges, sendStartingSoon } from '../../src/worker/domain/patrol';
import type { Bindings } from '../../src/worker/env';
import { addDays, fmtDateJa } from '../../src/worker/lib/jst';
import { fail, ok, setupGroup, today } from './helpers';

const CH = '123456789012345678';
const HIYORI = '400000000000000010', SORA = '400000000000000011', KOMACHI = '400000000000000012';
const noWait = { sleep: async () => {} };
let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
type Req = { url: string; body: Record<string, any> };
let reqs: Req[];
/** DiscordのAPIを差し替える。replyは道ごとの返事（無ければ、DMのチャンネルは dm-<相手> を返し、そのほかは200） */
function mockDiscord(reply: (r: Req) => Response | undefined = () => undefined) {
  reqs = [];
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const r = { url, body: JSON.parse(String(init?.body)) };
    reqs.push(r);
    const own = reply(r);
    if (own) return own;
    if (url.endsWith('/users/@me/channels')) return Response.json({ id: 'dm-' + String(r.body.recipient_id) });
    return Response.json({ id: 'm1' });
  });
}
/** DMで書いた文（相手と本文） */
const dms = () => reqs.filter((r) => r.url.includes('/channels/dm-')).map((r) => ({ to: r.url.split('/channels/dm-')[1]!.split('/')[0], text: String(r.body.content) }));
const queue = async () => (await env.DB.prepare('SELECT user_id, text, tries FROM dm_queue ORDER BY id').all<{ user_id: string; text: string; tries: number }>()).results;
const user = (id: string) => env.DB.prepare('SELECT dm_kinds, dm_channel, dm_error FROM users WHERE id = ?').bind(id).first<{ dm_kinds: string; dm_channel: string; dm_error: string }>();
/** その日（日本時間）のその時刻に、見回りが読むグループ */
const loadAt = (day: string, hhmm = '20:00') =>
  loadGroup(env.DB, G.id, SYSTEM_ACTOR, 'https://yoki.test/g/' + G.id + '/', new Date(day + 'T' + hhmm + ':00+09:00'), { token: 'test-bot-token', clientId: 'c' });
const optIn = (sid: string, kinds: string[]) => ok(sid, G.id, 'setDmNotices', { kinds });

beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
  await env.DB.prepare('UPDATE groups SET channel_id = ?1, remind_enabled = 1, notify_days = 1, notify_hour = 20, soon = 1, soon_minutes = 30 WHERE id = ?2').bind(CH, G.id).run();
  mockDiscord();
});
afterEach(() => vi.restoreAllMocks());

describe('本人が選ぶ', () => {
  test('受け取る知らせを選ぶと、画面データに出る。どのグループにも効く。知らない種類は断る。止めると届かなかった理由も消す', async () => {
    let r = await optIn(G.sora, ['remind', 'poll', 'remind']);
    expect(r.message).toBe('DMで受け取る知らせを保存しました（2種類。どのグループにも効きます）。');
    expect(r.data.me.dm).toEqual({ kinds: ['remind', 'poll'], error: '' });
    expect((await user(SORA))!.dm_kinds).toBe('remind,poll');
    expect((await fail(G.sora, G.id, 'setDmNotices', { kinds: ['remind', 'spam'] })).error).toBe('知らない知らせの種類です: spam');
    await env.DB.prepare("UPDATE users SET dm_error = 'x' WHERE id = ?").bind(SORA).run();
    r = await optIn(G.sora, ['sheet']);
    expect(r.data.me.dm).toEqual({ kinds: ['sheet'], error: 'x' });
    r = await optIn(G.sora, []);
    expect(r.message).toBe('DMの知らせを止めました。');
    expect(r.data.me.dm).toEqual({ kinds: [], error: '' });
    // ほかの人の設定は画面データに出ない
    expect((await ok(G.komachi, G.id, 'getConsoleData')).me.dm).toEqual({ kinds: [], error: '' });
  });

  test('人でない読み込み（メンバーでない）では、DMの知らせは空', async () => {
    expect(consoleData(await loadAt(T(0))).me).toMatchObject({ shareBusy: false, dm: { kinds: [], error: '' } });
  });

  test('試しに送る: 届いたらチャンネルを控える。届かなければ理由を残して断る。Botのトークンが無ければ送れない', async () => {
    let r = await ok(G.sora, G.id, 'testDm');
    expect(r.message).toBe('DMを送りました。Discordで届いたかを確かめてください。');
    expect(dms()).toEqual([{ to: SORA, text: '🔔 Yokiからの試しのDMです。選んだ知らせは、このように届きます。' }]);
    expect((await user(SORA))!.dm_channel).toBe('dm-' + SORA);
    mockDiscord((q) => (q.url.endsWith('/messages') ? Response.json({ code: 50007 }, { status: 403 }) : undefined));
    expect((await fail(G.sora, G.id, 'testDm')).error).toContain('DMを送れませんでした（DMを受け取れない設定です。');
    r = await ok(G.sora, G.id, 'getConsoleData');
    expect(r.me.dm.error).toContain('DMを受け取れない設定です');
    mockDiscord((q) => (q.url.endsWith('/users/@me/channels') ? new Response('', { status: 500 }) : undefined));
    expect((await fail(G.sora, G.id, 'testDm')).error).toBe('DMを送れませんでした（HTTP 500）。');
    expect((await user(SORA))!.dm_channel).toBe('');
    const ctx = await loadGroup(env.DB, G.id, { memberId: 1, name: 'ひより', isAdmin: true, userId: HIYORI }, '', new Date(), { token: '', clientId: '' });
    await expect(testDm(ctx)).rejects.toThrow('YokiのBotのトークンが無いので、DMを送れません');
  });
});

describe('積む', () => {
  test('受け取ると決めた人だけに積む。ログインしていないメンバーには積まない。文にグループの名前とURLを添える', async () => {
    await optIn(G.sora, ['remind']);
    await optIn(G.komachi, ['poll']);
    await env.DB.prepare("INSERT INTO members (group_id, name, created_at) VALUES (?, 'ゲスト', 'x')").bind(G.id).run();
    const ctx = await loadAt(T(0));
    await dmStmt(ctx, 'remind', ['ひより', 'ソラ', 'こまち', 'ゲスト', 'ソラ'], '本文')!.run();
    expect(await queue()).toEqual([{ user_id: SORA, text: '【テストの卓】本文\nhttps://yoki.test/g/' + G.id + '/', tries: 0 }]);
    expect(dmStmt(ctx, 'remind', ['ゲスト', 'いない人'], '本文')).toBeNull();
    await dmStmt({ ...ctx, appUrl: '' }, 'poll', ['こまち'], '本文')!.run();
    expect((await queue())[1]).toEqual({ user_id: KOMACHI, text: '【テストの卓】本文', tries: 0 });
  });
});

describe('見回りが送る', () => {
  const put = (id: string, text: string, created = new Date().toISOString(), tries = 0) =>
    env.DB.prepare('INSERT INTO dm_queue (user_id, text, created_at, tries) VALUES (?1, ?2, ?3, ?4)').bind(id, text, created, tries).run();

  test('古い順に送り、送ったら消す。チャンネルを開いたら控え、次からは開かずに書く', async () => {
    await put(SORA, 'a');
    await put(KOMACHI, 'b');
    await put(SORA, 'c');
    expect(await sendQueuedDms(env.DB, 'tok', new Date())).toBe(3);
    expect(dms()).toEqual([{ to: SORA, text: 'a' }, { to: KOMACHI, text: 'b' }, { to: SORA, text: 'c' }]);
    expect(reqs.filter((r) => r.url.endsWith('/users/@me/channels'))).toHaveLength(2);
    expect(await queue()).toEqual([]);
    expect((await user(SORA))!.dm_channel).toBe('dm-' + SORA);
    mockDiscord();
    await put(SORA, 'd');
    await sendQueuedDms(env.DB, 'tok', new Date());
    expect(reqs.map((r) => r.url)).toEqual(['https://discord.com/api/v10/channels/dm-' + SORA + '/messages']);
  });

  test('1回に送るのはDM_PER_RUN通まで。古くなった控えは送らずに捨てる。トークンが無ければ送らない', async () => {
    for (let i = 0; i < DM_PER_RUN + 2; i++) await put(SORA, 'n' + i);
    await put(KOMACHI, '古い', new Date(Date.now() - 13 * 3600_000).toISOString());
    expect(await sendQueuedDms(env.DB, '', new Date())).toBe(0);
    expect(await queue()).toHaveLength(DM_PER_RUN + 2);
    expect(await sendQueuedDms(env.DB, 'tok', new Date())).toBe(DM_PER_RUN);
    expect((await queue()).map((q) => q.text)).toEqual(['n' + DM_PER_RUN, 'n' + (DM_PER_RUN + 1)]);
  });

  test('受け取れない設定なら、理由を本人に残して捨てる。次に届いたら理由を消す', async () => {
    await put(SORA, 'a');
    mockDiscord((q) => (q.url.endsWith('/messages') ? Response.json({ code: 50007 }, { status: 403 }) : undefined));
    expect(await sendQueuedDms(env.DB, 'tok', new Date())).toBe(0);
    expect(await queue()).toEqual([]);
    expect((await user(SORA))!.dm_error).toContain('DMを受け取れない設定です');
    await put(SORA, 'b');
    mockDiscord();
    await sendQueuedDms(env.DB, 'tok', new Date());
    expect((await user(SORA))!.dm_error).toBe('');
  });

  test('Discordが混んでいる・通信が切れたときは、上限まで送り直す。トークンが使えなければ、そこで止める', async () => {
    await put(SORA, 'a');
    mockDiscord((q) => (q.url.endsWith('/messages') ? new Response('', { status: 503 }) : undefined));
    await sendQueuedDms(env.DB, 'tok', new Date());
    expect((await queue())[0]!.tries).toBe(1);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'));
    await sendQueuedDms(env.DB, 'tok', new Date());
    expect((await queue())[0]!.tries).toBe(DM_TRIES - 1);
    await sendQueuedDms(env.DB, 'tok', new Date());
    expect(await queue()).toEqual([]);
    expect((await user(SORA))!.dm_error).toBe('通信が切れました（down）');

    await put(SORA, 'b');
    await put(KOMACHI, 'c');
    mockDiscord(() => new Response('', { status: 401 }));
    await sendQueuedDms(env.DB, 'tok', new Date());
    expect(reqs).toHaveLength(1);
    expect((await queue()).map((q) => q.tries)).toEqual([0, 0]);
  });

  test('控えたチャンネルが無くなっていたら、控えを外して次の回に開き直す', async () => {
    await env.DB.prepare("UPDATE users SET dm_channel = 'old' WHERE id = ?").bind(SORA).run();
    await put(SORA, 'a');
    mockDiscord((q) => (q.url.includes('/channels/old/') ? new Response('', { status: 404 }) : undefined));
    await sendQueuedDms(env.DB, 'tok', new Date());
    expect((await user(SORA))!.dm_channel).toBe('');
    expect((await queue())[0]!.tries).toBe(1);
    await sendQueuedDms(env.DB, 'tok', new Date());
    expect(dms()).toEqual([{ to: SORA, text: 'a' }]);
    expect((await user(SORA))!.dm_channel).toBe('dm-' + SORA);
  });

  test('同じ回に、同じ人の1通が届き1通が届かなければ、届かなかった理由を残す', async () => {
    await put(SORA, 'a');
    await put(SORA, 'b');
    let n = 0;
    mockDiscord((q) => (q.url.endsWith('/messages') && n++ === 1 ? Response.json({ code: 50001 }, { status: 403 }) : undefined));
    expect(await sendQueuedDms(env.DB, 'tok', new Date())).toBe(1);
    expect((await user(SORA))!.dm_error).toBe('HTTP 403・50001');
  });

  test('チャンネルを開けなければ、理由を残して捨てる', async () => {
    await put(SORA, 'a');
    mockDiscord((q) => (q.url.endsWith('/users/@me/channels') ? Response.json({ code: 50007 }, { status: 403 }) : undefined));
    await sendQueuedDms(env.DB, 'tok', new Date());
    expect(await queue()).toEqual([]);
    expect((await user(SORA))!.dm_error).toContain('DMを受け取れない設定です');
  });

  test('見回りが毎回、積んだDMを送る', async () => {
    await put(SORA, 'a');
    await patrol(env as unknown as Bindings, Date.now(), noWait);
    expect(dms()).toEqual([{ to: SORA, text: 'a' }]);
  });
});

describe('知らせと一緒に積む', () => {
  test('開催前の知らせ: 届いた卓のGMと参加者のうち、受け取ると決めた人に（行けなくなった人は除く）', async () => {
    await optIn(G.sora, ['remind']);
    await optIn(G.komachi, ['remind']);
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', members: ['ソラ', 'こまち'], date: T(1), start: '20:00', end: '23:00', status: '開催' });
    await ok(G.komachi, G.id, 'setAbsence', { id: 'S001', name: 'こまち', note: '' });
    await env.DB.prepare('DELETE FROM dm_queue').run();
    await sendReminders(await loadAt(T(0)), 20, noWait);
    expect(await queue()).toEqual([{ user_id: SORA, text: '【テストの卓】📢 明日は「港」の日です（' + fmtDateJa(T(1)) + ' 20:00〜23:00）\nhttps://yoki.test/g/' + G.id + '/', tries: 0 }]);
  });

  test('開催前の知らせが届かなければ積まない', async () => {
    await optIn(G.sora, ['remind']);
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', members: ['ソラ'], date: T(1), status: '開催' });
    mockDiscord(() => new Response('', { status: 403 }));
    await sendReminders(await loadAt(T(0)), 20, noWait);
    expect(await queue()).toEqual([]);
  });

  test('開始直前の知らせ: 届いたら、GMと参加者のうち受け取ると決めた人に', async () => {
    await optIn(G.admin, ['remind']);
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', members: ['ソラ'], date: T(0), start: '21:00', status: '開催' });
    await sendStartingSoon(await loadAt(T(0), '20:40'), noWait);
    expect((await queue()).map((q) => q.text.split('\n')[0])).toEqual(['【テストの卓】⏰ あと20分で「港」が始まります（21:00〜）。']);
  });

  test('キャラシの催促: まだ出していない参加者に。送り先のチャンネルが無くても積む', async () => {
    await optIn(G.sora, ['sheet']);
    await optIn(G.komachi, ['sheet']);
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', members: ['ソラ', 'こまち'], date: T(5), status: '開催' });
    await ok(G.admin, G.id, 'savePrep', { id: 'S001', sheetDue: T(1) });
    await ok(G.komachi, G.id, 'submitSheet', { id: 'S001', name: 'こまち', url: 'https://example.com/s' });
    await env.DB.prepare("UPDATE groups SET channel_id = '' WHERE id = ?").bind(G.id).run();
    await sendSheetUrges(await loadAt(T(0)), 20, noWait);
    expect((await queue()).map((q) => [q.user_id, q.text.split('\n')[0]])).toEqual([[SORA, '【テストの卓】📝 「港」のキャラシの締め切りは明日（' + fmtDateJa(T(1)) + '）です。まだ出していません。']]);
    // 締め切りの当日なら「今日」
    await env.DB.prepare('UPDATE sessions SET sheet_urged_at = NULL').run();
    await env.DB.prepare('UPDATE groups SET channel_id = ?1 WHERE id = ?2').bind(CH, G.id).run();
    await sendSheetUrges(await loadAt(T(1)), 20, noWait);
    expect((await queue())[1]!.text).toContain('締め切りは今日');
  });

  test('日程調整: 締め切りの前日は答えていない人に、過ぎたらGMに。回答がそろったらGMに、決まったら決めた人のほかに', async () => {
    for (const sid of [G.admin, G.sora, G.komachi]) await optIn(sid, ['poll']);
    await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ソラ', members: ['ひより', 'こまち'], status: '調整中' });
    await ok(G.sora, G.id, 'startPoll', { id: 'S001', dates: [T(5)], due: T(3) });
    await env.DB.prepare("UPDATE groups SET channel_id = '' WHERE id = ?").bind(G.id).run();
    await sendPollDue(await loadAt(T(2)), 20, noWait);
    expect((await queue()).map((q) => q.user_id)).toEqual([HIYORI, KOMACHI]);
    expect((await queue())[0]!.text.split('\n')[0]).toBe('【テストの卓】⏰ 「迷宮」の日程調整の締め切りは明日（' + fmtDateJa(T(3)) + '）です。まだ答えていない候補日があります。');
    await env.DB.prepare('DELETE FROM dm_queue').run();
    await env.DB.prepare('UPDATE groups SET channel_id = ?1 WHERE id = ?2').bind(CH, G.id).run();
    await sendPollDue(await loadAt(T(4)), 20, noWait);
    expect((await queue()).map((q) => [q.user_id, q.text.split('\n')[0]])).toEqual([[SORA, '【テストの卓】⌛ 「迷宮」の日程調整の締め切り（' + fmtDateJa(T(3)) + '）が過ぎました。開催日を選ぶか、候補日を選び直してください。']]);
    // 締め切りの前日の知らせが届かなければ、DMも積まない（次の回に送り直す）
    await env.DB.prepare('DELETE FROM dm_queue').run();
    await env.DB.prepare('UPDATE sessions SET poll_urged_at = NULL').run();
    mockDiscord(() => new Response('', { status: 403 }));
    await sendPollDue(await loadAt(T(2)), 20, noWait);
    expect(await queue()).toEqual([]);
    mockDiscord();
    // 回答がそろったらGMに（最後に答えたのがGMなら送らない）
    await ok(G.admin, G.id, 'setPollVote', { id: 'S001', name: 'ひより', ymd: T(5), vote: '◯' });
    await ok(G.komachi, G.id, 'setPollVote', { id: 'S001', name: 'こまち', ymd: T(5), vote: '◯' });
    expect((await queue()).map((q) => [q.user_id, q.text.split('\n')[0]])).toEqual([[SORA, '【テストの卓】📝 「迷宮」の日程調整の回答がそろいました。開催日を選んでください。']]);
    await env.DB.prepare('DELETE FROM dm_queue').run();
    await ok(G.sora, G.id, 'decidePoll', { id: 'S001', ymd: T(5) });
    expect((await queue()).map((q) => [q.user_id, q.text.split('\n')[0]])).toEqual([
      [HIYORI, '【テストの卓】✅ 「迷宮」の日程が決まりました: ' + fmtDateJa(T(5)) + ' 時間未定'],
      [KOMACHI, '【テストの卓】✅ 「迷宮」の日程が決まりました: ' + fmtDateJa(T(5)) + ' 時間未定'],
    ]);
  });

  test('回答がそろった知らせが届かなければ、GMにDMを積まない（そろった印を外して送り直すため）', async () => {
    await optIn(G.sora, ['poll']);
    await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ソラ', members: ['ひより'], status: '調整中' });
    await ok(G.sora, G.id, 'startPoll', { id: 'S001', dates: [T(5)] });
    mockDiscord(() => new Response('', { status: 403 }));
    await ok(G.admin, G.id, 'setPollVote', { id: 'S001', name: 'ひより', ymd: T(5), vote: '◯' });
    expect(await queue()).toEqual([]);
  });

  test('キャンセル待ちの繰り上げ: 繰り上がった本人に（送り先のチャンネルが無くても）', async () => {
    await optIn(G.komachi, ['wait']);
    await env.DB.prepare("UPDATE groups SET channel_id = '' WHERE id = ?").bind(G.id).run();
    await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'ひより', status: '募集', capacity: 1 });
    await ok(G.sora, G.id, 'setInterest', { id: 'S001', name: 'ソラ', level: 'want' });
    await ok(G.komachi, G.id, 'setInterest', { id: 'S001', name: 'こまち', level: 'want' });
    await ok(G.sora, G.id, 'setInterest', { id: 'S001', name: 'ソラ', level: 'none' });
    expect((await queue()).map((q) => [q.user_id, q.text.split('\n')[0]])).toEqual([[KOMACHI, '【テストの卓】🎟️ 「古城」のキャンセル待ちから、参加希望に繰り上がりました。']]);
  });
});
