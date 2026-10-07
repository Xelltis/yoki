// Google連携の部品: 暗号化、設定、本物のGoogleの呼び方（fetchを差し替える）、開発用の偽のGoogle
import { env, SELF } from 'cloudflare:test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { app } from '../../src/worker/app';
import type { Bindings } from '../../src/worker/env';
import { emailOfIdToken, GoogleHttpError, GoogleRevoked, realGoogle, toBusy } from '../../src/worker/google/api';
import { googleConfigured, googleDeps } from '../../src/worker/google/config';
import { fakeGoogle, readFake, writeFake } from '../../src/worker/google/dev';
import { jstMs } from '../../src/worker/lib/ics';
import { importKey, open, seal } from '../../src/worker/lib/secretbox';
import { call, ORIGIN, setupGroup, SID } from './helpers';

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const OTHER = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

afterEach(() => vi.restoreAllMocks());

describe('暗号化', () => {
  test('同じ鍵で戻せる。毎回違う形になる', async () => {
    const key = await importKey(KEY);
    const a = await seal(key, 'refresh-token-あ');
    expect(a).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(await seal(key, 'refresh-token-あ')).not.toBe(a);
    expect(await open(key, a)).toBe('refresh-token-あ');
  });

  test('鍵が違う・形が違う・鍵の長さが違えば失敗する', async () => {
    const sealed = await seal(await importKey(KEY), 'x');
    await expect(open(await importKey(OTHER), sealed)).rejects.toThrow();
    await expect(open(await importKey(KEY), 'v2.a.b')).rejects.toThrow('形が違います');
    await expect(open(await importKey(KEY), 'v1.a')).rejects.toThrow('形が違います');
    await expect(importKey(btoa('short'))).rejects.toThrow('32バイト');
  });
});

describe('設定', () => {
  const base = env as unknown as Bindings;
  test('開発の形では、Client IDが空なら偽のGoogle。値を入れたら3つそろったときだけ', () => {
    expect(googleConfigured({ ...base, GOOGLE_CLIENT_ID: '' })).toBe(true);
    expect(googleConfigured({ ...base, GOOGLE_CLIENT_ID: 'id' })).toBe(false);
    expect(googleConfigured({ ...base, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' })).toBe(false);
    expect(googleConfigured({ ...base, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's', GOOGLE_TOKEN_KEY: KEY })).toBe(true);
    // 鍵の形が違う（24バイト・base64でない）なら、使えないことにする
    expect(googleConfigured({ ...base, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's', GOOGLE_TOKEN_KEY: btoa('x'.repeat(24)) })).toBe(false);
    expect(googleConfigured({ ...base, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's', GOOGLE_TOKEN_KEY: '#'.repeat(44) })).toBe(false);
  });

  test('鍵の形が違っても、Googleに関わる操作（卓の保存など）は止まらない', async () => {
    const { admin } = await setupGroup();
    const bad = { ...env, GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 's', GOOGLE_TOKEN_KEY: btoa('x'.repeat(24)) };
    const res = await app.request(ORIGIN + '/api/g/grp/saveSession', {
      method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Cookie: SID + '=' + admin }, body: JSON.stringify({ name: '鍵の誤り', status: '募集' }),
    }, bad);
    expect(res.status).toBe(200);
    expect((await res.json<{ message: string }>()).message).toContain('鍵の誤り');
  });

  test('一式: 偽のGoogleは /dev/google/authorize、本物はaccounts.google.com。設定が無ければnull。アドレスはAPP_URLを正とする', async () => {
    const fake = (await googleDeps({ ...base, GOOGLE_CLIENT_ID: '', APP_URL: '' }, 'http://localhost:5173'))!;
    expect(fake.appBase).toBe('http://localhost:5173');
    expect(fake.api.authorizeUrl('http://localhost:5173/auth/google/callback', 'st')).toMatch(/^http:\/\/localhost:5173\/dev\/google\/authorize\?/);
    const real = (await googleDeps({ ...base, GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 's', GOOGLE_TOKEN_KEY: KEY, APP_URL: 'https://yoki.example/' }, 'https://workers.dev'))!;
    expect(real.appBase).toBe('https://yoki.example');
    const u = new URL(real.api.authorizeUrl('https://yoki.example/auth/google/callback', 'st'));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      client_id: 'cid', redirect_uri: 'https://yoki.example/auth/google/callback', response_type: 'code', access_type: 'offline', prompt: 'consent', state: 'st',
      scope: 'openid email https://www.googleapis.com/auth/calendar.events.owned',
    });
    expect(await googleDeps({ ...base, GOOGLE_CLIENT_ID: 'cid' }, 'x')).toBeNull();
  });
});

