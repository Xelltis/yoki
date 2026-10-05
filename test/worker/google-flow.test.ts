// Google カレンダーとの連携の流れ: 連携する（OAuth）、設定を変える・今すぐ同期する・外す、予定の手入力と Google の印、見回りと片付け
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { app } from '../../src/worker/app';
import { deleteUser } from '../../src/worker/domain/admin';
import { saveGoogleSettings, unlinkGoogle } from '../../src/worker/domain/google';
import { cleanup, patrol } from '../../src/worker/domain/patrol';
import type { Bindings } from '../../src/worker/env';
import { googleDeps, type GoogleDeps } from '../../src/worker/google/config';
import { readFake, writeFake } from '../../src/worker/google/dev';
import { REVOKED_MESSAGE } from '../../src/worker/google/sync';
import { addDays } from '../../src/worker/lib/jst';
import { seal } from '../../src/worker/lib/secretbox';
import { call, fail, ok, ORIGIN, setupGroup, today } from './helpers';

const SORA = '400000000000000011';
const SID = '__Host-yoki_sid';

let deps: GoogleDeps;
let G: Awaited<ReturnType<typeof setupGroup>>;
let T: (n: number) => string;
beforeEach(async () => {
  deps = (await googleDeps(env as unknown as Bindings, ORIGIN))!;
  G = await setupGroup();
  const t0 = await today();
  T = (n) => addDays(t0, n);
});

const linkRow = () => env.DB.prepare('SELECT * FROM google_links WHERE user_id = ?').bind(SORA).first<Record<string, any>>();
const events = async () => Object.values((await readFake(env.DB)).events);
async function link(o: { write?: number; read?: number; email?: string } = {}) {
  await env.DB.prepare(
    "INSERT INTO google_links (user_id, email, refresh_token, write_events, read_busy, created_at) VALUES (?, ?, ?, ?, ?, '2026-01-01T00:00:00Z')",
  )
    .bind(SORA, o.email ?? 'dev@example.com', await seal(deps.key, 'dev-refresh-dev-code'), o.write ?? 1, o.read ?? 1)
    .run();
}
const cookieOf = (res: Response, name: string) => res.headers.getSetCookie().find((c) => c.startsWith(name + '='))?.split(';')[0]!.slice(name.length + 1);
const back = '/g/grp/settings/';

