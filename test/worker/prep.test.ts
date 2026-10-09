// 卓の準備: HOの枠・秘匿HO（見える人）・割り当て・希望・キャラシ、GMの変更の制限
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import { SYSTEM_ACTOR } from '../../src/worker/auth/guard';
import { loadGroup } from '../../src/worker/domain/load';
import { addDays } from '../../src/worker/lib/jst';
import { call, fail, ok, setupGroup, today } from './helpers';

let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
/** GMはこまち（管理者でない）、参加者はソラとひより（管理者） */
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
  await ok(G.sora, G.id, 'saveSession', { name: '港', gm: 'こまち', members: ['ソラ', 'ひより'], date: T(7), status: '開催' });
});
const prepOf = (body: any, id = 'S001') => body.data.sessions.find((s: any) => s.id === id).prep;
const slots = (o: { pos: number; label: string; summary?: string }[] = [{ pos: 1, label: 'HO1', summary: '探偵' }, { pos: 2, label: 'HO2', summary: '記者' }]) => o;
/** HOを2つ作り、HO1に秘匿HOを書いて、ソラに割り当てる */
async function withSecret() {
  await ok(G.komachi, G.id, 'savePrep', { id: 'S001', slots: slots() });
  await ok(G.komachi, G.id, 'saveSlotSecret', { id: 'S001', pos: 1, secret: '犯人は執事' });
  await ok(G.komachi, G.id, 'assignSlots', { id: 'S001', assign: { 1: 'ソラ' } });
}

describe('HOの枠と締め切り', () => {
  test('GMが枠と締め切りを書く。画面データに出る。番号で書き換え、消した枠だけ消える', async () => {
    const r = await ok(G.komachi, G.id, 'savePrep', { id: 'S001', slots: slots(), sheetDue: T(3) });
    expect(r.message).toBe('「港」の準備を保存しました（HO 2個・キャラシの締め切り ' + T(3) + '）');
    expect(prepOf(r)).toEqual({
      sheetDue: T(3), sheets: {},
      slots: [
        { pos: 1, label: 'HO1', summary: '探偵', assigned: '', secret: '', hasSecret: false, hopes: {} },
        { pos: 2, label: 'HO2', summary: '記者', assigned: '', secret: '', hasSecret: false, hopes: {} },
      ],
    });
    await ok(G.sora, G.id, 'setSlotHope', { id: 'S001', name: 'ソラ', hopes: [2] });
    const again = await ok(G.komachi, G.id, 'savePrep', { id: 'S001', slots: [{ pos: 2, label: 'HO2（記者）', summary: '' }, { pos: 3, label: 'HO3' }] });
    expect(again.message).toBe('「港」の準備を保存しました（HO 2個）');
    expect(prepOf(again).sheetDue).toBe('');
    expect(prepOf(again).slots.map((x: any) => [x.pos, x.label, x.hopes])).toEqual([[2, 'HO2（記者）', { ソラ: 1 }], [3, 'HO3', {}]]);
    // 枠を全部消す
    expect(prepOf(await ok(G.komachi, G.id, 'savePrep', { id: 'S001', slots: [] })).slots).toEqual([]);
  });

  test('締め切りを変えると、締め切り前の催促の印が消える。同じなら残る', async () => {
    await ok(G.komachi, G.id, 'savePrep', { id: 'S001', slots: [], sheetDue: T(3) });
    await env.DB.prepare("UPDATE sessions SET sheet_urged_at = '2026-01-01T00:00:00Z'").run();
    await ok(G.komachi, G.id, 'savePrep', { id: 'S001', slots: [], sheetDue: T(3) });
    expect(await env.DB.prepare('SELECT sheet_urged_at FROM sessions').first('sheet_urged_at')).not.toBeNull();
    await ok(G.komachi, G.id, 'savePrep', { id: 'S001', slots: [], sheetDue: T(4) });
    expect(await env.DB.prepare('SELECT sheet_urged_at FROM sessions').first('sheet_urged_at')).toBeNull();
  });

  test('GMか管理者だけ。終わった卓・中止の卓は変えられない。入れられない値は断る', async () => {
    expect((await fail(G.sora, G.id, 'savePrep', { id: 'S001', slots: [] })).error).toBe('ADMIN: GMのほかがHOと締め切りを変えることができるのは管理者だけです。');
    await ok(G.admin, G.id, 'savePrep', { id: 'S001', slots: slots() });
    const bad = async (o: Record<string, unknown>) => (await fail(G.komachi, G.id, 'savePrep', { id: 'S001', ...o })).error;
    expect(await bad({ slots: Array.from({ length: 13 }, (_, i) => ({ pos: i + 1, label: 'HO' })) })).toBe('HOは12個までです。');
    expect(await bad({ slots: [{ pos: 0, label: 'HO' }] })).toBe('HOの番号が正しくありません。');
    expect(await bad({ slots: [null] })).toBe('HOの番号が正しくありません。');
    expect(await bad({ slots: [{ pos: 1, label: '' }] })).toBe('HOの名前を入れてください（HO1など）。');
    expect(await bad({ slots: [{ pos: 1, label: 'あ'.repeat(31) }] })).toBe('HOの名前は30文字までです。');
    expect(await bad({ slots: [{ pos: 1, label: 'HO', summary: 'あ'.repeat(501) }] })).toBe('公開HOは500文字までです。');
    expect(await bad({ slots: [{ pos: 1, label: 'A' }, { pos: 1, label: 'B' }] })).toBe('HOの番号が重なっています。');
    expect(await bad({ slots: [], sheetDue: '2026/02/31' })).toBe('キャラシの締め切りの日付が読めません: 2026/02/31');
    // slotsが配列でなければ、枠なし
    expect(prepOf(await ok(G.komachi, G.id, 'savePrep', { id: 'S001', slots: 'x' })).slots).toEqual([]);
    await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'status', value: '中止' });
    expect(await bad({ slots: [] })).toBe('「港」は中止の卓なので、準備は変えられません。');
  });
});