/** fetchを差し替える。routeはURLとメソッドから返事を作る */
function mockFetch(route: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return route(url, init);
  });
  return calls;
}

/** JWTの形（中身はUTF-8のJSONをbase64urlに） */
const idToken = (claims: Record<string, unknown>) =>
  'h.' + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(claims)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.s';
const body = { summary: 'A', location: '', description: '', start: { date: '2026-10-10' }, end: { date: '2026-10-11' }, source: { title: 'Yoki', url: 'u' }, extendedProperties: { private: { yoki: '1' as const, session: 'g-1' } } };

describe('本物のGoogleでログイン', () => {
  const g = realGoogle('cid', 'secret');
  test('同意の画面はopenid emailだけを求め、アカウントを選んでもらう（refresh tokenは求めない）', () => {
    const u = new URL(g.loginUrl('https://x/cb', 'st'));
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: 'cid', redirect_uri: 'https://x/cb', response_type: 'code', scope: 'openid email', prompt: 'select_account', state: 'st' });
  });
  test('id_tokenからsubとメールを読む。ほかのアプリ向け・subが無いid_tokenと、失敗は断る', async () => {
    let tok = idToken({ sub: '123', email: 'a@example.com', aud: 'cid' });
    mockFetch(() => Response.json({ id_token: tok }));
    expect(await g.exchangeLogin('c', 'u')).toEqual({ sub: '123', email: 'a@example.com' });
    tok = idToken({ sub: '123', aud: 'cid' });
    expect(await g.exchangeLogin('c', 'u')).toEqual({ sub: '123', email: '' });
    tok = idToken({ sub: '123', aud: 'other' });
    await expect(g.exchangeLogin('c', 'u')).rejects.toThrow('Googleのログインを確かめられませんでした。');
    tok = idToken({ aud: 'cid' });
    await expect(g.exchangeLogin('c', 'u')).rejects.toThrow('Googleのログインを確かめられませんでした。');
    vi.restoreAllMocks();
    mockFetch(() => new Response('x', { status: 500 }));
    await expect(g.exchangeLogin('c', 'u')).rejects.toBeInstanceOf(GoogleHttpError);
  });
});

