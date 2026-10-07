// 版を出す・更新するときの道具: package.jsonの版の書き換え（tools/release）と、ボタンで設置したリポジトリのwrangler.jsoncの引き継ぎ（tools/update）
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { setLockVersion, setPackageVersion } from '../../tools/release/commit-version.mjs';
import { carry, parseJsonc } from '../../tools/update/carry-wrangler.mjs';

const root = path.join(import.meta.dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('版を出すと、package.jsonのいちばん上のversionだけが変わり、package-lock.jsonはnpmと同じ形のまま', () => {
  const pkg = read('package.json');
  const next = setPackageVersion(pkg, '9.8.7');
  expect(JSON.parse(next).version).toBe('9.8.7');
  expect(next.split('\n').filter((l, i) => l !== pkg.split('\n')[i])).toEqual(['  "version": "9.8.7",']);
  const lock = read('package-lock.json');
  expect(setLockVersion(lock, JSON.parse(lock).version)).toBe(lock);
  const bumped = JSON.parse(setLockVersion(lock, '9.8.7'));
  expect([bumped.version, bumped.packages[''].version]).toEqual(['9.8.7', '9.8.7']);
  expect(() => setPackageVersion('{\n  "name": "x"\n}\n', '1.0.0')).toThrow();
});

test('アプリの版はpackage.jsonから読む（ボタンで設置したリポジトリにはタグが無い）', () => {
  expect(read('vite.config.ts')).toMatch(/appVersion[\s\S]*package\.json/);
  expect(JSON.parse(read('package.json')).version).toMatch(/^\d+\.\d+\.\d+$/);
});

test('JSONCを読む: コメント・閉じる前のカンマ・文字列の中の // を正しく扱う', () => {
  expect(parseJsonc('{\n  // c\n  "a": "http://x", /* b */ "b": [1, 2,],\n}')).toEqual({ a: 'http://x', b: [1, 2] });
  // リポジトリのwrangler.jsoncも読める
  expect(parseJsonc(read('wrangler.jsonc')).d1_databases[0].binding).toBe('DB');
});

test('更新でwrangler.jsoncを入れ替えるとき、Workerの名前とD1の名前・IDを引き継ぐ。コメントは新しい版のまま', () => {
  const next = read('wrangler.jsonc');
  // Cloudflareが書き換えたもの（コメントが無く、字下げがタブでもよい）
  const current = JSON.stringify({ name: 'my-yoki', d1_databases: [{ binding: 'DB', database_name: 'my-db', database_id: 'abc-123', migrations_dir: './migrations' }] }, null, '\t');
  const out = carry(current, next);
  const v = parseJsonc(out);
  expect(v.name).toBe('my-yoki');
  expect(v.d1_databases).toEqual([{ binding: 'DB', database_name: 'my-db', database_id: 'abc-123', migrations_dir: './migrations' }]);
  expect(out).toContain('// 卓予定（Yoki）のWorkerの設定');
  // 新しい版にIDの行があれば、値だけを替える。もう一度引き継いでも同じ
  expect(carry(current, out)).toBe(out);
  // D1が無い（引き継ぐものが無い）なら、名前だけ
  expect(parseJsonc(carry('{ "name": "only" }', next)).d1_databases[0].database_id).toBeUndefined();
});
