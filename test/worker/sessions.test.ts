// 卓の登録・変更・削除・参加希望（GAS版scheduler.test.jsの §6・10・24・29・33・38・43・45）
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import { addDays, stampText } from '../../src/worker/lib/jst';
import { fail, ok, setupGroup, today } from './helpers';

let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
});
const sessionOf = (body: any, id: string) => body.data.sessions.find((s: any) => s.id === id);

describe('登録と更新', () => {
  test('新規はS001から。参加者に、メンバーに無い人（ゲスト）も入れられる。登録者はログインした人', async () => {
    const r = await ok(G.sora, G.id, 'saveSession', { name: 'テスト卓', gm: 'ひより', members: ['ソラ'], extra: 'ゲスト太郎、こまち', date: T(3), start: '21', status: '開催' });
    expect(r.id).toBe('S001');
    expect(r.message).toBe('登録しました: テスト卓（S001）');
    const s = sessionOf(r, 'S001');
    expect(s.members).toEqual(['ソラ', 'ゲスト太郎', 'こまち']);
    expect(s.start).toBe('21:00');
    expect(s.editor).toBe('ソラ');
  });

  test('「開催」なのに開催日が無ければ断る。読めない日付も断る', async () => {
    expect((await fail(G.sora, G.id, 'saveSession', { name: 'x', status: '開催' })).error).toContain('開催日を入れてください');
    expect((await fail(G.sora, G.id, 'saveSession', { name: 'x', status: '開催', date: '2026/02/31' })).error).toContain('読めません');
    expect((await fail(G.sora, G.id, 'saveSession', { name: '', status: '募集' })).error).toContain('卓の名前');
  });

  test('更新してもIDは変わらない。開催日を変えると開催前の知らせの印が消え、変えなければ残る', async () => {
    await ok(G.sora, G.id, 'saveSession', { name: 'A', gm: 'ひより', date: T(3), status: '開催' });
    await env.DB.prepare("UPDATE sessions SET notified_at = '2026-01-01T00:00:00Z', soon_at = '2026-01-01T00:00:00Z'").run();
    const same = await ok(G.sora, G.id, 'saveSession', { id: 'S001', name: 'A（改）', gm: 'ひより', date: T(3), status: '開催' });
    expect(same.id).toBe('S001');
    expect(sessionOf(same, 'S001').notified).not.toBe('');
    const moved = await ok(G.sora, G.id, 'saveSession', { id: 'S001', name: 'A', gm: 'ひより', date: T(4), status: '開催' });
    expect(sessionOf(moved, 'S001').notified).toBe('');
    expect(await env.DB.prepare('SELECT soon_at FROM sessions').first('soon_at')).toBeNull();
  });

  test('募集は期間を持つ（片方だけは断る）。「開催」にすると期間は消える', async () => {
    const r = await ok(G.sora, G.id, 'saveSession', { name: '募集の卓', gm: 'こまち', status: '募集', windowFrom: T(20), windowTo: T(10) });
    const s = sessionOf(r, 'S001');
    expect([s.windowFrom, s.windowTo]).toEqual([T(10), T(20)]);
    expect(s.window).toBe(T(10).replace(/-/g, '/') + '〜' + T(20).replace(/-/g, '/'));
    expect((await fail(G.sora, G.id, 'saveSession', { name: 'x', status: '募集', windowFrom: T(1) })).error).toContain('両方');
    const held = await ok(G.sora, G.id, 'saveSession', { id: 'S001', name: '募集の卓', gm: 'こまち', status: '開催', date: T(15), windowFrom: T(10), windowTo: T(20) });
    expect(sessionOf(held, 'S001').window).toBe('');
  });

  test('募集から「開催」にすると、参加希望の人は参加者に移り、選ばれなかった興味ありは外れる', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '募集の卓', gm: 'ひより', status: '募集' });
    await ok(G.sora, G.id, 'setInterest', { id: 'S001', name: 'ソラ', level: 'want' });
    await ok(G.komachi, G.id, 'setInterest', { id: 'S001', name: 'こまち', level: 'interest' });
    const r = await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '募集の卓', gm: 'ひより', status: '開催', date: T(5) });
    expect(r.promoted).toEqual(['ソラ']);
    expect(r.dropped).toEqual(['こまち']);
    const s = sessionOf(r, 'S001');
    expect(s.members).toEqual(['ソラ']);
    expect([s.want, s.interest]).toEqual([[], []]);
  });

  test('複数日をまとめて登録すると、名前の末尾の数字が進む（新規・開催だけ）', async () => {
    const r = await ok(G.sora, G.id, 'saveSession', { name: '鉄鳴界 #2', series: '鉄鳴界', gm: 'ひより', dates: [T(9), T(2), T(16)], date: T(2), status: '開催' });
    expect(r.names).toEqual(['鉄鳴界 #2', '鉄鳴界 #3', '鉄鳴界 #4']);
    expect(r.ids).toEqual(['S001', 'S002', 'S003']);
    expect(r.data.sessions.map((s: any) => s.date)).toEqual([T(2), T(9), T(16)]);
    const plain = await ok(G.sora, G.id, 'saveSession', { name: '単発', gm: 'ひより', dates: [T(1), T(8)], status: '開催' });
    expect(plain.names).toEqual(['単発', '単発 #2']);
    expect((await fail(G.sora, G.id, 'saveSession', { name: 'x', dates: [T(1), T(2)], status: '募集' })).error).toContain('「開催」');
  });

  test('単発の卓から「続けて登録」すると、元の回にも同じシリーズ名が入る', async () => {
    await ok(G.sora, G.id, 'saveSession', { name: '港 #1', gm: 'ひより', date: T(1), status: '開催' });
    const r = await ok(G.sora, G.id, 'saveSession', { name: '港 #2', series: '港', seriesFrom: 'S001', seriesEnd: T(60), gm: 'ひより', date: T(8), status: '開催' });
    expect(r.message).toContain('前の回も「港」にまとめました');
    expect(sessionOf(r, 'S001')).toMatchObject({ series: '港', seriesEnd: T(60) });
  });

  test('番号はS999の次がS1000（S000に戻らない）', async () => {
    await env.DB.prepare('UPDATE groups SET next_session_seq = 999').run();
    expect((await ok(G.sora, G.id, 'saveSession', { name: 'a', status: '募集' })).id).toBe('S999');
    expect((await ok(G.sora, G.id, 'saveSession', { name: 'b', status: '募集' })).id).toBe('S1000');
  });

  test('調整中でなくなったら、日程調整の回答も消える', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', members: ['ソラ'], status: '調整中' });
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5), T(6)] });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM poll_votes').first('n')).toBe(2);
    await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '迷宮', gm: 'ひより', members: ['ソラ'], status: '開催', date: T(5) });
    expect(await env.DB.prepare('SELECT count(*) AS n FROM poll_votes').first('n')).toBe(0);
  });

  test('調整中のまま直すと、候補日・回答・回答そろいの印は残る。募集のまま直すと、参加確認の印は残る', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', members: ['ソラ'], status: '調整中' });
    await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5), T(6)] });
    await ok(G.admin, G.id, 'saveSession', { name: '募集の卓', gm: 'こまち', status: '募集' });
    const at = '2026-01-01T00:00:00.000Z';
    await env.DB.prepare('UPDATE sessions SET poll_ready_at = ?1, asked_at = ?1').bind(at).run();
    let r = await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '迷宮（改）', gm: 'ひより', members: ['ソラ'], status: '調整中' });
    expect(sessionOf(r, 'S001')).toMatchObject({ name: '迷宮（改）', candidates: [T(5), T(6)], votes: { [T(5)]: { ひより: '◯' }, [T(6)]: { ひより: '◯' } } });
    r = await ok(G.admin, G.id, 'saveSession', { id: 'S002', name: '募集の卓', gm: 'こまち', status: '募集', memo: '初心者歓迎' });
    expect(sessionOf(r, 'S002')).toMatchObject({ memo: '初心者歓迎', asked: stampText(at) });
    // 調整中の卓は参加確認の印を、募集の卓は回答そろいの印を持たない
    const rows = (await env.DB.prepare('SELECT seq, poll_ready_at, asked_at FROM sessions ORDER BY seq').all()).results;
    expect(rows).toEqual([{ seq: 1, poll_ready_at: at, asked_at: null }, { seq: 2, poll_ready_at: null, asked_at: at }]);
  });

  test('知らない状態は「開催」として読む（旧い版の「予定」も）', async () => {
    const r = await ok(G.sora, G.id, 'saveSession', { name: '旧い卓', date: T(2), status: '予定' });
    expect(sessionOf(r, 'S001')).toMatchObject({ status: '開催', date: T(2) });
    expect((await fail(G.sora, G.id, 'saveSession', { name: 'x', status: '予定' })).error).toContain('開催日を入れてください');
  });

  test('まとめての登録は、GMがいなくてもよい。参加者は全部の回に入る（空の名前は飛ばす）', async () => {
    const r = await ok(G.sora, G.id, 'saveSession', { name: '練習会', members: ['ソラ', null, ''], extra: 'こまち', dates: [T(10), T(3), T(3)], status: '開催' });
    expect(r.count).toBe(2);
    expect(r.data.sessions.map((s: any) => [s.name, s.date, s.gm, s.members])).toEqual([
      ['練習会', T(3), '', ['ソラ', 'こまち']],
      ['練習会 #2', T(10), '', ['ソラ', 'こまち']],
    ]);
  });
});