describe('秘匿HO', () => {
  test('GMと割り当てた本人にだけ見える。ほかのメンバー・管理者には、あることだけが見える', async () => {
    await withSecret();
    const see = async (sid: string) => prepOf({ data: await ok(sid, G.id, 'getConsoleData') }).slots[0];
    expect(await see(G.komachi)).toMatchObject({ secret: '犯人は執事', hasSecret: true, assigned: 'ソラ' });
    expect(await see(G.sora)).toMatchObject({ secret: '犯人は執事', hasSecret: true });
    expect(await see(G.admin)).toMatchObject({ secret: null, hasSecret: true, assigned: 'ソラ' });
    // 秘匿HOの無い枠は、だれにも空（GMと本人）かnull
    expect(prepOf({ data: await ok(G.admin, G.id, 'getConsoleData') }).slots[1]).toMatchObject({ secret: null, hasSecret: false });
  });

  test('見回り（人でない読み込み）と、購読URLには出ない', async () => {
    await withSecret();
    const ctx = await loadGroup(env.DB, G.id, SYSTEM_ACTOR, 'https://yoki.test/g/grp/');
    expect(ctx.sessions[0]!.slots[0]).toMatchObject({ secret: null, hasSecret: true });
    const feed = await ok(G.sora, G.id, 'saveCalendarFeed', { scope: 'all' });
    const url = new URL(feed.data.calendar.feed.url);
    const ics = await (await call(url.pathname)).text();
    expect(ics).toContain('港');
    expect(ics).not.toContain('犯人は執事');
  });

  test('書けるのはGMだけ（管理者も書けない）。長すぎる・知らない枠は断る。空で消す', async () => {
    await ok(G.komachi, G.id, 'savePrep', { id: 'S001', slots: slots() });
    expect((await fail(G.admin, G.id, 'saveSlotSecret', { id: 'S001', pos: 1, secret: 'x' })).error).toBe('秘匿HOを書けるのは、その卓のGMだけです。');
    expect((await fail(G.sora, G.id, 'saveSlotSecret', { id: 'S001', pos: 1, secret: 'x' })).error).toBe('秘匿HOを書けるのは、その卓のGMだけです。');
    expect((await fail(G.komachi, G.id, 'saveSlotSecret', { id: 'S001', pos: 1, secret: 'あ'.repeat(2001) })).error).toBe('秘匿HOは2000文字までです。');
    expect((await fail(G.komachi, G.id, 'saveSlotSecret', { id: 'S001', pos: 9, secret: 'x' })).error).toBe('HOが見つかりません: 9');
    expect((await ok(G.komachi, G.id, 'saveSlotSecret', { id: 'S001', pos: 1, secret: 'x' })).message).toBe('HO1の秘匿HOを保存しました');
    expect((await ok(G.komachi, G.id, 'saveSlotSecret', { id: 'S001', pos: 1, secret: '' })).message).toBe('HO1の秘匿HOを消しました');
  });

  test('秘匿HOのある枠を消せるのは、GMだけ', async () => {
    await withSecret();
    expect((await fail(G.admin, G.id, 'savePrep', { id: 'S001', slots: slots().slice(1) })).error).toBe('秘匿HOのあるHOを消せるのは、GMだけです。');
    // 秘匿HOの無い枠は、管理者も消せる
    await ok(G.admin, G.id, 'savePrep', { id: 'S001', slots: slots().slice(0, 1) });
    await ok(G.komachi, G.id, 'savePrep', { id: 'S001', slots: [] });
  });
});

