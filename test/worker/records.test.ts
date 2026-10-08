// 卓の記録とPCの台帳: 終わった卓にログと振り返り（GMか管理者）、PCの名前と結果（参加者本人）を残す
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
  // ソラがGM、こまちが参加者の、終わった卓
  await ok(G.admin, G.id, 'saveSession', { name: '港', gm: 'ソラ', members: ['こまち'], date: T(-2), status: '終了' });
});
const sessionOf = (r: Record<string, any>) => r.data.sessions[0];

describe('卓の記録', () => {
  test('GMはログのURLと振り返りを書け、履歴に残る。管理者も書ける', async () => {
    let r = await ok(G.sora, G.id, 'saveRecord', { id: 'S001', logUrl: 'https://example.com/log', recap: '楽しかった' });
    expect(r.message).toBe('「港」の記録を保存しました。');
    expect(sessionOf(r).record).toEqual({ logUrl: 'https://example.com/log', recap: '楽しかった' });
    r = await ok(G.admin, G.id, 'saveRecord', { id: 'S001', logUrl: '', recap: '' });
    expect(sessionOf(r).record).toEqual({ logUrl: '', recap: '' });
    const h = (await ok(G.sora, G.id, 'getSessionHistory', { id: 'S001' })).items.map((x: any) => x.detail);
    expect(h.slice(0, 2)).toEqual(['記録を消した', 'ログ・振り返り']);
    await ok(G.sora, G.id, 'saveRecord', { id: 'S001', recap: 'のみ' });
    await ok(G.sora, G.id, 'saveRecord', { id: 'S001', logUrl: 'https://example.com/x' });
    expect((await ok(G.sora, G.id, 'getSessionHistory', { id: 'S001' })).items.slice(0, 2).map((x: any) => x.detail)).toEqual(['ログ', '振り返り']);
  });

  test('GMでも管理者でもなければ書けない。URLの形と長さを確かめる。まだ終わっていない卓には書けない', async () => {
    expect((await fail(G.komachi, G.id, 'saveRecord', { id: 'S001', recap: 'x' })).error).toBe('ADMIN: GMのほかが卓の記録を書くことができるのは管理者だけです。');
    expect((await fail(G.sora, G.id, 'saveRecord', { id: 'S001', logUrl: 'javascript:alert(1)' })).error).toContain('http:// か https://');
    expect((await fail(G.sora, G.id, 'saveRecord', { id: 'S001', logUrl: 'https://e.com/' + 'a'.repeat(500) })).error).toBe('ログのURLは500文字までです。');
    expect((await fail(G.sora, G.id, 'saveRecord', { id: 'S001', recap: 'あ'.repeat(1001) })).error).toBe('振り返りは1000文字までです。');
    await ok(G.admin, G.id, 'saveSession', { name: '明日の卓', gm: 'ソラ', date: T(1), status: '開催' });
    expect((await fail(G.sora, G.id, 'saveRecord', { id: 'S002', recap: 'x' })).error).toBe('「明日の卓」は、まだ終わっていない卓なので、記録は書けません。');
    await ok(G.admin, G.id, 'saveSession', { name: '募集', gm: 'ソラ', status: '募集' });
    expect((await fail(G.sora, G.id, 'saveRecord', { id: 'S003', recap: 'x' })).error).toContain('まだ終わっていない卓');
    // 今日の開催の卓には書ける
    await ok(G.admin, G.id, 'saveSession', { name: '今日の卓', gm: 'ソラ', date: T(0), status: '開催' });
    await ok(G.sora, G.id, 'saveRecord', { id: 'S004', recap: 'x' });
  });
});

describe('PCの名前と結果', () => {
  test('参加者本人が書く。キャラシのURLはそのまま', async () => {
    await env.DB.prepare("INSERT INTO session_sheets (session_id, member_id, url, pc_name, updated_at) SELECT s.id, m.id, 'https://example.com/sheet', '前の名前', 'x' FROM sessions s, members m WHERE m.name = 'こまち'").run();
    let r = await ok(G.komachi, G.id, 'setPcRecord', { id: 'S001', name: 'こまち', pc: '水瀬 栞', outcome: '生還' });
    expect(r.message).toBe('「港」のこまちのPCを保存しました（水瀬 栞・生還）。');
    expect(sessionOf(r).prep.sheets.こまち).toMatchObject({ url: 'https://example.com/sheet', pc: '水瀬 栞', outcome: '生還' });
    r = await ok(G.komachi, G.id, 'setPcRecord', { id: 'S001', name: 'こまち', pc: '水瀬 栞', outcome: '' });
    expect(r.message).toBe('「港」のこまちのPCを保存しました（水瀬 栞）。');
    r = await ok(G.komachi, G.id, 'setPcRecord', { id: 'S001', name: 'こまち', pc: '', outcome: '' });
    expect(r.message).toBe('「港」のこまちのPCを保存しました。');
  });

  test('キャラシを出していなくても書ける（URLは空）', async () => {
    const r = await ok(G.komachi, G.id, 'setPcRecord', { id: 'S001', name: 'こまち', pc: 'A', outcome: 'ロスト' });
    expect(sessionOf(r).prep.sheets.こまち).toMatchObject({ url: '', pc: 'A', outcome: 'ロスト' });
  });

  test('本人で、その卓の参加者だけ。長さを確かめる', async () => {
    expect((await fail(G.admin, G.id, 'setPcRecord', { id: 'S001', name: 'こまち', pc: 'A' })).error).toBe('入れられるのは自分のぶんだけです。');
    expect((await fail(G.sora, G.id, 'setPcRecord', { id: 'S001', name: 'ソラ', pc: 'A' })).error).toBe('ソラは「港」の参加者ではありません。');
    expect((await fail(G.komachi, G.id, 'setPcRecord', { id: 'S001', name: 'こまち', pc: 'あ'.repeat(51) })).error).toBe('キャラクターの名前は50文字までです。');
    expect((await fail(G.komachi, G.id, 'setPcRecord', { id: 'S001', name: 'こまち', pc: 'A', outcome: 'あ'.repeat(21) })).error).toBe('結果は20文字までです。');
  });
});
