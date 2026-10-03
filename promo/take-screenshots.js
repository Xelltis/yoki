// 広報用に、アプリのスクリーンショットを promo/images/ に撮る（?clean で札なし、吹き出しとスクロールバーは隠す。PC は 2 倍、スマホは 3 倍の解像度）
//   npm run screenshots   （開発サーバーをこの場で立てて撮る。サンプルデータで動くアプリをそのまま写す）
// 初めて使う前に、ブラウザを入れておく: npx playwright install chromium
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { withDevServer } from '../tools/dev-server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'images');
fs.mkdirSync(out, { recursive: true });
const HIDE = '#toast { display: none !important; } html { scrollbar-width: none; } ::-webkit-scrollbar { display: none; }';

async function openPage(browser, app, width, height, scale, query) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  const pg = await ctx.newPage();
  await pg.goto(app + '?clean' + query);
  await pg.waitForFunction('window.D && D.sessions && D.sessions.length > 0', null, { timeout: 20000 });
  await pg.addStyleTag({ content: HIDE });
  await pg.waitForTimeout(900);
  return { ctx, pg };
}

const dayOf = (pg, name) => pg.evaluate((n) => (D.sessions.filter((s) => s.name === n)[0] || {}).date, name);

const shots = [];
async function shot(pg, name) {
  const f = path.join(out, name);
  await pg.screenshot({ path: f });
  shots.push(f);
}

await withDevServer(async (app) => {
  const browser = await chromium.launch();
  for (const theme of ['light', 'dark']) {
    // PC
    let { ctx, pg } = await openPage(browser, app, 1440, 900, 2, '&theme=' + theme);
    await pg.evaluate((d) => selectDay(d), await dayOf(pg, '連れて帰る'));
    await pg.waitForTimeout(300);
    await shot(pg, `PC_カレンダー_${theme}.png`);
    if (theme === 'light') {
      await pg.evaluate(() => window.scrollTo(0, 0));
      await pg.click('#newSession'); await pg.waitForTimeout(400);
      await shot(pg, 'PC_卓の登録.png');
      await pg.click('#formClose'); await pg.waitForTimeout(200);
      for (const [tab, label] of [['recruit', '募集・調整'], ['avail', 'メンバーの予定'], ['settings', '設定']]) {
        await pg.click(`nav.tabs button[data-tab=${tab}]`); await pg.waitForTimeout(400);
        await shot(pg, `PC_${label}.png`);
      }
    }
    await ctx.close();
    // スマホ
    ({ ctx, pg } = await openPage(browser, app, 390, 844, 3, '&theme=' + theme));
    await shot(pg, `スマホ_カレンダー_${theme}.png`);
    if (theme === 'light') {
      await pg.click('nav.tabs button[data-tab=recruit]'); await pg.waitForTimeout(400);
      await shot(pg, 'スマホ_募集・調整.png');
      await pg.click('nav.tabs button[data-tab=avail]'); await pg.waitForTimeout(400);
      await shot(pg, 'スマホ_メンバーの予定.png');
    }
    await ctx.close();
  }
  await browser.close();
});
for (const f of shots) console.log(path.basename(f), Math.round(fs.statSync(f).size / 1024), 'KB');
