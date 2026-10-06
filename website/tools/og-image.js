// サイトとアプリのリンクをSNSやDiscordに貼ったときに出る画像（og.png）を、og-image.htmlから書き出す。
//   npm run og-image
// ページは1600×900で組んであり、そのままの大きさでwebsite/public/og.pngに出し、アプリのsrc/client/public/og.pngにも写す（どちらもリポジトリに入れる）。
// 文字はGoogle Fontsから読むので、書き出しにはネット接続が要る。アイコンは、ページの <span class="ms">名前</span> を
// Material Symbols Rounded（@iconify-json/material-symbols。Apache License 2.0）の塗りの形のSVGにして入れる（フォントや画像は読まない）
// 初めて使う前に、ブラウザを入れておく: npx playwright install chromium
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const png = path.join(here, '../public/og.png');

const icons = JSON.parse(fs.readFileSync(path.join(here, '../../node_modules/@iconify-json/material-symbols/icons.json'), 'utf8'));
/** アイコンのSVG（名前はog-image.htmlに書いたMaterial Symbolsの名前。塗りの形） */
function svgOf(name) {
  let id = name.replace(/_/g, '-') + '-rounded';
  while (icons.aliases?.[id]) id = icons.aliases[id].parent;
  const icon = icons.icons[id];
  if (!icon) throw new Error('アイコンがありません: ' + name);
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + (icon.width ?? icons.width) + ' ' + (icon.height ?? icons.height) + '">' + icon.body + '</svg>';
}
const html = fs.readFileSync(path.join(here, 'og-image.html'), 'utf8')
  .replace(/(<span class="ms" aria-hidden="true">)(\w+)(<\/span>)/g, (_, open, name, close) => open + svgOf(name) + close);

// ページはそれだけで完結している（文字はGoogle Fonts、アイコンは上で入れたSVG）
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(pathToFileURL(path.join(here, 'og-image.html')).href);
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(800);
await page.screenshot({ path: png });
const appPng = path.join(here, '../../src/client/public/og.png');
fs.copyFileSync(png, appPng);
await browser.close();
for (const f of [png, appPng]) console.log(path.relative(path.join(here, '../..'), f), Math.round(fs.statSync(f).size / 1024), 'KB');
