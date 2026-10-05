// Google でログインする（Discord のアカウントに結びつけた、もう 1 つの入り口）
import { env } from 'cloudflare:test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { app } from '../../src/worker/app';
import { consumeGoogleLink, linkGoogleLogin, PENDING_MS } from '../../src/worker/auth/google-login';
import type { Bindings } from '../../src/worker/env';
import { googleDeps } from '../../src/worker/google/config';
import { DEV_GOOGLE_SUB } from '../../src/worker/google/dev';
import { seal } from '../../src/worker/lib/secretbox';
import { call, loginAs, makeGroup, mockDiscord, ok, ORIGIN, setCookies, setupGroup, SID } from './helpers';

afterEach(() => vi.restoreAllMocks());

const SORA = '400000000000000011';
const cookieOf = (res: Response, name: string) => setCookies(res).find((c) => c.startsWith(name + '='))?.split(';')[0]!.slice(name.length + 1);
const loginRow = (userId: string) => env.DB.prepare('SELECT google_sub, email, last_login_at FROM google_logins WHERE user_id = ?').bind(userId).first<Record<string, string | null>>();

/** /auth/google/login を呼び、Google へ渡す state と、戻ってくるときの cookie を返す */
async function start(q = '', sid?: string) {
  const res = await call('/auth/google/login' + q, { sid });
  const to = res.headers.get('Location') ?? '';
  const raw = cookieOf(res, 'yoki_glogin') ?? '';
  return { res, to, state: new URL(to, ORIGIN).searchParams.get('state') ?? '', cookie: 'yoki_glogin=' + raw, saved: decodeURIComponent(raw) };
}
/** Google から戻ってくる（cookie は state の cookie と、ほかに足すもの） */
const back = (q: string, cookies: string[]) => call('/auth/google/callback?' + q, { headers: { Cookie: cookies.filter(Boolean).join('; ') } });

