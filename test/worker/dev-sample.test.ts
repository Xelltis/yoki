// 開発用ログインの端の場合と、サンプルのグループの作り直し・年をまたぐ月のサンプル
import { env, SELF } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { ensureSampleGroup } from '../../src/worker/auth/dev';
import { call, ORIGIN } from './helpers';

const LOCAL = 'http://localhost:5173';
const devPost = (path: string, body = '') =>
  SELF.fetch(LOCAL + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: LOCAL }, body, redirect: 'manual' });
const sessionCount = () => env.DB.prepare("SELECT count(*) AS n FROM sessions WHERE group_id = 'sample'").first<number>('n');

describe('開発用ログイン', () => {
  test('知らない名前なら、最初の人（ひより）で入る。2 回目はサンプルを作り直さない', async () => {
    const res = await devPost('/dev/login', 'as=だれか');
    expect(res.status).toBe(303);
    expect(await env.DB.prepare("SELECT global_name FROM users WHERE id = '400000000000000010'").first('global_name')).toBe('ひより');
    const n = await sessionCount();
    await env.DB.prepare("DELETE FROM sessions WHERE group_id = 'sample' AND name = '今夜の短編'").run();
    await devPost('/dev/login', 'as=ソラ');
    expect(await sessionCount()).toBe(n! - 1);
  });

  test('/dev/reset はサンプルを消して作り直す。手元でなければ無い', async () => {
    await devPost('/dev/login', 'as=ひより');
    const n = await sessionCount();
    await env.DB.prepare("DELETE FROM sessions WHERE group_id = 'sample'").run();
    const res = await devPost('/dev/reset');
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe('/g/sample/');
    expect(await sessionCount()).toBe(n);
    expect((await call('/dev/reset', { method: 'POST', headers: { Origin: ORIGIN } })).status).toBe(404);
  });
});

describe('サンプルの来月の募集は、年をまたいでも正しい期間になる', () => {
  const windows = async () =>
    (await env.DB.prepare("SELECT name, window_from AS f, window_to AS t FROM sessions WHERE group_id = 'sample' AND name IN ('雪原の古城', '新キャンペーン顔合わせ') ORDER BY name").all<{ name: string; f: string; t: string }>()).results;

  test('12 月に作ると、来月は翌年の 1 月', async () => {
    await ensureSampleGroup(env.DB, ORIGIN + '/g/sample/', new Date('2026-12-10T12:00:00+09:00'));
    expect(await windows()).toEqual([
      { name: '新キャンペーン顔合わせ', f: '2027-01-15', t: '2027-01-31' },
      { name: '雪原の古城', f: '2027-01-01', t: '2027-01-15' },
    ]);
  });

  test('11 月に作ると、来月の 12 月は 31 日まで', async () => {
    await ensureSampleGroup(env.DB, ORIGIN + '/g/sample/', new Date('2026-11-10T12:00:00+09:00'));
    expect(await windows()).toEqual([
      { name: '新キャンペーン顔合わせ', f: '2026-12-15', t: '2026-12-31' },
      { name: '雪原の古城', f: '2026-12-01', t: '2026-12-15' },
    ]);
  });
});
