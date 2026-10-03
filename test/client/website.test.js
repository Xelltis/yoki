// サイト（website/）の約束: 使うアイコンを読み込んでいるか、載せるスクリーンショットがあるか、アプリの「使い方」がサイトを指しているか
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

test('使うアイコンが、読み込むアイコンの一覧（config.ts の ICONS）にちょうどある。一覧はアルファベット順', () => {
  const icons = JSON.parse(/export const ICONS = (\[[\s\S]*?\]);/.exec(config)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
  const used = new Set();
  for (const t of pages) {
    for (const m of t.matchAll(/\bicon="([a-z0-9_]+)"/g)) used.add(m[1]);
    for (const m of t.matchAll(/class="ms[^"]*"[^>]*>([a-z0-9_]+)</g)) used.add(m[1]);
  }
  expect(icons).toEqual([...used].sort());
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
  for (const p of ['src/client/index.html', 'src/client/console/index.html']) {
    const links = [...read(p).matchAll(/<a\b[^>]*>(?:(?!<\/a>)[\s\S])*使い方/g)].map((m) => /href="([^"]+)"/.exec(m[0])[1]);
    expect(links.length, p).toBeGreaterThan(0);
    expect(links.every((h) => h === url), p).toBe(true);
  }
});
