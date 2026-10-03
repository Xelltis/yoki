// サイトを SNS に貼ったときに出る画像（og.png）を、og-image.html から書き出す。
//   npm run og-image
// ページは 1600×900 で組んであり、そのままの大きさで website/public/og.png に出す（リポジトリに入れる）。
// フォントは Google Fonts から読むので、書き出しにはネット接続が要る。
// 初めて使う前に、ブラウザを入れておく: npx playwright install chromium
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const png = path.join(here, '../public/og.png');

// ページはそれだけで完結している（フォントは Google Fonts）ので、ファイルのまま開く
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(pathToFileURL(path.join(here, 'og-image.html')).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(800);
await page.screenshot({ path: png });
await browser.close();
console.log(path.relative(path.join(here, '../..'), png), Math.round(fs.statSync(png).size / 1024), 'KB');
