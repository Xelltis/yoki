// 自分の予定の一覧（GET /api/me/agenda）。入っているグループをまたいで、これからの卓とあなたの番を集める
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import { addDays } from '../../src/worker/lib/jst';
import { call, makeGroup, ok, setupGroup, today } from './helpers';

let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
});
const agenda = async (sid: string) => (await (await call('/api/me/agenda', { sid })).json()) as { today: string; items: Record<string, string>[] };
const brief = (items: Record<string, string>[]) => items.map((x) => [x.kind, x.name, x.date]);

describe('自分の予定の一覧', () => {
  test('ログインしていなければ401', async () => {
    expect((await call('/api/me/agenda')).status).toBe(401);
  });

  test('これからの卓（GMか参加者）を開催日の順に。過ぎた卓・行けなくなった卓・60日より先の卓は出さない', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', members: ['ソラ'], date: T(3), start: '20:00', status: '開催' });
    await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'ソラ', date: T(1), status: '開催' });
    await ok(G.admin, G.id, 'saveSession', { name: '遠い卓', gm: 'ソラ', date: T(60), status: '開催' });
    await ok(G.admin, G.id, 'saveSession', { name: '過ぎた卓', gm: 'ソラ', date: T(-1), status: '開催' });
    await ok(G.admin, G.id, 'saveSession', { name: '行けない卓', gm: 'ひより', members: ['ソラ'], date: T(5), status: '開催' });
    await ok(G.admin, G.id, 'saveSession', { name: 'こまちの卓', gm: 'こまち', date: T(2), status: '開催' });
    await ok(G.sora, G.id, 'setAbsence', { id: 'S005', name: 'ソラ' });
    // 同じ日時の卓は、名前の順
    await ok(G.admin, G.id, 'saveSession', { name: 'アの卓', gm: 'ソラ', date: T(1), status: '開催' });
    const a = await agenda(G.sora);
    expect(a.today).toBe(T(0));
    expect(brief(a.items)).toEqual([['session', 'アの卓', T(1)], ['session', '古城', T(1)], ['session', '港', T(3)]]);
    expect(a.items[2]).toMatchObject({ groupId: G.id, groupTitle: 'テストの卓', id: 'S001', start: '20:00' });
  });

  test('あなたの番が先: 答えていない日程調整、そろってGMが選ぶ日程調整、出していないキャラシ', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', members: ['ソラ'], status: '調整中' });
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(4), T(5)] });
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', members: ['ソラ', 'こまち'], date: T(8), status: '開催' });
    await ok(G.admin, G.id, 'savePrep', { id: 'S002', sheetDue: T(6), slots: [] });
    await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'ひより', members: ['こまち'], date: T(9), status: '開催' });
    await ok(G.admin, G.id, 'savePrep', { id: 'S003', sheetDue: T(-1), slots: [] });
    let a = await agenda(G.sora);
    expect(brief(a.items)).toEqual([['vote', '迷宮', ''], ['sheet', '港', T(6)], ['session', '港', T(8)]]);
    // ひよりはGMで、もう答えている（候補日を出した人には ◯ が付く）。ソラが答えると、ひよりの番になる
    expect(brief((await agenda(G.admin)).items)).toEqual([['session', '港', T(8)], ['session', '古城', T(9)]]);
    await ok(G.sora, G.id, 'setPollVoteAll', { id: 'S001', name: 'ソラ' });
    await ok(G.sora, G.id, 'submitSheet', { id: 'S002', name: 'ソラ', url: 'https://example.com/s', pc: 'A' });
    a = await agenda(G.sora);
    expect(brief(a.items)).toEqual([['session', '港', T(8)]]);
    expect(brief((await agenda(G.admin)).items)[0]).toEqual(['decide', '迷宮', '']);
    // こまちは締め切りの過ぎたキャラシを数えない
    expect(brief((await agenda(G.komachi)).items)).toEqual([['sheet', '港', T(6)], ['session', '港', T(8)], ['session', '古城', T(9)]]);
  });

  test('入れないグループ（サーバーにいない）の卓は出さない。卓は20件まで', async () => {
    await makeGroup('other', 'guild-x', 'よそ');
    await env.DB.prepare("INSERT INTO members (group_id, name, user_id, created_at) VALUES ('other', 'ソラ', '400000000000000011', 'x')").run();
    await env.DB.prepare("INSERT INTO sessions (group_id, seq, name, status, date, updated_at) VALUES ('other', 1, 'よその卓', '開催', ?, 'x')").bind(T(2)).run();
    await env.DB.prepare("INSERT INTO session_people (session_id, role, pos, member_id) SELECT s.id, 'gm', 0, m.id FROM sessions s, members m WHERE s.name = 'よその卓' AND m.group_id = 'other'").run();
    await ok(G.admin, G.id, 'saveSession', { name: '連続 1', gm: 'ソラ', status: '開催', dates: Array.from({ length: 20 }, (_, i) => T(i + 1)), date: T(1) });
    await ok(G.admin, G.id, 'saveSession', { name: '21回目', gm: 'ソラ', status: '開催', date: T(30) });
    const a = await agenda(G.sora);
    expect(a.items).toHaveLength(20);
    expect(a.items.some((x) => x.name === 'よその卓' || x.name === '21回目')).toBe(false);
  });
});
