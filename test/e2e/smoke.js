// ブラウザで通しで確かめる（npm run e2e）。開発サーバーを立て、開発用ログインでサンプルのグループに入り、
// 卓の登録・日程調整の回答・予定の入力（PC の表とスマホのリスト）をして、画面にエラーが出ないことを見る。npm test には入れない（ブラウザが要るため）
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { devLogin, withDevServer } from './dev-server.js';

await withDevServer(async (base) => {
  await fetch(base + 'dev/reset', { method: 'POST', headers: { Origin: new URL(base).origin } });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const D = () => page.evaluate(() => window.yoki.D);
  try {
    await devLogin(page, base);
    assert.equal((await D()).sessions.length, 11, 'サンプルの卓は 11 件');
    console.log('ok - 開発用ログインでサンプルのグループに入れる');

    // 卓を登録する
    await page.click('#newSession');
    await page.fill('#name', 'e2e で登録した卓');
    await page.selectOption('#status', '募集');
    await page.click('#f button[type=submit]');
    await page.waitForFunction(() => window.yoki.D.sessions.some((s) => s.name === 'e2e で登録した卓'), null, { timeout: 15000 });
    console.log('ok - 卓を登録できる');

    // 日程調整に回答する（迷宮の底へ。ひよりはまだ答えていない候補日がある）
    const maze = (await D()).sessions.find((s) => s.name === '迷宮の底へ');
    const open = maze.candidates.find((k) => !(maze.votes[k] && maze.votes[k]['ひより']));
    await page.evaluate(() => window.yoki.showTab('recruit'));
    await page.click('button[data-vote="◯"][data-id="' + maze.id + '"][data-day="' + open + '"]');
    await page.waitForFunction((k) => window.yoki.D.sessions.find((s) => s.name === '迷宮の底へ').votes[k]?.['ひより'] === '◯', open, { timeout: 15000 });
    console.log('ok - 日程調整に回答できる');

    // メンバーの予定: 自分のマスはボタンで、押すと 空 → △ と変わる
    await page.evaluate(() => window.yoki.showTab('avail'));
    const cell = page.locator('#availTable button.mk').first();
    const day = await cell.getAttribute('data-day');
    const before = (await D()).avail[day]?.['ひより'] ?? '';
    const next = { '': '△', '△': '×', '×': '' }[before];
    await cell.click();
    await page.waitForFunction(([k, v]) => (window.yoki.D.avail[k]?.['ひより'] ?? '') === v, [day, next], { timeout: 15000 });
    console.log('ok - 予定表の自分のマスを押すと印が変わる');

    // 狭い画面では日ごとのリストになり、◯ △ × のボタンで打てる
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.locator('#tab-avail .wrap.avail').isVisible(), false, '狭い画面では表を隠す');
    const ng = page.locator('#availList button.pk[data-mark="×"][aria-pressed="false"]').first();
    const ngDay = await ng.getAttribute('data-day');
    await ng.click();
    await page.waitForFunction((k) => window.yoki.D.avail[k]?.['ひより'] === '×', ngDay, { timeout: 15000 });
    console.log('ok - 狭い画面では日ごとのリストで印を打てる');

    assert.deepEqual(errors, [], '画面にエラーが出ない');
    console.log('ok - 画面にエラーが出ない');
  } finally {
    await browser.close();
  }
});
