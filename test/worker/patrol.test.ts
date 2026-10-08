// 知らせの見回り（§23・40・46・47）。時刻はscheduledTimeで渡す（日本時間 = UTC + 9）
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { loadGroup } from '../../src/worker/domain/load';
import { type PatrolRecord, patrol, runPatrol, sendSheetUrges, sendStartingSoon, sendUrges } from '../../src/worker/domain/patrol';
import { addDays } from '../../src/worker/lib/jst';
import { makeGroup } from './helpers';

const CH = '123456789012345678';          // 基本のチャンネル
const SERIES_CH = '123456789012345679';   // シリーズのチャンネル
/** Botがメッセージを書くDiscordのAPI */
const msgUrl = (ch: string) => 'https://discord.com/api/v10/channels/' + ch + '/messages';
const DAY = '2026-10-10';   // 「今日」（日本時間）
const at = (hhmm: string) => Date.parse(DAY + 'T' + hhmm + ':00+09:00');
const noWait = { sleep: async () => {} };
let posts: { url: string; content: string; embeds: number; auth: string | null; allowed: unknown }[] = [];

/** Botの送信を差し替える。codesの順に返し、尽きたら200 */
function mockBot(codes: number[] = []) {
  posts = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(String(init?.body));
    posts.push({ url, content: body.content, embeds: (body.embeds ?? []).length, auth: new Headers(init?.headers).get('Authorization'), allowed: body.allowed_mentions });
    return new Response('{}', { status: codes.shift() ?? 200 });
  });
}

let seq = 1;
async function addSession(o: { name: string; status?: string; date?: string | null; start?: string; gm?: string; members?: string[]; series?: string; windowFrom?: string; windowTo?: string }) {
  const s = seq++;
  await env.DB.prepare(
    `INSERT INTO sessions (group_id, seq, name, status, date, start_time, series, window_from, window_to, updated_at) VALUES ('g', ?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01')`,
  ).bind(s, o.name, o.status ?? '開催', o.date ?? null, o.start ?? '', o.series ?? '', o.windowFrom ?? null, o.windowTo ?? null).run();
  const people = [...(o.gm ? [['gm', o.gm]] : []), ...(o.members ?? []).map((n) => ['member', n])];
  for (const [i, [role, name]] of people.entries()) {
    await env.DB.prepare(
      `INSERT INTO session_people (session_id, role, pos, member_id) SELECT (SELECT id FROM sessions WHERE seq = ?), ?, ?, (SELECT id FROM members WHERE name = ?)`,
    ).bind(s, role, i, name).run();
  }
}
const mark = (name: string, col: string) => env.DB.prepare(`SELECT ${col} AS v FROM sessions WHERE name = ?`).bind(name).first('v');

beforeEach(async () => {
  seq = 1;
  await makeGroup('g', 'guild');
  await env.DB.batch([
    env.DB.prepare("UPDATE groups SET channel_id = ?, remind_enabled = 1, notify_days = 1, notify_hour = 20 WHERE id = 'g'").bind(CH),
    env.DB.prepare("INSERT INTO members (group_id, name, discord_id, created_at) VALUES ('g', 'ひより', '400000000000000010', 'x'), ('g', 'ソラ', '400000000000000011', 'x')"),
  ]);
  mockBot();
});
afterEach(() => vi.restoreAllMocks());

