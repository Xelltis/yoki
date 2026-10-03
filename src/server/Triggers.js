/* ---------------------------------------------------------
 * メニューとトリガー
 * --------------------------------------------------------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('卓予定')
    .addItem('ウェブアプリの URL を表示', 'showWebAppUrl')
    .addItem('ウェブアプリの合言葉を設定…', 'setWebPassword')
    .addItem('管理者の合言葉を設定…', 'setAdminPasswordFromSheet')
    .addItem('表示を更新', 'refreshAll')
    .addSeparator()
    .addItem('明日の卓を今すぐ Discord に送る', 'notifyTomorrowNow')
    .addItem('Discord 接続テスト', 'testDiscord')
    .addItem('自動通知を設定（毎時の見回り）', 'installTriggers')
    .addItem('自動通知を解除', 'removeTriggers')
    .addSeparator()
    .addItem('初期設定（シートを作る）', 'setup')
    .addItem('サンプルデータを入れる', 'seedSample')
    .addToUi();

  try {
    const ss = ss_();
    if (!ss.getSheetByName(SHEET.SESSIONS)) return;
    const ctx = loadContext_(ss);
    if (isOn_(ctx.settings['開いたときに更新'])) refreshAll_(ctx);
    toastUpcoming_(ctx);
  } catch (err) {
    Logger.log('onOpen: ' + err);
  }
}

function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    const name = sh.getName();
    const ss = sh.getParent();
    if (name === SHEET.CALENDAR) {
      if (e.range.getRow() === 2 && e.range.getColumn() === 2) renderCalendar_(loadContext_(ss));
      return;
    }
    if ([SHEET.SESSIONS, SHEET.MEMBERS, SHEET.AVAIL, SHEET.SETTINGS].indexOf(name) < 0) return;
    const ctx = loadContext_(ss);
    if (!isOn_(ctx.settings['編集時に自動更新'])) return;
    if (name === SHEET.AVAIL) {
      fixAvailCell_(ctx, e.range);
      renderCalendar_(ctx);
    } else {
      refreshAll_(ctx);
    }
  } catch (err) {
    Logger.log('onEdit: ' + err);
  }
}

/** 初期設定。シートを作り、表示を組む。何度実行しても既存データは消えない */
function setup() {
  const ss = ss_();
  rememberSpreadsheet_(ss);
  ensureSheets_(ss);
  try { ensureRefreshTrigger_(); } catch (err) { Logger.log('setup: ' + err); }
  refreshAll_(loadContext_(ss));
  SpreadsheetApp.getUi().alert(
    '初期設定が終わりました。\n\n' +
    '1. 「メンバー」シートに名前を入れる\n' +
    '2. ウェブアプリとして公開し（デプロイ → 新しいデプロイ → ウェブアプリ）、その画面の「登録」タブで卓を登録する\n' +
    '3. Discord に流すなら「設定」シートに Webhook URL を貼る\n' +
    '4. 開催前の知らせ（開催前の知らせ）を自動で送るなら「卓予定 → 自動通知を設定」を実行する'
  );
}

/** 表示（カレンダー・一覧・管理・都合）を作り直す */
function refreshAll() {
  const ss = ss_();
  rememberSpreadsheet_(ss);
  ensureSheets_(ss);
  refreshAll_(loadContext_(ss));
  ss.toast('表示を更新しました', '卓予定', 3);
}

/** シートのメニュー: 毎日の自動通知を、設定した時刻に登録する（実行した人のアカウントで走る） */
function installTriggers() {
  const ss = ss_();
  rememberSpreadsheet_(ss);
  ensureSheets_(ss);
  const r = installTriggers_(ss, userEmail_() || '（不明）');
  SpreadsheetApp.getUi().alert(r.message);
}

/** シートのメニュー: 自動通知を止める（自分が登録した分だけ） */
function removeTriggers() {
  const r = removeTriggers_(ss_());
  SpreadsheetApp.getUi().alert(r.message);
}

/**
 * 自動通知のトリガーは見回り。今日が開催前の知らせの日（開催日の N 日前）の卓のうち、送る時刻が来たものを送る。
 * 日と時刻はシートから毎回読むので、変えてもトリガーを作り直さなくてよい。
 * 間隔は毎時。「開始直前の知らせ」が ON のときだけ 5 分ごとにする（分きざみで送るため）
 */
function installTriggers_(ss, who) {
  const st = getSettings_(ss);
  const hour = baseNotifyHour_(st), days = baseNotifyDays_(st);
  createNotifyTrigger_(notifyTriggerMode_(st));
  ensureRefreshTrigger_();
  const stamp = who + ' / ' + fmtDateTime_(new Date());
  setSetting_(ss, '自動通知の設定者', stamp);
  return { ok: true, hour: hour, days: days, setter: stamp, message: '開催前の知らせを有効にしました。開催日の' + notifyWhenText_(days, hour) + 'に送ります（シリーズで変えた卓はその日時）。設定者: ' + stamp };
}

const NOTIFY_TRIGGER_KEY = 'NOTIFY_TRIGGER';

/** 見回りの間隔。「開始直前の知らせ」が ON なら 5 分ごと、そうでなければ毎時 */
function notifyTriggerMode_(st) { return isOn_(st && st[SOON_KEY]) ? 'min5' : 'hourly'; }

/** 見回りのトリガーを作り直す。今ある dailyNotify のトリガーは消す */
function createNotifyTrigger_(mode) {
  deleteTriggersOf_('dailyNotify');
  const b = ScriptApp.newTrigger('dailyNotify').timeBased();
  if (mode === 'min5') b.everyMinutes(SOON_PATROL_MIN).create(); else b.everyHours(1).create();
  try { PropertiesService.getScriptProperties().setProperty(NOTIFY_TRIGGER_KEY, mode); } catch (err) { Logger.log('createNotifyTrigger_: ' + err); }
}