describe('連携する（OAuth）', () => {
  async function start(sid?: string, returnTo = back) {
    const res = await call('/auth/google/start?return_to=' + encodeURIComponent(returnTo), { sid });
    return { res, state: new URL(res.headers.get('Location')!, ORIGIN).searchParams.get('state') ?? '', cookie: cookieOf(res, 'yoki_google') ?? '' };
  }
  const callback = (q: string, sid: string, cookie: string) => call('/auth/google/callback?' + q, { headers: { Cookie: SID + '=' + sid + '; yoki_google=' + cookie } });

  test('ログインしていなければ、ログインへ。戻り先は画面の道だけ', async () => {
    const r = await start();
    expect(r.res.status).toBe(302);
    expect(r.res.headers.get('Location')).toBe('/auth/login?return_to=' + encodeURIComponent(back));
    expect(decodeURIComponent((await start(G.sora, 'https://evil.example/')).cookie)).toMatch(/\|\/$/);
  });

  test('同意の画面へ送り、戻ってきたら refresh token を暗号化して置く。返事のあとで同期する', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: 'ソラの卓', gm: 'ひより', members: ['ソラ'], date: T(3), status: '開催' });
    const s = await start(G.sora);
    expect(s.res.headers.get('Location')).toMatch(/^https:\/\/yoki\.test\/dev\/google\/authorize\?/);
    expect(decodeURIComponent(s.cookie)).toBe(s.state + '|' + SORA + '|' + back);
    const res = await callback('code=dev-code&state=' + s.state, G.sora, s.cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(back + '?google=linked');
    const row = (await linkRow())!;
    expect(row.email).toBe('dev@example.com');
    expect(row.refresh_token).toMatch(/^v1\./);
    expect(row.refresh_token).not.toContain('dev-refresh');
    await vi.waitFor(async () => expect((await events()).map((e) => e.summary)).toEqual(['ソラの卓']));
    const view = (await ok(G.sora, G.id, 'getConsoleData')).calendar.google;
    expect(view).toMatchObject({ email: 'dev@example.com', write: true, read: true, from: '19:00', to: '23:00', error: '' });
    expect(JSON.stringify(await ok(G.sora, G.id, 'getConsoleData'))).not.toContain(row.refresh_token);
  });

  test('断られたら戻り先へ。途中の情報が無い・別の人・state が違う・code が無いときは受け取らない', async () => {
    const s = await start(G.sora);
    expect((await callback('error=access_denied', G.sora, s.cookie)).headers.get('Location')).toBe(back + '?google=cancelled');
    expect((await call('/auth/google/callback?code=x&state=' + s.state, { sid: G.sora })).status).toBe(400);
    expect((await callback('code=x&state=' + s.state, G.komachi, s.cookie)).status).toBe(400);
    expect((await callback('code=x&state=wrong', G.sora, s.cookie)).status).toBe(400);
    expect((await callback('state=' + s.state, G.sora, s.cookie)).status).toBe(400);
    expect((await callback('code=x', G.sora, s.cookie)).status).toBe(400);
    expect(await linkRow()).toBeNull();
  });

  test('cookie の戻り先が画面の道でなければ、入口へ戻す', async () => {
    const forged = encodeURIComponent('st|' + SORA + '|https://evil.example/');
    expect((await callback('error=access_denied', G.sora, forged)).headers.get('Location')).toBe('/?google=cancelled');
  });

  test('別の Google アカウントで連携し直すと、前のアカウントに書いた予定を消す', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: 'ソラの卓', gm: 'ひより', members: ['ソラ'], date: T(3), status: '開催' });
    await link({ email: 'old@example.com' });
    await ok(G.sora, G.id, 'syncGoogleNow');
    expect((await events()).length).toBe(1);
    const s = await start(G.sora);
    await callback('code=dev-code&state=' + s.state, G.sora, s.cookie);
    expect((await linkRow())!.email).toBe('dev@example.com');
    await vi.waitFor(async () => expect((await events()).length).toBe(1));
    expect(Object.keys((await readFake(env.DB)).events)).not.toContain('dev-event-1');
  });

  test('運営者が設定していなければ、案内を出す', async () => {
    const res = await app.request(ORIGIN + '/auth/google/start', { headers: { Cookie: SID + '=' + G.sora } }, { ...env, GOOGLE_CLIENT_ID: 'id-only' });
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('Google 連携の設定がありません');
  });
});

