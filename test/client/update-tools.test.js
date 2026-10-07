// 版を出すときの道具: package.jsonの版の書き換え（tools/release）
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { setLockVersion, setPackageVersion } from '../../tools/release/commit-version.mjs';

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

test('アプリの版はpackage.jsonから読む（タグに頼らない）', () => {
  expect(read('vite.config.ts')).toMatch(/appVersion[\s\S]*package\.json/);
  expect(JSON.parse(read('package.json')).version).toMatch(/^\d+\.\d+\.\d+$/);
});