describe('GMの変更', () => {
  test('秘匿HOのある卓のGMを替えられるのは、今のGMだけ（管理者も替えられない）。替えれば、新しいGMに見える', async () => {
    await withSecret();
    const form = { id: 'S001', name: '港', gm: 'ひより', members: ['ソラ'], date: T(7), status: '開催' };
    expect((await fail(G.sora, G.id, 'saveSession', form)).error).toBe('「港」には秘匿HOがあるので、GMと共同GMを替えられるのは今のGMか共同GM（こまち）だけです。');
    expect((await fail(G.admin, G.id, 'saveSession', form)).status).toBe(400);
    expect((await fail(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'setGm', value: 'ひより' })).status).toBe(400);
    // GMのままなら、ほかの人も卓を変えられる
    await ok(G.sora, G.id, 'saveSession', { ...form, gm: 'こまち', members: ['ソラ', 'ひより'] });
    const r = await ok(G.komachi, G.id, 'saveSession', form);
    expect(prepOf({ data: await ok(G.admin, G.id, 'getConsoleData') }).slots[0].secret).toBe('犯人は執事');
    expect(r.ok).toBe(true);
  });

  test('メンバーのGMがいない卓なら、管理者がGMを替え、HOを割り当てられる', async () => {
    await withSecret();
    await ok(G.admin, G.id, 'deleteMember', { name: 'こまち' });
    // こまちは名前だけのGM（ゲスト）になる。ソラはまだ割り当てられている
    await ok(G.admin, G.id, 'assignSlots', { id: 'S001', assign: { 2: 'ひより' } });
    await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: '港', gm: 'ひより', members: ['ソラ', 'ひより'], date: T(7), status: '開催' });
    expect(prepOf({ data: await ok(G.admin, G.id, 'getConsoleData') }).slots[0].secret).toBe('犯人は執事');
  });
});

