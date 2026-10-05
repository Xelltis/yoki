// デザイン案（mock.html）を撮り、案ごとに 1 枚の見比べる画像にする（brand/mocks/sheet-a.png など）。配らない
// 案の画像は、案を選んだときの控え（A に決めた。2026-10-05）
//   node brand/mocks/shoot.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = pathToFileURL(path.join(here, 'mock.html')).href;
const NAMES = { a: 'A: 青を大きく使う', b: 'B: クリームの地に、青と差し色', c: 'C: いまの暗い帯のまま、水色を青に' };
const browser = await chromium.launch();
const shot = async (v, theme, screen, w, h, scale) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  const pg = await ctx.newPage();
  await pg.goto(page + '?v=' + v + '&theme=' + theme + '&screen=' + screen);
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(300);
  const buf = await pg.screenshot();
  await ctx.close();
  return 'data:image/png;base64,' + buf.toString('base64');
};
for (const v of ['a', 'b', 'c']) {
  const pc = [await shot(v, 'light', 'guest', 1280, 760, 1), await shot(v, 'dark', 'home', 1280, 760, 1), await shot(v, 'light', 'app', 1280, 760, 1), await shot(v, 'dark', 'app', 1280, 760, 1)];
  const ph = [await shot(v, 'light', 'guest', 390, 760, 1), await shot(v, 'dark', 'guest', 390, 760, 1), await shot(v, 'light', 'app', 390, 760, 1), await shot(v, 'dark', 'app', 390, 760, 1)];
  const label = (t) => '<div style="font:600 15px/1.4 sans-serif;color:#444;margin:6px 0 10px">' + t + '</div>';
  const img = (src, w) => '<img src="' + src + '" style="width:' + w + 'px;display:block;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.18)">';
  const html = '<body style="margin:0;padding:28px;background:#ecebe6;font-family:sans-serif">' +
    '<div style="font:700 26px/1.3 sans-serif;margin-bottom:18px">' + NAMES[v] + '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(2,640px);gap:18px 24px">' +
    ['入口（明るい）', 'ログインのあと（ダーク）', 'カレンダー（明るい）', 'カレンダー（ダーク）'].map((t, i) => '<div>' + label('PC ' + t) + img(pc[i], 640) + '</div>').join('') +
    '</div><div style="display:grid;grid-template-columns:repeat(4,312px);gap:18px;margin-top:24px">' +
    ['入口（明るい）', '入口（ダーク）', 'カレンダー（明るい）', 'カレンダー（ダーク）'].map((t, i) => '<div>' + label('スマホ ' + t) + img(ph[i], 312) + '</div>').join('') +
    '</div></body>';
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const pg = await ctx.newPage();
  await pg.setContent(html);
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: path.join(here, 'sheet-' + v + '.png'), fullPage: true });
  await ctx.close();
  console.log('sheet-' + v + '.png');
}
await browser.close();
fs.rmSync(path.join(here, 'tmp'), { recursive: true, force: true });
