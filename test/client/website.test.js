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

test('使うアイコンが、アイコンの一覧（theme/icons.ts の ICONS）にちょうどある。一覧はアルファベット順。フォントのアイコンは読まない', () => {
  const list = read('website/.vitepress/theme/icons.ts');
  const icons = [...(/ICONS = \{([^}]*)\}/.exec(list)[1].matchAll(/^\s+(\w+):/gm))].map((m) => m[1]);
  const used = new Set();
  for (const t of pages) {
    for (const m of t.matchAll(/<(?:Ms|Ui)\b[^>]*\s(?:name|icon)="([a-z0-9_]+)"/g)) used.add(m[1]);
    // トップのページの特長（index.md の points）
    for (const m of t.matchAll(/^\s+- icon: ([a-z0-9_]+)$/gm)) used.add(m[1]);
  }
  expect(icons).toEqual([...used].sort());
  // 特長のアイコンは SVG の文字で渡す（HomeFeatures.vue）。index.md の名前はすべてそこにある
  const home = read('website/.vitepress/theme/components/HomeFeatures.vue');
  for (const m of read('website/index.md').matchAll(/^\s+- icon: ([a-z0-9_]+)$/gm)) expect(home).toContain(m[1] + ':');
  // アイコンは unplugin-icons で読み、集まりはライセンスを確かめたもの（tools/icons.ts）だけ
  const allowed = [...read('tools/icons.ts').matchAll(/^\s+'([\w-]+)': '[\w.-]+',/gm)].map((m) => m[1]);
  for (const m of (list + home).matchAll(/'~icons\/([\w-]+)\//g)) expect(allowed).toContain(m[1]);
  // フォントのアイコン（Google Fonts の Material Symbols と、名前を文字で書く <span class="ms">）は使わない
  expect(pages.join('\n') + config).not.toMatch(/Material\+Symbols|<span class="ms/);
});

test('<Shot> で載せるスクリーンショットが public/screenshots/ にある', () => {
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

test('アプリの「使い方」は、サイトのアドレス（config.ts の SITE_URL）を指す', () => {
  const url = /const SITE_URL = '([^']+)'/.exec(config)[1];
  // 画面は app/links.ts の HELP_URL を使う
  expect(/HELP_URL = '([^']+)'/.exec(read('src/client/app/links.ts'))[1]).toBe(url);
});