describe('開催前の知らせ', () => {
  test('知らせの日の、送る時刻になったら1通にまとめて送る。同じ時刻台に何度回っても、次の時刻台でも送り直さない', async () => {
    await addSession({ name: '明日の卓', date: addDays(DAY, 1), start: '20:00', gm: 'ひより', members: ['ソラ'] });
    await addSession({ name: 'あさっての卓', date: addDays(DAY, 2), gm: 'ソラ' });
    await patrol(env, at('19:00'), noWait);
    expect(posts).toHaveLength(0);
    await patrol(env, at('20:00'), noWait);
    expect(posts).toHaveLength(1);
    // Botのトークンでチャンネルに書く。メンションで呼ぶのは人だけ
    expect(posts[0]).toEqual({
      url: msgUrl(CH), content: '📢 明日は卓の日です！ <@400000000000000010> <@400000000000000011>', embeds: 1,
      auth: 'Bot test-bot-token', allowed: { parse: ['users'] },
    });
    expect(await mark('明日の卓', 'notified_at')).not.toBeNull();
    await patrol(env, at('20:05'), noWait);
    await patrol(env, at('21:00'), noWait);
    expect(posts).toHaveLength(1);
  });

  test('シリーズごとの日時とチャンネル（基本にも送るなら両方）', async () => {
    await env.DB.prepare("INSERT INTO series_notify (group_id, series, channel_id, also_base, days, hour, updated_at) VALUES ('g', '港', ?, 1, 3, 9, 'x')").bind(SERIES_CH).run();
    await addSession({ name: '港 #1', series: '港', date: addDays(DAY, 3), gm: 'ひより' });
    await patrol(env, at('09:00'), noWait);
    expect(posts.map((p) => p.url).sort()).toEqual([msgUrl(CH), msgUrl(SERIES_CH)].sort());
    expect(posts[0]!.content).toContain('3日後は卓の日です！');
  });

  test('11卓を超えたら10卓ごとに分けて送り、届いた卓だけを送った扱いにする', async () => {
    for (let i = 1; i <= 12; i++) await addSession({ name: '卓' + i, date: addDays(DAY, 1), gm: 'ひより' });
    mockBot([200, 500, 500, 500]);
    await patrol(env, at('20:00'), noWait);
    expect(posts.map((p) => p.embeds)).toEqual([10, 2, 2, 2]);
    expect(await mark('卓1', 'notified_at')).not.toBeNull();
    // 2通目は3回とも失敗したので、印を戻して次の時刻台で送り直す
    expect(await mark('卓12', 'notified_at')).toBeNull();
    mockBot();
    await patrol(env, at('21:00'), noWait);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.embeds).toBe(2);
  });

  test('有効にしていないグループには送らない。チャンネルが無ければ送らずに記録する', async () => {
    await addSession({ name: '明日の卓', date: addDays(DAY, 1), gm: 'ひより' });
    await env.DB.prepare("UPDATE groups SET remind_enabled = 0 WHERE id = 'g'").run();
    await patrol(env, at('20:00'), noWait);
    expect(posts).toHaveLength(0);
    await env.DB.prepare("UPDATE groups SET remind_enabled = 1, channel_id = '' WHERE id = 'g'").run();
    await patrol(env, at('21:00'), noWait);
    expect(posts).toHaveLength(0);
    expect(await env.DB.prepare('SELECT result FROM notify_log ORDER BY id DESC').first('result')).toBe('送らず: 送り先のチャンネルが未設定');
  });

  test('ほかの知らせ（キャラシの催促・期間前の催促）でグループを読んでも、止めている開催前の知らせは送らない', async () => {
    await addSession({ name: '明日の卓', date: addDays(DAY, 1), gm: 'ひより', members: ['ソラ'] });
    await addSession({ name: '古城', status: '募集', windowFrom: addDays(DAY, 1), windowTo: addDays(DAY, 10), gm: 'ひより' });
    await env.DB.prepare("UPDATE sessions SET sheet_due = ? WHERE name = '明日の卓'").bind(addDays(DAY, 1)).run();
    await env.DB.prepare("UPDATE groups SET remind_enabled = 0 WHERE id = 'g'").run();
    await patrol(env, at('20:00'), noWait);
    expect(posts.map((p) => [...p.content][0])).toEqual(['⏳', '📝']);
    expect(await mark('明日の卓', 'notified_at')).toBeNull();
  });

  test('Botのトークンが無ければ（運営者の設定）送らずに失敗を記録し、印を戻す', async () => {
    await addSession({ name: '明日の卓', date: addDays(DAY, 1), gm: 'ひより' });
    // 本番ではsecretのDISCORD_BOT_TOKENを入れ忘れることがある
    await patrol({ ...env, DISCORD_BOT_TOKEN: undefined as unknown as string }, at('20:00'), noWait);
    expect(posts).toHaveLength(0);
    expect(await env.DB.prepare('SELECT result FROM notify_log ORDER BY id DESC').first('result')).toMatch(/^送信失敗（Botの設定）/);
    expect(await mark('明日の卓', 'notified_at')).toBeNull();
  });
});

