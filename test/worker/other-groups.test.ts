// ほかのグループの卓。同じ利用者がほかのグループで入っている「開催」の卓の日を、予定表に「他」として出す（日と時間帯だけ）
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import { addDays } from '../../src/worker/lib/jst';
import { fail, GUILD, makeGroup, ok, setupGroup, today } from './helpers';

let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
  // 同じサーバーの、もう1つのグループ。ソラとこまちが入る
  await makeGroup('grp2', GUILD, 'もう1つの卓');
  for (const sid of [G.admin, G.sora, G.komachi]) await ok(sid, 'grp2', 'getConsoleData');
  await ok(G.admin, 'grp2', 'saveSession', { name: '秘密の卓', gm: 'こまち', members: ['ソラ'], date: T(3), start: '20:00', status: '開催' });
});

describe('ほかのグループの卓', () => {
  test('入っている人の列に「他」が付き、時間帯も分かる。グループや卓の名前は出さない', async () => {
    const d = await ok(G.admin, G.id, 'getConsoleData');
    expect(d.booked[T(3)]).toEqual({ こまち: '他', ソラ: '他' });
    expect(d.bookedParts[T(3)]).toEqual({ こまち: '夜', ソラ: '夜' });
    expect(JSON.stringify(d)).not.toContain('秘密の卓');
    expect(JSON.stringify(d)).not.toContain('もう1つの卓');
    expect(d.me.shareBusy).toBe(true);
  });

  test('このグループの卓がある日は、そちらの札を出す', async () => {
    const d = await ok(G.admin, G.id, 'saveSession', { name: '卓', gm: 'ソラ', date: T(3), status: '開催' });
    expect(d.data.booked[T(3)]).toEqual({ ソラ: 'GM', こまち: '他' });
  });

  test('「他」の日には、その人の印を入れられない。日程調整の「予定表から入れる」では × になる', async () => {
    expect((await fail(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(3), mark: '△' })).error).toContain('卓に入っている日');
    await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', members: ['ソラ'], status: '調整中' });
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(3), T(4)] });
    const r = await ok(G.sora, G.id, 'setPollVoteFromAvail', { id: 'S001', name: 'ソラ' });
    expect(r.data.sessions[0].votes).toMatchObject({ [T(3)]: { ソラ: '×' }, [T(4)]: { ソラ: '◯' } });
  });

  test('本人が止めると、どのグループにも出さない。戻せる', async () => {
    let r = await ok(G.sora, G.id, 'setShareBusy', { on: false });
    expect(r).toMatchObject({ message: 'ほかのグループの卓の日を、予定表に出すのをやめました。' });
    expect(r.data.me.shareBusy).toBe(false);
    expect(r.data.booked[T(3)]).toEqual({ こまち: '他' });
    r = await ok(G.sora, G.id, 'setShareBusy', { on: true });
    expect(r.message).toBe('ほかのグループの卓の日を、予定表に「他」として出します。');
    expect(r.data.booked[T(3)]).toEqual({ こまち: '他', ソラ: '他' });
  });

  test('出さない卓: 開催でない・過ぎた・行けなくなった卓。ログインしていないメンバーには付かない', async () => {
    await ok(G.sora, 'grp2', 'setAbsence', { id: 'S001', name: 'ソラ' });
    await ok(G.admin, 'grp2', 'saveSession', { name: '募集', gm: 'こまち', status: '募集' });
    await env.DB.prepare("UPDATE sessions SET date = ? WHERE group_id = 'grp2' AND name = '秘密の卓'").bind(T(4)).run();
    await ok(G.admin, 'grp2', 'saveSession', { name: '過ぎた卓', gm: 'こまち', date: T(-2), status: '開催' });
    await ok(G.admin, G.id, 'saveMember', { name: 'エマ' });
    const d = await ok(G.admin, G.id, 'getConsoleData');
    expect(d.booked[T(4)]).toEqual({ こまち: '他' });
    expect(Object.values(d.booked).some((day: any) => 'エマ' in day)).toBe(false);
  });
});