describe('設定・同期・外す', () => {
  test('連携していなければ断る。運営者が設定していなければ断る', async () => {
    expect((await fail(G.sora, G.id, 'syncGoogleNow')).error).toBe('Google と連携していません。');
    const ctx = { google: {} } as any;
    await expect(saveGoogleSettings(ctx, {}, { google: null } as any)).rejects.toThrow('運営者が設定していない');
  });

  test('時間帯を確かめる', async () => {
    await link();
    const base = { write: true, read: true };
    expect((await fail(G.sora, G.id, 'saveGoogleSettings', { ...base, from: '夜', to: '23:00' })).error).toContain('19:00 のように');
    expect((await fail(G.sora, G.id, 'saveGoogleSettings', { ...base, from: '23:00', to: '19:00' })).error).toContain('始まりより後');
    const r = await ok(G.sora, G.id, 'saveGoogleSettings', { ...base, from: '9', to: '24:00' });
    expect(r.message).toBe('Google 連携の設定を保存しました。');
    expect(r.data.calendar.google).toMatchObject({ from: '09:00', to: '24:00' });
  });

  test('書き込みをやめると書いた予定を消す。読み込みをやめると Google の印を消す', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: 'ソラの卓', gm: 'ひより', members: ['ソラ'], date: T(3), status: '開催' });
    await link();
    await writeFake(env.DB, { seq: 0, events: {}, revoked: [], busy: [{ start: T(1) + 'T09:00:00Z', end: T(1) + 'T15:00:00Z' }] });
    const synced = await ok(G.sora, G.id, 'syncGoogleNow');
    expect(synced.message).toBe('Google カレンダーと同期しました。');
    expect(synced.data.availGoogle).toEqual({ [T(1)]: ['ソラ'] });
    expect((await events()).length).toBe(1);
    const off = await ok(G.sora, G.id, 'saveGoogleSettings', { write: false, read: false, from: '19:00', to: '23:00' });
    expect(off.message).toBe('Google 連携の設定を保存しました。書き込んだ予定を 1 件消しました。');
    expect(await events()).toEqual([]);
    expect(off.data.avail[T(1)]).toBeUndefined();
    expect(off.data.calendar.google).toMatchObject({ write: false, read: false });
    // オンに戻すと、返事のあとで同期する
    await ok(G.sora, G.id, 'saveGoogleSettings', { write: true, read: false, from: '19:00', to: '23:00' });
    await vi.waitFor(async () => expect((await events()).length).toBe(1));
  });

  test('今すぐ同期: 取り消されていれば断る', async () => {
    await link();
    await deps.api.revoke('dev-refresh-dev-code');
    expect((await fail(G.sora, G.id, 'syncGoogleNow')).error).toBe(REVOKED_MESSAGE);
    expect((await ok(G.sora, G.id, 'getConsoleData')).calendar.google.error).toBe(REVOKED_MESSAGE);
  });

  test('外すと、書いた予定・Google の印・連携の行を消し、許可を取り消す', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: 'ソラの卓', gm: 'ひより', members: ['ソラ'], date: T(3), status: '開催' });
    await link();
    await writeFake(env.DB, { seq: 0, events: {}, revoked: [], busy: [{ start: T(1) + 'T09:00:00Z', end: T(1) + 'T15:00:00Z' }] });
    await ok(G.sora, G.id, 'syncGoogleNow');
    const r = await ok(G.sora, G.id, 'unlinkGoogle');
    expect(r.message).toBe('Google との連携を外しました。書き込んだ予定を 1 件消しました。');
    expect(r.data.calendar.google).toBeNull();
    expect(r.data.availGoogle).toEqual({});
    expect(await events()).toEqual([]);
    expect((await readFake(env.DB)).revoked).toEqual(['dev-refresh-dev-code']);
    expect(await linkRow()).toBeNull();
  });

  test('連携の行が先に消えていても、外せる', async () => {
    const ctx = { db: env.DB, actor: { userId: SORA }, google: {}, now: new Date() } as any;
    expect((await unlinkGoogle(ctx, {}, { google: deps } as any)).message).toBe('Google との連携を外しました。');
  });

  test('鍵が替わって token が読めなくても、外せる', async () => {
    await link();
    await env.DB.prepare("UPDATE google_links SET refresh_token = 'broken'").run();
    expect((await ok(G.sora, G.id, 'unlinkGoogle')).message).toBe('Google との連携を外しました。');
    expect(await linkRow()).toBeNull();
  });
});

describe('運営者が利用者を消す', () => {
  const googleEvents = () => env.DB.prepare('SELECT count(*) AS n FROM google_events WHERE user_id = ?').bind(SORA).first<number>('n');

  test('連携していれば、書いた予定を消し、許可を取り消してから消す', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: 'ソラの卓', gm: 'ひより', members: ['ソラ'], date: T(3), status: '開催' });
    await link();
    await ok(G.sora, G.id, 'syncGoogleNow');
    expect(await events()).toHaveLength(1);
    await deleteUser(env.DB, SORA, () => false, deps);
    expect(await events()).toEqual([]);
    expect((await readFake(env.DB)).revoked).toEqual(['dev-refresh-dev-code']);
    expect(await linkRow()).toBeNull();
    expect(await googleEvents()).toBe(0);
  });

  test('運営者が Google の値を外していれば、連携の行と書いた予定の控えだけを消す（Google 側には残る）', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: 'ソラの卓', gm: 'ひより', members: ['ソラ'], date: T(3), status: '開催' });
    await link();
    await ok(G.sora, G.id, 'syncGoogleNow');
    await deleteUser(env.DB, SORA, () => false);
    expect(await events()).toHaveLength(1);
    expect((await readFake(env.DB)).revoked).toEqual([]);
    expect(await linkRow()).toBeNull();
    expect(await googleEvents()).toBe(0);
  });
});

describe('卓を変えたら書き直す', () => {
  test('書き込んでいる人がいるグループだけ、返事のあとで書き直す', async () => {
    await link({ read: 0 });
    await ok(G.admin, G.id, 'saveSession', { name: 'ソラの卓', gm: 'ひより', members: ['ソラ'], date: T(3), status: '開催' });
    await vi.waitFor(async () => expect((await events()).map((e) => e.summary)).toEqual(['ソラの卓']));
    await ok(G.admin, G.id, 'saveSession', { id: 'S001', name: 'ソラの卓（改）', gm: 'ひより', members: ['ソラ'], date: T(3), status: '開催' });
    await vi.waitFor(async () => expect((await events()).map((e) => e.summary)).toEqual(['ソラの卓（改）']));
  });
});

