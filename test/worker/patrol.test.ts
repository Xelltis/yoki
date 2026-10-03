// 知らせの見回り（§23・40・46・47）。時刻は scheduledTime で渡す（日本時間 = UTC + 9）
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { patrol } from '../../src/worker/domain/patrol';
import { addDays } from '../../src/worker/lib/jst';
import { makeGroup } from './helpers';

const HOOK = 'https://discord.com/api/webhooks/123456789012345678/base';
const SERIES_HOOK = 'https://discord.com/api/webhooks/123456789012345679/series';
const DAY = '2026-10-10';   // 「今日」（日本時間）
const at = (hhmm: string) => Date.parse(DAY + 'T' + hhmm + ':00+09:00');
const noWait = { sleep: async () => {} };
let posts: { url: string; content: string; embeds: number }[] = [];

function mockWebhook(codes: number[] = []) {
  posts = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(String(init?.body));
    posts.push({ url, content: body.content, embeds: (body.embeds ?? []).length });
    return new Response(null, { status: codes.shift() ?? 204 });
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
    env.DB.prepare("UPDATE groups SET webhook_url = ?, remind_enabled = 1, notify_days = 1, notify_hour = 20 WHERE id = 'g'").bind(HOOK),
    env.DB.prepare("INSERT INTO members (group_id, name, discord_id, created_at) VALUES ('g', 'ひより', '400000000000000010', 'x'), ('g', 'ソラ', '400000000000000011', 'x')"),
  ]);
  mockWebhook();
});
afterEach(() => vi.restoreAllMocks());

describe('開催前の知らせ', () => {
  test('知らせの日の、送る時刻になったら 1 通にまとめて送る。同じ時刻台に何度回っても、次の時刻台でも送り直さない', async () => {
    await addSession({ name: '明日の卓', date: addDays(DAY, 1), start: '20:00', gm: 'ひより', members: ['ソラ'] });
    await addSession({ name: 'あさっての卓', date: addDays(DAY, 2), gm: 'ソラ' });
    await patrol(env, at('19:00'), noWait);
    expect(posts).toHaveLength(0);
    await patrol(env, at('20:00'), noWait);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({ url: HOOK, content: '📢 明日は卓の日です！ <@400000000000000010> <@400000000000000011>', embeds: 1 });
    expect(await mark('明日の卓', 'notified_at')).not.toBeNull();
    await patrol(env, at('20:05'), noWait);
    await patrol(env, at('21:00'), noWait);
    expect(posts).toHaveLength(1);
  });

  test('シリーズごとの日時とチャンネル（基本にも送るなら両方）', async () => {
    await env.DB.prepare("INSERT INTO series_notify (group_id, series, webhook_url, also_base, days, hour, updated_at) VALUES ('g', '港', ?, 1, 3, 9, 'x')").bind(SERIES_HOOK).run();
    await addSession({ name: '港 #1', series: '港', date: addDays(DAY, 3), gm: 'ひより' });
    await patrol(env, at('09:00'), noWait);
    expect(posts.map((p) => p.url).sort()).toEqual([HOOK, SERIES_HOOK].sort());
    expect(posts[0]!.content).toContain('3 日後は卓の日です！');
  });

  test('11 卓を超えたら 10 卓ごとに分けて送り、届いた卓だけを送った扱いにする', async () => {
    for (let i = 1; i <= 12; i++) await addSession({ name: '卓' + i, date: addDays(DAY, 1), gm: 'ひより' });
    mockWebhook([204, 500, 500, 500]);
    await patrol(env, at('20:00'), noWait);
    expect(posts.map((p) => p.embeds)).toEqual([10, 2, 2, 2]);
    expect(await mark('卓1', 'notified_at')).not.toBeNull();
    // 2 通目は 3 回とも失敗したので、印を戻して次の時刻台で送り直す
    expect(await mark('卓12', 'notified_at')).toBeNull();
    mockWebhook();
    await patrol(env, at('21:00'), noWait);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.embeds).toBe(2);
  });

  test('有効にしていないグループには送らない。Webhook が無ければ送らずに記録する', async () => {
    await addSession({ name: '明日の卓', date: addDays(DAY, 1), gm: 'ひより' });
    await env.DB.prepare("UPDATE groups SET remind_enabled = 0 WHERE id = 'g'").run();
    await patrol(env, at('20:00'), noWait);
    expect(posts).toHaveLength(0);
    await env.DB.prepare("UPDATE groups SET remind_enabled = 1, webhook_url = '' WHERE id = 'g'").run();
    await patrol(env, at('21:00'), noWait);
    expect(posts).toHaveLength(0);
    expect(await env.DB.prepare('SELECT result FROM notify_log ORDER BY id DESC').first('result')).toBe('送らず: Discord Webhook URL が空');
  });
});

describe('期間前の催促と開始直前の知らせ', () => {
  test('期間の始まりが明日の募集中の卓を、GM に知らせる', async () => {
    await addSession({ name: '古城', status: '募集', windowFrom: addDays(DAY, 1), windowTo: addDays(DAY, 10), gm: 'ひより' });
    await patrol(env, at('20:00'), noWait);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.content).toBe('⏳ 明日から「古城」の募集の期間です。まだ参加者を集めている途中です。 <@400000000000000010>\n🔗 参加希望は卓予定の「募集・調整」タブから: https://yoki.test/g/g/');
    expect(await mark('古城', 'urged_at')).not.toBeNull();
    await patrol(env, at('21:00'), noWait);
    expect(posts).toHaveLength(1);
  });

  test('開始の N 分前を過ぎた最初の見回りで、GM と参加者に知らせる（ON のときだけ）', async () => {
    await env.DB.prepare("UPDATE groups SET soon = 1, soon_minutes = 30 WHERE id = 'g'").run();
    await addSession({ name: '今夜の卓', date: DAY, start: '21:00', gm: 'ひより', members: ['ソラ'] });
    await patrol(env, at('20:25'), noWait);
    expect(posts).toHaveLength(0);
    await patrol(env, at('20:35'), noWait);
    expect(posts[0]!.content).toBe('⏰ あと 25 分で「今夜の卓」が始まります。 <@400000000000000010> <@400000000000000011>');
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
