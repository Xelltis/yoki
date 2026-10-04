// アイコン（ファビコン・ホーム画面のアイコン・manifest）: ページが参照するファイルがあり、大きさが名前と合うか。
// ファイルは npm run icons が brand/yoki.png から書き出す
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const root = path.join(import.meta.dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const PUBLIC = 'src/client/public';

/** PNG の幅と高さ（IHDR） */
const pngSize = (buf) => {
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
};
/** 頭のタグの中で、アイコンと manifest が参照するファイル（href と sizes） */
const refs = (html) => [...html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)" href="\/([^"]+)"(?:[^>]*sizes="(\d+)x\d+")?/g)].map((m) => ({ file: m[1], size: m[2] ? Number(m[2]) : null }));

const PAGES = ['src/client/index.html', 'src/worker/routes/html.ts'];

test('どのページも、同じアイコンと manifest を参照し、そのファイルがある', () => {
  const want = refs(read(PAGES[0]));
  expect(want.map((r) => r.file)).toEqual(['favicon.ico', 'icon-192.png', 'apple-touch-icon.png', 'manifest.webmanifest']);
  for (const p of PAGES) expect(refs(read(p)), p).toEqual(want);
  for (const r of want) expect(fs.existsSync(path.join(root, PUBLIC, r.file)), r.file).toBe(true);
  expect(fs.existsSync(path.join(root, PUBLIC, 'icon.png')), '古いアイコンは消した').toBe(false);
});

test('PNG の大きさが、名前と sizes に合う', () => {
  for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-512.png', 512], ['apple-touch-icon.png', 180]]) {
    expect(pngSize(fs.readFileSync(path.join(root, PUBLIC, file))), file).toEqual([size, size]);
  }
});

test('favicon.ico は 16・32・48px の PNG を持つ', () => {
  const ico = fs.readFileSync(path.join(root, PUBLIC, 'favicon.ico'));
  expect([ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([1, 3]);
  const sizes = [0, 1, 2].map((i) => {
    const e = 6 + i * 16, len = ico.readUInt32LE(e + 8), off = ico.readUInt32LE(e + 12);
    const [w, h] = pngSize(ico.subarray(off, off + len));
    expect([ico.readUInt8(e), ico.readUInt8(e + 1)]).toEqual([w, h]);
    return w;
  });
  expect(sizes).toEqual([16, 32, 48]);
});

test('manifest のアイコンがあり、大きさが合う。maskable も 1 つある', () => {
  const m = JSON.parse(read(PUBLIC + '/manifest.webmanifest'));
  expect(m).toMatchObject({ name: '卓予定', start_url: '/', display: 'browser' });
  for (const icon of m.icons) {
    const [w, h] = pngSize(fs.readFileSync(path.join(root, PUBLIC, icon.src)));
    expect(icon.sizes, icon.src).toBe(w + 'x' + h);
  }
  expect(m.icons.filter((i) => i.purpose === 'maskable')).toHaveLength(1);
});

test('サイトも、同じ絵のファビコンとロゴを参照し、そのファイルがある', () => {
  const config = read('website/.vitepress/config.ts');
  const files = [...config.matchAll(/base \+ '([^']+\.(?:ico|png))'/g)].map((m) => m[1]).filter((f) => f !== 'og.png');
  expect(files).toEqual(['favicon.ico', 'icon-192.png', 'apple-touch-icon.png']);
  expect(config).toContain("logo: '/icon-192.png'");
  for (const f of files) {
    expect(fs.readFileSync(path.join(root, 'website/public', f)).equals(fs.readFileSync(path.join(root, PUBLIC, f))), f).toBe(true);
  }
  expect(fs.existsSync(path.join(root, 'website/public/icon.png')), '古いアイコンは消した').toBe(false);
});
