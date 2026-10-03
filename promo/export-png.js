// X 用の告知画像を PNG に書き出す。
//   npm run promo   （開発サーバーをこの場で立てて書き出す）
// ページは 1600×900 で組んであり、2 倍（3200×1800）で promo/images/ に出す（リポジトリには入れない）。
// フォントは Google Fonts から読むので、書き出しにはネット接続が要る。
// 初めて使う前に、ブラウザを入れておく: npx playwright install chromium
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { withDevServer } from '../tools/dev-server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'images');
// 書き出すページ（promo/ の HTML の名前）と、組んだときの大きさ
const PAGES = { 'x-announcement.html': { width: 1600, height: 900 } };

fs.mkdirSync(out, { recursive: true });
await withDevServer(async (base) => {
  const browser = await chromium.launch();
  for (const [name, viewport] of Object.entries(PAGES)) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
    const png = path.join(out, path.basename(name, '.html') + '.png');
    await page.goto(new URL('promo/' + name, base).href);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(800);
    await page.screenshot({ path: png });
    console.log(path.relative(path.join(here, '..'), png), Math.round(fs.statSync(png).size / 1024), 'KB');
    await page.close();
  }
  await browser.close();
});
