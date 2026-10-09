// 日程調整の回答の締め切り: 決める・確かめる・外す、締め切りの前日の催促（まだ答えていない人だけ）、締め切りが過ぎた知らせ（GMへ）
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SYSTEM_ACTOR } from '../../src/worker/auth/guard';
import { pollPayload } from '../../src/worker/discord/payloads';
import { agendaOf } from '../../src/worker/domain/agenda';
import { loadGroup } from '../../src/worker/domain/load';
import { patrol, sendPollDue } from '../../src/worker/domain/patrol';
import type { Bindings } from '../../src/worker/env';
import { addDays, fmtDateJa } from '../../src/worker/lib/jst';
import { fail, ok, setupGroup, today } from './helpers';

const CH = '123456789012345678';
const noWait = { sleep: async () => {} };
let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
let posts: { url: string; body: Record<string, any> }[];
/** Botの送信を差し替える。codesの順に返し、尽きたら200 */
function mockBot(codes: number[] = []) {
  posts = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    posts.push({ url, body: JSON.parse(String(init?.body)) });
    return Response.json({ id: 'm1' }, { status: codes.shift() ?? 200 });
  });
}
/** その日（日本時間）のその時刻に、見回りが読むグループ */
const loadAt = (day: string, hour = 20, buttons = false) =>
  loadGroup(env.DB, G.id, SYSTEM_ACTOR, 'https://yoki.test/g/' + G.id + '/', new Date(day + 'T' + String(hour).padStart(2, '0') + ':00:00+09:00'), { token: 'test-bot-token', clientId: 'c' })
    .then((ctx) => ({ ...ctx, buttons }));
const meta = (col: string) => env.DB.prepare(`SELECT ${col} AS v FROM sessions WHERE seq = 1`).first('v');

beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
  await env.DB.prepare('UPDATE groups SET channel_id = ?1, urge = 1, notify_hour = 20 WHERE id = ?2').bind(CH, G.id).run();
  await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', members: ['ソラ', 'こまち'], status: '調整中' });
  mockBot();
});
afterEach(() => vi.restoreAllMocks());

