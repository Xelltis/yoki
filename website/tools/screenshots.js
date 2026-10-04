// サイトに載せるアプリのスクリーンショットを website/public/screenshots/ に撮る（吹き出し・スクロールバー・ログアウトは写さない。PC は 2 倍、スマホは 3 倍の解像度）
//   npm run screenshots   （開発サーバーをこの場で立て、開発用ログインでサンプルのグループを写す）
// 撮った画像はリポジトリに入れる（サイトの組み立てでは撮らない）。アプリの見た目を変えたら撮り直す
// 初めて使う前に、ブラウザを入れておく: npx playwright install chromium
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { devLogin, withDevServer } from '../../test/e2e/dev-server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '../public/screenshots');
fs.mkdirSync(out, { recursive: true });
const HIDE = '#toast, #logoutBtn, #stLogout { display: none !important; } html { scrollbar-width: none; } ::-webkit-scrollbar { display: none; }';
/** 手元には Bot が無いので、知らせのチャンネルを撮るときは、Bot がサーバーにいることにして返事を差し替える（サンプルのチャンネルは ID が全部 0） */
const CHANNELS = [
  { id: '000000000000000000', name: '卓の知らせ', category: 'TRPG' },
  { id: '100000000000000001', name: '募集', category: 'TRPG' },
  { id: '100000000000000002', name: 'セッションの記録', category: 'TRPG' },
  { id: '100000000000000003', name: '雑談', category: '' },
];
async function fakeBot(ctx) {
  await ctx.route('**/api/g/*/*', async (route) => {
    if (route.request().url().endsWith('/getDiscordChannels')) return route.fulfill({ json: { ok: true, botReady: true, inGuild: true, channels: CHANNELS } });
    const res = await route.fetch();
    const body = await res.json();
    for (const d of [body, body.data]) if (d && d.bot) d.bot = { ready: true, inviteUrl: 'https://discord.com/oauth2/authorize' };
    return route.fulfill({ response: res, json: body });
  });
}

const shots = [];
async function shot(pg, name) {
  const f = path.join(out, name);
  await pg.screenshot({ path: f });
  shots.push(f);
}

await withDevServer(async (base) => {
  // サンプルを作り直す（日付を今日から数え直す）
  await fetch(base + 'dev/reset', { method: 'POST', headers: { Origin: new URL(base).origin } });
  const browser = await chromium.launch();
  async function open(width, height, scale, theme) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
    // 見た目は画面が読む前に決める（最初はカレンダー）
    await ctx.addInitScript((t) => { try { localStorage.setItem('taku.theme', t); localStorage.removeItem('taku.tab'); } catch {} }, theme);
    const pg = await ctx.newPage();
    await devLogin(pg, base);
    await pg.addStyleTag({ content: HIDE });
    await pg.waitForTimeout(900);
    return { ctx, pg };
  }
  const dayOf = (pg, name) => pg.evaluate((n) => (window.yoki.D.sessions.filter((s) => s.name === n)[0] || {}).date, name);
  for (const theme of ['light', 'dark']) {
    // PC
    let { ctx, pg } = await open(1440, 900, 2, theme);
    await pg.evaluate((d) => window.yoki.selectDay(d), await dayOf(pg, '連れて帰る'));
    await pg.waitForTimeout(300);
    await shot(pg, `pc-calendar-${theme}.png`);
    if (theme === 'light') {
      await pg.evaluate(() => window.scrollTo(0, 0));
      await pg.click('#newSession'); await pg.waitForTimeout(400);
      await shot(pg, 'pc-new-session.png');
      await pg.click('#formClose'); await pg.waitForTimeout(200);
      for (const [tab, name] of [['recruit', 'recruit'], ['avail', 'availability']]) {
        await pg.click(`nav.tabs button[data-tab=${tab}]`); await pg.waitForTimeout(400);
        await shot(pg, `pc-${name}.png`);
      }
      // グループの管理画面（メンバーと知らせの区分）
      await fakeBot(ctx);
      await pg.goto(base + 'g/sample/admin/#members');
      await pg.waitForFunction('window.yoki && yoki.D && yoki.D.sessions && yoki.D.sessions.length > 0', null, { timeout: 30000 });
      await pg.addStyleTag({ content: HIDE });
      await pg.waitForTimeout(600);
      await shot(pg, 'pc-admin.png');
      await pg.click('#setNav button[data-set=notify]'); await pg.waitForTimeout(400);
      await shot(pg, 'pc-admin-notify.png');
      // 知らせのチャンネル（Bot を招く・チャンネルを選ぶ）
      await pg.evaluate(() => { document.getElementById('chFold').open = true; });
      await pg.waitForSelector('#botState >> text=Bot はサーバーにいます');
      await pg.evaluate(() => { document.getElementById('chFold').scrollIntoView(); window.scrollBy(0, -88); });
      await pg.waitForTimeout(300);
      await shot(pg, 'pc-admin-channels.png');
    }
    await ctx.close();
    // スマホ
    ({ ctx, pg } = await open(390, 844, 3, theme));
    await shot(pg, `phone-calendar-${theme}.png`);
    if (theme === 'light') {
      await pg.click('nav.tabs button[data-tab=recruit]'); await pg.waitForTimeout(400);
      await shot(pg, 'phone-recruit.png');
      await pg.click('nav.tabs button[data-tab=avail]'); await pg.waitForTimeout(400);
      await shot(pg, 'phone-availability.png');
    }
    await ctx.close();
  }
  await browser.close();
});
for (const f of shots) console.log(path.basename(f), Math.round(fs.statSync(f).size / 1024), 'KB');