describe('割り当てと希望', () => {
  beforeEach(async () => { await ok(G.komachi, G.id, 'savePrep', { id: 'S001', slots: slots() }); });

  test('GMが参加者に割り当てる。外すのは空。送らなかった枠は今のまま。1人に1つまで', async () => {
    const r = await ok(G.komachi, G.id, 'assignSlots', { id: 'S001', assign: { 1: 'ソラ', 2: 'ひより' } });
    expect(r.message).toBe('「港」のHOを割り当てました');
    expect(prepOf(r).slots.map((x: any) => x.assigned)).toEqual(['ソラ', 'ひより']);
    expect(prepOf(await ok(G.komachi, G.id, 'assignSlots', { id: 'S001', assign: { 2: '' } })).slots.map((x: any) => x.assigned)).toEqual(['ソラ', '']);
    expect((await fail(G.komachi, G.id, 'assignSlots', { id: 'S001', assign: { 2: 'ソラ' } })).error).toBe('1人に割り当てられるHOは1つまでです。');
    expect((await fail(G.komachi, G.id, 'assignSlots', { id: 'S001', assign: { 2: 'こまち' } })).error).toBe('こまちは「港」の参加者（メンバー）ではないので、HOを割り当てられません。');
    expect((await fail(G.komachi, G.id, 'assignSlots', { id: 'S001', assign: { 7: 'ソラ' } })).status).toBe(404);
    expect((await fail(G.admin, G.id, 'assignSlots', { id: 'S001', assign: { 2: 'ひより' } })).error).toBe('HOを割り当てられるのは、その卓のGMだけです。');
    // assignが無ければ、何も変えない
    expect(prepOf(await ok(G.komachi, G.id, 'assignSlots', { id: 'S001' })).slots.map((x: any) => x.assigned)).toEqual(['ソラ', '']);
  });

  test('参加者から外すと、割り当ても外れる（卓の保存・まとめての変更）', async () => {
    await ok(G.komachi, G.id, 'assignSlots', { id: 'S001', assign: { 1: 'ソラ', 2: 'ひより' } });
    const r = await ok(G.komachi, G.id, 'saveSession', { id: 'S001', name: '港', gm: 'こまち', members: ['ひより'], date: T(7), status: '開催' });
    expect(prepOf(r).slots.map((x: any) => x.assigned)).toEqual(['', 'ひより']);
    const b = await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'removeMember', value: 'ひより' });
    expect(prepOf(b).slots.map((x: any) => x.assigned)).toEqual(['', '']);
    // 割り当てが無ければ、そのまま書く
    await ok(G.admin, G.id, 'bulkUpdateSessions', { ids: ['S001'], action: 'addMember', value: 'ソラ' });
  });

  test('参加者本人が第2希望まで出す。希望は、GM・管理者・本人にだけ見える', async () => {
    const r = await ok(G.sora, G.id, 'setSlotHope', { id: 'S001', name: 'ソラ', hopes: [2, 1] });
    expect(r.message).toBe('ソラのHOの希望: 第1希望 HO2、第2希望 HO1');
    await ok(G.admin, G.id, 'setSlotHope', { id: 'S001', name: 'ひより', hopes: [2] });
    const hopes = async (sid: string) => prepOf({ data: await ok(sid, G.id, 'getConsoleData') }).slots.map((x: any) => x.hopes);
    expect(await hopes(G.komachi)).toEqual([{ ソラ: 2 }, { ソラ: 1, ひより: 1 }]);
    expect(await hopes(G.sora)).toEqual([{ ソラ: 2 }, { ソラ: 1 }]);
    expect(await hopes(G.admin)).toEqual([{ ソラ: 2 }, { ソラ: 1, ひより: 1 }]);
    expect((await ok(G.sora, G.id, 'setSlotHope', { id: 'S001', name: 'ソラ', hopes: [] })).message).toBe('ソラのHOの希望を取り消しました');
    expect(await hopes(G.sora)).toEqual([{}, {}]);
  });

  test('希望を出せない場合', async () => {
    expect((await fail(G.komachi, G.id, 'setSlotHope', { id: 'S001', name: 'こまち', hopes: [1] })).error).toBe('こまちは「港」の参加者ではないので、HOの希望は出せません。');
    expect((await fail(G.sora, G.id, 'setSlotHope', { id: 'S001', name: 'ひより', hopes: [1] })).status).toBe(403);
    expect((await fail(G.sora, G.id, 'setSlotHope', { id: 'S001', name: 'ソラ', hopes: [1, 2, 1] })).error).toBe('HOの希望は、第2希望までです。');
    expect((await fail(G.sora, G.id, 'setSlotHope', { id: 'S001', name: 'ソラ', hopes: [1, 1] })).error).toBe('第1希望と第2希望は、別のHOにしてください。');
    expect((await fail(G.sora, G.id, 'setSlotHope', { id: 'S001', name: 'ソラ', hopes: [5] })).status).toBe(404);
  });
});