describe('締め切りを決める', () => {
  test('候補日と一緒に決め、返事・履歴・画面データに出る。選び直しでは、送らなければそのまま、空なら外す', async () => {
    let r = await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5), T(6)], due: T(3) });
    expect(r.message).toBe('「迷宮」の日程調整を始めました（候補2日、締め切り ' + fmtDateJa(T(3)) + '）。');
    let s = (await ok(G.admin, G.id, 'getConsoleData')).sessions[0];
    expect(s.pollDue).toBe(T(3));
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5), T(7)] });
    expect(await meta('poll_due')).toBe(T(3));
    r = await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5), T(7)], due: '' });
    expect(r.message).toBe('「迷宮」の日程調整を更新しました（候補2日）。');
    expect(await meta('poll_due')).toBeNull();
    const h = (await ok(G.admin, G.id, 'getSessionHistory', { id: 'S001' })).items.map((x: any) => x.detail);
    expect(h.slice(0, 3)).toEqual([
      '候補日を選び直した: ' + fmtDateJa(T(5)) + '、' + fmtDateJa(T(7)) + '（締め切りなし）',
      '候補日を選び直した: ' + fmtDateJa(T(5)) + '、' + fmtDateJa(T(7)) + '（締め切り ' + fmtDateJa(T(3)) + '）',
      '候補日を出した: ' + fmtDateJa(T(5)) + '、' + fmtDateJa(T(6)) + '（締め切り ' + fmtDateJa(T(3)) + '）',
    ]);
  });

  test('読めない日・過ぎた日・いちばん早い候補日から先の日は断る', async () => {
    expect((await fail(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5)], due: 'あした' })).error).toBe('回答の締め切りが読めません: あした');
    expect((await fail(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5)], due: T(-1) })).error).toBe('過ぎた日は、回答の締め切りにできません。');
    expect((await fail(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(6), T(5)], due: T(5) })).error)
      .toBe('回答の締め切りは、いちばん早い候補日（' + fmtDateJa(T(5)) + '）より前の日にしてください。');
    // 今日は締め切りにできる
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5)], due: T(0) });
  });

  test('過ぎた締め切りは、変えずに選び直すときだけ残る。締め切りを変えたら、催促と知らせを送り直せる', async () => {
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5), T(6)], due: T(2) });
    await env.DB.prepare("UPDATE sessions SET poll_due = ?1, poll_urged_at = 'x', poll_closed_at = 'y' WHERE seq = 1").bind(T(-1)).run();
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5)], due: T(-1) });
    expect([await meta('poll_due'), await meta('poll_urged_at'), await meta('poll_closed_at')]).toEqual([T(-1), 'x', 'y']);
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5)], due: T(3) });
    expect([await meta('poll_due'), await meta('poll_urged_at'), await meta('poll_closed_at')]).toEqual([T(3), null, null]);
  });

  test('開催日を決める・日程調整をやめる・調整中でなくなると、締め切りも外れる', async () => {
    const reset = () => env.DB.prepare("UPDATE sessions SET poll_due = ?1, poll_urged_at = 'x', poll_closed_at = 'y' WHERE seq = 1").bind(T(3)).run();
    const cleared = async () => expect([await meta('poll_due'), await meta('poll_urged_at'), await meta('poll_closed_at')]).toEqual([null, null, null]);
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5)], due: T(3) });
    await ok(G.admin, G.id, 'cancelPoll', { id: 'S001' });
    await cleared();
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5)], due: T(3) });
    await ok(G.admin, G.id, 'decidePoll', { id: 'S001', ymd: T(5) });
    await cleared();
    await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '迷宮', gm: 'ひより', members: ['ソラ', 'こまち'], status: '調整中' });
    await reset();
    await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '迷宮', gm: 'ひより', members: ['ソラ', 'こまち'], status: '募集' });
    await cleared();
    await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'status', value: '調整中' });
    await reset();
    await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'status', value: '中止' });
    await cleared();
    // 調整中のまま保存すれば残る
    await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'status', value: '調整中' });
    await reset();
    await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '迷宮（改）', gm: 'ひより', members: ['ソラ', 'こまち'], status: '調整中' });
    expect(await meta('poll_due')).toBe(T(3));
  });

  test('聞く知らせに締め切りを書く。あなたの予定の「答えてください」に締め切りを添える。書き出しにも入る', async () => {
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5)], due: T(3) });
    const ctx = await loadAt(T(0));
    expect(pollPayload(ctx, ctx.sessions[0]!, 'ひより').content.split('\n')[2]).toBe('回答の締め切り: ' + fmtDateJa(T(3)));
    const user = (await env.DB.prepare("SELECT user_id FROM members WHERE name = 'ソラ'").first<string>('user_id'))!;
    const a = await agendaOf(env.DB, user, [G.id], new Date());
    expect(a.items.find((x) => x.kind === 'vote')).toMatchObject({ id: 'S001', date: T(3) });
    expect((await ok(G.admin, G.id, 'exportGroup')).export.sessions[0].pollDue).toBe(T(3));
  });
});

