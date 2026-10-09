// ブラウザで通しで確かめる（npm run e2e）。開発サーバーを立て、開発用ログインでサンプルのグループに入り、
// 画面の主な操作（タブ・カレンダー・卓の登録と変更・募集・日程調整・予定・グループの管理画面）をして、
// データに入ったことと、画面にエラーが出ないことを見る。npm testには入れない（ブラウザが要るため）
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  /** 画面のデータが条件を満たすまで待つ（fnはブラウザの中でDとargを受け取る） */
  const until = (fn, arg) => page.waitForFunction(`(${fn})(window.yoki.D, ${JSON.stringify(arg ?? null)})`, null, { timeout: 15000 });
  /** タブを押して、タブの中身が出るのを待つ（中身はあとから読み込んで描くことがある）。設定はタブでなく、あなたのメニューから開く */
  const tab = async (name) => {
    if (name === 'settings') { await page.click('#meBtn'); await page.click('#toSettings'); }
    else await page.click(`nav.tabs button[data-tab=${name}]`);
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
   * ソラの締め出し・新規登録の受付・規約を戻す（印はusersとmetaに残り、サンプルの作り直しでは消えないため、最初と最後に戻す）。
   * ソラはe2eの中で消すので、いて締め出されているときだけ戻す（いない人を戻そうとすると404がブラウザのエラーに出る）
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
      assert.equal((await D()).sessions.length, 11, 'サンプルの卓は11件');
    });

    await step('タブと見た目（ライト・ダーク）を切り替えられる', async () => {
      for (const t of ['recruit', 'scenario', 'avail', 'records', 'settings', 'cal']) {
        await tab(t);
        assert.equal(await page.getAttribute('body', 'data-tab'), t);
      }
      const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      await page.click('#meBtn');
      await page.click('#theme');
      assert.notEqual(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), before);
      assert.equal(await page.isVisible('#meMenu'), false, '選んだらメニューは閉じる');
      await page.click('#meBtn');
      await page.click('#theme');
      await page.click('#meBtn');
      await page.keyboard.press('Escape');
      assert.equal(await page.isVisible('#meMenu'), false, 'Escでメニューが閉じる');
      await page.click('#helpBtn');
      assert.equal(await page.isVisible('#helpLink'), true, 'ヘルプのメニューに使い方がある');
      await page.click('#guideBtn');
      await page.waitForSelector('#setupGuide', { state: 'visible', timeout: 15000 });
      await page.click('#helpBtn');
      await page.click('#guideBtn');
      await page.waitForSelector('#setupGuide', { state: 'hidden', timeout: 15000 });
    });

    await step('グループを開き直すと、そのグループで前に見ていたタブから始まる（設定は控えない）', async () => {
      await tab('avail');
      await main();
      assert.match(page.url(), /\/g\/sample\/avail\/$/);
      await tab('settings');
      await main();
      assert.match(page.url(), /\/g\/sample\/avail\/$/, '設定を開いたあとでも、前のタブから始まる');
      await tab('cal');
    });

    await step('入口に「あなたの予定」が出て、あなたの番の日程調整から「募集・調整」のタブへ移れる', async () => {
      await page.goto(base);
      await page.waitForSelector('#agenda', { timeout: 15000 });
      assert.match(await page.textContent('#agenda'), /今夜の短編/, '今日の卓が出る');
      await page.click('#agenda [data-agenda="vote"] a');
      await page.waitForSelector('#tab-recruit', { state: 'visible', timeout: 15000 });
      await page.waitForFunction(() => window.yoki && window.yoki.D, null, { timeout: 30000 });
      await tab('cal');
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

    await step('だれも印を付けていない日も、カレンダーで全員空きになる', async () => {
      const d = await D();
      const free = d.availDays.find((k) => !Object.keys(d.avail[k] || {}).length && !Object.keys(d.booked[k] || {}).length);
      assert.ok(free, 'だれも印を付けていない日がある');
      await page.evaluate((k) => window.yoki.selectDay(k), free);
      assert.match(await page.getAttribute(`.cal .day[data-day="${free}"]`, 'aria-label'), /全員空き/);
    });

    await step('卓を登録できる', async () => {
      await page.click('#newSession');
      await page.fill('#name', 'e2eで登録した卓');
      await page.click('#status label:has(input[value="募集"])');   // どんな卓かの札
      assert.equal(await page.locator('#formModal #del').count(), 0);   // 登録の窓には、削除が無い
      await page.click('#f button[type=submit]');
      await until((d) => d.sessions.some((s) => s.name === 'e2eで登録した卓' && !String(s.id).startsWith('__tmp__')));
    });

    await step('くり返しで日を足して、毎週の卓をまとめて登録できる', async () => {
      const day = (await D()).availDays[20];
      await page.click('#newSession');
      await page.fill('#name', 'くり返しの定期卓');
      await page.click('#status label:has(input[value="開催"])');
      await page.fill('#date', day);
      await page.click('#repeatOpen');
      await page.selectOption('#repeatRule', 'week');
      await page.fill('#repeatCount', '2');
      await page.click('#repeatAdd');
      assert.equal(await page.locator('#moreDates input.xdate').count(), 2, '2日が足される');
      await page.click('#f button[type=submit]');
      await until((d) => d.sessions.filter((s) => s.name.startsWith('くり返しの定期卓') && !String(s.id).startsWith('__tmp__')).length === 3);
    });

    await step('卓を変更できる（内訳の「編集」から）', async () => {
      const s = (await D()).sessions.find((x) => x.name === '灰色の図書館');
      await page.evaluate((k) => window.yoki.selectDay(k), s.date);
      await page.click(`#dayBody button[data-edit="${s.id}"]`);
      assert.match(await page.textContent('#formTitle'), /「灰色の図書館」を変更/);
      await page.fill('#name', '灰色の図書館（改）');
      await page.click('#f button[type=submit]');
      await until((d, id) => d.sessions.some((x) => x.id === id && x.name === '灰色の図書館（改）'), s.id);
      // 変更の窓の下で、変更の履歴を読める
      await page.click(`#dayBody button[data-edit="${s.id}"]`);
      await page.click('#historyFold summary');
      await page.waitForSelector('#historyList >> text=名前 灰色の図書館→灰色の図書館（改）', { timeout: 15000 });
      await page.click('#formClose');
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
      const s = (await D()).sessions.find((x) => x.name === 'e2eで登録した卓');
      await tab('recruit');
      await page.click(`#recruitList button[data-edit="${s.id}"]`);
      await page.click('#del');
      await confirm();
      await until((d, id) => !d.sessions.some((x) => x.id === id), s.id);
    });

    await step('シナリオ: 登録して自分の通過を付け、遊べる日から卓を立てるとシナリオとGMが入る。通過した人が参加者にいると注意が出る', async () => {
      await tab('scenario');
      assert.equal(await page.locator('#scenarioList button[data-scenario]').count(), 5, 'サンプルのシナリオは5件');
      await page.click('#newScenario');
      await page.fill('#scName', 'e2eのシナリオ');
      await page.fill('#scMin', '1');
      await page.click('#scSave');
      await until((d) => d.scenarios.some((s) => s.name === 'e2eのシナリオ'));
      await page.waitForFunction(() => document.getElementById('scenarioTitle')?.textContent === 'e2eのシナリオ');
      await page.click('#scenarioPeople input[data-mark="ひより"][data-kind="gm"]');
      await until((d) => d.scenarios.find((s) => s.name === 'e2eのシナリオ').marks['ひより'] === 'gm');
      const id = (await D()).scenarios.find((s) => s.name === 'e2eのシナリオ').id;
      await page.click('#playDays button[data-start-day] >> nth=0');
      await page.waitForFunction(() => document.getElementById('formTitle')?.textContent === '卓を登録');
      assert.equal(await page.inputValue('#scenario'), id);
      assert.equal(await page.inputValue('#name'), 'e2eのシナリオ');
      assert.equal(await page.inputValue('#gm'), 'ひより');
      // 通過した人（「あの日の約束」のソラ）を参加者にすると、注意が出る
      const promise = (await D()).scenarios.find((s) => s.name === 'あの日の約束').id;
      await page.selectOption('#scenario', promise);
      await page.check('#membersBox input[value="ソラ"]');
      assert.match(await page.textContent('#passWarn'), /ソラ/);
      await page.click('#f button[type=submit]');
      await until((d, sid) => d.sessions.some((s) => s.scenarioId === sid && s.members.includes('ソラ') && !String(s.id).startsWith('__tmp__')), promise);
      // シナリオを消すと、確かめる窓を通って一覧から消える
      await tab('scenario');
      await page.click(`#scenarioList button[data-scenario="${id}"]`);
      await page.click('#scenarioEdit');
      await page.click('#scDelete');
      await confirm();
      await until((d, sid) => !d.scenarios.some((s) => s.id === sid), id);
    });

    await step('卓の準備: 割り当てられた自分の秘匿HOだけが読める。HOの希望とキャラシを出せる。GMでない管理者は割り当てられない', async () => {
      await tab('cal');
      const s = (await D()).sessions.find((x) => x.name.startsWith('灰色の図書館'));
      await page.evaluate((k) => window.yoki.selectDay(k), s.date);
      assert.match(await page.textContent(`#dayBody [data-prep-of="${s.id}"]`), /HO 2\/3を割り当て/);
      await page.click(`#dayBody button[data-prep="${s.id}"]`);
      await page.waitForSelector('#prepModal:not([hidden])');
      assert.match(await page.textContent('#mySecret'), /亡くなった祖父/);
      const slots = (await D()).sessions.find((x) => x.id === s.id).prep.slots;
      assert.equal(slots[0].secret, null, 'ほかの人（こまち）の秘匿HOは画面データに来ない');
      assert.equal(slots[0].hasSecret, true);
      assert.equal(await page.locator('#prepAssign').count(), 0, 'GMのいる卓では、管理者でも割り当てられない');
      await page.selectOption('#hope1', String(slots[2].pos));
      await until((d, id) => d.sessions.find((x) => x.id === id).prep.slots[2].hopes['ひより'] === 1, s.id);
      await page.fill('#sheetUrl', 'https://example.com/sheet/hiyori');
      await page.fill('#sheetPc', '早瀬 ひより');
      await page.click('#sheetSave');
      await until((d, id) => d.sessions.find((x) => x.id === id).prep.sheets['ひより']?.pc === '早瀬 ひより', s.id);
      // 管理者は、枠を足せる（秘匿HOは書けない）
      await page.click('#prepAddSlot');
      await page.click('#prepSave');
      await until((d, id) => d.sessions.find((x) => x.id === id).prep.slots.length === 4, s.id);
      await page.click('#prepClose');
      await page.waitForSelector('#prepModal', { state: 'hidden' });
    });

    await step('参加者は「行けなくなった」を一言付きでGMに伝えられ、管理者は日を組み直す窓を開ける。取り消せる', async () => {
      await tab('cal');
      const s = (await D()).sessions.find((x) => x.name === '連れて帰る');
      await page.evaluate((k) => window.yoki.selectDay(k), s.date);
      await page.click(`#dayBody button[data-absent="${s.id}"]`);
      await page.fill('#absenceText', 'e2eの急用');
      await page.click('#absenceSend');
      await until((d, id) => d.sessions.find((x) => x.id === id).absent.some((a) => a.name === 'ひより' && a.note === 'e2eの急用'), s.id);
      assert.match(await page.textContent(`#dayBody [data-absent-of="${s.id}"]`), /行けなくなった: ひより（e2eの急用）/);
      assert.match(await page.textContent('#notices'), /行けなくなった人がいます/);
      await page.click(`#dayBody button[data-reschedule="${s.id}"]`);
      assert.equal(await page.inputValue('#status'), '調整中', '状態を調整中にした変更の窓が開く');
      await page.click('#formClose');
      await page.click(`#dayBody button[data-absent="${s.id}"][data-on="1"]`);
      await until((d, id) => d.sessions.find((x) => x.id === id).absent.length === 0, s.id);
    });

    await step('記録のタブ: 終わった卓の記録とPCの台帳が出る。GMは記録を書ける', async () => {
      await tab('records');
      const s = (await D()).sessions.find((x) => x.name === '鉄鳴界の夜明け #1');
      assert.match(await page.textContent(`#doneList [data-done="${s.id}"]`), /ソラ（カイ・ハーツ・継続）/);
      assert.match(await page.textContent('#pcLedger [data-ledger="ソラ"]'), /カイ・ハーツ/);
      await page.click(`#doneList button[data-record="${s.id}"]`);
      await page.fill('#recordRecap', 'e2eの振り返り');
      await page.click('#recordSave');
      await until((d, id) => d.sessions.find((x) => x.id === id).record.recap === 'e2eの振り返り', s.id);
      await page.click('#recordClose');
      await tab('cal');
    });

    await step('募集中の卓に参加希望を付け、取り消せる。定員に達した卓では、キャンセル待ちに並ぶ', async () => {
      await tab('recruit');
      const s = (await D()).sessions.find((x) => x.name === '雪原の古城');
      // サンプルの「雪原の古城」は定員3人に達していて、レンがキャンセル待ちの1番目
      assert.match(await page.textContent(`#recruitList button[data-level="want"][data-id="${s.id}"]`), /キャンセル待ちに並ぶ/);
      await page.click(`#recruitList button[data-level="want"][data-id="${s.id}"]`);
      await until((d, id) => d.sessions.find((x) => x.id === id).want.includes('ひより'), s.id);
      await page.waitForSelector(`#recruitList button[data-level="want"][data-id="${s.id}"]:has-text("キャンセル待ち 2番目")`);
      assert.match(await page.textContent(`[data-wait-of="${s.id}"]`), /1\. レン　2\. ひより/);
      await page.click(`#recruitList button[data-level="none"][data-id="${s.id}"]`);
      await until((d, id) => !d.sessions.find((x) => x.id === id).want.includes('ひより'), s.id);
    });

    await step('募集の定員を変えると、外に出た人はキャンセル待ちに並び、増やすと前の人から繰り上がる', async () => {
      const s = (await D()).sessions.find((x) => x.name === '雪原の古城');
      assert.equal(s.capacity, 3, 'サンプルの定員');
      const setCapacity = async (n) => {
        await page.click(`#recruitList button[data-edit="${s.id}"]`);
        await page.fill('#capacity', String(n));
        await page.click('#f button[type=submit]');
        await until((d, a) => d.sessions.find((x) => x.id === a[0]).capacity === a[1], [s.id, n]);
      };
      await setCapacity(1);
      assert.match(await page.textContent(`[data-want-of="${s.id}"]`), /ソラ1\/1人（定員）/);
      assert.match(await page.textContent(`[data-wait-of="${s.id}"]`), /1\. ミナト　2\. ユズ　3\. レン/);
      assert.equal(await page.isDisabled(`#recruitList button[data-level="want"][data-id="${s.id}"]`), false, '定員に達していても並べる');
      assert.equal(await page.isDisabled(`#recruitList button[data-level="interest"][data-id="${s.id}"]`), false, '興味ありは押せる');
      assert.match(await page.textContent(`[data-due-of="${s.id}"]`), /まで/);
      await setCapacity(2);
      assert.match(await page.textContent(`[data-want-of="${s.id}"]`), /ソラ、ミナト2\/2人（定員）/);
    });

    await step('募集を開催にすると、キャンセル待ちの人は並んだまま残り、管理者が繰り上げられる', async () => {
      const d = await D(), s = d.sessions.find((x) => x.name === '雪原の古城'), day = d.availDays[9];
      await page.click(`#recruitList button[data-hold="${s.id}"]`);
      await page.fill('#date', day);
      await page.click('#f button[type=submit]');
      await until((x, id) => { const t = x.sessions.find((y) => y.id === id); return t.status === '開催' && t.want.join() === 'ユズ,レン'; }, s.id);
      await tab('cal');
      await page.evaluate((k) => window.yoki.selectDay(k), day);
      await page.click(`#dayBody [data-promote="${s.id}"][data-name="ユズ"]`);
      await until((x, id) => { const t = x.sessions.find((y) => y.id === id); return t.members.includes('ユズ') && t.want.join() === 'レン'; }, s.id);
    });

    await step('調整中の卓を登録すると候補日を選ぶ窓が開き、候補日を出せる', async () => {
      const d = await D();
      await tab('cal');
      await page.click('#newSession');
      await page.fill('#name', 'e2eの日程調整');
      await page.click('#status label:has(input[value="調整中"])');
      await page.check('#membersBox input.m[value="ソラ"]');
      await page.fill('#winFrom', d.availDays[20]);
      await page.fill('#winTo', d.availDays[26]);
      await page.click('#f button[type=submit]');
      await page.waitForSelector('#pollModal:not([hidden])', { timeout: 15000 });
      const days = page.locator('#pollDays input.pdc');
      await days.nth(0).check();
      await days.nth(2).check();
      // 回答の締め切りを決めると、カードに出る
      await page.fill('#pollDue', d.availDays[19]);
      await page.click('#pollSend');
      await until((x, due) => { const s = x.sessions.find((y) => y.name === 'e2eの日程調整'); return !!s && s.candidates.length === 2 && s.pollDue === due; }, d.availDays[19]);
      const made = (await D()).sessions.find((s) => s.name === 'e2eの日程調整');
      await tab('recruit');
      assert.match(await page.textContent(`[data-poll-due-of="${made.id}"]`), /回答の締め切り .+まで/);
    });

    await step('日程調整に回答できる。カレンダーの「回答待ち」から、その卓のカードへ移る。答え終えると「募集・調整」の印が減る', async () => {
      const maze = (await D()).sessions.find((s) => s.name === '迷宮の底へ');
      const badge = async () => +((await page.textContent('#recruitCount')).replace(/\D/g, '') || 0);
      await tab('cal');
      const before = await badge();
      assert.ok(before > 0, '答えていない日程調整があれば、印に数が出る');
      await page.click('#notices button[data-tab="recruit"]:has-text("迷宮の底へ")');
      await page.waitForSelector(`#tab-recruit [data-card="${maze.id}"].ring-2`, { timeout: 15000 });
      const today = (await D()).today;
      const open = maze.candidates.filter((k) => k >= today && !(maze.votes[k] && maze.votes[k]['ひより']));
      assert.ok(open.length > 0, 'まだ答えていない候補日がある');
      // 予定表から入れる（答えていない日だけ）。そのあと1日を △ にする
      await page.click(`button[data-fill="${maze.id}"]`);
      await until((d, a) => a[1].every((k) => !!d.sessions.find((s) => s.id === a[0]).votes[k]?.['ひより']), [maze.id, open]);
      await page.click(`button[data-vote="△"][data-id="${maze.id}"][data-day="${open[0]}"]`);
      await until((d, a) => d.sessions.find((s) => s.id === a[0]).votes[a[1]]?.['ひより'] === '△', [maze.id, open[0]]);
      assert.equal(await page.locator(`button[data-fill="${maze.id}"]`).count(), 0, '答え終えたら「予定表から入れる」は消える');
      await page.waitForFunction((n) => +(document.querySelector('#recruitCount').textContent.replace(/\D/g, '') || 0) === n, before - 1, { timeout: 15000 });
    });

    await step('管理者は候補日から開催日を決められる', async () => {
      const s = (await D()).sessions.find((x) => x.name === 'e2eの日程調整');
      const day = s.candidates[0];
      await page.click(`#adjustList button[data-decide="${s.id}"][data-day="${day}"]`);
      await confirm();
      await until((d, a) => d.sessions.some((x) => x.id === a[0] && x.status === '開催' && x.date === a[1]), [s.id, day]);
    });

    await step('日付のメモを保存できる', async () => {
      const day = (await D()).availDays[3];
      await tab('cal');
      await page.evaluate((k) => window.yoki.selectDay(k), day);
      await page.fill('#dayNote', 'e2eのメモ');
      await page.click('#dayNoteSave');
      await until((d, k) => d.notes[k]?.text === 'e2eのメモ', day);
    });

    await step('日付のメモを期間で書ける。続く日には、始まりの日のメモが出て、そこから開いて直せる', async () => {
      const [from, mid, to] = (await D()).availDays.slice(30, 33);
      await page.evaluate((k) => window.yoki.selectDay(k), from);
      await page.fill('#dayNote', 'e2eの合宿');
      await page.fill('#dayNoteTo', to);
      await page.click('#dayNoteSave');
      await until((d, a) => d.notes[a[0]]?.text === 'e2eの合宿' && d.notes[a[0]]?.to === a[1], [from, to]);
      await page.evaluate((k) => window.yoki.selectDay(k), mid);
      assert.equal(await page.locator(`.cal .day[data-day="${mid}"] [data-note-from="${from}"]`).count(), 1, '続く日にもメモが出る');
      await page.click(`#dayBody button[data-open-note="${from}"]`);
      assert.equal(await page.inputValue('#dayNote'), 'e2eの合宿', '始まりの日が開く');
      assert.equal(await page.inputValue('#dayNoteTo'), to);
    });

    await step('カレンダー連携: 購読URLを作って読め、作り直すと前のURLは読めない。止められる', async () => {
      await tab('settings');
      await page.selectOption('#feedScope', 'all');
      await page.click('#feedCreate');
      await until((d) => d.calendar.feed?.scope === 'all');
      const url = await page.inputValue('#feedUrl');
      // 購読URLはログインせずに読むものなので、ブラウザの外から読む（前のURLの404が、画面のエラーに数えられないように）
      const ics = await (await fetch(url)).text();
      assert.match(ics, /^BEGIN:VCALENDAR/);
      assert.match(ics, /SUMMARY:連れて帰る/);
      await page.click('#feedRenew');
      await confirm();
      await until((d, u) => d.calendar.feed && d.calendar.feed.url !== u, url);
      assert.equal((await fetch(url)).status, 404, '作り直す前のURLは読めない');
      await page.click('#feedStop');
      await confirm();
      await until((d) => d.calendar.feed === null);
    });

    await step('カレンダー連携: 偽のGoogleと連携すると卓が書き込まれ、予定から × が入る。消した印は戻らない。外すと片付く', async () => {
      const fake = () => page.evaluate(() => fetch('/dev/google/state').then((r) => r.json()));
      await page.click('#googleLink');
      await page.waitForSelector('#googleForm', { timeout: 15000 });
      await until((d) => d.calendar.google?.email === 'dev@example.com');
      // 連携したら、返事のあとで卓を書き込む
      for (let i = 0; i < 30 && !Object.keys((await fake()).events).length; i++) await page.waitForTimeout(300);
      assert.ok(Object.values((await fake()).events).some((e) => e.summary === '連れて帰る'), 'ひよりの卓が書き込まれる');
      // 卓も印も無い日に、時間帯（19:00〜23:00）を埋める予定を入れて同期すると、× がGoogleの印として入る
      const d0 = await D();
      const day = d0.availDays.find((k) => !d0.booked[k]?.['ひより'] && !d0.avail[k]?.['ひより']);
      await page.evaluate(async (k) => {
        const at = (h) => new Date(k + 'T' + h + ':00+09:00').toISOString();
        await fetch('/dev/google/busy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ busy: [{ start: at('18:00'), end: at('23:30') }] }) });
      }, day);
      await page.click('#googleSync');
      await until((d, k) => d.avail[k]?.['ひより'] === '×' && (d.availGoogle[k] || []).includes('ひより'), day);
      // 本人が消すと、次に同期しても戻らない
      await tab('avail');
      await page.click(`#availTable button.mk[data-day="${day}"]`);
      await until((d, k) => !d.avail[k]?.['ひより'], day);
      await tab('settings');
      await Promise.all([page.waitForResponse((r) => r.url().endsWith('/syncGoogleNow')), page.click('#googleSync')]);
      assert.equal((await D()).avail[day]?.['ひより'], undefined, '消した日には入れない');
      // 外すと、書いた予定と連携を消す
      await page.click('#googleUnlink');
      await confirm();
      await until((d) => d.calendar.google === null);
      assert.deepEqual((await fake()).events, {});
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
      await page.fill('#memoText', 'e2eの予定メモ');
      await page.click('#memoSave');
      await until((d, k) => d.availNotes[k]?.['ひより']?.text === 'e2eの予定メモ', day);
    });

    await step('予定をまとめて入れられる', async () => {
      if (await page.isHidden('#availBulk')) await page.click('#foldBulk');
      await page.selectOption('#abMark', '×');
      await page.click('#abRun');
      await confirm();
      await until((d) => Object.values(d.avail).filter((m) => m['ひより'] === '×').length >= 10);
    });

    await step('まとめて入れるで、印を変えずにメモだけ入れられる', async () => {
      const [from, to] = [(await D()).availDays[40], (await D()).availDays[42]];
      await page.fill('#abFrom', from);
      await page.fill('#abTo', to);
      await page.selectOption('#abMark', 'none');
      await page.selectOption('#abNoteMode', 'set');
      await page.fill('#abNote', 'e2eの旅行');
      await page.uncheck('#abKeep');
      await page.click('#abRun');
      await confirm();
      await until((d, a) => [a[0], a[1]].every((k) => d.availNotes[k]?.['ひより']?.text === 'e2eの旅行'), [from, to]);
      await page.selectOption('#abNoteMode', '');
      await page.selectOption('#abMark', '×');
      await page.check('#abKeep');
    });

    await step('昼と夜に分けるグループでは、予定表の自分のマスが昼と夜に分かれ、時間帯ごとに印を入れられる', async () => {
      await admin('table');
      await page.click('#stDayParts');
      await until((d) => d.settings.dayParts === true);
      await main();
      await tab('avail');
      const [day, whole] = await page.evaluate(() => {
        const d = window.yoki.D;
        const k = d.availDays.find((x) => !(d.booked[x] || {})['ひより'] && d.availDays.indexOf(x) > 1);
        return [k, (d.avail[k] || {})['ひより'] || ''];
      });
      // 1日の印は、昼を押すと昼と夜に分かれ、昼だけが次の印になる
      const next = { '': '△', '△': '×', '×': '' };
      await page.click(`#availTable button.mk[data-day="${day}"][data-part="昼"]`);
      await until((d, a) => JSON.stringify((d.availParts[a[0]] || {})['ひより'] || ['', '']) === JSON.stringify([a[1], a[2]]), [day, next[whole], whole]);
      await page.click(`#availTable button.mk[data-day="${day}"][data-part="夜"]`);
      await until((d, a) => ((d.availParts[a[0]] || {})['ひより'] || ['', ''])[1] === a[1], [day, next[whole]]);
      // 分けるのをやめると、まとめた印（△）の1マスに戻る
      await admin('table');
      await page.click('#stDayParts');
      await until((d) => d.settings.dayParts === false);
      await main();
    });

    await step('管理画面: グループの中身をJSONとCSVで書き出せる', async () => {
      await admin('table');
      const save = async (sel) => {
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
        return [dl.suggestedFilename(), readFileSync(await dl.path(), 'utf8')];
      };
      const [jsonName, json] = await save('#exportJson');
      const x = JSON.parse(json);
      const n = await page.evaluate(() => window.yoki.D.sessions.length);
      assert.match(jsonName, /^yoki-.+\.json$/);
      assert.equal(x.format, 'yoki-group-export');
      assert.ok(x.sessions.length >= n);
      await page.waitForSelector('#exportMsg:has-text("書き出しました")');
      const [csvName, csv] = await save('#exportCsv');
      assert.match(csvName, /-sessions\.csv$/);
      assert.ok(csv.startsWith('\uFEFF"卓のID","名前"'));
      await main();
    });

    await step('管理画面: メンバーを足し、名前を変え、外せる', async () => {
      await admin('members');
      await page.click('#mclear');
      await page.fill('#mname', 'e2eメンバー');
      await page.click('#msave');
      await until((d) => d.members.some((m) => m.name === 'e2eメンバー'));
      await page.click('#memberTable tr[data-name="e2eメンバー"]');
      await page.fill('#mname', 'e2eメンバー（改）');
      await page.click('#msave');
      await until((d) => d.members.some((m) => m.name === 'e2eメンバー（改）'));
      await page.click('#mdel');
      await confirm();
      await until((d) => !d.members.some((m) => m.name.startsWith('e2eメンバー')));
    });

    await step('管理画面: 知らせのつまみ・接続テスト・グループの名前の変更ができる。Botが無ければそう出る', async () => {
      await admin('notify');
      // 手元にはBotのトークンが無いので、チャンネルは選べず、そのことを知らせる（サンプルのチャンネルへの接続テストはできる）
      assert.match(await page.textContent('#botState'), /Botをまだ設定していません/);
      assert.equal(await page.isDisabled('#stChannel'), true);
      const urge = (await D()).settings.urge;
      await page.locator('#stUrge').dispatchEvent('click');
      await until((d, v) => d.settings.urge === !v, urge);
      // Discordのイベント: 手元にはBotが無いので、入れようとしても断られる（サーバーが400を返すのは見込みどおりなので、そのエラーは数えない）
      const errorsBefore = errors.length;
      await page.click('#stEvents');
      await page.waitForFunction(() => /Botが設定されていません/.test(document.getElementById('evMsg')?.textContent ?? ''));
      assert.equal((await D()).settings.discordEvents, false);
      errors.splice(errorsBefore);
      // 送信記録は新しい10件までなので、件数ではなく、いちばん新しい記録が変わったかで見る
      const top = JSON.stringify((await D()).log[0] ?? null);
      await page.locator('#stTest').dispatchEvent('click');
      await until((d, t) => JSON.stringify(d.log[0] ?? null) !== t && d.log[0].kind === '接続テスト', top);
      await page.click('#setNav button[data-set="table"]');
      await page.fill('#stName', 'e2eのグループ');
      await page.click('#stNameSave');
      await confirm();
      await until((d) => d.title === 'e2eのグループ');
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
      // シナリオをまとめて付け替える（中止にした卓は一覧から外れるので、稼働中の卓で）
      const bring = (await D()).sessions.find((x) => x.name === '連れて帰る');
      const castle = (await D()).scenarios.find((x) => x.name === '雪原の古城').id;
      await page.check(`#matrix input.rowsel[data-id="${bring.id}"]`);
      await page.selectOption('#bulkAction', 'setScenario');
      await page.selectOption('#bulkScenario', castle);
      await page.click('#bulkRun');
      await confirm();
      await until((d, a) => d.sessions.find((x) => x.id === a[0])?.scenarioId === a[1], [bring.id, castle]);
    });

    await step('管理画面から予定の画面へ戻れる', async () => {
      await page.click('#toMain');
      await page.waitForURL('**/g/sample/');
      await page.waitForFunction(() => window.yoki && window.yoki.D, null, { timeout: 30000 });
      assert.equal(await page.isVisible('#adminLink'), true, '管理者には、右上に管理画面への入口が出る');
    });

    await step('「あなた」はログインした人で、ほかの人には切り替えられない', async () => {
      assert.equal(await page.textContent('#me'), 'ひより');
      assert.equal(await page.locator('select#me, #proxyBadge').count(), 0);
    });

    await step('設定: ほかのグループの卓を「他」として出すのを止めて、戻せる', async () => {
      await tab('settings');
      assert.equal(await page.isChecked('#stShareBusy'), true, 'はじめは出す');
      await page.click('#stShareBusy');
      await until((d) => d.me.shareBusy === false);
      await page.click('#stShareBusy');
      await until((d) => d.me.shareBusy === true);
      await tab('cal');
    });

    await step('「更新」で読み直せる', async () => {
      await page.click('#reload');
      await page.waitForFunction(() => /最新/.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
    });

    await step('グループを消せる。開いていたほかのタブには「見つかりません」と出る', async () => {
      const made = await page.evaluate(async () => {
        const r = await fetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guildId: 'dev-guild', title: 'e2eの消すグループ' }) });
        return r.json();
      });
      // 上の帯のグループの切り替えで、作ったグループへ移ると、読み込むデータも移ったグループのものになる
      await page.click('#groupMenuBtn');
      await page.click(`#groupMenu [data-group="${made.id}"]`);
      await page.waitForURL(`**/g/${made.id}/`);
      await until((d, t) => d && d.title === t, 'e2eの消すグループ');
      // 作ったばかりのグループには、はじめの3ステップが出る。今の段は「仲間を招く」だけで、Discordは任意。閉じると、開き直しても出ない
      await page.waitForSelector('#setupGuide:not([hidden]) [data-step="1"][data-state="now"]');
      assert.equal(await page.locator('#setupGuide [data-state="now"]').count(), 1, '今の段は1つだけ');
      assert.equal(await page.isVisible('#setupGuide [data-go="copy"]'), true, 'グループのURLを写せる');
      assert.equal(await page.isVisible('#helpNudge'), true, '準備が済むまでは、ヘルプに印が付く');
      await page.click('#setupGuide [data-go="close"]');
      await page.waitForSelector('#setupGuide', { state: 'hidden' });
      assert.equal(await page.isVisible('#helpNudge'), false, '閉じたら、ヘルプの印も消す');
      await page.reload();
      await page.waitForFunction((t) => window.yoki && window.yoki.D && window.yoki.D.title === t, 'e2eの消すグループ', { timeout: 30000 });
      assert.equal(await page.isVisible('#setupGuide'), false, '閉じたことを覚えている');
      // チャンネルを決めていないグループの「知らせ」では、チャンネルを表より先に開いて出す
      await page.click('#adminLink');
      await page.click('#setNav button[data-set="notify"]');
      await page.waitForSelector('[data-pane="notify"] > #chFold[open]:first-child');
      await page.click('#toMain');
      await page.waitForURL(`**/g/${made.id}/`);
      await page.click('#groupMenuBtn');
      assert.equal(await page.getAttribute(`#groupMenu [data-group="${made.id}"]`, 'aria-current'), 'page', '今のグループに印が付く');
      await page.click('#groupMenu [data-group="sample"]');
      await page.waitForURL('**/g/sample/');
      await until((d, t) => d && d.title === t, 'e2eのグループ');
      const other = await context.newPage();
      await other.goto(base + made.url.slice(1));
      await other.waitForFunction(() => window.yoki && window.yoki.D, null, { timeout: 30000 });
      await page.goto(base + made.url.slice(1) + 'admin/#danger');
      await page.waitForFunction(() => window.yoki && window.yoki.D, null, { timeout: 30000 });
      assert.equal(await page.isDisabled('#delGroup'), true, '名前を打つまでは押せない');
      await page.fill('#delConfirm', 'e2eの消すグループ');
      await page.click('#delGroup');
      await confirm();
      await page.waitForURL('**/?deleted=1');
      await other.click('#reload');
      await other.waitForSelector('#loading:not([hidden]) >> text=見つかりません', { timeout: 15000 });
      await other.close();
      await main();
    });

    await step('管理者でない人（ソラ）: 管理画面は403、入口も出ない。自分の名前と備考は直せる', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      const sora = await ctx.newPage();
      sora.on('pageerror', (e) => errors.push(e.message));
      await devLogin(sora, base, 'ソラ');
      assert.equal(await sora.isVisible('#adminLink'), false);
      assert.equal((await sora.goto(base + 'g/sample/admin/')).status(), 403);
      await sora.goto(base + 'g/sample/');
      await sora.waitForFunction(() => window.yoki && window.yoki.D, null, { timeout: 30000 });
      // 運営者でなければ、グループの切り替えに運営の管理画面は出ない（一覧を読み終えてから確かめる）
      await sora.click('#groupMenuBtn');
      await sora.waitForSelector('#groupMenu [data-group="sample"]');
      assert.equal(await sora.locator('#toOperator').count(), 0);
      await sora.keyboard.press('Escape');
      await sora.click('#meBtn');
      await sora.click('#toSettings');
      // 設定の画面が出てから確かめる（出る前なら、入口があっても見えない）
      await sora.waitForSelector('#meNote');
      assert.equal(await sora.isVisible('#adminEntry'), false);
      await sora.fill('#meNote', 'e2eの備考');
      await sora.click('#meSave');
      await sora.waitForFunction(() => window.yoki.D.members.find((m) => m.name === 'ソラ')?.note === 'e2eの備考', null, { timeout: 15000 });
      await ctx.close();
    });

    await step('運営の管理画面: グループの画面からも開ける。様子・グループ・利用者が見え、ログインを切って締め出し、戻し、消せる。新規登録の受付を止めて戻せる', async () => {
      // グループの画面では、上の帯のグループの切り替えから開く
      await page.goto(base + 'g/sample/');
      await page.waitForFunction(() => window.yoki && window.yoki.D, null, { timeout: 30000 });
      await page.click('#groupMenuBtn');
      await Promise.all([page.waitForURL('**/admin/**'), page.click('#toOperator')]);
      await page.waitForSelector('#opCounts .op-count', { timeout: 15000 });
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
      // 消す。利用者の一覧から消え、サンプルのグループのメンバーからも外れる（次のe2eは、作り直したサンプルとログインで戻る）
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
      // Discordのボタン: 手元にはBotが無いので、入れようとしても断られる（400は見込みどおりなので、そのエラーは数えない）
      assert.match(await page.textContent('#opButtons'), /付けていません/);
      const errorsBefore = errors.length;
      await page.click('#opButtonsToggle');
      await page.waitForSelector('#toast >> text=Botのトークンが無い', { timeout: 15000 });
      errors.splice(errorsBefore);
      // 運営者への知らせ: 止める・使うを切り替えられる。手元にはBotが無いので、試しに送ると断られる
      assert.match(await page.textContent('#opBotState'), /ありません/);
      await page.click('#opNoticeToggle');
      await page.waitForSelector('#opNotice >> text=止めています', { timeout: 15000 });
      await page.click('#opNoticeToggle');
      await page.waitForSelector('#opNoticeToggle[data-on="0"]', { timeout: 15000 });
      const errorsBeforeTest = errors.length;
      await page.click('#opNoticeTest');
      await page.waitForSelector('#toast >> text=DMを送れません', { timeout: 15000 });
      errors.splice(errorsBeforeTest);
      await main();
      // 開いた直後は、ブラウザの控え（消す前のデータ）が出ることがある。最新を読んで、ソラがメンバーから外れるのを待つ
      await until((d) => !d.members.some((m) => m.name === 'ソラ'));
    });

    await step('運営の管理画面: 規約の運営者・問い合わせ先・本文を直すと、/termsに出る。入口と設定の画面から開ける', async () => {
      await page.goto(base + 'admin/#legal');
      // 欄は画面を描いてから出るので、出るのも待つ
      await page.waitForFunction(() => document.getElementById('lgTerms')?.value.includes('本サービス'), null, { timeout: 15000 });
      assert.match(await page.textContent('#lgTermsState'), /既定の文/);
      await page.fill('#lgOperator', 'e2eの運営');
      await page.fill('#lgContact', 'https://example.com/contact');
      await page.fill('#lgTerms', '## e2eの決まり\n- 仲良く遊ぶ');
      await page.click('#opLegal button[type=submit]');
      await page.waitForSelector('#lgTermsState >> text=直した文', { timeout: 15000 });
      const doc = await context.newPage();
      await doc.goto(base + 'terms');
      assert.equal(await doc.textContent('h1'), '利用規約');
      assert.match(await doc.textContent('dl.who'), /e2eの運営/);
      assert.equal(await doc.getAttribute('dl.who a', 'href'), 'https://example.com/contact');
      assert.equal(await doc.textContent('article h2'), 'e2eの決まり');
      await Promise.all([doc.waitForURL('**/privacy'), doc.click('nav a[href="/privacy"]')]);
      assert.equal(await doc.textContent('h1'), 'プライバシーポリシー');
      await doc.close();
      // 既定の文に戻す（入力に入れて保存する）
      await page.click('#opLegal button[data-default="terms"]');
      await page.click('#opLegal button[type=submit]');
      await page.waitForSelector('#lgTermsState >> text=既定の文', { timeout: 15000 });
      await page.goto(base);
      // 入口はReactで描くので、描き終わるのを待つ
      await page.waitForSelector('.foot a[href="/terms"]', { timeout: 15000 });
      await main();
      await tab('settings');
      assert.equal(await page.isVisible('#tab-settings a[href="/privacy"]'), true, '設定の画面にリンクがある');
    });

    await step('運営の管理画面: 新しいバージョンがあれば「様子」で知らせ、「更新」で変わったことを見て更新を始められる（開発用の偽のGitHub）', async () => {
      await page.goto(base + 'admin/overview/');
      await page.waitForSelector('#opUpdateNotice', { timeout: 15000 });
      await Promise.all([page.waitForURL('**/admin/update/'), page.click('#opUpdateNotice')]);
      await page.waitForSelector('#opNotes li', { timeout: 15000 });
      assert.match(await page.textContent('#opUpdateState'), /新しいバージョンv\d+\.\d+\.\d+があります/);
      assert.equal(await page.isVisible('#opMigrations'), true, '表の変更を含むと知らせる');
      await page.click('#opUpdateStart');
      await confirm();
      await page.waitForSelector('#opRuns li', { timeout: 15000 });
      await main();
    });

    await step('Googleでログイン: 初めてはDiscord（開発用ログイン）と結びつけ、次からはGoogleだけで入れる。設定で外せる', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
      const g = await ctx.newPage();
      g.on('pageerror', (e) => errors.push(e.message));
      await g.goto(base);
      await Promise.all([g.waitForURL('**/?login=google-new'), g.click('#googleLoginBtn')]);
      assert.match(await g.textContent('#notice'), /初めてのGoogleアカウント/);
      // お知らせは /api/me を待たずに出るので、ログインの部品が出るまで待ってから数える
      await g.waitForSelector('#devForm');
      assert.equal(await g.locator('#googleLoginBtn').count(), 0, '結びつけを待つあいだは、Googleのボタンを出さない');
      assert.equal(await g.locator('#devForm input[name=link_google]').count(), 1, '結びつけるためのログインに印を付ける');
      await g.selectOption('#devAs', 'ひより');
      await Promise.all([g.waitForURL('**/?login=google-linked'), g.click('#devForm button')]);
      // ログアウトで、その人のグループの控えを消す。見た目の設定（端末の控え）は残す
      await g.goto(base + 'g/sample/');
      await g.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith('taku.cache:')));
      await g.evaluate(() => localStorage.setItem('taku.font', 'm'));
      await g.goto(base);
      await Promise.all([g.waitForURL(base), g.click('form[action="/auth/logout"] button')]);
      const kept = await g.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('taku.')));
      assert.equal(kept.some((k) => k.startsWith('taku.cache:')), false, 'ログアウトでグループの控えを消す');
      assert.equal(kept.includes('taku.font'), true, '端末の控えは残す');
      await g.waitForSelector('#devForm');
      assert.equal(await g.locator('#devForm input[name=link_google]').count(), 0, 'ふだんのログインには印を付けない');
      await Promise.all([g.waitForURL((u) => u.pathname === '/' && !u.search), g.click('#googleLoginBtn')]);
      await g.waitForSelector('#groups');
      await g.goto(base + 'g/sample/settings/');
      await g.waitForSelector('#googleLoginEmail');
      await g.click('#googleLoginUnlink');
      await g.click('#confirmOk');
      await g.waitForSelector('#googleLoginLink');
      await ctx.close();
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