/**
 * 見回りのトリガーを設定に合う間隔に直す。自動通知を有効にしていなければ（トリガーが無ければ）何もしない。
 * 旧い版の「毎日 1 回」のトリガーもここで置き換わる。シートを整え直すときと、見回りのたびに呼ぶ
 */
function ensureNotifyTrigger_(ss, st) {
  try {
    const props = PropertiesService.getScriptProperties();
    const mode = notifyTriggerMode_(st || getSettings_(ss));
    if (props.getProperty(NOTIFY_TRIGGER_KEY) === mode) return false;
    if (!hasTrigger_('dailyNotify')) { props.setProperty(NOTIFY_TRIGGER_KEY, mode); return false; }
    createNotifyTrigger_(mode);
    return true;
  } catch (err) {
    Logger.log('ensureNotifyTrigger_: ' + err);   // シートを開いたときの簡易トリガーではトリガーを触れない。次の書き込みでやり直す
    return false;
  }
}

function removeTriggers_(ss) {
  const n = deleteTriggersOf_('dailyNotify');
  const setter = String(getSettings_(ss)['自動通知の設定者'] || '').trim();
  if (n > 0) {
    setSetting_(ss, '自動通知の設定者', '');
    return { ok: true, removed: n, message: '自動通知を解除しました。' };
  }
  if (setter) {
    return { ok: false, removed: 0, message: 'この自動通知は「' + setter + '」が別のアカウントで設定したものです。解除はその人がシートのメニュー「卓予定 → 自動通知を解除」から行ってください。' };
  }
  return { ok: true, removed: 0, message: '自動通知は設定されていません。' };
}

/** 自分（実行アカウント）に dailyNotify のトリガーがあるか */
function hasMyTrigger_() {
  return hasTrigger_('dailyNotify');
}

function hasTrigger_(fnName) {
  try {
    return ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === fnName);
  } catch (err) {
    return false;
  }
}

/* ---------------------------------------------------------
 * 表示シートの描き直しは「あとで」
 *   ウェブアプリからの書き込みはデータ行だけを書き、表示シート（カレンダー・一覧・管理・都合）の
 *   描き直しは印を付けておくだけにする。描き直しは 10 分おきのトリガーと、シートを開いたときに走る。
 *   描き直しは 1 回 300 回前後のシート操作なので、これを毎回やると登録が十数秒かかる。
 * --------------------------------------------------------- */

const DIRTY_KEY = 'VIEWS_DIRTY';

/** 表示シートを描き直す必要がある印を付け、10 分おきのトリガーが無ければ作る */
function markDirty_() {
  try {
    PropertiesService.getScriptProperties().setProperty(DIRTY_KEY, '1');
    ensureRefreshTrigger_();
  } catch (err) {
    Logger.log('markDirty_: ' + err);
  }
}

function clearDirty_() {
  try { PropertiesService.getScriptProperties().deleteProperty(DIRTY_KEY); } catch (err) { Logger.log('clearDirty_: ' + err); }
}

function ensureRefreshTrigger_() {
  if (hasTrigger_('refreshIfDirty')) return false;
  ScriptApp.newTrigger('refreshIfDirty').timeBased().everyMinutes(10).create();
  return true;
}

/** 10 分おきのトリガーから呼ばれる。印が付いているときだけ表示シートを描き直す */
function refreshIfDirty() {
  let dirty = false;
  try { dirty = PropertiesService.getScriptProperties().getProperty(DIRTY_KEY) === '1'; } catch (err) { dirty = true; }
  if (!dirty) return false;
  return withLock_(() => { refreshAll_(loadContext_(ss_())); return true; }, 5000, true) || false;
}

/**
 * シートの列や入力規則の版。列を足したり状態の一覧を変えたりしたら上げる。
 * ウェブアプリからの書き込みは、この版が控えと違えば先にシートを整え直す（状態のドロップダウンに新しい値が無くて弾かれるのを防ぐ）
 */
const SCHEMA_VERSION = '2026-09-26';
const SCHEMA_KEY = 'SCHEMA_VERSION';

/** シートが揃っていて版が新しいかを確かめる。無い・古いなら整え直す。それ以外は何もしない */
function ensureReady_(ss) {
  let stale = false;
  try { stale = PropertiesService.getScriptProperties().getProperty(SCHEMA_KEY) !== SCHEMA_VERSION; } catch (err) { stale = true; }
  if (stale || !ss.getSheetByName(SHEET.SESSIONS) || !ss.getSheetByName(SHEET.NOTES) || !ss.getSheetByName(SHEET.AVAIL_NOTES) || !ss.getSheetByName(SHEET.POLL) || !ss.getSheetByName(SHEET.SERIES_NOTIFY)) ensureSheets_(ss);
}

/** 旧い版の「予定」を「開催」に書き換える。入力規則を当て直す前に呼ぶ（規則に無い値が残ると弾かれるため） */
function migrateOldStatus_(ses) {
  const last = ses.getLastRow();
  if (last < 2) return 0;
  const rng = ses.getRange(2, SC.STATUS + 1, last - 1, 1);
  const values = rng.getValues();
  let n = 0;
  const next = values.map(r => {
    const v = String(r[0] || '').trim();
    if (OLD_STATUS[v]) { n++; return [OLD_STATUS[v]]; }
    return [r[0]];
  });
  if (n) rng.setValues(next);
  return n;
}

function deleteTriggersOf_(fnName) {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === fnName) { ScriptApp.deleteTrigger(t); n++; }
  });
  return n;
}
