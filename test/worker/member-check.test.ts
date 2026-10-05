// グループに入れるかを、Bot がいるサーバーでは Bot で確かめ直す（控えが古い・控えにサーバーが無いとき）
import { env } from 'cloudflare:test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { groupAccess } from '../../src/worker/auth/guard';
import type { Viewer } from '../../src/worker/auth/session';
import { guildMembership } from '../../src/worker/discord/member';
import { loginAs, makeGroup, mockBotGuilds } from './helpers';

afterEach(() => vi.restoreAllMocks());

describe('サーバーにいるかを Bot で確かめ直す', () => {
  const viewer = (id: string, checkedAt: Date): Viewer => ({ id, username: 'u', globalName: 'ユーザー', avatar: null, guildsCheckedAt: checkedAt.toISOString() });
  const old = new Date(Date.now() - 25 * 3600_000);
  const ug = (userId: string) => env.DB.prepare('SELECT can_manage, checked_at FROM user_guilds WHERE user_id = ?').bind(userId).first<{ can_manage: number; checked_at: string | null }>();

  test('控えが古くても、Bot が「いる」と言えば入れ、確かめた日時を残す（次の 24 時間は聞かない）。管理できるかも読む', async () => {
    await makeGroup('b1', '111');
    await loginAs({ id: '501', name: 'A' }, [{ id: '111', name: 'S' }], { checkedAt: old });
    const bot = mockBotGuilds({ 111: { members: { 501: ['r-admin'] }, owner: '0', roles: { 111: '0', 'r-admin': '8' } } });
    const a = await groupAccess(env.DB, viewer('501', old), 'b1', 'tok', new Date());
    expect(a).toMatchObject({ ok: true, actor: { isAdmin: true } });
    expect(await ug('501')).toMatchObject({ can_manage: 1 });
    expect((await ug('501'))!.checked_at).toBeTruthy();
    const n = bot.calls.length;
    expect((await groupAccess(env.DB, viewer('501', old), 'b1', 'tok', new Date())).ok).toBe(true);
    expect(bot.calls.length).toBe(n);
  });

  test('控えにサーバーが無くても、Bot が「いる」と言えば入れる（オーナーは管理できる）。「いない」なら 403 で、控えからも外す', async () => {
    await makeGroup('b2', '222');
    await loginAs({ id: '502', name: 'A' }, []);
    mockBotGuilds({ 222: { members: { 502: [] }, owner: '502', roles: { 222: '0' } } });
    expect(await groupAccess(env.DB, viewer('502', new Date()), 'b2', 'tok', new Date())).toMatchObject({ ok: true, actor: { isAdmin: true } });
    await loginAs({ id: '503', name: 'B' }, [{ id: '222', name: 'S' }], { checkedAt: old });
    expect(await groupAccess(env.DB, viewer('503', old), 'b2', 'tok', new Date())).toEqual({ ok: false, reason: 'forbidden' });
    expect(await ug('503')).toBeNull();
  });

  test('管理できるかが読めなければ、控えの値のまま。Bot がいない・Discord に届かないときは、今までどおり聞き直す', async () => {
    await makeGroup('b3', '333');
    await loginAs({ id: '504', name: 'C' }, [{ id: '333', name: 'S', canManage: true }], { checkedAt: old });
    mockBotGuilds({ 333: { members: { 504: [] } } });
    expect(await groupAccess(env.DB, viewer('504', old), 'b3', 'tok', new Date())).toMatchObject({ ok: true, actor: { isAdmin: true } });
    // 控えに無く、管理できるかも読めなければ、管理できない
    await loginAs({ id: '506', name: 'E' }, []);
    mockBotGuilds({ 333: { members: { 506: [] } } });
    expect(await groupAccess(env.DB, viewer('506', new Date()), 'b3', 'tok', new Date())).toMatchObject({ ok: true, actor: { isAdmin: false } });
    vi.restoreAllMocks();
    await makeGroup('b4', '444');
    await loginAs({ id: '505', name: 'D' }, [{ id: '444', name: 'S' }], { checkedAt: old });
    mockBotGuilds();
    expect(await groupAccess(env.DB, viewer('505', old), 'b4', 'tok', new Date())).toEqual({ ok: false, reason: 'recheck' });
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    expect(await guildMembership('tok', '444', '505')).toBeNull();
    expect(await groupAccess(env.DB, viewer('505', old), 'b4', '', new Date())).toEqual({ ok: false, reason: 'recheck' });
  });
});