describe('参加希望・興味あり', () => {
  test('自分のぶんは誰でも。ほかの人のぶんは、管理者も付けられない。GMや参加者は付けられない', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '募集', gm: 'ひより', members: ['こまち'], status: '募集' });
    const r = await ok(G.sora, G.id, 'setInterest', { id: 'S001', name: 'ソラ', level: 'want' });
    expect(sessionOf(r, 'S001').want).toEqual(['ソラ']);
    expect(await fail(G.sora, G.id, 'setInterest', { id: 'S001', name: 'こまち', level: 'want' })).toEqual({ status: 403, error: '入れられるのは自分のぶんだけです。' });
    expect((await fail(G.komachi, G.id, 'setInterest', { id: 'S001', name: 'こまち', level: 'want' })).error).toContain('すでにこの卓の参加者');
    expect((await fail(G.admin, G.id, 'setInterest', { id: 'S001', name: 'ソラ', level: 'none' })).error).toBe('入れられるのは自分のぶんだけです。');
    const back = await ok(G.sora, G.id, 'setInterest', { id: 'S001', name: 'ソラ', level: 'none' });
    expect(sessionOf(back, 'S001').want).toEqual([]);
  });

  test('募集中でない卓には付けられない', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '開催', gm: 'ひより', status: '開催', date: T(3) });
    expect((await fail(G.sora, G.id, 'setInterest', { id: 'S001', name: 'ソラ', level: 'want' })).error).toContain('募集中ではありません');
  });

  test('GMのいない卓にも付けられる。操作を省くと取り消し', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '募集', status: '募集' });
    let r = await ok(G.sora, G.id, 'setInterest', { id: 'S001', name: 'ソラ', level: 'interest' });
    expect(r.message).toBe('「募集」に興味ありを付けました: ソラ');
    expect(sessionOf(r, 'S001')).toMatchObject({ gm: '', interest: ['ソラ'] });
    r = await ok(G.sora, G.id, 'setInterest', { id: 'S001', name: 'ソラ' });
    expect(r).toMatchObject({ level: 'none', message: '「募集」への希望を取り消しました: ソラ' });
    expect(sessionOf(r, 'S001').interest).toEqual([]);
  });
});

