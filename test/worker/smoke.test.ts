// 土台の確認: Worker が動き、D1 にテーブルがそろっている
import { env, SELF } from 'cloudflare:test';
import { expect, test } from 'vitest';

test('/api/health が D1 のテーブル数を返す', async () => {
  const res = await SELF.fetch('https://yoki.test/api/health');
  expect(res.status).toBe(200);
  const body = await res.json<{ ok: boolean; tables: number }>();
  expect(body.ok).toBe(true);
  expect(body.tables).toBeGreaterThanOrEqual(13);
});

test('マイグレーションで作ったテーブルに書ける', async () => {
  await env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind('k', 'v').run();
  expect(await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind('k').first('value')).toBe('v');
});