describe('Google でログインする', () => {
  test('始める: 偽の Google の同意の画面へ送る。戻り先は画面の道だけ。結びつけるのはログインしている人だけ', async () => {
    const s = await start('?return_to=' + encodeURIComponent('/g/grp/'));
    expect(s.res.status).toBe(302);
    expect(s.to).toMatch(/^https:\/\/yoki\.test\/dev\/google\/authorize\?/);
    expect(s.saved).toBe(s.state + '|login||/g/grp/');
    expect((await start('?return_to=https://evil.example/')).saved).toMatch(/\|login\|\|\/$/);
    expect((await start()).saved).toMatch(/\|login\|\|\/$/);
    const anon = await call('/auth/google/login?link=1&return_to=' + encodeURIComponent('/g/grp/settings/'));
    expect(anon.headers.get('Location')).toBe('/auth/login?return_to=' + encodeURIComponent('/g/grp/settings/'));
    const sid = await loginAs({ id: SORA, name: 'ソラ' }, []);
    expect((await start('?link=1', sid)).saved).toMatch(new RegExp('\\|link\\|' + SORA + '\\|/$'));
  });

  test('運営者が設定していなければ、案内を出す', async () => {
    const res = await app.request(ORIGIN + '/auth/google/login', {}, { ...env, GOOGLE_CLIENT_ID: 'id-only' });
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('Google のログインの設定がありません');
  });

  test('初めての Google のアカウント: 控えて、Discord でログインしてもらう。Discord でログインしたら結びつき、次からは Google でそのまま入れる', async () => {
    await makeGroup('grp', 'guild-t');
    const s = await start('?return_to=' + encodeURIComponent('/g/grp/'));
    const r = await back('code=x&state=' + s.state, [s.cookie]);
    expect(r.headers.get('Location')).toBe('/?login=google-new&return_to=' + encodeURIComponent('/g/grp/'));
    const pending = cookieOf(r, 'yoki_glink')!;
    expect(pending).toMatch(/^v1\./);
    expect(decodeURIComponent(pending)).not.toContain(DEV_GOOGLE_SUB);
    // 入口へ戻るときは、戻り先を付けない
    const s2 = await start();
    expect((await back('code=x&state=' + s2.state, [s2.cookie])).headers.get('Location')).toBe('/?login=google-new');

    // Discord でログインする（控えを持って）
    mockDiscord({ user: { id: SORA, username: 'sora', global_name: 'ソラ' }, guilds: [{ id: 'guild-t', name: 'T', permissions: '0' }] });
    const dl = await call('/auth/login');
    const oauth = cookieOf(dl, 'yoki_oauth')!;
    const state = new URL(dl.headers.get('Location')!).searchParams.get('state')!;
    const cb = await call('/auth/callback?code=c&state=' + state, { headers: { Cookie: 'yoki_oauth=' + oauth + '; yoki_glink=' + pending } });
    expect(cb.headers.get('Location')).toBe('/?login=google-linked');
    expect(setCookies(cb).some((c) => c.startsWith('yoki_glink=;'))).toBe(true);
    expect(await loginRow(SORA)).toMatchObject({ google_sub: DEV_GOOGLE_SUB, email: 'dev@example.com', last_login_at: null });
    vi.restoreAllMocks();

    // 次からは Google だけで入れる
    const s3 = await start('?return_to=' + encodeURIComponent('/g/grp/'));
    const in3 = await back('code=x&state=' + s3.state, [s3.cookie]);
    expect(in3.headers.get('Location')).toBe('/g/grp/');
    const sid = cookieOf(in3, SID)!;
    expect(sid).toBeTruthy();
    expect((await call('/api/me', { sid })).status).toBe(200);
    expect(((await (await call('/api/me', { sid })).json()) as { user: { id: string } }).user.id).toBe(SORA);
    expect((await loginRow(SORA))!.last_login_at).toBeTruthy();
  });

  test('Discord のログインで戻り先がグループなら、結びつけても、そのままグループへ戻る', async () => {
    const key = (await googleDeps(env as unknown as Bindings, ORIGIN))!.key;
    const pending = await seal(key, JSON.stringify({ sub: 'g-1', email: 'a@example.com', at: new Date().toISOString() }));
    mockDiscord({ user: { id: SORA, username: 'sora' }, guilds: [] });
    const dl = await call('/auth/login?return_to=' + encodeURIComponent('/g/grp/'));
    const state = new URL(dl.headers.get('Location')!).searchParams.get('state')!;
    const cb = await call('/auth/callback?code=c&state=' + state, { headers: { Cookie: 'yoki_oauth=' + cookieOf(dl, 'yoki_oauth') + '; yoki_glink=' + encodeURIComponent(pending) } });
    expect(cb.headers.get('Location')).toBe('/g/grp/');
    expect((await loginRow(SORA))!.google_sub).toBe('g-1');
  });

  test('締め出された人は Google でも入れない。断られたら入口へ。code が無ければやり直し', async () => {
    await loginAs({ id: SORA, name: 'ソラ' }, []);
    await linkGoogleLogin(env.DB, SORA, DEV_GOOGLE_SUB, 'dev@example.com', new Date());
    await env.DB.prepare("UPDATE users SET banned_at = '2026-01-01' WHERE id = ?").bind(SORA).run();
    const s = await start();
    expect((await back('code=x&state=' + s.state, [s.cookie])).headers.get('Location')).toBe('/?login=banned');
    const s2 = await start();
    expect((await back('error=access_denied&state=' + s2.state, [s2.cookie])).headers.get('Location')).toBe('/?login=cancelled');
    const s3 = await start();
    expect((await back('state=' + s3.state, [s3.cookie])).status).toBe(400);
    // state が無ければ、ログインの戻りとはみなさない（カレンダーの連携の戻りとして、途中の情報が無いので断る）
    const s4 = await start();
    expect((await back('code=x', [s4.cookie])).status).toBe(400);
  });

  test('cookie の戻り先が画面の道でなければ、入口へ戻す', async () => {
    await loginAs({ id: SORA, name: 'ソラ' }, []);
    await linkGoogleLogin(env.DB, SORA, DEV_GOOGLE_SUB, 'dev@example.com', new Date());
    const res = await back('code=x&state=st', ['yoki_glogin=' + encodeURIComponent('st|login||https://evil.example/')]);
    expect(res.headers.get('Location')).toBe('/');
  });

  test('設定の画面から結びつける・取りやめる。始めた人と違う人・ほかの人の Google アカウントは断る。外せる', async () => {
    const G = await setupGroup();
    const settings = '?link=1&return_to=' + encodeURIComponent('/g/grp/settings/');
    const s = await start(settings, G.sora);
    const res = await back('code=x&state=' + s.state, [s.cookie, SID + '=' + G.sora]);
    expect(res.headers.get('Location')).toBe('/g/grp/settings/?google=login-linked');
    expect((await ok(G.sora, G.id, 'getConsoleData')).googleLogin).toEqual({ ready: true, email: 'dev@example.com' });
    // 取りやめた
    const s2 = await start(settings, G.sora);
    expect((await back('error=access_denied&state=' + s2.state, [s2.cookie, SID + '=' + G.sora])).headers.get('Location')).toBe('/g/grp/settings/?google=login-cancelled');
    // 戻ってきたのが別の人
    const s3 = await start(settings, G.sora);
    expect((await back('code=x&state=' + s3.state, [s3.cookie, SID + '=' + G.komachi])).status).toBe(400);
    // こまちが同じ Google アカウントを結びつけようとした
    const s4 = await start(settings, G.komachi);
    const taken = await back('code=x&state=' + s4.state, [s4.cookie, SID + '=' + G.komachi]);
    expect(taken.status).toBe(409);
    expect(await taken.text()).toContain('ほかの Discord アカウントに結びついています');
    // 外す
    const r = await ok(G.sora, G.id, 'unlinkGoogleLogin');
    expect(r.message).toBe('Google でのログインを外しました。Discord では、今までどおりログインできます。');
    expect(r.data.googleLogin).toEqual({ ready: true, email: '' });
  });

  test('控えは、読めない・古い・ほかの人の Google アカウント・設定が無い、なら結びつけない', async () => {
    await loginAs({ id: SORA, name: 'ソラ' }, []);
    await loginAs({ id: '9', name: 'ほか' }, []);
    await linkGoogleLogin(env.DB, '9', 'taken', 'x@example.com', new Date());
    const key = (await googleDeps(env as unknown as Bindings, ORIGIN))!.key;
    const now = new Date();
    const sealed = (p: object) => seal(key, JSON.stringify(p));
    const tryWith = async (cookie: string | null, e: Partial<Bindings> = {}) => {
      const headers: Record<string, string> = cookie === null ? {} : { Cookie: 'yoki_glink=' + encodeURIComponent(cookie) };
      const c = { req: { url: ORIGIN + '/', raw: new Request(ORIGIN + '/', { headers }), header: (n: string) => headers[n] }, env: { ...env, ...e }, header: () => {} };
      return consumeGoogleLink(c as never, SORA, now);
    };
    expect(await tryWith(null)).toBe(false);
    expect(await tryWith('broken')).toBe(false);
    expect(await tryWith(await sealed({ sub: '', email: '', at: now.toISOString() }))).toBe(false);
    expect(await tryWith(await sealed({ sub: 'g', email: '', at: new Date(now.getTime() - PENDING_MS).toISOString() }))).toBe(false);
    expect(await tryWith(await sealed({ sub: 'taken', email: '', at: now.toISOString() }))).toBe(false);
    expect(await tryWith(await sealed({ sub: 'g', email: '', at: now.toISOString() }), { GOOGLE_CLIENT_ID: 'id-only' })).toBe(false);
    expect(await loginRow(SORA)).toBeNull();
    expect(await tryWith(await sealed({ sub: 'g', email: 'g@example.com', at: now.toISOString() }))).toBe(true);
    expect((await loginRow(SORA))!.google_sub).toBe('g');
  });

  test('入口の API は、Google でもログインできるかを知らせる', async () => {
    expect(((await (await call('/api/me')).json()) as { google: boolean }).google).toBe(true);
  });
});
