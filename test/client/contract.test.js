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

/** HTML に直接書いたアイコン（class="material-icons …" や class="ms …" の中身） */
const htmlIcons = (html) => [...html.matchAll(/class="(?:material-icons|ms)\b[^"]*"[^>]*>([a-z_]+)</g)].map((x) => x[1]);
const tsIcons = (ts) => [...ts.matchAll(/\bmi\('([a-z_]+)'/g)].map((x) => x[1]);

test('グループの画面で使うアイコンが、読み込むアイコンの一覧にある', () => {
  const names = iconNames(consoleHtml);
  const used = new Set([...tsIcons(consoleTs), ...htmlIcons(consoleHtml)]);
  expect([...used].filter((n) => !names.has(n))).toEqual([]);
});

test('運営者の管理画面で使うアイコンが、読み込むアイコンの一覧にある', () => {
  const html = read('src/client/operator/index.html');
  const names = iconNames(html);
  const used = new Set([...tsIcons(read('src/client/operator/main.ts')), ...htmlIcons(html)]);
  expect([...used].filter((n) => !names.has(n))).toEqual([]);
});

/** React の画面（src/client の .tsx。古い console/ と operator/ は除く） */
const tsxFiles = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile() && e.name.endsWith('.tsx'))
  .map((e) => path.join(e.parentPath, e.name));

test('React の画面のアイコン: 一覧（ui/icons.ts）は並んでいて重ならず、どれも使っている。index.html はその一覧を読み込む', () => {
  const list = /ICON_NAMES = \[([^\]]*)\]/.exec(read('src/client/ui/icons.ts'))[1].match(/[a-z_]+/g);
  expect(list).toEqual([...new Set(list)].sort());
  // 使う名前は型で確かめる（<Icon name="…">）。ここでは、使っていない名前が一覧に残っていないかを見る
  const used = new Set(tsxFiles('src/client').flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/<Icon\b[^>]*\bname="([a-z_]+)"/g)].map((m) => m[1])));
  expect(list.filter((n) => !used.has(n))).toEqual([]);
  expect(read('src/client/index.html')).toContain('icon_names=%ICON_NAMES%&');
});