describe('予定の手入力と Google の印', () => {
  const marks = async () =>
    Object.fromEntries(
      (await env.DB.prepare("SELECT a.date, a.mark, a.source FROM availability a JOIN members m ON m.id = a.member_id WHERE m.name = 'ソラ' ORDER BY a.date").all<{ date: string; mark: string; source: string }>())
        .results.map((r) => [r.date, r.mark + (r.source ? ':' + r.source : '')]),
    );
  const dismissed = async () => (await env.DB.prepare('SELECT date FROM google_dismissed ORDER BY date').all<{ date: string }>()).results.map((r) => r.date);
  beforeEach(async () => {
    const id = await env.DB.prepare("SELECT id FROM members WHERE name = 'ソラ'").first<number>('id');
    for (const n of [1, 2, 3, 4]) await env.DB.prepare("INSERT INTO availability (member_id, date, mark, source) VALUES (?, ?, '×', 'google')").bind(id, T(n)).run();
  });

  test('1 マス: 印を入れれば本人の印になり、消せばその日を覚える。本人の印を消しても覚えない', async () => {
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(1), mark: '△' });
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(2), mark: '' });
    await ok(G.sora, G.id, 'setAvailability', { name: 'ソラ', ymd: T(1), mark: '' });
    expect(await marks()).toEqual({ [T(3)]: '×:google', [T(4)]: '×:google' });
    expect(await dismissed()).toEqual([T(2)]);
    const d = await ok(G.sora, G.id, 'getConsoleData');
    expect(d.availGoogle).toEqual({ [T(3)]: ['ソラ'], [T(4)]: ['ソラ'] });
  });

  test('まとめて: 印を入れれば本人の印、空欄にすれば Google の印の日を覚える', async () => {
    await ok(G.sora, G.id, 'setAvailabilityBulk', { name: 'ソラ', from: T(1), to: T(2), mark: '△' });
    await ok(G.sora, G.id, 'setAvailabilityBulk', { name: 'ソラ', from: T(2), to: T(4), mark: '' });
    expect(await marks()).toEqual({ [T(1)]: '△' });
    expect(await dismissed()).toEqual([T(3), T(4)]);
  });
});

describe('見回りと片付け', () => {
  const at = () => new Date().getTime();
  test('見回りが、連携している人の卓を書く。運営者が設定していなければ回らない', async () => {
    await ok(G.admin, G.id, 'saveSession', { name: 'ソラの卓', gm: 'ひより', members: ['ソラ'], date: T(3), status: '開催' });
    await link({ read: 0 });
    await patrol({ ...env, GOOGLE_CLIENT_ID: 'id-only' } as unknown as Bindings, at(), { sleep: async () => {} });
    expect(await events()).toEqual([]);
    await patrol(env as unknown as Bindings, at(), { sleep: async () => {} });
    expect((await events()).length).toBe(1);
  });

  test('毎日: 古い「消した日」の記録と、連携が無い人・過ぎた卓の書いた予定の控えを片付ける', async () => {
    const id = await env.DB.prepare("SELECT id FROM members WHERE name = 'ソラ'").first<number>('id');
    await link();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO google_dismissed (member_id, date) VALUES (?, ?), (?, ?)').bind(id, T(-100), id, T(1)),
      env.DB.prepare("INSERT INTO google_events (user_id, session_id, event_id, hash, date) VALUES (?, 1, 'a', 'h', ?), (?, 2, 'b', 'h', ?), ('gone-user', 3, 'c', 'h', ?)")
        .bind(SORA, T(1), SORA, T(-30), T(1)),
    ]);
    await cleanup(env.DB, new Date());
    expect((await env.DB.prepare('SELECT date FROM google_dismissed').all<{ date: string }>()).results.map((r) => r.date)).toEqual([T(1)]);
    expect((await env.DB.prepare('SELECT event_id FROM google_events').all<{ event_id: string }>()).results.map((r) => r.event_id)).toEqual(['a']);
  });
});