describe('期間前の催促と開始直前の知らせ', () => {
  test('期間の始まりが明日の募集中の卓を、GMに知らせる', async () => {
    await addSession({ name: '古城', status: '募集', windowFrom: addDays(DAY, 1), windowTo: addDays(DAY, 10), gm: 'ひより' });
    await patrol(env, at('20:00'), noWait);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.content).toBe('⏳ 明日から「古城」の募集の期間です。まだ参加者を集めている途中です。 <@400000000000000010>\n🔗 参加希望はYokiの「募集・調整」タブから: https://yoki.test/g/g/');
    expect(await mark('古城', 'urged_at')).not.toBeNull();
    await patrol(env, at('21:00'), noWait);
    expect(posts).toHaveLength(1);
  });

  test('期間前の催促を止めたグループには、ほかの知らせ（開催前の知らせ）でグループを読んでも送らない', async () => {
    await addSession({ name: '古城', status: '募集', windowFrom: addDays(DAY, 1), windowTo: addDays(DAY, 10), gm: 'ひより' });
    await addSession({ name: '明日の卓', date: addDays(DAY, 1), gm: 'ひより' });
    await env.DB.prepare("UPDATE groups SET urge = 0 WHERE id = 'g'").run();
    await patrol(env, at('20:00'), noWait);
    expect(posts.map((p) => [...p.content][0])).toEqual(['📢']);
    expect(await mark('古城', 'urged_at')).toBeNull();
  });

  test('開始のN分前を過ぎた最初の見回りで、GMと参加者に知らせる（ONのときだけ）', async () => {
    await env.DB.prepare("UPDATE groups SET soon = 1, soon_minutes = 30 WHERE id = 'g'").run();
    await addSession({ name: '今夜の卓', date: DAY, start: '21:00', gm: 'ひより', members: ['ソラ'] });
    await patrol(env, at('20:25'), noWait);
    expect(posts).toHaveLength(0);
    await patrol(env, at('20:35'), noWait);
    expect(posts[0]!.content).toBe('⏰ あと25分で「今夜の卓」が始まります。 <@400000000000000010> <@400000000000000011>');
    await patrol(env, at('20:40'), noWait);
    expect(posts).toHaveLength(1);
  });
});

describe('毎時と毎日の仕事', () => {
  test('過ぎた「開催」の卓は終了になる。古い送信記録は片付ける', async () => {
    await addSession({ name: '昨日の卓', date: addDays(DAY, -1) });
    const rows = Array.from({ length: 510 }, (_, i) => `('g', 'x', 'k', 't', 'r${i}')`).join(',');
    await env.DB.prepare('INSERT INTO notify_log (group_id, at, kind, target, result) VALUES ' + rows).run();
    await patrol(env, at('05:00'), noWait);
    expect(await mark('昨日の卓', 'status')).toBe('終了');
    expect(await env.DB.prepare('SELECT count(*) AS n FROM notify_log').first('n')).toBe(500);
  });
});