describe('キャラシ', () => {
  test('GMと参加者の本人が出し、取り下げる。画面データに名前で出る', async () => {
    const r = await ok(G.sora, G.id, 'submitSheet', { id: 'S001', name: 'ソラ', url: 'https://example.com/sheet/1', pc: '探偵 一郎' });
    expect(r.message).toBe('ソラのキャラシを出しました（探偵 一郎）');
    expect(prepOf(r).sheets.ソラ).toMatchObject({ url: 'https://example.com/sheet/1', pc: '探偵 一郎' });
    expect((await ok(G.komachi, G.id, 'submitSheet', { id: 'S001', name: 'こまち', url: 'http://example.com/npc' })).message).toBe('こまちのキャラシを出しました');
    // 出し直し
    expect(prepOf(await ok(G.sora, G.id, 'submitSheet', { id: 'S001', name: 'ソラ', url: 'https://example.com/sheet/2' })).sheets.ソラ.url).toBe('https://example.com/sheet/2');
    expect((await ok(G.sora, G.id, 'submitSheet', { id: 'S001', name: 'ソラ', url: '' })).message).toBe('ソラのキャラシを取り下げました');
  });

  test('管理者は、ほかの人のキャラシを取り下げることだけできる', async () => {
    await ok(G.sora, G.id, 'submitSheet', { id: 'S001', name: 'ソラ', url: 'https://example.com/s' });
    expect((await fail(G.admin, G.id, 'submitSheet', { id: 'S001', name: 'ソラ', url: 'https://example.com/x' })).status).toBe(403);
    expect(prepOf(await ok(G.admin, G.id, 'submitSheet', { id: 'S001', name: 'ソラ', url: '' })).sheets).toEqual({});
    expect((await fail(G.admin, G.id, 'submitSheet', { id: 'S001', name: 'だれか', url: '' })).error).toBe('メンバーが見つかりません: だれか');
  });

  test('出せない場合', async () => {
    await ok(G.sora, G.id, 'saveSession', { name: '別の卓', gm: 'ソラ', members: [], date: T(8), status: '開催' });
    expect((await fail(G.komachi, G.id, 'submitSheet', { id: 'S002', name: 'こまち', url: 'https://example.com' })).error).toBe('こまちは「別の卓」のGMでも参加者でもないので、キャラシは出せません。');
    expect((await fail(G.sora, G.id, 'submitSheet', { id: 'S001', name: 'ソラ', url: 'https://example.com/' + 'a'.repeat(490) })).error).toBe('キャラシのURLは500文字までです。');
    expect((await fail(G.sora, G.id, 'submitSheet', { id: 'S001', name: 'ソラ', url: 'javascript:x' })).error).toBe('キャラシのURLは、http:// か https:// で始まるアドレスを入れてください。');
    expect((await fail(G.sora, G.id, 'submitSheet', { id: 'S001', name: 'ソラ', url: 'https://example.com', pc: 'あ'.repeat(51) })).error).toBe('キャラクターの名前は50文字までです。');
    expect((await fail(G.sora, G.id, 'submitSheet', { id: 'S001', name: 'こまち', url: 'https://example.com' })).status).toBe(403);
  });

  test('メンバーを外すと、その人のキャラシと希望は消え、割り当ては外れる', async () => {
    await withSecret();
    await ok(G.sora, G.id, 'submitSheet', { id: 'S001', name: 'ソラ', url: 'https://example.com/s' });
    await ok(G.sora, G.id, 'setSlotHope', { id: 'S001', name: 'ソラ', hopes: [1] });
    await ok(G.admin, G.id, 'deleteMember', { name: 'ソラ' });
    const p = prepOf({ data: await ok(G.komachi, G.id, 'getConsoleData') });
    expect(p.sheets).toEqual({});
    expect(p.slots[0]).toMatchObject({ assigned: '', hopes: {} });
  });
});
