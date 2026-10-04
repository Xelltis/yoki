// まとめての変更（§15）とメンバー（§13）
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import { addDays } from '../../src/worker/lib/jst';
import { fail, ok, setupGroup, today } from './helpers';

let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
});
const byId = (body: any) => Object.fromEntries(body.data.sessions.map((s: any) => [s.id, s]));

describe('まとめての変更', () => {
  beforeEach(async () => {
    await ok(G.admin, G.id, 'saveSession', { name: 'A', gm: 'ひより', members: ['ソラ'], date: T(3), status: '開催' });
    await ok(G.admin, G.id, 'saveSession', { name: 'B', gm: 'こまち', status: '募集' });
    await ok(G.sora, G.id, 'setInterest', { id: 'S002', name: 'ソラ', level: 'want' });
  });

  test('参加者の追加と除外、GM の変更、シリーズ', async () => {
    let r = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001', 'S002'], action: 'addMember', value: 'こまち' });
    expect(r.message).toBe('2 件の卓の参加者に こまち を足しました: A、B');
    expect(byId(r).S001.members).toEqual(['ソラ', 'こまち']);
    r = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'removeMember', value: 'ソラ' });
    expect(r.message).toBe('1 件の卓の参加者から ソラ を外しました: A');
    expect(byId(r).S001.members).toEqual(['こまち']);
    r = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'setGm', value: 'ソラ' });
    expect(r.message).toBe('1 件の卓の GM を ソラ にしました: A');
    expect(byId(r).S001.gm).toBe('ソラ');
    r = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001', 'S002'], action: 'setSeries', value: '港' });
    expect(r.message).toBe('2 件の卓のシリーズを「港」にしました: A、B');
    expect([byId(r).S001.series, byId(r).S002.series]).toEqual(['港', '港']);
  });

  test('開催日をずらすと、開催前の知らせの印が消える。日付の無い卓は飛ばす', async () => {
    await env.DB.prepare("UPDATE sessions SET notified_at = '2026-01-01T00:00:00Z'").run();
    const r = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001', 'S002'], action: 'shiftDays', value: '7' });
    expect(r.message).toBe('2 件の卓の開催日を 7 日後ろにずらしました: A、B');
    expect(byId(r).S001).toMatchObject({ date: T(10), notified: '' });
    expect(byId(r).S002.date).toBe('');
    expect((await fail(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'shiftDays', value: 'x' })).error).toContain('ずらす日数');
  });

  test('状態を変える。開催にすると参加希望が参加者に移る。日付が無ければ開催にできない', async () => {
    expect((await fail(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S002'], action: 'status', value: '開催' })).error).toContain('開催日が無いので');
    const r = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S002'], action: 'status', value: '調整中' });
    expect(byId(r).S002).toMatchObject({ status: '調整中', members: ['ソラ'], want: [] });
    expect(r.message).toContain('参加希望の人を参加者に加えました: ソラ（B）');
  });

  test('「中止」にすると、期間と日程調整の回答が消える。参加希望は参加者に移らない', async () => {
    await ok(G.admin, G.id, 'saveSession', { id: 'S002', name: 'B', gm: 'こまち', status: '募集', windowFrom: T(5), windowTo: T(9) });
    await ok(G.admin, G.id, 'saveSession', { name: 'C', gm: 'ひより', members: ['ソラ'], status: '調整中' });
    await ok(G.admin, G.id, 'startPoll', { id: 'S003', dates: [T(5)] });
    const r = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S002', 'S003'], action: 'status', value: '中止' });
    expect(r.message).toBe('2 件の卓の状態を「中止」にしました: B、C');
    expect(byId(r).S002).toMatchObject({ status: '中止', window: '', want: ['ソラ'], members: [] });
    expect(byId(r).S003).toMatchObject({ status: '中止', candidates: [], votes: {} });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM poll_votes').first('n')).toBe(0);
  });

  test('「調整中」にまとめて変えると、参加希望のある卓だけ参加者が増える', async () => {
    const r = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001', 'S002'], action: 'status', value: '調整中' });
    expect(byId(r).S001).toMatchObject({ status: '調整中', members: ['ソラ'], want: [] });
    expect(byId(r).S002).toMatchObject({ status: '調整中', members: ['ソラ'], want: [] });
    expect(r.message).toBe('2 件の卓の状態を「調整中」にしました: A、B　参加希望の人を参加者に加えました: ソラ（B）');
  });

  test('開催日を前にずらす。シリーズを外す', async () => {
    let r = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'shiftDays', value: '-1' });
    expect(r.label).toBe('開催日を -1 日');
    expect(r.message).toBe('1 件の卓の開催日を 1 日前にずらしました: A');
    expect(byId(r).S001.date).toBe(T(2));
    await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001', 'S002'], action: 'setSeries', value: '港' });
    r = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001', 'S002'], action: 'setSeries', value: '' });
    expect(r.label).toBe('シリーズを外す');
    expect(r.message).toBe('2 件の卓のシリーズを外しました: A、B');
    expect([byId(r).S001.series, byId(r).S002.series]).toEqual(['', '']);
  });

  test('削除と、管理者だけ', async () => {
    expect((await fail(G.sora, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'delete' })).error).toMatch(/^ADMIN:/);
    const r = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001', 'S002'], action: 'delete' });
    expect(r.message).toBe('2 件の卓を削除しました: A、B');
    expect(r.data.sessions).toEqual([]);
  });
});