describe('本物のGoogleの呼び方', () => {
  const g = realGoogle('cid', 'secret');

  test('認可コードを換える。refresh tokenが無い・失敗は投げる', async () => {
    const calls = mockFetch(() => Response.json({ refresh_token: 'rt', id_token: idToken({ email: 'a@example.com' }) }));
    expect(await g.exchangeCode('code', 'https://x/cb')).toEqual({ refreshToken: 'rt', email: 'a@example.com' });
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token');
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]!.init.body)))).toEqual({
      code: 'code', client_id: 'cid', client_secret: 'secret', redirect_uri: 'https://x/cb', grant_type: 'authorization_code',
    });
    vi.restoreAllMocks();
    mockFetch(() => Response.json({ id_token: idToken({}) }));
    await expect(g.exchangeCode('c', 'u')).rejects.toThrow('refresh tokenが返りませんでした');
    vi.restoreAllMocks();
    mockFetch(() => new Response('', { status: 400 }));
    await expect(g.exchangeCode('c', 'u')).rejects.toBeInstanceOf(GoogleHttpError);
  });

  test('access tokenを取る。取り消されていればGoogleRevoked、ほかの失敗はGoogleHttpError', async () => {
    mockFetch(() => Response.json({ access_token: 'at' }));
    expect(await g.accessToken('rt')).toBe('at');
    vi.restoreAllMocks();
    mockFetch(() => Response.json({ error: 'invalid_grant' }, { status: 400 }));
    await expect(g.accessToken('rt')).rejects.toBeInstanceOf(GoogleRevoked);
    vi.restoreAllMocks();
    mockFetch(() => Response.json({ error: 'unauthorized_client' }, { status: 401 }));
    await expect(g.accessToken('rt')).rejects.toBeInstanceOf(GoogleRevoked);
    vi.restoreAllMocks();
    mockFetch(() => new Response('not json', { status: 400 }));
    await expect(g.accessToken('rt')).rejects.toThrow('HTTP 400');
    vi.restoreAllMocks();
    mockFetch(() => new Response('', { status: 503 }));
    await expect(g.accessToken('rt')).rejects.toThrow('HTTP 503');
  });

  test('取り消しは、失敗しても投げない', async () => {
    const calls = mockFetch(() => { throw new Error('通信が切れた'); });
    await g.revoke('rt');
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/revoke');
  });

  test('予定を書く・書き直す・消す。もう無い予定はgoneか、そのまま', async () => {
    const calls = mockFetch((url, init) => {
      if (init.method === 'POST') return Response.json({ id: 'ev1' });
      if (url.endsWith('/gone')) return new Response('', { status: init.method === 'PUT' ? 410 : 404 });
      if (url.endsWith('/bad')) return new Response('', { status: 500 });
      return new Response(init.method === 'DELETE' ? null : '{}', { status: init.method === 'DELETE' ? 204 : 200 });
    });
    expect(await g.insertEvent('at', body)).toBe('ev1');
    expect(calls[0]!.url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    expect(new Headers(calls[0]!.init.headers).get('Authorization')).toBe('Bearer at');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(body);
    expect(await g.updateEvent('at', 'ev1', body)).toBe('ok');
    expect(await g.updateEvent('at', 'gone', body)).toBe('gone');
    await g.deleteEvent('at', 'ev1');
    await g.deleteEvent('at', 'gone');
    await expect(g.updateEvent('at', 'bad', body)).rejects.toThrow('書き直し');
    await expect(g.deleteEvent('at', 'bad')).rejects.toThrow('削除');
    vi.restoreAllMocks();
    mockFetch(() => new Response('', { status: 403 }));
    await expect(g.insertEvent('at', body)).rejects.toThrow('HTTP 403');
  });

  test('予定ありの時間を読む。ページを追い、数えない予定は除く', async () => {
    const calls = mockFetch((url) => {
      const page = new URL(url).searchParams.get('pageToken');
      if (!page) return Response.json({ items: [{ start: { dateTime: '2026-10-10T19:00:00+09:00' }, end: { dateTime: '2026-10-10T21:00:00+09:00' } }], nextPageToken: 'p2' });
      return Response.json({ items: [{ status: 'cancelled', start: { date: '2026-10-11' }, end: { date: '2026-10-12' } }] });
    });
    expect(await g.busy('at', 0, 1)).toEqual([{ start: Date.parse('2026-10-10T10:00:00Z'), end: Date.parse('2026-10-10T12:00:00Z') }]);
    expect(calls.length).toBe(2);
    expect(new URL(calls[0]!.url).searchParams.get('singleEvents')).toBe('true');
    // 予定の名前や説明は受け取らない
    expect(new URL(calls[0]!.url).searchParams.get('fields')).not.toMatch(/summary|description|location/);
    vi.restoreAllMocks();
    const many = mockFetch(() => Response.json({ nextPageToken: 'again' }));
    expect(await g.busy('at', 0, 1)).toEqual([]);
    expect(many.length).toBe(4);
    vi.restoreAllMocks();
    mockFetch(() => new Response('', { status: 401 }));
    await expect(g.busy('at', 0, 1)).rejects.toThrow('読み込み');
  });

  test('数える予定: 取り消し・予定なし・Yokiが書いた予定・欠席・時刻の無い予定は数えない。終日は日本時間の0時から', () => {
    expect(toBusy({ status: 'cancelled', start: { date: '2026-10-10' }, end: { date: '2026-10-11' } })).toBeNull();
    expect(toBusy({ transparency: 'transparent', start: { date: '2026-10-10' }, end: { date: '2026-10-11' } })).toBeNull();
    expect(toBusy({ extendedProperties: { private: { yoki: '1' } }, start: { date: '2026-10-10' }, end: { date: '2026-10-11' } })).toBeNull();
    expect(toBusy({ attendees: [{ self: true, responseStatus: 'declined' }], start: { date: '2026-10-10' }, end: { date: '2026-10-11' } })).toBeNull();
    expect(toBusy({ start: {}, end: {} })).toBeNull();
    expect(toBusy({ attendees: [{ responseStatus: 'declined' }, { self: true, responseStatus: 'accepted' }], start: { date: '2026-10-10' }, end: { date: '2026-10-11' } }))
      .toEqual({ start: jstMs('2026-10-10', 0), end: jstMs('2026-10-11', 0) });
  });

  test('id_tokenからメールを読む。無ければ空', () => {
    expect(emailOfIdToken(idToken({ email: 'ü@example.com' }))).toBe('ü@example.com');
    expect(emailOfIdToken(idToken({}))).toBe('');
    expect(emailOfIdToken(undefined)).toBe('');
  });
});