describe('見回りの様子の記録（運営者の管理画面が読む）', () => {
  const meta = async (key: string) => env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first<string>('value');

  test('うまくいったら、最後の回の結果と、うまくいった時刻を残す', async () => {
    await runPatrol(env, at('20:00'), noWait);
    const rec = JSON.parse((await meta('patrol'))!) as PatrolRecord;
    expect(rec).toMatchObject({ at: new Date(at('20:00')).toISOString(), ok: true, error: '' });
    expect(rec.ms).toBeGreaterThanOrEqual(0);
    expect(await meta('patrol_ok_at')).toBe(new Date(at('20:00')).toISOString());
  });

  test('失敗したら、理由を残してから投げ直す。うまくいった時刻は前のまま', async () => {
    await runPatrol(env, at('20:00'), noWait);
    const boom = async () => { throw new Error('D1が応えない'); };
    await expect(runPatrol(env, at('20:05'), noWait, boom)).rejects.toThrow('D1が応えない');
    const rec = JSON.parse((await meta('patrol'))!) as PatrolRecord;
    expect(rec).toMatchObject({ at: new Date(at('20:05')).toISOString(), ok: false, error: 'D1が応えない' });
    expect(await meta('patrol_ok_at')).toBe(new Date(at('20:00')).toISOString());
  });
});