describe('メンバー', () => {
  test('管理者は追加できる。区切り文字・予約語・同じ名前・数字でない Discord ID は断る', async () => {
    const r = await ok(G.admin, G.id, 'saveMember', { name: 'エマ', discordId: '<@987654321098765432>', note: '見学' });
    expect(r.data.members.find((m: any) => m.name === 'エマ')).toMatchObject({ discordId: '987654321098765432', note: '見学', linked: false });
    expect((await fail(G.admin, G.id, 'saveMember', { name: 'a、b' })).error).toContain('区切り文字');
    expect((await fail(G.admin, G.id, 'saveMember', { name: '全員' })).error).toContain('使えません');
    expect((await fail(G.admin, G.id, 'saveMember', { name: 'ソラ' })).error).toContain('同じ名前');
    expect((await fail(G.admin, G.id, 'saveMember', { name: 'フラン', discordId: 'abc' })).error).toContain('数字だけ');
  });

  test('名前を変えると、卓・回答・予定にもそのまま伝わる（中は ID で持つ）', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '卓', gm: 'ソラ', members: ['こまち'], status: '調整中' });
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5)] });
    await ok(G.sora, G.id, 'setPollVote', { id: 'S001', ymd: T(5), name: 'ソラ', vote: '◯' });
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(2), mark: '×' });
    const r = await ok(G.admin, G.id, 'saveMember', { oldName: 'ソラ', name: 'ソラ改', note: '' });
    const s = r.data.sessions[0];
    expect(s.gm).toBe('ソラ改');
    expect(s.votes[T(5)]).toEqual({ ソラ改: '◯' });
    expect(r.data.avail[T(2)]).toEqual({ ソラ改: '×' });
  });

  test('ログインした人は自分の名前と備考を直せる（Discord ID とほかの人は管理者だけ）', async () => {
    const r = await ok(G.sora, G.id, 'saveMember', { oldName: 'ソラ', name: 'そら', discordId: '1234567890', note: 'よろしく' });
    expect(r.data.members.find((m: any) => m.name === 'そら')).toMatchObject({ discordId: '400000000000000011', note: 'よろしく', linked: true });
    expect((await fail(G.sora, G.id, 'saveMember', { oldName: 'こまち', name: 'x' })).status).toBe(403);
    expect((await fail(G.sora, G.id, 'saveMember', { name: '新しい人' })).status).toBe(403);
  });

  test('消しても、卓の参加者と回答には名前が残る（メンバーに無い人として）', async () => {
    await ok(G.admin, G.id, 'saveMember', { name: 'エマ' });
    await ok(G.admin, G.id, 'saveSession', { name: '卓', gm: 'ひより', members: ['エマ'], date: T(3), status: '開催' });
    const r = await ok(G.admin, G.id, 'deleteMember', { name: 'エマ' });
    expect(r.data.members.some((m: any) => m.name === 'エマ')).toBe(false);
    expect(r.data.sessions[0].members).toEqual(['エマ']);
  });

  test('管理者にする・外す。管理者が 1 人だけのときは外せない', async () => {
    await env.DB.prepare("UPDATE members SET is_admin = 1 WHERE name = 'ひより'").run();
    expect((await fail(G.admin, G.id, 'setAdmin', { name: 'ひより', admin: false })).error).toContain('1 人だけ');
    let r = await ok(G.admin, G.id, 'setAdmin', { name: 'ソラ', admin: true });
    expect(r.data.admins).toEqual(['ひより', 'ソラ']);
    r = await ok(G.admin, G.id, 'setAdmin', { name: 'ひより', admin: false });
    expect(r.data.admins).toEqual(['ソラ']);
    expect((await fail(G.komachi, G.id, 'setAdmin', { name: 'こまち', admin: true })).status).toBe(403);
  });
});