describe('締め切りの前日の催促', () => {
  beforeEach(async () => {
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5), T(6)], due: T(3) });
    // ひよりは答えた（GMが出したので、候補日に ◯ が付いている）。ソラは1日だけ
    await ok(G.sora, G.id, 'setPollVote', { id: 'S001', name: 'ソラ', ymd: T(5), vote: '◯' });
  });

  test('前日の送る時刻に、まだ答えていない人だけを呼ぶ。ボタンを付ける。一度だけ', async () => {
    await sendPollDue(await loadAt(T(2), 19), 19, noWait);
    expect(posts).toEqual([]);
    await sendPollDue(await loadAt(T(2), 20, true), 20, noWait);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe('https://discord.com/api/v10/channels/' + CH + '/messages');
    expect(posts[0]!.body.content).toBe(
      '⏰ 「迷宮」の日程調整の締め切りは明日（' + fmtDateJa(T(3)) + '）です。まだ答えていない人: <@400000000000000011> <@400000000000000012>\n' +
      '候補日: ' + fmtDateJa(T(5)) + '、' + fmtDateJa(T(6)) + '\n' +
      '下のボタンでも答えられます。Yokiの「募集・調整」タブで、候補日ごとに ◯・△・× を押してください。\n🔗 https://yoki.test/g/' + G.id + '/',
    );
    expect(posts[0]!.body.components[0].components[0].custom_id).toBe('yoki:' + G.id + ':1:fill');
    expect(await meta('poll_urged_at')).not.toBeNull();
    await sendPollDue(await loadAt(T(2), 21), 21, noWait);
    expect(posts).toHaveLength(1);
  });

  test('見回りが重なっても、印を取れた1つだけが送る', async () => {
    const ctx = await loadAt(T(2));
    await sendPollDue(ctx, 20, noWait);
    await sendPollDue(ctx, 20, noWait);
    expect(posts).toHaveLength(1);
  });

  test('前日を逃したら当日に送る（今日と書く）。ボタンを使わないグループには付けない', async () => {
    await sendPollDue(await loadAt(T(3)), 20, noWait);
    expect(posts[0]!.body.content).toContain('の日程調整の締め切りは今日（' + fmtDateJa(T(3)) + '）です。');
    expect(posts[0]!.body.content).not.toContain('下のボタンでも');
    expect(posts[0]!.body.components).toBeUndefined();
  });

  test('みんな答えていれば送らずに印だけ付ける。送り先が無ければ記録して印を付ける。届かなければ印を戻す', async () => {
    await ok(G.sora, G.id, 'setPollVoteAll', { id: 'S001', name: 'ソラ' });
    await ok(G.komachi, G.id, 'setPollVoteAll', { id: 'S001', name: 'こまち' });
    mockBot();
    await sendPollDue(await loadAt(T(2)), 20, noWait);
    expect(posts).toEqual([]);
    expect(await meta('poll_urged_at')).not.toBeNull();

    await env.DB.prepare("UPDATE sessions SET poll_urged_at = NULL, poll_ready_at = NULL WHERE seq = 1").run();
    await env.DB.prepare("DELETE FROM poll_votes WHERE member_id = (SELECT id FROM members WHERE name = 'こまち')").run();
    await env.DB.prepare("UPDATE groups SET channel_id = '' WHERE id = ?").bind(G.id).run();
    await sendPollDue(await loadAt(T(2)), 20, noWait);
    expect(posts).toEqual([]);
    expect(await env.DB.prepare('SELECT kind, target, result FROM notify_log ORDER BY id DESC').first()).toEqual({ kind: '日程調整の催促', target: '迷宮', result: '送らず: 送り先のチャンネルが未設定' });
    expect(await meta('poll_urged_at')).not.toBeNull();

    await env.DB.prepare("UPDATE sessions SET poll_urged_at = NULL WHERE seq = 1").run();
    await env.DB.prepare('UPDATE groups SET channel_id = ?1 WHERE id = ?2').bind(CH, G.id).run();
    mockBot([403]);
    await sendPollDue(await loadAt(T(2)), 20, noWait);
    expect(posts).toHaveLength(1);
    expect(await meta('poll_urged_at')).toBeNull();
  });

  test('催促のつまみを止めていれば送らない。締め切りの2日前より前・調整中でない卓・候補日の無い卓にも送らない', async () => {
    await env.DB.prepare('UPDATE groups SET urge = 0 WHERE id = ?').bind(G.id).run();
    await sendPollDue(await loadAt(T(2)), 20, noWait);
    await env.DB.prepare('UPDATE groups SET urge = 1 WHERE id = ?').bind(G.id).run();
    await sendPollDue(await loadAt(T(1)), 20, noWait);
    await env.DB.prepare("UPDATE sessions SET status = '募集' WHERE seq = 1").run();
    await sendPollDue(await loadAt(T(2)), 20, noWait);
    await env.DB.prepare("UPDATE sessions SET status = '調整中', candidates = '[]' WHERE seq = 1").run();
    await sendPollDue(await loadAt(T(2)), 20, noWait);
    expect(posts).toEqual([]);
  });

  test('見回りが毎時の仕事で、締め切りの近いグループを読んで送る', async () => {
    await patrol(env as unknown as Bindings, Date.parse(T(2) + 'T20:00:00+09:00'), noWait);
    expect(posts.map((p) => p.body.content.split('\n')[0])).toEqual(['⏰ 「迷宮」の日程調整の締め切りは明日（' + fmtDateJa(T(3)) + '）です。まだ答えていない人: <@400000000000000011> <@400000000000000012>']);
  });
});

