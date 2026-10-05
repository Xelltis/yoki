// ブラウザで通しで確かめる（npm run e2e）。開発サーバーを立て、開発用ログインでサンプルのグループに入り、
// 画面の主な操作（タブ・カレンダー・卓の登録と変更・募集・日程調整・予定・グループの管理画面）をして、
// データに入ったことと、画面にエラーが出ないことを見る。npm test には入れない（ブラウザが要るため）
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { devLogin, withDevServer } from './dev-server.js';

await withDevServer(async (base) => {
  await fetch(base + 'dev/reset', { method: 'POST', headers: { Origin: new URL(base).origin } });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const D = () => page.evaluate(() => window.yoki.D);
  /** 画面のデータが条件を満たすまで待つ（fn はブラウザの中で D と arg を受け取る） */
  const until = (fn, arg) => page.waitForFunction(`(${fn})(window.yoki.D, ${JSON.stringify(arg ?? null)})`, null, { timeout: 15000 });
  /** タブを押して、タブの中身が出るのを待つ（中身はあとから読み込んで描くことがある） */
  const tab = async (name) => {
    await page.click(`nav.tabs button[data-tab=${name}]`);
    await page.waitForSelector(`#tab-${name}`, { state: 'visible', timeout: 15000 });
  };
  /** グループの管理画面を開き、区分を選ぶ */
  const admin = async (pane) => {
    if (!page.url().includes('/admin/')) { await page.goto(base + 'g/sample/admin/'); await page.waitForFunction(() => window.yoki && window.yoki.D, null, { timeout: 30000 }); }
    await page.click(`#setNav button[data-set="${pane}"]`);
  };
  const main = async () => { await page.goto(base + 'g/sample/'); await page.waitForFunction(() => window.yoki && window.yoki.D, null, { timeout: 30000 }); };
  const confirm = () => page.click('#confirmOk');
  const step = async (name, fn) => { await fn(); console.log('ok - ' + name); };
  const SORA = '400000000000000011';
  /**
   * ソラの締め出し・新規登録の受付・規約を戻す（印は users と meta に残り、サンプルの作り直しでは消えないため、最初と最後に戻す）。
   * ソラは e2e の中で消すので、いて締め出されているときだけ戻す（いない人を戻そうとすると 404 がブラウザのエラーに出る）
   */
  const restoreOperator = () => page.evaluate(async (id) => {
    const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const users = await fetch('/api/admin/users').then((r) => r.json());
    if (users.some((u) => u.id === id && u.bannedAt)) await post('/api/admin/users/' + id + '/ban', { banned: false });
    await post('/api/admin/registration', { open: true });
    await post('/api/admin/legal', { operator: '', contact: '', terms: '', privacy: '' });
  }, SORA);
  try {
    await step('開発用ログインでサンプルのグループに入れる', async () => {
      await devLogin(page, base);
      await restoreOperator();
      assert.equal((await D()).sessions.length, 11, 'サンプルの卓は 11 件');
    });

    await step('タブと見た目（ライト・ダーク）を切り替えられる', async () => {
      for (const t of ['recruit', 'avail', 'settings', 'cal']) {
        await tab(t);
        assert.equal(await page.getAttribute('body', 'data-tab'), t);
      }
      const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      await page.click('#theme');
      assert.notEqual(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), before);
      await page.click('#theme');
    });

    await step('カレンダーで日を選ぶと内訳が出て、月を送れる', async () => {
      const s = (await D()).sessions.find((x) => x.name === '連れて帰る');
      await page.evaluate((k) => window.yoki.selectDay(k), s.date);
      await page.click(`.cal .day[data-day="${s.date}"]`);   // もう一度押すと外れる
      assert.match(await page.textContent('#dayTitle'), /日を選んでください/);
      await page.click(`.cal .day[data-day="${s.date}"]`);
      assert.match(await page.textContent('#dayBody'), /連れて帰る/);
      const month = await page.textContent('#monthLabel');
      await page.click('#next');
      assert.notEqual(await page.textContent('#monthLabel'), month);
      await page.click('#todayBtn');
      assert.equal(await page.textContent('#monthLabel'), month);
    });

    await step('卓を登録できる', async () => {
      await page.click('#newSession');
      await page.fill('#name', 'e2e で登録した卓');
      await page.click('#status label:has(input[value="募集"])');   // どんな卓かの札
      assert.equal(await page.locator('#formModal #del').count(), 0);   // 登録の窓には、削除が無い
      await page.click('#f button[type=submit]');
      await until((d) => d.sessions.some((s) => s.name === 'e2e で登録した卓' && !String(s.id).startsWith('__tmp__')));
    });

    await step('卓を変更できる（内訳の「編集」から）', async () => {
      const s = (await D()).sessions.find((x) => x.name === '灰色の図書館');
      await page.evaluate((k) => window.yoki.selectDay(k), s.date);
      await page.click(`#dayBody button[data-edit="${s.id}"]`);
      assert.match(await page.textContent('#formTitle'), /「灰色の図書館」を変更/);
      await page.fill('#name', '灰色の図書館（改）');
      await page.click('#f button[type=submit]');
      await until((d, id) => d.sessions.some((x) => x.id === id && x.name === '灰色の図書館（改）'), s.id);
    });

    await step('変更の窓から、続きの登録に移れる', async () => {
      const s = (await D()).sessions.find((x) => x.name === '連れて帰る');
      await page.evaluate((k) => window.yoki.selectDay(k), s.date);
      await page.click(`#dayBody button[data-edit="${s.id}"]`);
      await page.click('#cont');
      await page.waitForFunction(() => document.getElementById('formTitle')?.textContent === '卓を登録');
      assert.equal(await page.inputValue('#name'), '連れて帰る（続き）');
      await page.click('#formClose');
    });

    await step('卓を削除できる（確かめる窓を通る）', async () => {
      const s = (await D()).sessions.find((x) => x.name === 'e2e で登録した卓');
      await tab('recruit');
      await page.click(`#recruitList button[data-edit="${s.id}"]`);
      await page.click('#del');
      await confirm();
      await until((d, id) => !d.sessions.some((x) => x.id === id), s.id);
    });

    await step('募集中の卓に参加希望を付け、取り消せる', async () => {
      const s = (await D()).sessions.find((x) => x.name === '雪原の古城');
      await page.click(`#recruitList button[data-level="want"][data-id="${s.id}"]`);
      await until((d, id) => d.sessions.find((x) => x.id === id).want.includes('ひより'), s.id);
      await page.click(`#recruitList button[data-level="none"][data-id="${s.id}"]`);
      await until((d, id) => !d.sessions.find((x) => x.id === id).want.includes('ひより'), s.id);
    });

    await step('調整中の卓を登録すると候補日を選ぶ窓が開き、候補日を出せる', async () => {
      const d = await D();
      await tab('cal');
      await page.click('#newSession');
      await page.fill('#name', 'e2e の日程調整');
      await page.click('#status label:has(input[value="調整中"])');
      await page.check('#membersBox input.m[value="ソラ"]');
      await page.fill('#winFrom', d.availDays[20]);
      await page.fill('#winTo', d.availDays[26]);
      await page.click('#f button[type=submit]');
      await page.waitForSelector('#pollModal:not([hidden])', { timeout: 15000 });
      const days = page.locator('#pollDays input.pdc');
      await days.nth(0).check();
      await days.nth(2).check();
      await page.click('#pollSend');
      await until((x) => (x.sessions.find((s) => s.name === 'e2e の日程調整')?.candidates || []).length === 2);
    });

    await step('日程調整に回答できる', async () => {
      const maze = (await D()).sessions.find((s) => s.name === '迷宮の底へ');
      const open = maze.candidates.find((k) => !(maze.votes[k] && maze.votes[k]['ひより']));
      await tab('recruit');
      await page.click(`button[data-vote="◯"][data-id="${maze.id}"][data-day="${open}"]`);
      await until((d, k) => d.sessions.find((s) => s.name === '迷宮の底へ').votes[k]?.['ひより'] === '◯', open);
    });

    await step('管理者は候補日から開催日を決められる', async () => {
      const s = (await D()).sessions.find((x) => x.name === 'e2e の日程調整');
      const day = s.candidates[0];
      await page.click(`#adjustList button[data-decide="${s.id}"][data-day="${day}"]`);
      await confirm();
      await until((d, a) => d.sessions.some((x) => x.id === a[0] && x.status === '開催' && x.date === a[1]), [s.id, day]);
    });

    await step('日付のメモを保存できる', async () => {
      const day = (await D()).availDays[3];
      await tab('cal');
      await page.evaluate((k) => window.yoki.selectDay(k), day);
      await page.fill('#dayNote', 'e2e のメモ');
      await page.click('#dayNoteSave');
      await until((d, k) => d.notes[k]?.text === 'e2e のメモ', day);
    });

    await step('予定表の自分のマスを押すと印が変わる', async () => {
      await tab('avail');
      const cell = page.locator('#availTable button.mk').first();
      const day = await cell.getAttribute('data-day');
      const before = (await D()).avail[day]?.['ひより'] ?? '';
      const next = { '': '△', '△': '×', '×': '' }[before];
      await cell.click();
      await until((d, a) => (d.avail[a[0]]?.['ひより'] ?? '') === a[1], [day, next]);
    });

    await step('予定表の上のボタンで絞り込める', async () => {
      const all = await page.locator('#availTable tr').count();
      await page.click('#availChips button[data-chip="hol"]');
      assert.ok((await page.locator('#availTable tr').count()) < all, '土日祝だけにすると行が減る');
      await page.click('#availChips button[data-chip="mine"]');
      assert.equal(await page.locator('#availTable tr').first().locator('th').count(), 4, '自分の列だけ（日付・曜・卓・自分）');
      await page.click('#availChips button[data-chip="hol"]');
      await page.click('#availChips button[data-chip="mine"]');
      assert.equal(await page.locator('#availTable tr').count(), all);
    });

    await step('予定のメモを書ける（鉛筆から）', async () => {
      const pen = page.locator('#availTable button[data-pen]').nth(4);
      const day = await pen.getAttribute('data-pen');
      await pen.click();
      await page.fill('#memoText', 'e2e の予定メモ');
      await page.click('#memoSave');
      await until((d, k) => d.availNotes[k]?.['ひより']?.text === 'e2e の予定メモ', day);
    });

    await step('予定をまとめて入れられる', async () => {
      if (await page.isHidden('#availBulk')) await page.click('#foldBulk');
      await page.selectOption('#abMark', '×');
      await page.click('#abRun');
      await confirm();
      await until((d) => Object.values(d.avail).filter((m) => m['ひより'] === '×').length >= 10);
    });

    await step('管理画面: メンバーを足し、名前を変え、外せる', async () => {
      await admin('members');
      await page.click('#mclear');
      await page.fill('#mname', 'e2e メンバー');
      await page.click('#msave');
      await until((d) => d.members.some((m) => m.name === 'e2e メンバー'));
      await page.click('#memberTable tr[data-name="e2e メンバー"]');
      await page.fill('#mname', 'e2e メンバー（改）');
      await page.click('#msave');
      await until((d) => d.members.some((m) => m.name === 'e2e メンバー（改）'));
      await page.click('#mdel');
      await confirm();
      await until((d) => !d.members.some((m) => m.name.startsWith('e2e メンバー')));
    });

    await step('管理画面: 知らせのつまみ・接続テスト・グループの名前の変更ができる。Bot が無ければそう出る', async () => {
      await admin('notify');
      // 手元には Bot のトークンが無いので、チャンネルは選べず、そのことを知らせる（サンプルのチャンネルへの接続テストはできる）
      assert.match(await page.textContent('#botState'), /Bot をまだ設定していません/);
      assert.equal(await page.isDisabled('#stChannel'), true);
      const urge = (await D()).settings.urge;
      await page.locator('#stUrge').dispatchEvent('click');
      await until((d, v) => d.settings.urge === !v, urge);
      const logs = (await D()).log.length;
      await page.locator('#stTest').dispatchEvent('click');
      await until((d, n) => d.log.length > n, logs);
      await page.click('#setNav button[data-set="table"]');
      await page.fill('#stName', 'e2e のグループ');
      await page.click('#stNameSave');
      await confirm();
      await until((d) => d.title === 'e2e のグループ');
    });

    await step('管理画面: 卓をまとめて変えられる', async () => {
      await admin('ops');
      const s = (await D()).sessions.find((x) => x.name === '灰色の図書館（改）');
      await page.check(`#matrix input.rowsel[data-id="${s.id}"]`);
      await page.selectOption('#bulkAction', 'status');
      await page.selectOption('#bulkStatus', '中止');
      await page.click('#bulkRun');
      await confirm();
      await until((d, id) => d.sessions.find((x) => x.id === id)?.status === '中止', s.id);
    });

    await step('管理画面から予定の画面へ戻れる', async () => {
      await page.click('#toMain');
      await page.waitForURL('**/g/sample/');
      await page.waitForFunction(() => window.yoki && window.yoki.D, null, { timeout: 30000 });
      assert.equal(await page.isVisible('#adminLink'), true, '管理者には管理画面への入口が出る');
    });

    await step('「あなた」はログインした人で、ほかの人には切り替えられない', async () => {
      assert.equal(await page.textContent('#me'), 'ひより');
      assert.equal(await page.locator('select#me, #proxyBadge').count(), 0);
    });

    await step('「更新」で読み直せる', async () => {
      await page.click('#reload');
      await page.waitForFunction(() => /最新/.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
    });

    await step('グループを消せる。開いていたほかのタブには「見つかりません」と出る', async () => {
      const made = await page.evaluate(async () => {
        const r = await fetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guildId: 'dev-guild', title: 'e2e の消すグループ' }) });
        return r.json();
      });
      const other = await context.newPage();
      await other.goto(base + made.url.slice(1));
      await other.waitForFunction(() => window.yoki && window.yoki.D, null, { timeout: 30000 });
      await page.goto(base + made.url.slice(1) + 'admin/#danger');
      await page.waitForFunction(() => window.yoki && window.yoki.D, null, { timeout: 30000 });
      assert.equal(await page.isDisabled('#delGroup'), true, '名前を打つまでは押せない');
      await page.fill('#delConfirm', 'e2e の消すグループ');
      await page.click('#delGroup');
      await confirm();
      await page.waitForURL('**/?deleted=1');
      await other.click('#reload');
      await other.waitForSelector('#loading:not([hidden]) >> text=見つかりません', { timeout: 15000 });
      await other.close();
      await main();
    });

    await step('管理者でない人（ソラ）: 管理画面は 403、入口も出ない。自分の名前と備考は直せる', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      const sora = await ctx.newPage();
      sora.on('pageerror', (e) => errors.push(e.message));
      await devLogin(sora, base, 'ソラ');
      assert.equal(await sora.isVisible('#adminLink'), false);
      assert.equal((await sora.goto(base + 'g/sample/admin/')).status(), 403);
      await sora.goto(base + 'g/sample/');
      await sora.waitForFunction(() => window.yoki && window.yoki.D, null, { timeout: 30000 });
      await sora.click('nav.tabs button[data-tab=settings]');
      assert.equal(await sora.isVisible('#adminEntry'), false);
      await sora.fill('#meNote', 'e2e の備考');
      await sora.click('#meSave');
      await sora.waitForFunction(() => window.yoki.D.members.find((m) => m.name === 'ソラ')?.note === 'e2e の備考', null, { timeout: 15000 });
      await ctx.close();
    });

    await step('運営の管理画面: 様子・グループ・利用者が見え、ログインを切って締め出し、戻し、消せる。新規登録の受付を止めて戻せる', async () => {
      await page.goto(base);
      await page.waitForSelector('#opLink:not([hidden])', { timeout: 15000 });
      await page.click('#opLink');
      await page.waitForURL('**/admin/**');
      await page.waitForSelector('#opCounts .op-count', { timeout: 15000 });
      await page.click('#opNav button[data-set="groups"]');
      await page.click('#opGroups tr[data-gid="sample"]');
      await page.waitForSelector('#opGroup:not([hidden]) >> text=メンバーと管理者');
      await page.click('#opNav button[data-set="users"]');
      await page.waitForSelector(`#opUsers button[data-ban="${SORA}"]`);
      if (await page.isVisible(`#opUsers button[data-logout="${SORA}"]`)) {
        await page.click(`#opUsers button[data-logout="${SORA}"]`);
        await confirm();
        await page.waitForSelector(`#opUsers button[data-logout="${SORA}"]`, { state: 'detached', timeout: 15000 });
      }
      await page.click(`#opUsers button[data-ban="${SORA}"]`);
      await page.fill('#banReason', 'e2e');
      await page.click('#banForm button[type=submit]');
      await page.waitForSelector(`#opUsers button[data-unban="${SORA}"]`, { timeout: 15000 });
      // 締め出されたソラは、開発用ログインでも入れない
      const ctx = await browser.newContext();
      const sora = await ctx.newPage();
      await sora.goto(base);
      await sora.selectOption('#devAs', 'ソラ');
      await Promise.all([sora.waitForURL('**/?login=banned'), sora.click('#devForm button')]);
      assert.match(await sora.textContent('#notice'), /締め出しています/);
      await ctx.close();
      await page.click(`#opUsers button[data-unban="${SORA}"]`);
      await page.waitForSelector(`#opUsers button[data-ban="${SORA}"]`, { timeout: 15000 });
      // 消す。利用者の一覧から消え、サンプルのグループのメンバーからも外れる（次の e2e は、作り直したサンプルとログインで戻る）
      await page.click(`#opUsers button[data-del="${SORA}"]`);
      await confirm();
      await page.waitForSelector(`#opUsers button[data-ban="${SORA}"]`, { state: 'detached', timeout: 15000 });
      // 新規登録の受付を止めると入口にも出る。戻す
      await page.click('#opNav button[data-set="overview"]');
      await page.click('#opRegToggle');
      await confirm();
      await page.waitForSelector('#opReg >> text=止めています', { timeout: 15000 });
      assert.equal((await page.evaluate(() => fetch('/api/me').then((r) => r.json()))).registration, false);
      await page.click('#opRegToggle');
      await page.waitForSelector('#opReg >> text=受け付けています', { timeout: 15000 });
      await main();
      // 開いた直後は、ブラウザの控え（消す前のデータ）が出ることがある。最新を読んで、ソラがメンバーから外れるのを待つ
      await until((d) => !d.members.some((m) => m.name === 'ソラ'));
    });

    await step('運営の管理画面: 規約の運営者・問い合わせ先・本文を直すと、/terms に出る。入口と設定タブから開ける', async () => {
      await page.goto(base + 'admin/#legal');
      // 欄は画面を描いてから出るので、出るのも待つ
      await page.waitForFunction(() => document.getElementById('lgTerms')?.value.includes('本サービス'), null, { timeout: 15000 });
      assert.match(await page.textContent('#lgTermsState'), /既定の文/);
      await page.fill('#lgOperator', 'e2e の運営');
      await page.fill('#lgContact', 'https://example.com/contact');
      await page.fill('#lgTerms', '## e2e の決まり\n- 仲良く遊ぶ');
      await page.click('#opLegal button[type=submit]');
      await page.waitForSelector('#lgTermsState >> text=直した文', { timeout: 15000 });
      const doc = await context.newPage();
      await doc.goto(base + 'terms');
      assert.equal(await doc.textContent('h1'), '利用規約');
      assert.match(await doc.textContent('dl.who'), /e2e の運営/);
      assert.equal(await doc.getAttribute('dl.who a', 'href'), 'https://example.com/contact');
      assert.equal(await doc.textContent('article h2'), 'e2e の決まり');
      await Promise.all([doc.waitForURL('**/privacy'), doc.click('nav a[href="/privacy"]')]);
      assert.equal(await doc.textContent('h1'), 'プライバシーポリシー');
      await doc.close();
      // 既定の文に戻す（入力に入れて保存する）
      await page.click('#opLegal button[data-default="terms"]');
      await page.click('#opLegal button[type=submit]');
      await page.waitForSelector('#lgTermsState >> text=既定の文', { timeout: 15000 });
      await page.goto(base);
      // 入口は React で描くので、描き終わるのを待つ
      await page.waitForSelector('.foot a[href="/terms"]', { timeout: 15000 });
      await main();
      await tab('settings');
      assert.equal(await page.isVisible('#tab-settings a[href="/privacy"]'), true, '設定タブにリンクがある');
    });

    await step('狭い画面では日ごとのリストで印を打てる', async () => {
      await tab('avail');
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.locator('#tab-avail .wrap.avail').isVisible(), false, '狭い画面では表を隠す');
      const soft = page.locator('#availList button.pk[data-mark="△"][aria-pressed="false"]').first();
      const day = await soft.getAttribute('data-day');
      await soft.click();
      await until((d, k) => d.avail[k]?.['ひより'] === '△', day);
    });

    await step('画面にエラーが出ない', async () => {
      assert.deepEqual(errors, []);
    });
  } finally {
    await restoreOperator().catch(() => {});
    await browser.close();
  }
});