describe('募集の定員と締め切り', () => {
  test('募集の卓だけが持つ。送らなければ今のまま、空にすると消える。「開催」にすると消える', async () => {
    let r = await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'ひより', status: '募集', capacity: '3', recruitDue: T(5) });
    expect(sessionOf(r, 'S001')).toMatchObject({ capacity: 3, recruitDue: T(5) });
    r = await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '古城', gm: 'ひより', status: '募集' });
    expect(sessionOf(r, 'S001')).toMatchObject({ capacity: 3, recruitDue: T(5) });
    r = await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '古城', gm: 'ひより', status: '募集', capacity: '', recruitDue: '' });
    expect(sessionOf(r, 'S001')).toMatchObject({ capacity: 0, recruitDue: '' });
    r = await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '古城', gm: 'ひより', status: '募集', capacity: 4, recruitDue: T(6) });
    r = await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '古城', gm: 'ひより', status: '開催', date: T(9), capacity: 4, recruitDue: T(6) });
    expect(sessionOf(r, 'S001')).toMatchObject({ capacity: 0, recruitDue: '' });
    r = await ok(G.admin, G.id, 'saveSession', { name: '開催の卓', gm: 'ひより', status: '開催', date: T(9), capacity: 4 });
    expect(sessionOf(r, 'S002').capacity).toBe(0);
  });

  test('定員は1〜20人。締め切りは読める日付だけ', async () => {
    for (const capacity of ['0', '21', '2.5', 'あ']) {
      expect((await fail(G.admin, G.id, 'saveSession', { name: '古城', status: '募集', capacity })).error).toBe('定員は1〜20人で入れてください（決めないなら空のまま）。');
    }
    expect((await fail(G.admin, G.id, 'saveSession', { name: '古城', status: '募集', recruitDue: 'x' })).error).toBe('募集の締め切りの日付が読めません: x');
  });

  test('締め切りを過ぎたら、参加希望も興味ありも付けられない（取り消しはできる）。締め切りの日は付けられる', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'ひより', status: '募集', recruitDue: T(0) });
    await ok(G.sora, G.id, 'setInterest', { id: 'S001', name: 'ソラ', level: 'interest' });
    await env.DB.prepare('UPDATE sessions SET recruit_due = ?').bind(T(-1)).run();
    for (const level of ['want', 'interest']) {
      expect((await fail(G.komachi, G.id, 'setInterest', { id: 'S001', name: 'こまち', level })).error).toContain('「古城」の募集は締め切りました');
    }
    await ok(G.sora, G.id, 'setInterest', { id: 'S001', name: 'ソラ', level: 'none' });
  });

  test('まとめて状態を変えると、募集でなくなった卓の定員と締め切りは消える', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'ひより', status: '募集', capacity: 3, recruitDue: T(5) });
    await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ひより', status: '募集', capacity: 2 });
    let r = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'status', value: '募集' });
    expect(sessionOf(r, 'S001')).toMatchObject({ capacity: 3, recruitDue: T(5) });
    r = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001', 'S002'], action: 'status', value: '調整中' });
    expect([sessionOf(r, 'S001'), sessionOf(r, 'S002')].map((x) => [x.capacity, x.recruitDue])).toEqual([[0, ''], [0, '']]);
  });

  test('締め切りを変えると、締め切りの日の知らせを送り直せる。変えなければ印は残る', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: '古城', gm: 'ひより', status: '募集', recruitDue: T(5) });
    await env.DB.prepare("UPDATE sessions SET due_urged_at = 'x'").run();
    await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '古城（改）', gm: 'ひより', status: '募集' });
    expect(await env.DB.prepare('SELECT due_urged_at AS v FROM sessions').first('v')).toBe('x');
    await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '古城', gm: 'ひより', status: '募集', recruitDue: T(6) });
    expect(await env.DB.prepare('SELECT due_urged_at AS v FROM sessions').first('v')).toBeNull();
  });
});

describe('削除', () => {
  test('管理者だけが消せる', async () => {
    await ok(G.sora, G.id, 'saveSession', { name: '消す卓', status: '募集' });
    expect((await fail(G.sora, G.id, 'deleteSession', { id: 'S001' })).error).toBe('ADMIN: 卓の削除ができるのは管理者だけです。');
    const r = await ok(G.admin, G.id, 'deleteSession', { id: 'S001' });
    expect(r.data.sessions).toEqual([]);
  });
});
