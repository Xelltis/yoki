// 書くときの決まり（CONTRIBUTING.md）が守られているか
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const worker = path.join(import.meta.dirname, '../../src/worker');
// lib/jst.tsは日本時間を扱う場所（Date.UTCで計算する）なので除く
const files = fs.readdirSync(worker, { recursive: true }).map(String).filter((f) => f.endsWith('.ts') && f !== path.join('lib', 'jst.ts'));

test('サーバーは手元の時刻（new Date(年, 月, 日)・getHoursなど）を使わない。日本時間はlib/jst.tsで扱う', () => {
  const bad = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(worker, f), 'utf8');
    if (/new Date\(\s*\d|new Date\([^)'"`]*,/.test(text) || /\.get(Hours|Minutes|Date|Day|Month|FullYear)\(/.test(text)) bad.push(f);
  }
  expect(bad).toEqual([]);
});
