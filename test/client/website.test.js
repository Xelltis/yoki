// サイト（website/）の約束: 使うアイコンが一覧にあるか、載せるスクリーンショットがあるか、アプリの「使い方」がサイトを指しているか
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const root = path.join(import.meta.dirname, '../..');
const site = path.join(root, 'website');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const config = read('website/.vitepress/config.ts');
// 本文（Markdown）と部品（Vue）
const pages = fs.readdirSync(site, { recursive: true }).map(String)
  .filter((f) => /\.(md|vue)$/.test(f) && !f.startsWith(path.join('.vitepress', 'dist')) && !f.startsWith(path.join('.vitepress', 'cache')))
  .map((f) => fs.readFileSync(path.join(site, f), 'utf8'));

test('使うアイコンが、アイコンの一覧（theme/icons.tsのICONS）にちょうどある。一覧はアルファベット順。フォントのアイコンは読まない', () => {
  const list = read('website/.vitepress/theme/icons.ts');
  const icons = [...(/ICONS = \{([^}]*)\}/.exec(list)[1].matchAll(/^\s+(\w+):/gm))].map((m) => m[1]);
  const used = new Set();
  for (const t of pages) {
    for (const m of t.matchAll(/<(?:Ms|Ui)\b[^>]*\s(?:name|icon)="([a-z0-9_]+)"/g)) used.add(m[1]);
    // トップのページの特長（index.mdのpoints）
    for (const m of t.matchAll(/^\s+- icon: ([a-z0-9_]+)$/gm)) used.add(m[1]);
  }
  expect(icons).toEqual([...used].sort());
  // 特長のアイコンはSVGの文字で渡す（HomeFeatures.vue）。index.mdの名前はすべてそこにある
  const home = read('website/.vitepress/theme/components/HomeFeatures.vue');
  for (const m of read('website/index.md').matchAll(/^\s+- icon: ([a-z0-9_]+)$/gm)) expect(home).toContain(m[1] + ':');
  // アイコンはunplugin-iconsで読み、集まりはライセンスを確かめたもの（tools/icons.ts）だけ
  const allowed = [...read('tools/icons.ts').matchAll(/^\s+'([\w-]+)': '[\w.-]+',/gm)].map((m) => m[1]);
  for (const m of (list + home).matchAll(/'~icons\/([\w-]+)\//g)) expect(allowed).toContain(m[1]);
  // フォントのアイコン（Google FontsのMaterial Symbolsと、名前を文字で書く <span class="ms">）は使わない
  expect(pages.join('\n') + config).not.toMatch(/Material\+Symbols|<span class="ms/);
});

test('<Shot> で載せるスクリーンショットがpublic/screenshots/ にある', () => {
  const missing = [];
  for (const t of pages) {
    for (const m of t.matchAll(/<Shot\b([^>]*)\/>/g)) {
      const name = /\bname="([^"]+)"/.exec(m[1])[1];
      const files = /\bthemed\b/.test(m[1]) ? [name + '-light', name + '-dark'] : [name];
      for (const f of files) if (!fs.existsSync(path.join(site, 'public/screenshots', f + '.png'))) missing.push(f);
    }
  }
  expect(missing).toEqual([]);
});

test('アプリの「使い方」は、サイトのアドレス（config.tsのSITE_URL）を指す', () => {
  const url = /const SITE_URL = '([^']+)'/.exec(config)[1];
  // 画面はapp/links.tsのHELP_URLを使う
  expect(/HELP_URL = '([^']+)'/.exec(read('src/client/app/links.ts'))[1]).toBe(url);
});

// リリースノート（website/releases/）: バージョンのページは、一覧（index.md）に新しい順に並べる。サイドバーはページから作る（config.ts）
test('リリースノートの一覧に、バージョンのページがちょうど新しい順に並ぶ', () => {
  const dir = path.join(site, 'releases');
  const num = (v) => v.slice(1).split('.').map(Number);
  const newer = (a, b) => num(b).reduce((d, x, i) => d || x - num(a)[i], 0);
  const files = fs.readdirSync(dir).filter((f) => /^v\d+\.\d+\.\d+\.md$/.test(f)).map((f) => f.slice(0, -3)).sort(newer);
  const listed = [...fs.readFileSync(path.join(dir, 'index.md'), 'utf8').matchAll(/^## \[(v\d+\.\d+\.\d+)\]\(\.\/(v\d+\.\d+\.\d+)\)$/gm)]
    .map((m) => { expect(m[2]).toBe(m[1]); return m[1]; });
  expect(files.length).toBeGreaterThan(0);
  expect(listed).toEqual(files);
  // 各ページの見出しは、ファイルの名前のバージョン
  for (const v of files) expect(fs.readFileSync(path.join(dir, v + '.md'), 'utf8')).toMatch(new RegExp('^# ' + v.replace(/\./g, '\\.') + '$', 'm'));
});
