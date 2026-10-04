// 画面からは起こしにくい場面を、サーバーの関数を直に呼んで確かめる（同じときの別の操作・ログインに結びつかないメンバー・無いグループ）
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Actor } from '../../src/worker/auth/guard';
import { loadGroup } from '../../src/worker/domain/load';
import { saveMember } from '../../src/worker/domain/members';
import { decidePoll, type Io } from '../../src/worker/domain/polls';
import { addDays, fmtDateJa } from '../../src/worker/lib/jst';
import { ok, setupGroup, today } from './helpers';

const APP_URL = 'https://yoki.test/g/grp/';
let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
beforeEach(async () => {
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
});
afterEach(() => vi.restoreAllMocks());

/** そのメンバーとして、グループのデータを読み込む（Bot のトークンも渡し、送るときは本当に送ろうとするようにする） */
async function ctxAs(name: string, isAdmin: boolean) {
  const m = await env.DB.prepare('SELECT id, user_id FROM members WHERE group_id = ? AND name = ?').bind(G.id, name).first<{ id: number; user_id: string | null }>();
  const actor: Actor = { memberId: m!.id, name, isAdmin, userId: m!.user_id ?? '' };
  return loadGroup(env.DB, G.id, actor, APP_URL, new Date(), { token: env.DISCORD_BOT_TOKEN, clientId: env.DISCORD_CLIENT_ID });
}

test('無いグループは読み込めない', async () => {
  const actor: Actor = { memberId: 1, name: 'ひより', isAdmin: true, userId: '1' };
  await expect(loadGroup(env.DB, 'nope', actor, APP_URL)).rejects.toThrow('グループが見つかりません: nope');
});

test('開催日を決めた直後に、ほかの人が卓を中止にしていたら、決まった知らせは送らない', async () => {
  await env.DB.prepare('UPDATE groups SET channel_id = ?').bind('123456789012345678').run();
  await ok(G.admin, G.id, 'saveSession', { name: '迷宮', gm: 'ひより', members: ['ソラ'], status: '調整中' });
  await ok(G.admin, G.id, 'startPoll', { id: 'S001', dates: [T(5)] });
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 200 }));
  const io: Io = {
    // 読み直す前に、別の呼び出しが「中止」にした
    reload: async () => {
      await env.DB.prepare("UPDATE sessions SET status = '中止'").run();
      return ctxAs('ひより', true);
    },
    data: async () => null,
    sleep: async () => {},
  };
  const r = await decidePoll(await ctxAs('ひより', true), { id: 'S001', ymd: T(5) }, io);
  expect(r).toMatchObject({ decided: T(5), notified: null, message: '日程を決めました: 迷宮（' + fmtDateJa(T(5)) + '）' });
  expect(fetchSpy).not.toHaveBeenCalled();
});

test('ログインに結びついていないメンバーの行でも、管理者のほかは Discord ID を変えられない', async () => {
  await ok(G.admin, G.id, 'saveMember', { name: 'エマ', discordId: '123456789012345678' });
  // ふだん、ログインした人の行には user_id が入っている。入っていない行を、本人として直したことにする
  const r = await saveMember(await ctxAs('エマ', false), { oldName: 'エマ', name: 'エマ', discordId: '987654321098765432', note: 'よろしく' });
  expect(r.message).toBe('更新しました: エマ');
  expect(await env.DB.prepare("SELECT discord_id, note FROM members WHERE name = 'エマ'").first()).toEqual({ discord_id: '123456789012345678', note: 'よろしく' });
});