describe('見回りの端の場合', () => {
  const SYSTEM = { memberId: 0, name: '', isAdmin: true, userId: '' };
  const load = (hhmm: string) => loadGroup(env.DB, 'g', SYSTEM, '', new Date(at(hhmm)), { token: env.DISCORD_BOT_TOKEN, clientId: env.DISCORD_CLIENT_ID });
  const lastLog = () => env.DB.prepare('SELECT result FROM notify_log ORDER BY id DESC').first('result');
  /** DiscordのIDの無いメンバー（知らせにメンションが付かない） */
  const addGuest = () => env.DB.prepare("INSERT INTO members (group_id, name, created_at) VALUES ('g', 'ゲスト', 'x')").run();

  test('Errorでないものが投げられても、文にして残してから投げ直す', async () => {
    await expect(runPatrol(env, at('20:00'), noWait, async () => { throw '止まった'; })).rejects.toBe('止まった');
    const rec = JSON.parse((await env.DB.prepare("SELECT value FROM meta WHERE key = 'patrol'").first<string>('value'))!) as PatrolRecord;
    expect(rec).toMatchObject({ ok: false, error: '止まった' });
  });

  test('メンションする人がいなければ、文だけを送る。アプリのURLが無ければリンクを付けない', async () => {
    await addGuest();
    await addSession({ name: '明日の卓', date: addDays(DAY, 1), gm: 'ゲスト' });
    await addSession({ name: '古城', status: '調整中', windowFrom: addDays(DAY, 1), gm: 'ゲスト' });
    await patrol({ ...env, APP_URL: '' }, at('20:00'), noWait);
    expect(posts.map((p) => p.content).sort()).toEqual(['⏳ 明日から「古城」の候補の期間です。まだ開催日が決まっていません。', '📢 明日は卓の日です！']);
  });

  test('アプリのURLが無くても、ログインのときに控えたアドレス（workers.devのまま公開したとき）でリンクを付ける', async () => {
    await addSession({ name: '古城', status: '募集', windowFrom: addDays(DAY, 1), gm: 'ひより' });
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('app_origin', 'https://yoki.example.workers.dev')").run();
    await patrol({ ...env, APP_URL: '' }, at('20:00'), noWait);
    expect(posts[0]!.content).toContain('から: https://yoki.example.workers.dev/g/g/');
  });

  test('期間前の催促: チャンネルが無ければ送らずに記録する。送れなければ印を戻して次の回に送り直す', async () => {
    await addSession({ name: '古城', status: '募集', windowFrom: addDays(DAY, 1), gm: 'ひより' });
    await env.DB.prepare("UPDATE groups SET channel_id = '' WHERE id = 'g'").run();
    await patrol(env, at('20:00'), noWait);
    expect(posts).toHaveLength(0);
    expect(await lastLog()).toBe('送らず: 送り先のチャンネルが未設定');
    await env.DB.prepare("UPDATE groups SET channel_id = ? WHERE id = 'g'").bind(CH).run();
    mockBot([500, 500, 500]);
    await sendUrges(await load('20:00'), 20, noWait);
    expect(posts).toHaveLength(3);
    expect(await mark('古城', 'urged_at')).toBeNull();
  });

  test('期間前の催促と開始直前の知らせ: ほかの見回りが先に印を取っていたら送らない', async () => {
    await env.DB.prepare("UPDATE groups SET soon = 1, soon_minutes = 30 WHERE id = 'g'").run();
    await addSession({ name: '古城', status: '募集', windowFrom: addDays(DAY, 1), gm: 'ひより' });
    await addSession({ name: '今夜の卓', date: DAY, start: '21:00', gm: 'ひより' });
    const ctx = await load('20:40');
    await env.DB.prepare("UPDATE sessions SET urged_at = 'x', soon_at = 'x'").run();
    await sendUrges(ctx, 20, noWait);
    await sendStartingSoon(ctx, noWait);
    expect(posts).toHaveLength(0);
  });

  test('開始直前の知らせ: 開始を過ぎたら「まもなく」。時刻の無い卓とほかの日の卓は見ない', async () => {
    await addGuest();
    // 明日の卓の開催前の知らせは、ここでは見ない
    await env.DB.prepare("UPDATE groups SET soon = 1, soon_minutes = 30, remind_enabled = 0 WHERE id = 'g'").run();
    await addSession({ name: '今夜の卓', date: DAY, start: '21:00', gm: 'ゲスト' });
    await addSession({ name: '時刻なし', date: DAY, gm: 'ひより' });
    await addSession({ name: '明日の卓', date: addDays(DAY, 1), start: '21:00', gm: 'ひより' });
    await patrol(env, at('21:02'), noWait);
    expect(posts.map((p) => p.content)).toEqual(['⏰ まもなく「今夜の卓」が始まります。']);
  });

  test('開始直前の知らせ: チャンネルが無ければ送らずに記録する。送れなければ印を戻す', async () => {
    await env.DB.prepare("UPDATE groups SET soon = 1, soon_minutes = 30, channel_id = '' WHERE id = 'g'").run();
    await addSession({ name: '今夜の卓', date: DAY, start: '21:00', gm: 'ひより' });
    await patrol(env, at('20:40'), noWait);
    expect(await lastLog()).toBe('送らず: 送り先のチャンネルが未設定');
    await env.DB.prepare("UPDATE groups SET channel_id = ? WHERE id = 'g'").bind(CH).run();
    mockBot([500, 500, 500]);
    await patrol(env, at('20:45'), noWait);
    expect(posts).toHaveLength(3);
    expect(await mark('今夜の卓', 'soon_at')).toBeNull();
  });
});