describe('開発用の偽のGoogle', () => {
  test('許可・書き込み・書き直し・消す・予定あり・取り消し', async () => {
    const g = fakeGoogle(env.DB, 'http://localhost:5173');
    expect(await g.exchangeCode('c', 'u')).toEqual({ refreshToken: 'dev-refresh-c', email: 'dev@example.com' });
    expect(await g.accessToken('dev-refresh-c')).toBe('dev-access');
    const id = await g.insertEvent('at', body);
    expect(id).toBe('dev-event-1');
    expect(await g.updateEvent('at', id, { ...body, summary: 'B' })).toBe('ok');
    expect((await readFake(env.DB)).events[id]!.summary).toBe('B');
    await g.deleteEvent('at', id);
    expect(await g.updateEvent('at', id, body)).toBe('gone');
    await writeFake(env.DB, { ...(await readFake(env.DB)), busy: [{ start: '2026-10-10T10:00:00Z', end: '2026-10-10T12:00:00Z' }] });
    expect(await g.busy('at', Date.parse('2026-10-10T00:00:00Z'), Date.parse('2026-10-11T00:00:00Z'))).toEqual([{ start: Date.parse('2026-10-10T10:00:00Z'), end: Date.parse('2026-10-10T12:00:00Z') }]);
    expect(await g.busy('at', Date.parse('2026-10-11T00:00:00Z'), Date.parse('2026-10-12T00:00:00Z'))).toEqual([]);
    await g.revoke('dev-refresh-c');
    await expect(g.accessToken('dev-refresh-c')).rejects.toBeInstanceOf(GoogleRevoked);
  });

  const LOCAL = 'http://localhost:5173';
  test('道: 同意の画面の代わりにすぐ戻す。中身を読む・予定ありを置き換える。手元からだけ', async () => {
    const res = await SELF.fetch(LOCAL + '/dev/google/authorize?redirect_uri=' + encodeURIComponent(LOCAL + '/auth/google/callback') + '&state=st', { redirect: 'manual' });
    expect(res.status).toBe(302);
    // codeは毎回変わる（前に取り消したrefresh tokenと重ならないように）
    expect(res.headers.get('Location')).toMatch(new RegExp('^' + LOCAL + '/auth/google/callback\\?code=dev-code-[\\w-]{8}&state=st$'));
    expect((await SELF.fetch(LOCAL + '/dev/google/authorize?redirect_uri=https://evil.example/&state=st', { redirect: 'manual' })).status).toBe(404);
    expect((await SELF.fetch(LOCAL + '/dev/google/authorize', { redirect: 'manual' })).headers.get('Location')).toMatch(new RegExp('^' + LOCAL + '/\\?code=dev-code-[\\w-]{8}&state=$'));
    const busy = [{ start: '2026-10-10T10:00:00Z', end: '2026-10-10T12:00:00Z' }];
    const post = await SELF.fetch(LOCAL + '/dev/google/busy', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: LOCAL }, body: JSON.stringify({ busy }) });
    expect(post.status).toBe(200);
    expect((await (await SELF.fetch(LOCAL + '/dev/google/state')).json() as any).busy).toEqual(busy);
    await SELF.fetch(LOCAL + '/dev/google/busy', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: LOCAL }, body: '{}' });
    expect((await readFake(env.DB)).busy).toEqual([]);
    expect((await call('/dev/google/authorize')).status).toBe(404);
    expect((await call('/dev/google/state')).status).toBe(404);
    expect((await call('/dev/google/busy', { method: 'POST', headers: { Origin: 'https://yoki.test', 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(404);
  });
});
