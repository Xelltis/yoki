// 開発用ログインの端の場合と、サンプルのグループの作り直し・年をまたぐ月のサンプル
import { env, SELF } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { ensureSampleGroup } from '../../src/worker/auth/dev';
import type { Bindings } from '../../src/worker/env';
import { googleDeps } from '../../src/worker/google/config';
import { seal } from '../../src/worker/lib/secretbox';
import { call, ORIGIN } from './helpers';

const LOCAL = 'http://localhost:5173';
const devPost = (path: string, body = '') =>
  SELF.fetch(LOCAL + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: LOCAL }, body, redirect: 'manual' });
const sessionCount = () => env.DB.prepare("SELECT count(*) AS n FROM sessions WHERE group_id = 'sample'").first<number>('n');

describe('開発用ログイン', () => {
  test('知らない名前なら、最初の人（ひより）で入る。2回目はサンプルを作り直さない', async () => {
    const res = await devPost('/dev/login', 'as=だれか');
    expect(res.status).toBe(303);
    expect(await env.DB.prepare("SELECT global_name FROM users WHERE id = '400000000000000010'").first('global_name')).toBe('ひより');
    const n = await sessionCount();
    await env.DB.prepare("DELETE FROM sessions WHERE group_id = 'sample' AND name = '今夜の短編'").run();
    await devPost('/dev/login', 'as=ソラ');
    expect(await sessionCount()).toBe(n! - 1);
  });

  test('/dev/resetはサンプルを消して作り直す。手元でなければ無い', async () => {
    await devPost('/dev/login', 'as=ひより');
    const n = await sessionCount();
    await env.DB.prepare("DELETE FROM sessions WHERE group_id = 'sample'").run();
    const res = await devPost('/dev/reset');
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/g/sample/');
    expect(await sessionCount()).toBe(n);
    expect((await call('/dev/reset', { method: 'POST', headers: { Origin: ORIGIN } })).status).toBe(404);
  });

  test('/dev/resetは、開発用の人のGoogle連携と偽のGoogleの中身も消す。ほかの人の連携は残す', async () => {
    const HIYORI = '400000000000000010', OTHER = '900000000000000001';
    await devPost('/dev/login', 'as=ひより');
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, username, guilds_checked_at, created_at, last_login_at) VALUES (?, 'other', '', '', '')").bind(OTHER),
      ...[HIYORI, OTHER].flatMap((id) => [
        env.DB.prepare("INSERT INTO google_links (user_id, email, refresh_token, created_at) VALUES (?, 'x@example.com', 'v1.x', '')").bind(id),
        env.DB.prepare("INSERT INTO google_events (user_id, session_id, event_id, hash, date) VALUES (?, 1, 'e', 'h', '2026-10-10')").bind(id),
      ]),
      env.DB.prepare("INSERT INTO meta (key, value) VALUES ('dev_google', '{}')"),
    ]);
    await devPost('/dev/reset');
    const ids = async (table: string) => (await env.DB.prepare('SELECT user_id FROM ' + table).all<{ user_id: string }>()).results.map((r) => r.user_id);
    expect(await ids('google_links')).toEqual([OTHER]);
    expect(await ids('google_events')).toEqual([OTHER]);
    expect(await env.DB.prepare("SELECT value FROM meta WHERE key = 'dev_google'").first()).toBeNull();
  });
});

describe('開発用ログインとGoogleでのログイン', () => {
  test('初めてのGoogleのアカウントを控えていれば、結びつけるために押した開発用ログインの人に結びつけ、入口で知らせる', async () => {
    const key = (await googleDeps(env as unknown as Bindings, LOCAL))!.key;
    const pending = await seal(key, JSON.stringify({ sub: 'g-dev', email: 'dev@example.com', at: new Date().toISOString() }));
    const devLogin = (body: string) => SELF.fetch(LOCAL + '/dev/login', {
      method: 'POST', redirect: 'manual', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: LOCAL, Cookie: 'yoki_glink=' + encodeURIComponent(pending) },
    });
    // 印が無ければ、控えがあっても結びつけない
    expect((await devLogin('as=ひより')).headers.get('Location')).toBe('/g/sample/');
    expect(await env.DB.prepare("SELECT user_id FROM google_logins WHERE google_sub = 'g-dev'").first('user_id')).toBeNull();
    const res = await devLogin('as=ひより&link_google=1');
    expect(res.headers.get('Location')).toBe('/?login=google-linked');
    expect(await env.DB.prepare("SELECT user_id FROM google_logins WHERE google_sub = 'g-dev'").first('user_id')).toBe('400000000000000010');
  });
});

describe('サンプルの来月の募集は、年をまたいでも正しい期間になる', () => {
  const windows = async () =>
    (await env.DB.prepare("SELECT name, window_from AS f, window_to AS t FROM sessions WHERE group_id = 'sample' AND name IN ('雪原の古城', '新キャンペーン顔合わせ') ORDER BY name").all<{ name: string; f: string; t: string }>()).results;

  test('12月に作ると、来月は翌年の1月', async () => {
    await ensureSampleGroup(env.DB, ORIGIN + '/g/sample/', new Date('2026-12-10T12:00:00+09:00'));
    expect(await windows()).toEqual([
      { name: '新キャンペーン顔合わせ', f: '2027-01-15', t: '2027-01-31' },
      { name: '雪原の古城', f: '2027-01-01', t: '2027-01-15' },
    ]);
  });

  test('11月に作ると、来月の12月は31日まで', async () => {
    await ensureSampleGroup(env.DB, ORIGIN + '/g/sample/', new Date('2026-11-10T12:00:00+09:00'));
    expect(await windows()).toEqual([
      { name: '新キャンペーン顔合わせ', f: '2026-12-15', t: '2026-12-31' },
      { name: '雪原の古城', f: '2026-12-01', t: '2026-12-15' },
    ]);
  });
});