describe('キャラシの催促', () => {
  /** 締め切りを決め、出した人のキャラシを入れる */
  async function sheetDue(name: string, due: string, submitted: string[] = []) {
    await env.DB.prepare('UPDATE sessions SET sheet_due = ? WHERE name = ?').bind(due, name).run();
    for (const n of submitted) {
      await env.DB.prepare(
        `INSERT INTO session_sheets (session_id, member_id, url, updated_at) SELECT (SELECT id FROM sessions WHERE name = ?), (SELECT id FROM members WHERE name = ?), 'https://example.com', 'x'`,
      ).bind(name, n).run();
    }
  }

  test('締め切りの前日、送る時刻になったら、まだ出していないPLにメンションする。次の時刻台では送り直さない', async () => {
    await addSession({ name: '港', date: addDays(DAY, 7), gm: 'ひより', members: ['ソラ'] });
    // メンバーでない参加者（ゲスト）は、キャラシを出せないので数えない
    await env.DB.prepare("INSERT INTO session_people (session_id, role, pos, guest_name) SELECT id, 'member', 9, 'ゲスト' FROM sessions WHERE name = '港'").run();
    await sheetDue('港', addDays(DAY, 1));
    await patrol(env, at('19:00'), noWait);
    expect(posts).toHaveLength(0);
    await patrol(env, at('20:00'), noWait);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.content).toBe('📝 「港」のキャラシの締め切りは明日（10/11（日））です。まだ出していない人: <@400000000000000011>\n🔗 キャラシはYokiの卓の「準備」から出せます: https://yoki.test/g/g/');
    expect(await mark('港', 'sheet_urged_at')).not.toBeNull();
    await patrol(env, at('21:00'), noWait);
    expect(posts).toHaveLength(1);
  });

  test('前日に送れなかったら、締め切りの当日に送る。みんな出していれば送らずに印だけ。終わった卓・過ぎた締め切りには送らない', async () => {
    await addSession({ name: '今日まで', date: addDays(DAY, 3), gm: 'ひより', members: ['ソラ'] });
    await sheetDue('今日まで', DAY);
    await addSession({ name: '出した', date: addDays(DAY, 3), gm: 'ひより', members: ['ソラ'] });
    await sheetDue('出した', DAY, ['ソラ']);
    await addSession({ name: '中止', status: '中止', date: addDays(DAY, 3), members: ['ソラ'] });
    await sheetDue('中止', DAY);
    await addSession({ name: '過ぎた', date: addDays(DAY, 3), members: ['ソラ'] });
    await sheetDue('過ぎた', addDays(DAY, -1));
    await patrol(env, at('20:00'), noWait);
    expect(posts.map((p) => p.content.split('\n')[0])).toEqual(['📝 「今日まで」のキャラシの締め切りは今日（10/10（土））です。まだ出していない人: <@400000000000000011>']);
    expect(await mark('出した', 'sheet_urged_at')).not.toBeNull();
    expect(await mark('中止', 'sheet_urged_at')).toBeNull();
  });

  test('送り先が無ければ、記録して印を付ける（毎時記録しない）。全部の送り先で届かなければ、印を戻す', async () => {
    await addSession({ name: '港', date: addDays(DAY, 7), members: ['ソラ'] });
    await sheetDue('港', addDays(DAY, 1));
    await env.DB.prepare("UPDATE groups SET channel_id = '' WHERE id = 'g'").run();
    // 画面のアドレスが無ければ、案内の行は付けない
    const ctx = () => loadGroup(env.DB, 'g', { memberId: 0, name: '', isAdmin: true, userId: '' }, '', new Date(at('20:00')), { token: 'test-bot-token' });
    await sendSheetUrges(await ctx(), 20, noWait);
    expect(await env.DB.prepare("SELECT kind, result FROM notify_log WHERE kind = 'キャラシの催促'").all()).toMatchObject({ results: [{ result: '送らず: 送り先のチャンネルが未設定' }] });
    expect(await mark('港', 'sheet_urged_at')).not.toBeNull();
    await env.DB.prepare("UPDATE groups SET channel_id = ? WHERE id = 'g'").bind(CH).run();
    await env.DB.prepare('UPDATE sessions SET sheet_urged_at = NULL').run();
    mockBot([500, 500, 500]);
    await sendSheetUrges(await ctx(), 20, noWait);
    expect(posts).toHaveLength(3);
    expect(posts[0]!.content).not.toContain('🔗');
    expect(await mark('港', 'sheet_urged_at')).toBeNull();
    // ほかの見回りが先に印を取っていれば、送らない
    await env.DB.prepare("UPDATE sessions SET sheet_urged_at = 'x'").run();
    const stale = await ctx();
    stale.sessions.forEach((s) => { s.sheetUrgedAt = null; });
    mockBot();
    await sendSheetUrges(stale, 20, noWait);
    expect(posts).toHaveLength(0);
  });
});
