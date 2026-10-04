// 新規登録の受付（運営者が切り替える）。止めると、新しいグループの作成と、初めての人のログインを断る。もう使っている人と運営者は別
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AdminOverview } from '../../src/shared/admin';
import type { MeResponse } from '../../src/shared/api';
import { call, loginAs, mockDiscord, postJson } from './helpers';

const OP = '400000000000000098';
let op = '';
let logs: string[] = [];

beforeEach(async () => {
  op = await loginAs({ id: OP, name: '運営' }, [{ id: 'g1', name: 'G', canManage: true }]);
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((s: unknown) => { logs.push(String(s)); });
});
afterEach(() => vi.restoreAllMocks());

const setOpen = async (open: boolean) => {
  const res = await postJson('/api/admin/registration', { open }, op);
  expect(res.status).toBe(200);
  return (await res.json<{ message: string }>()).message;
};
const me = async (sid?: string) => (await call('/api/me', { sid })).json<MeResponse>();
const users = () => env.DB.prepare('SELECT count(*) AS n FROM users').first<number>('n');

/** Discord でログインする（OAuth を通す）。戻り先を返す */
async function discordLogin(id: string) {
  mockDiscord({ user: { id, username: 'u' + id, global_name: '名前' + id }, guilds: [] });
  const login = await call('/auth/login');
  const state = new URL(login.headers.get('Location')!).searchParams.get('state');
  const cookie = login.headers.getSetCookie().find((c) => c.startsWith('yoki_oauth='))!.split(';')[0]!;
  const back = await call('/auth/callback?code=c&state=' + state, { headers: { Cookie: cookie } });
  vi.mocked(globalThis.fetch).mockRestore();
  return back.headers.get('Location');
}

test('初めは受け付ける。運営者が止める・戻すと、様子と入口に出て、監査の控えが残る', async () => {
  expect((await me()).registration).toBe(true);
  expect(await setOpen(false)).toBe('新規登録の受付を止めました。もう使っている人と運営者は、そのまま使えます。');
  expect((await me()).registration).toBe(false);
  expect((await (await call('/api/admin/overview', { sid: op })).json<AdminOverview>()).registrationOpen).toBe(false);
  expect(logs.some((l) => l.includes('"action":"setRegistration"') && l.includes('"target":"closed"'))).toBe(true);
  expect(await setOpen(true)).toBe('新規登録を受け付けます。');
  expect((await me()).registration).toBe(true);
});

describe('受付を止めているとき', () => {
  beforeEach(() => setOpen(false));

  test('初めての人は Discord でログインできず、記録も残らない。もう使っている人と運営者は入れる', async () => {
    const before = await users();
    expect(await discordLogin('500')).toBe('/?login=closed');
    expect(await users()).toBe(before);
    await loginAs({ id: '501', name: 'もう使っている人' }, []);
    expect(await discordLogin('501')).toBe('/');
    // 運営者の ID なら、初めてでも入れる
    expect(await discordLogin('400000000000000099')).toBe('/');
  });

  test('開発用ログインでも、初めての人は断る（開発では、ひよりは運営者なので入れる）', async () => {
    const dev = (as: string) =>
      SELF.fetch('http://localhost:5173/dev/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'http://localhost:5173' }, body: 'as=' + as, redirect: 'manual' });
    expect((await dev('ソラ')).headers.get('Location')).toBe('/?login=closed');
    expect((await dev('ひより')).headers.get('Location')).toBe('/g/sample/');
    // 一度入った人は、止めていても入れる
    await setOpen(true);
    await dev('ソラ');
    await setOpen(false);
    expect((await dev('ソラ')).headers.get('Location')).toBe('/g/sample/');
  });

  test('グループは作れない。運営者は作れる', async () => {
    const sid = await loginAs({ id: '600', name: 'サーバーの管理者' }, [{ id: 'g1', name: 'G', canManage: true }]);
    const r = await postJson('/api/groups', { guildId: 'g1' }, sid);
    expect(r.status).toBe(403);
    expect((await r.json<{ error: string }>()).error).toBe('今は新しいグループの受付を止めています。');
    expect((await postJson('/api/groups', { guildId: 'g1' }, op)).status).toBe(200);
  });
});