describe('締め切りが過ぎた知らせ', () => {
  beforeEach(async () => {
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5), T(6)], due: T(3) });
    await ok(G.sora, G.id, 'setPollVote', { id: 'S001', name: 'ソラ', ymd: T(5), vote: '△' });
    await env.DB.prepare("UPDATE sessions SET poll_urged_at = 'x' WHERE seq = 1").run();
  });

  test('次の日の送る時刻に、GMを呼び、候補日ごとの数と、まだ答えていない人を並べる。一度だけ', async () => {
    await sendPollDue(await loadAt(T(4)), 20, noWait);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body.content).toBe(
      '⌛ 「迷宮」の日程調整の締め切り（' + fmtDateJa(T(3)) + '）が過ぎました。<@400000000000000010>\n' +
      '・' + fmtDateJa(T(5)) + '　◯ 1/3　△ 1\n・' + fmtDateJa(T(6)) + '　◯ 1/3\n' +
      'まだ答えていない人: ソラ、こまち\n' +
      'Yokiの「募集・調整」タブで、開催日を選ぶか、候補日を選び直してください。\n🔗 https://yoki.test/g/' + G.id + '/',
    );
    expect(posts[0]!.body.embeds).toHaveLength(1);
    await sendPollDue(await loadAt(T(5)), 20, noWait);
    expect(posts).toHaveLength(1);
  });

  test('候補日がみな過ぎていれば、そう書く。みんな答えていれば、答えていない人は書かない', async () => {
    await ok(G.sora, G.id, 'setPollVoteAll', { id: 'S001', name: 'ソラ' });
    await ok(G.komachi, G.id, 'setPollVoteAll', { id: 'S001', name: 'こまち' });
    // 回答がそろった知らせを、まだ送れていない（送り先が無かったなど）
    await env.DB.prepare('UPDATE sessions SET poll_ready_at = NULL WHERE seq = 1').run();
    mockBot();
    await sendPollDue(await loadAt(T(7)), 20, noWait);
    expect(posts[0]!.body.content.split('\n').slice(1, 3)).toEqual(['これからの候補日がありません。', 'Yokiの「募集・調整」タブで、開催日を選ぶか、候補日を選び直してください。']);
  });

  test('回答がそろった知らせを送っていれば、印だけ付ける。締め切りから7日より前の日程調整には送らない', async () => {
    await env.DB.prepare("UPDATE sessions SET poll_ready_at = 'x' WHERE seq = 1").run();
    await sendPollDue(await loadAt(T(4)), 20, noWait);
    expect(posts).toEqual([]);
    expect(await meta('poll_closed_at')).not.toBeNull();
    await env.DB.prepare('UPDATE sessions SET poll_ready_at = NULL, poll_closed_at = NULL WHERE seq = 1').run();
    await sendPollDue(await loadAt(T(11)), 20, noWait);
    expect(posts).toEqual([]);
    await sendPollDue(await loadAt(T(10)), 20, noWait);
    expect(posts).toHaveLength(1);
  });
});
