// 画面の約束: 使うアイコンを読み込んでいるか。GAS の名残（テンプレート・合言葉の窓・シートの入口）が無いか。
// 画面とサーバーの呼び出しの名前・返事の形は、src/shared/api.ts の型で確かめる（npm run typecheck）
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const root = path.join(import.meta.dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const consoleDir = path.join(root, 'src/client/console');
const consoleTs = fs.readdirSync(consoleDir).filter((f) => f.endsWith('.ts')).map((f) => fs.readFileSync(path.join(consoleDir, f), 'utf8')).join('\n');
const consoleHtml = read('src/client/console/index.html');
const iconNames = (html) => new Set(/icon_names=([^&"]+)/.exec(html)[1].split(','));

test('GAS の名残（google.script・テンプレート・合言葉の窓・シートの入口）が無い', () => {
  expect(consoleTs).not.toMatch(/google\.script\.run\b(?!\s+と同じ)/);
  expect(consoleHtml).not.toContain('<?');
  expect(consoleHtml).not.toContain('loginModal');
  expect(consoleHtml).not.toContain('sheetLink');
  expect(consoleHtml).not.toContain('base target');
});

test('グループの画面で使うアイコンが、読み込むアイコンの一覧にある', () => {
  const names = iconNames(consoleHtml);
  const used = new Set([...consoleTs.matchAll(/\bmi\('([a-z_]+)'/g)].map((x) => x[1]));
  expect([...used].filter((n) => !names.has(n))).toEqual([]);
});

test('入口の画面で使うアイコンが、読み込むアイコンの一覧にある', () => {
  const html = read('src/client/index.html');
  const names = iconNames(html);
  const used = new Set([...(html + read('src/client/home.ts')).matchAll(/class="ms[^"]*"[^>]*>([a-z_]+)</g)].map((x) => x[1]));
  expect([...used].filter((n) => !names.has(n))).toEqual([]);
});
