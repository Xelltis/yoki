/* =========================================================
 * 卓予定管理 — TRPG セッションスケジューラ（Google Apps Script）
 *
 * スプレッドシートに紐付けて使う。導入手順と使い方は
 * docs/卓予定管理_構想.md にある。
 *
 * シート構成
 *   カレンダー … 月ごとの格子。卓の予定と、参加者全員の都合がいい日を色で示す
 *   一覧       … いま動いている卓（募集・調整中・開催）を開催日順に並べる
 *   管理       … 稼働中の卓数と、卓×メンバーの参加表
 *   都合       … 日付×メンバーの△×（空欄は参加できる）。その日の卓に入っている人は「参」「GM」が自動で入る
 *   セッション … 卓のデータ本体（ウェブアプリの「登録」タブが書く。直接編集も可）
 *   メンバー   … 名前と Discord のユーザーID
 *   設定       … Webhook URL、通知時刻など
 *   日付メモ   … 日付ごとのメモ（卓と関係のない予定を書く）
 *   予定メモ   … メンバーの予定の 1 マス（日付×名前）に添えるメモ。○△×とは別
 *   日程調整   … 調整中の卓の候補日ごとの回答（◯ / ×）。全員が答えたら GM に知らせ、GM が候補日から開催日を選ぶ
 *   通知ログ   … Discord へ送った記録
 *
 * 登録・編集と都合の入力はブラウザ用の画面（Console.html）で行う。doGet() で出すので、ウェブアプリとしてデプロイして使う。
 * 画面は全員共通の合言葉で守る。一度通ったブラウザは「証」を覚え、合言葉を変えるまで二度と求めない。
 * ========================================================= */

const SHEET = {
  SETTINGS: '設定', MEMBERS: 'メンバー', SESSIONS: 'セッション',
  CALENDAR: 'カレンダー', LIST: '一覧', AVAIL: '都合', ADMIN: '管理', LOG: '通知ログ', NOTES: '日付メモ', AVAIL_NOTES: '予定メモ', POLL: '日程調整',
  SERIES_NOTIFY: 'シリーズ通知',
};
/**
 * 卓の状態。募集 → 調整中 → 開催 → 終了 と進み、中止は別。
 *   募集   … 参加者を集めている。開催日ではなく、開きたい期間（10/3〜10/17 のような日の幅）を持つ。参加希望・興味ありを付けられる
 *   調整中 … 参加者は決まり、開催日を選んでいる。候補の期間（◯月◯日〜◯日のどこか）を持つ。募集のときの参加希望の人は、このときに参加者へ移る
 *   開催   … 開催日が決まった。日程調整で決まったときも、募集から直接ここに来たときも、参加希望の人は参加者へ移る
 *   終了   … 開催日が過ぎた（自動で変わる）
 * 旧い版にあった「予定」は「開催」に読み替える（シートの値も版を上げたときに書き換える）
 */
const STATUS = { RECRUIT: '募集', ADJUSTING: '調整中', HELD: '開催', DONE: '終了', CANCELED: '中止' };
const STATUS_LIST = [STATUS.RECRUIT, STATUS.ADJUSTING, STATUS.HELD, STATUS.DONE, STATUS.CANCELED];
const ACTIVE = [STATUS.RECRUIT, STATUS.ADJUSTING, STATUS.HELD];   // 稼働中。一覧と「卓予定」に出る
const DATED = [STATUS.HELD];                                      // 開催日が要る。都合表に「参」「GM」が付く
const PROMOTE = [STATUS.ADJUSTING, STATUS.HELD];                  // この状態になったら、参加希望の人を参加者に移す
const OLD_STATUS = { '予定': STATUS.HELD };                        // 旧い版の値の読み替え
const HALVES = ['前期', '後期'];

const SESSION_HEADER = ['ID', '卓の名前', 'GM', '参加者', '開催日', '開始', '終了', '状態', '場所 / URL', 'メモ', '登録者', '更新日時', '開催前の知らせ', '募集時期（旧）', '参加希望', '興味あり', '参加確認', 'シリーズ', '期間', '候補日', 'シリーズ最終日', '期間前の催促', '開始直前の知らせ'];
const SC = { ID: 0, NAME: 1, GM: 2, MEMBERS: 3, DATE: 4, START: 5, END: 6, STATUS: 7, PLACE: 8, MEMO: 9, EDITOR: 10, UPDATED: 11, NOTIFIED: 12, PERIOD: 13, WANT: 14, INTEREST: 15, ASK: 16, SERIES: 17, WINDOW: 18, CANDS: 19, SERIES_END: 20, URGED: 21, SOON: 22 };
const MEMBER_HEADER = ['名前', 'Discord ユーザーID', '備考'];
const LOG_HEADER = ['日時', '種別', '対象', '結果'];
const NOTE_HEADER = ['日付', 'メモ', '書いた人', '更新日時'];
const AVAIL_NOTE_HEADER = ['日付', '名前', 'メモ', '更新日時'];
const AVAIL_NOTE_MAX = 200;
const POLL_HEADER = ['卓ID', '日付', '名前', '回答', '更新日時'];
/** シリーズごとの通知。送り先（Webhook）、基本のチャンネルにも送るか、開催前の知らせの日と時刻（空なら基本と同じ） */
const SERIES_NOTIFY_HEADER = ['シリーズ', 'Discord Webhook URL', '基本のチャンネルにも送る', '開催前の知らせ（何日前）', '開催前の知らせ（時刻）', '更新日時'];
/** 旧い版の見出し → いまの見出し（シリーズ通知シートと設定シート） */
const OLD_NOTIFY_KEYS = {
  '前日通知の時刻': '開催前の知らせ（時刻）',
  '事前通知の時刻': '開催前の知らせ（時刻）',
  '事前通知の日（何日前）': '開催前の知らせ（何日前）',
  '事前通知の Webhook URL': '開催前の知らせの Webhook URL',
  '開始前の知らせ': '開始直前の知らせ',
  '開始前の分': '開始直前の分',
};
const NOTIFY_DAYS_KEY = '開催前の知らせ（何日前）';
const NOTIFY_HOUR_KEY = '開催前の知らせ（時刻）';
/** 開催前の知らせは開催日の何日前まで遡れるか */
const NOTIFY_DAYS_MAX = 30;
/** 期間前の催促（募集中・調整中の卓の期間が明日から）と、開始直前の知らせ */
const URGE_KEY = '期間前の催促';
const SOON_KEY = '開始直前の知らせ';
const SOON_MIN_KEY = '開始直前の分';
/** 開始直前の知らせを出すときの見回りの間隔（分）と、開始を過ぎてから送らなくなるまでの猶予（分） */
const SOON_PATROL_MIN = 5;
const SOON_LATE_MIN = 15;
const POLL_MARKS = ['◯', '×'];
const POLL_MAX_DATES = 20;
const MARKS = ['△', '×'];   // 空欄 = 参加できる。旧い「○」は空欄として読む
const BOOKED_MARKS = ['参', 'GM'];   // その日の卓に入っている人。都合表が自動で書く
const TARGET_ALL = '全員';
const TARGET_NONE = '（なし）';
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const CAL_COLS = 7;

const COLOR = {
  HEAD: '#e8eaed', TODAY: '#fff2cc', SESSION: '#dbe9ff', OK: '#b7e1a1', SOFT: '#e2f0d9',
  OUT: '#f3f3f3', WEEKEND: '#f7f7f7', WARN: '#f8cbad', SOON: '#ffe699', PAST: '#d9d9d9',
  ACCENT: '#4a86e8', WHITE: '#ffffff', GM: '#fce5cd', MARK: '#d9ead3',
};

const DEFAULT_SETTINGS = [
  ['Discord Webhook URL', '', 'Discord のチャンネル設定 → 連携サービス → ウェブフック で作った URL を貼る'],
  ['開催前の知らせ（時刻）', 20, '0〜23。この時刻台に送る（基本）。シリーズごとの値は「シリーズ通知」シート。メニュー「自動通知を設定」で有効になる'],
  ['登録時にDiscordへ通知', 'ON', 'ON / OFF。予定の登録・変更をその場で Discord に流す'],
  ['カレンダーの表示月数', 2, '今月から何か月分を描くか（1〜12）'],
  ['都合表の日数', 60, '今日から何日分の行を「都合」シートに作るか（7〜366）'],
  ['過ぎた卓を自動で終了', 'ON', 'ON / OFF。開催日を過ぎた卓を「終了」にする。カレンダーには残る'],
  ['編集時に自動更新', 'ON', 'ON / OFF。セッション・メンバー・都合を直したら表示を作り直す'],
  ['開いたときに更新', 'ON', 'ON / OFF。ファイルを開いたときに表示を作り直す'],
  ['自動通知の設定者', '', '（自動で書かれる）「自動通知を設定」を実行した人と日時'],
  ['開催前の知らせ（何日前）', 1, '0〜30。開催日の何日前に送るか（基本）。1 なら前日、0 なら当日。シリーズごとの値は「シリーズ通知」シート'],
  ['開催前の知らせの Webhook URL', '', '開催前の知らせだけを別のチャンネルに送るときの URL。空なら基本の Discord Webhook URL へ送る'],
  ['募集の Webhook URL', '', '募集の知らせ（状態が「募集」の卓の登録・変更・削除・案内と、興味ありの人への参加確認）だけを別のチャンネルに送るときの URL。空なら基本へ送る'],
  ['期間前の催促', 'ON', 'ON / OFF。募集中・調整中の卓の期間が明日から始まるとき、GM に知らせる。送る時刻は開催前の知らせ（時刻）'],
  ['開始直前の知らせ', 'OFF', 'ON / OFF。卓の当日、開始時刻の少し前に GM と参加者へ知らせる。ON にすると見回りが 5 分ごとになる'],
  ['開始直前の分', 30, '5〜720。開始の何分前に知らせるか。5 分ごとの見回りで送るので、指定した時刻より少し遅れることがある'],
  ['管理者', '', '管理者の名前。「、」区切り。管理者の合言葉を通した人が、そのとき選んでいた名前で足されます'],
];
/** 知らせの種類ごとの送り先。空なら基本の Discord Webhook URL */
const KIND_WEBHOOK = {
  remind: { key: '開催前の知らせの Webhook URL', label: '開催前の知らせのチャンネル' },
  recruit: { key: '募集の Webhook URL', label: '募集のチャンネル' },
};

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

/* ---------------------------------------------------------
 * 通知
 * --------------------------------------------------------- */

/**
 * 毎時のトリガーから呼ばれる。今日が開催前の知らせの日の卓のうち、送る時刻が来たものを Discord へ送る。送ったときだけ表示を作り直す。
 * トリガーの e.hour は UTC なので使わず、スクリプトの時刻で見る。エディタから手で走らせたとき（e なし）は時刻を問わず送る。
 * テストでは e.testHour で時刻を渡す
 */
function dailyNotify(e) {
  const hour = e && typeof e.testHour === 'number' ? e.testHour : (e && e.triggerUid ? new Date().getHours() : undefined);
  withLock_(() => {
    const ss = ss_();
    const ctx = loadContext_(ss);
    if (e && e.testNow) ctx.now = new Date(e.testNow);   // テストから「いま」を渡す
    sendTomorrow_(ctx, false, hour);
    sendUrge_(ctx, hour);
    sendStartingSoon_(ctx);
    if (ctx.sentCount) refreshAll_(loadContext_(ss));
    ensureNotifyTrigger_(ss, ctx.settings);   // 設定シートを直に書き換えられたときも、次の見回りで間隔が直る
  }, LOCK_WAIT_MS, true);
}

/** 基本の開催前の知らせ（何日前）と時刻。「設定」シートの値 */
function baseNotifyDays_(st) { return clampInt_(st[NOTIFY_DAYS_KEY], 0, NOTIFY_DAYS_MAX, 1); }
function baseNotifyHour_(st) { return clampInt_(st[NOTIFY_HOUR_KEY], 0, 23, 20); }
/** 卓の開催前の知らせ（何日前）と時刻。シリーズに値があればそれ、無ければ基本 */
function notifyDaysOf_(ctx, s) {
  const sn = s.series && ctx.seriesNotify ? ctx.seriesNotify[s.series] : null;
  if (sn && sn.days !== null && sn.days !== undefined) return sn.days;
  return baseNotifyDays_(ctx.settings);
}
function notifyHourOf_(ctx, s) {
  const sn = s.series && ctx.seriesNotify ? ctx.seriesNotify[s.series] : null;
  if (sn && sn.hour !== null && sn.hour !== undefined) return sn.hour;
  return baseNotifyHour_(ctx.settings);
}
/** 開催前の知らせを送る日（yyyy-mm-dd）。開催日の無い卓は空 */
function notifyYmdOf_(ctx, s) { return s.date ? ymd_(addDays_(s.date, -notifyDaysOf_(ctx, s))) : ''; }
/** 「前日の 20 時台」「3 日前の 9 時台」「当日の 12 時台」 */
function notifyWhenText_(days, hour) { return (days === 0 ? '当日' : days === 1 ? '前日' : days + ' 日前') + 'の ' + hour + ' 時台'; }
/** 開催前の知らせの見出し。開催日まで何日あるかで言い分ける */
function aheadText_(n) { return n <= 0 ? '今日' : n === 1 ? '明日' : n === 2 ? 'あさって' : n + ' 日後'; }

/** 開始の何分前に知らせるか。「設定」シートの値 */
function soonMinutes_(st) { return clampInt_(st[SOON_MIN_KEY], 5, 720, 30); }
/** 'HH:MM' を 0 時からの分にする。読めなければ null */
function minutesOfTime_(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/**
 * 期間前の催促。募集中・調整中のまま、期間の始まりが明日に迫った卓を GM に知らせる。
 * 「設定」の「期間前の催促」が ON のときだけ。送る時刻は開催前の知らせ（時刻）（シリーズで変えていればその時刻）。
 * 送った卓は「期間前の催促」の列に日時が入り、期間を変えるまで送り直さない
 */
function sendUrge_(ctx, hour) {
  if (!isOn_(ctx.settings[URGE_KEY])) return 0;
  const today = ymd_(ctx.now);
  const due = ctx.sessions.filter(s => {
    if (s.status !== STATUS.RECRUIT && s.status !== STATUS.ADJUSTING) return false;
    if (!s.windowFrom || s.urged) return false;
    const from = toDate_(s.windowFrom);
    if (!from || ymd_(addDays_(from, -1)) !== today) return false;
    return hour === undefined || notifyHourOf_(ctx, s) <= hour;
  });
  if (!due.length) return 0;
  const sh = ctx.ss.getSheetByName(SHEET.SESSIONS);
  const stamp = fmtDateTime_(new Date());
  let sent = 0;
  due.forEach(s => {
    const targets = sessionTargets_(ctx, s);
    if (!targets.length) { appendLog_(ctx.ss, URGE_KEY, s.name, '送らず: Discord Webhook URL が空'); return; }
    const gm = ctx.memberByName[s.gm];
    const mention = gm && gm.discordId ? ' <@' + gm.discordId + '>' : '';
    const head = s.status === STATUS.RECRUIT
      ? '⏳ 明日から「' + s.name + '」の募集の期間です。まだ参加者を集めている途中です。'
      : '⏳ 明日から「' + s.name + '」の候補の期間です。まだ開催日が決まっていません。';
    const ok = postToTargets_(ctx, { content: head + mention + recruitLink_(s), embeds: [sessionEmbed_(ctx, s)] }, URGE_KEY, s.name, targets);
    if (ok) { sh.getRange(s.row, SC.URGED + 1).setValue(stamp); sent++; }
  });
  return sent;
}

/**
 * 開始直前の知らせ。今日の卓の開始時刻が近づいたら、GM と参加者に知らせる。
 * 「設定」の「開始直前の知らせ」が ON で、開始時刻の入った「開催」の卓だけ。見回りは 5 分ごとなので、
 * 指定した時刻を過ぎた最初の見回りで送る（少し遅れて届く）。開始を大きく過ぎた卓には送らない。
 * 送った卓は「開始直前の知らせ」の列に日時が入り、開催日か開始時刻を変えるまで送り直さない
 */
function sendStartingSoon_(ctx) {
  if (!isOn_(ctx.settings[SOON_KEY])) return 0;
  const today = ymd_(ctx.now);
  const nowMin = ctx.now.getHours() * 60 + ctx.now.getMinutes();
  const lead = soonMinutes_(ctx.settings);
  const due = [];
  ctx.sessions.forEach(s => {
    if (DATED.indexOf(s.status) < 0 || s.ymd !== today || s.soon) return;
    const t = minutesOfTime_(s.start);
    if (t === null) return;
    const left = t - nowMin;
    if (left <= lead && left > -SOON_LATE_MIN) due.push({ s: s, left: left });
  });
  if (!due.length) return 0;
  const sh = ctx.ss.getSheetByName(SHEET.SESSIONS);
  const stamp = fmtDateTime_(new Date());
  let sent = 0;
  due.forEach(d => {
    const s = d.s;
    const targets = sessionTargets_(ctx, s, 'remind');
    if (!targets.length) { appendLog_(ctx.ss, SOON_KEY, s.name, '送らず: Discord Webhook URL が空'); return; }
    const mentions = mentionsOf_(ctx, [s]);
    const head = d.left <= 0 ? '⏰ まもなく「' + s.name + '」が始まります。' : '⏰ あと ' + d.left + ' 分で「' + s.name + '」が始まります。';
    const ok = postToTargets_(ctx, { content: head + (mentions ? ' ' + mentions : ''), embeds: [sessionEmbed_(ctx, s)] }, SOON_KEY, s.name, targets);
    if (ok) { sh.getRange(s.row, SC.SOON + 1).setValue(stamp); sent++; }
  });
  return sent;
}

/** 見回りの「送らず」の記録は、同じ日・同じ時刻台では 1 回だけ残す（5 分ごとの見回りで通知ログが埋まらないように） */
function loggedThisHour_(key) {
  try {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('SKIP_LOG_AT') === key) return true;
    props.setProperty('SKIP_LOG_AT', key);
    return false;
  } catch (err) {
    return false;
  }
}

/** メニューから手で送る。通知済みでも送り直す */
function notifyTomorrowNow() {
  const ss = ss_();
  const ctx = loadContext_(ss);
  const result = sendTomorrow_(ctx, true);
  refreshAll_(loadContext_(ss));
  SpreadsheetApp.getUi().alert(result);
}

/**
 * 開催前の知らせを送る。見回り（force なし）は、今日が開催前の知らせの日（開催日の N 日前）の卓を送る。
 * hour を渡すと、送る時刻（シリーズの時刻か基本の時刻）がその時刻までの卓だけを送る（毎時の見回り）。
 * force はメニューの「明日の卓を今すぐ Discord に送る」。明日の卓を、通知済みでも送り直す。
 * 送り先と「あと何日」ごとに 1 通にまとめる（シリーズのチャンネルと基本のチャンネル）。どれか 1 か所に届いた卓に通知済みの印を付ける。
 * 見回りでは「送らず」の記録を基本の時刻のときだけ残す（毎時残すと通知ログが埋まるため）
 */
function sendTomorrow_(ctx, force, hour) {
  ctx.sentCount = 0;
  const today = ymd_(ctx.now);
  const tomorrow = ymd_(addDays_(ctx.now, 1));
  const baseHour = baseNotifyHour_(ctx.settings);
  const quiet = !force && hour !== undefined && hour !== baseHour;
  const kind = force ? '開催前の知らせ（手動）' : '開催前の知らせ';
  const dated = ctx.sessions.filter(s => DATED.indexOf(s.status) >= 0 && s.date);
  const planned = force ? dated.filter(s => s.ymd === tomorrow) : dated.filter(s => notifyYmdOf_(ctx, s) === today);
  const due = planned.filter(s => (force || !s.notified) && (force || hour === undefined || notifyHourOf_(ctx, s) <= hour));
  const what = force ? '明日の卓' : '今日が開催前の知らせの日の卓';
  if (due.length === 0) {
    const waiting = planned.filter(s => !s.notified);
    const why = !planned.length ? (force ? '明日（' + tomorrow + '）の卓なし' : '今日（' + today + '）が開催前の知らせの日の卓なし') : waiting.length ? what + 'はまだ送る時刻ではない' : what + ' ' + planned.length + ' 件はすべて送信済み';
    if (!quiet && !(waiting.length && hour !== undefined) && !(hour !== undefined && loggedThisHour_(today + ' ' + hour))) appendLog_(ctx.ss, kind, '-', '送らず: ' + why);
    return planned.length ? what + '（' + planned.map(s => s.name).join('、') + '）はすべて送信済みです。送り直すなら「明日の卓を今すぐ Discord に送る」を使ってください。'
      : (force ? '明日の卓はありません（' + tomorrow + '）。' : what + 'はありません（' + today + '）。');
  }
  // 送り先と「あと何日」ごとにまとめる
  const groups = {}, order = [];
  due.forEach(s => {
    const ahead = daysBetween_(ctx.now, s.date);
    sessionTargets_(ctx, s, 'remind').forEach(t => {
      const key = t.url + '|' + ahead;
      if (!groups[key]) { groups[key] = { t: t, ahead: ahead, list: [] }; order.push(key); }
      groups[key].list.push(s);
    });
  });
  if (!order.length) {
    appendLog_(ctx.ss, kind, due.map(s => s.name).join('、'), '送らず: Discord Webhook URL が空');
    return what + 'は ' + due.length + ' 件ありますが、Discord Webhook URL が設定されていません。';
  }
  const sent = {}, failed = [];
  order.forEach(k => {
    const g = groups[k];
    const mentions = mentionsOf_(ctx, g.list);
    const payload = {
      content: '📢 ' + aheadText_(g.ahead) + 'は卓の日です！' + (mentions ? ' ' + mentions : ''),
      embeds: g.list.slice(0, 10).map(s => sessionEmbed_(ctx, s)),
    };
    const ok = postDiscord_(ctx, payload, kind, g.list.map(s => s.name).join('、') + targetNote_(g.t), g.t.url);
    if (ok) g.list.forEach(s => { sent[s.id] = s; }); else if (failed.indexOf(g.t.label) < 0) failed.push(g.t.label);
  });
  const done = due.filter(s => sent[s.id]);
  if (done.length) {
    const sh = ctx.ss.getSheetByName(SHEET.SESSIONS);
    const stamp = fmtDateTime_(new Date());
    done.forEach(s => sh.getRange(s.row, SC.NOTIFIED + 1).setValue(stamp));
    ctx.sentCount = done.length;
  }
  if (!failed.length) return '送りました: ' + due.map(s => s.name).join('、');
  return (done.length ? '一部の送信に失敗しました（' + failed.join('、') + '）: ' : '送信に失敗しました: ') + due.map(s => s.name).join('、');
}

function testDiscord() {
  const ss = ss_();
  const ctx = loadContext_(ss);
  if (!String(ctx.settings['Discord Webhook URL'] || '').trim()) {
    SpreadsheetApp.getUi().alert('「設定」シートの Discord Webhook URL が空です。');
    return;
  }
  const ok = postDiscord_(ctx, {
    content: '✅ 卓予定管理から接続テスト（' + ss.getName() + '）',
  }, '接続テスト', '-');
  SpreadsheetApp.getUi().alert(ok ? 'Discord に届きました。' : '送信に失敗しました。通知ログを確認してください。');
}

/**
 * Discord へ送る。429（Cloudflare の 1015 を含む）と 5xx のときは、少し待って最大 3 回まで送り直す。
 * Apps Script の通信は Google の共有サーバーから出るので、こちらが 1 通でも混雑で弾かれることがある。
 * トリガーやシートのメニューから呼ぶときはこの関数が待ちも受け持つ。
 * ウェブアプリは 1 回ずつ sendDiscordStep() を呼び、待ちと回数の表示を画面側で行う
 */
/**
 * 送り先。シリーズに専用のチャンネル（Webhook）があればそこへ送り、「基本のチャンネルにも送る」なら基本にも送る。
 * 専用のチャンネルが無いシリーズと、シリーズの無い卓は、基本のチャンネルだけ。返り値は [{ url, label, series }]
 */
function discordTargets_(ctx, series, kindKey) {
  const base = kindBase_(ctx, kindKey);
  const sn = series && ctx.seriesNotify ? ctx.seriesNotify[series] : null;
  const out = [];
  if (sn && sn.webhook) {
    out.push({ url: sn.webhook, label: 'シリーズ「' + series + '」のチャンネル', series: series });
    if (sn.alsoBase && base && base.url !== sn.webhook) out.push(base);
  } else if (base) {
    out.push(base);
  }
  return out;
}
/**
 * 知らせの種類（'remind' 開催前の知らせ、'recruit' 募集、それ以外は基本）の送り先。
 * 種類ごとの URL があればそれ、無ければ基本の URL。どちらも無ければ null
 */
function kindBase_(ctx, kindKey) {
  const kw = KIND_WEBHOOK[kindKey];
  const own = kw ? String(ctx.settings[kw.key] || '').trim() : '';
  if (own) return { url: own, label: kw.label, series: '', kind: kindKey };
  const base = String(ctx.settings['Discord Webhook URL'] || '').trim();
  return base ? { url: base, label: '基本のチャンネル', series: '' } : null;
}
/** 卓の知らせの種類。状態が「募集」の卓は募集、それ以外は基本 */
function sessionKind_(s) { return s && s.status === STATUS.RECRUIT ? 'recruit' : ''; }
function sessionTargets_(ctx, s, kindKey) { return discordTargets_(ctx, s && s.series, kindKey === undefined ? sessionKind_(s) : kindKey); }
/** 通知ログの「対象」に添える送り先。基本のチャンネルなら何も付けない */
function targetNote_(t) { return t && t.series ? '（シリーズ「' + t.series + '」のチャンネル）' : t && t.kind ? '（' + t.label + '）' : ''; }
/** いくつかの送り先へ同じ文を送る。すべて届けば true */
function postToTargets_(ctx, payload, kind, target, targets) {
  let all = targets.length > 0;
  targets.forEach(t => { if (!postDiscord_(ctx, payload, kind, target + targetNote_(t), t.url)) all = false; });
  return all;
}
function isDiscordWebhook_(w) {
  return /^https:\/\/(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)\/api\/webhooks\//.test(String(w || ''));
}

const DISCORD_RETRY_WAITS_MS = [3000, 8000];
const DISCORD_MAX_TRIES = DISCORD_RETRY_WAITS_MS.length + 1;

function postDiscord_(ctx, payload, kind, target, url) {
  for (let attempt = 1; attempt <= DISCORD_MAX_TRIES; attempt++) {
    const r = discordAttempt_(ctx, payload, kind, target, attempt, url);
    if (r.ok) return true;
    if (!r.retryable) return false;
    Utilities.sleep(r.waitMs);
  }
  return false;
}

/**
 * 1 回だけ送り、結果を通知ログに 1 行残す。
 * 返り値: { ok, code, retryable（この後まだ送り直してよいか）, waitMs（次までに待つ時間）, result（ログの文）, attempt, maxTries }
 */
function discordAttempt_(ctx, payload, kind, target, attempt, toUrl) {
  const url = String(toUrl || ctx.settings['Discord Webhook URL'] || '').trim();
  attempt = clampInt_(attempt, 1, DISCORD_MAX_TRIES, 1);
  if (!url) return { ok: false, code: 0, retryable: false, waitMs: 0, result: '送らず: Discord Webhook URL が空', attempt: attempt, maxTries: DISCORD_MAX_TRIES };
  let code = 0, body = '', retryAfterMs = 0, errText = '';
  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    code = res.getResponseCode();
    body = String(res.getContentText() || '');
    retryAfterMs = retryAfterMs_(res, body);
  } catch (err) {
    errText = String(err);
  }
  const ok = code >= 200 && code < 300;
  const canRetry = !ok && (code === 429 || code >= 500 || (!code && /timed out|timeout|DNS|address/i.test(errText)));
  const last = attempt >= DISCORD_MAX_TRIES || !canRetry;
  const waitMs = canRetry && !last ? Math.min(Math.max(DISCORD_RETRY_WAITS_MS[attempt - 1] || 8000, retryAfterMs), 15000) : 0;
  const raw = code ? 'HTTP ' + code + ' ' + body.slice(0, 200) : 'ERROR ' + errText;
  const reason = ok ? null : classifyDiscordFailure_(code, errText);
  let result;
  if (ok) {
    result = 'OK (' + code + ')' + (attempt > 1 ? '（' + attempt + ' 回目）' : '');
  } else if (!last) {
    // まだ送り直す。記録には「何秒後に送り直すか」を添える
    result = raw + '（' + attempt + ' 回目、' + Math.ceil(waitMs / 1000) + ' 秒後に送り直し）';
  } else {
    // 打ち止め。種類を先に出し、ツールの不具合でなければそう書く
    result = '送信失敗（' + reason.label + '）: ' + raw + '（' + attempt + ' 回目' + (attempt > 1 ? '、打ち止め' : '') + '）　→ ' + reason.text + ' ' + reason.advice +
      (reason.toolFault ? '' : '　このツールの不具合ではありません。');
  }
  appendLog_(ctx.ss, kind, target, result);
  return { ok: ok, code: code, retryable: canRetry && !last, waitMs: waitMs, result: result, raw: raw, reason: reason, attempt: attempt, maxTries: DISCORD_MAX_TRIES };
}

const ASK_MESSAGE_MAX = 500;

/** 募集中の卓の「興味あり」の人に、参加できるかを聞く文。ID のある人はメンション、無い人は名前。GM の一言（message）を挟める。返事は募集タブの「参加希望」で */
function askPayload_(ctx, s, me, message) {
  const withId = [], noId = [];
  s.interest.forEach(n => {
    const m = ctx.memberByName[n];
    if (m && m.discordId) withId.push('<@' + m.discordId + '>'); else noId.push(n + ' さん');
  });
  let url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (err) { url = ''; }
  const lines = [
    '❓ 「' + s.name + '」（' + (s.windowLabel ? s.windowLabel + ' に開催予定' : '時期未定') + '）に参加できそうですか？ ' + withId.concat(noId).join(' '),
  ];
  const msg = String(message || '').trim();
  if (msg) lines.push('💬 ' + msg + (me ? '（' + me + '）' : ''));
  lines.push('参加希望であれば、卓予定の「募集・調整」タブで「参加希望」を押してください。' + (me && !msg ? '　by ' + me : '') + (url ? '\n' + url : ''));
  return { content: lines.join('\n'), embeds: [sessionEmbed_(ctx, s)] };
}

/** Retry-After ヘッダーか Discord の retry_after（秒）から、待つミリ秒を取る。無ければ 0 */
function retryAfterMs_(res, body) {
  try {
    const h = res.getHeaders() || {};
    const v = h['Retry-After'] || h['retry-after'];
    if (v && !isNaN(Number(v))) return Number(v) * 1000;
  } catch (err) { /* ヘッダーが取れない環境もある */ }
  try {
    const j = JSON.parse(body);
    if (j && typeof j.retry_after === 'number') return j.retry_after * (j.retry_after > 100 ? 1 : 1000);
  } catch (err) { /* JSON でない本文 */ }
  return 0;
}

/**
 * 失敗の種類分け。画面と通知ログの両方がこれを使う。
 *   label: 見出し。toolFault: このツールの不具合の可能性があるか。text: ひとことの説明。advice: 直し方
 */
function classifyDiscordFailure_(code, errText) {
  errText = String(errText || '');
  if (code === 429) return { kind: 'cloudflare', label: 'Discord 側の制限', toolFault: false,
    text: 'Discord の手前にある Cloudflare が、アクセスの集中を理由に受け取りを断りました（error code 1015）。Google のサーバーから送る通知はまとめて数えられるため、こちらが 1 通でも起きます。',
    advice: '数分おいて、もう一度送ってください。' };
  if (code >= 500) return { kind: 'discord_down', label: 'Discord 側の不調', toolFault: false,
    text: 'Discord が一時的に応答できていません。', advice: '時間をおいて送り直してください。' };
  if (code === 401 || code === 403 || code === 404) return { kind: 'bad_url', label: 'Webhook URL', toolFault: false,
    text: 'Webhook URL が違うか、Discord 側でウェブフックが消されています。', advice: '設定タブで貼り直して「接続テスト」を。' };
  if (code === 400) return { kind: 'bad_payload', label: '本文', toolFault: true,
    text: 'Discord が本文を受け付けませんでした。', advice: '卓名やメモが極端に長くないか確かめてください。直らなければツール側の問題かもしれないので、送信記録の詳細を添えて知らせてください。' };
  if (/external_request|authoriz|permission|権限|承認/i.test(errText)) return { kind: 'auth', label: '承認', toolFault: false,
    text: 'スクリプトの承認が足りません。', advice: 'Apps Script の「デプロイを管理」で新バージョンを出し、承認画面を通してください。' };
  if (/DNS|address|resolve|timed out|timeout/i.test(errText)) return { kind: 'network', label: '通信', toolFault: false,
    text: 'Discord に届く前に通信が切れました。', advice: '時間をおいて送り直してください。' };
  return { kind: 'unknown', label: '原因不明', toolFault: true,
    text: '原因を判別できませんでした。', advice: '送信記録の詳細を添えて知らせてください。' };
}

/** 失敗の中身から、まず疑う場所を添える（通知ログ用の短い文） */
function discordHint_(code, errText) {
  const r = classifyDiscordFailure_(code, errText);
  return '　→ ' + r.text + ' ' + r.advice;
}

/** Retry-After ヘッダーか Discord の retry_after（秒）から、待つミリ秒を取る。無ければ 0 */
function retryAfterMs_(res, body) {
  try {
    const h = res.getHeaders() || {};
    const v = h['Retry-After'] || h['retry-after'];
    if (v && !isNaN(Number(v))) return Number(v) * 1000;
  } catch (err) { /* ヘッダーが取れない環境もある */ }
  try {
    const j = JSON.parse(body);
    if (j && typeof j.retry_after === 'number') return j.retry_after * (j.retry_after > 100 ? 1 : 1000);
  } catch (err) { /* JSON でない本文 */ }
  return 0;
}

/** 失敗の中身から、まず疑う場所を添える */
function discordHint_(code, errText) {
  if (code === 401 || code === 403 || code === 404) return '　→ Webhook URL が違うか、Discord 側でウェブフックが消されています。設定タブで貼り直して「接続テスト」を。';
  if (code === 400) return '　→ 送った本文を Discord が受け付けませんでした。卓名やメモに極端に長い文が無いか確かめてください。';
  if (code === 429) return '　→ Discord の手前（Cloudflare）が混雑で弾きました（error code 1015 など）。Apps Script の通信は Google の共有サーバーから出るため、こちらが 1 通でも起きます。3 回まで自動で送り直しても通らなかったので、数分おいて押し直してください。';
  if (code >= 500) return '　→ Discord 側の一時的な不調です。時間をおいて。';
  if (/external_request|authoriz|permission|権限|承認/i.test(errText)) return '　→ スクリプトの承認が足りません。Apps Script の「デプロイを管理」で新バージョンを出し、承認画面を通してください。';
  if (/DNS|address|resolve|timed out|timeout/i.test(errText)) return '　→ URL の形が違うか、通信が届いていません。';
  return '';
}

/** 「10/3（土） 20:00〜23:00」。募集中なら「10月前期 開催予定（募集中）」 */
function whenText_(s) {
  if (s.date) return fmtDateJa_(s.date) + ' ' + timeRange_(s);
  if (s.status === STATUS.RECRUIT) return (s.windowLabel ? s.windowLabel + ' に開催予定' : '時期未定') + '（募集中）';
  if (s.status === STATUS.ADJUSTING) {
    if (s.candidates && s.candidates.length) return '候補日: ' + s.candidates.map(k => fmtDateJa_(toDate_(k))).join('、') + '（日程調整中）';
    return (s.windowLabel ? s.windowLabel + ' のどこか' : '期間未定') + '（調整中）';
  }
  return '日程未定';
}

function sessionEmbed_(ctx, s) {
  const lines = [
    'GM: ' + (s.gm || '未定'),
    '日時: ' + whenText_(s),
    '参加者: ' + (s.members.length ? s.members.join('、') : '未定'),
  ];
  if (s.status === STATUS.RECRUIT && s.want.length) lines.push('参加希望: ' + s.want.join('、'));
  if (s.place) lines.push('場所: ' + s.place);
  if (s.memo) lines.push('メモ: ' + s.memo);
  return {
    title: s.name + (s.status === STATUS.RECRUIT ? '（募集中）' : s.status === STATUS.ADJUSTING ? '（調整中）' : ''),
    description: lines.join('\n'),
    color: 0x4a86e8,
    footer: { text: ctx.ss.getName() },
  };
}

function mentionsOf_(ctx, sessions) {
  const ids = {};
  sessions.forEach(s => peopleOf_(s).forEach(n => {
    const m = ctx.memberByName[n];
    if (m && m.discordId) ids['<@' + m.discordId + '>'] = true;
  }));
  return Object.keys(ids).join(' ');
}

/**
 * 募集・調整の知らせに添える、卓予定（ウェブアプリ）への案内の行。
 * 募集中の卓は参加希望、調整中の卓は日程調整の入口として出す。それ以外の卓と、URL が取れないときは空
 */
function recruitLink_(s) {
  const what = s.status === STATUS.RECRUIT ? '参加希望' : s.status === STATUS.ADJUSTING ? '日程調整' : '';
  const url = what ? appUrl_() : '';
  return url ? '\n🔗 ' + what + 'は卓予定の「募集・調整」タブから: ' + url : '';
}

/** 登録・変更・削除の知らせ。削除は本文だけ（卓はもう無い）。登録のときは GM と参加者をメンションする。募集・調整中の卓には卓予定の URL を添える */
function changePayload_(ctx, s, verb, editor) {
  const icon = { 登録: '🆕', 変更: '✏️', 削除: '🗑️' }[verb] || 'ℹ️';
  const mentions = verb === '登録' ? mentionsOf_(ctx, [s]) : '';
  return {
    content: icon + ' 卓の予定が' + verb + 'されました' + (editor ? '（' + editor + '）' : '') + (verb === '削除' ? '：' + s.name : (mentions ? '\n' + mentions : '') + recruitLink_(s)),
    embeds: verb === '削除' ? [] : [sessionEmbed_(ctx, s)],
  };
}

/** 卓 1 件の案内。参加者をメンションする */
function announcePayload_(ctx, s, me) {
  const mentions = mentionsOf_(ctx, [s]);
  const when = whenText_(s);
  return {
    content: '📣 卓の案内: ' + s.name + '（' + when + '）' + (me ? '　by ' + me : '') + (mentions ? '\n' + mentions : '') + recruitLink_(s),
    embeds: [sessionEmbed_(ctx, s)],
  };
}

function notifyChange_(ctx, s, verb) {
  const targets = sessionTargets_(ctx, s);
  if (!targets.length) return false;
  return postToTargets_(ctx, changePayload_(ctx, s, verb, s.editor), verb + '通知', s.name, targets);
}

/**
 * ウェブアプリ用。Discord へ 1 回だけ送り、結果を返す。待ちと送り直しは画面側が回す。
 * form: { kind: 'test'|'change'|'delete'|'announce'|'bulk'|'poll'|'pollReady'|'decided', attempt, to（送り先の番号）, id, verb, name, series, names, ids, label, me }
 * 送り先が 2 か所あるとき（シリーズのチャンネルと基本のチャンネル）は、画面が to を 0, 1 と進めて 1 か所ずつ送る
 */
function sendDiscordStep(...args) { return withLock_(() => sendDiscordStepLocked_(...args)); }
function sendDiscordStepLocked_(form) {
  authFor_(form);
  const ss = ss_();
  const ctx = loadContext_(ss);
  const me = String(form.me || '').trim();
  const kind = String(form.kind || '');
  let payload, label, target, s = null, kindKey = '';
  if (kind === 'test') {
    payload = { content: '✅ 卓予定管理から接続テスト（' + ss.getName() + '）' }; label = '接続テスト'; target = '-';
  } else if (kind === 'change') {
    s = ctx.sessions.filter(x => x.id === String(form.id || ''))[0];
    if (!s) throw new Error('その卓が見つかりません: ' + form.id);
    const verb = form.verb === '変更' ? '変更' : '登録';
    payload = changePayload_(ctx, s, verb, me || s.editor); label = verb + '通知'; target = s.name;
  } else if (kind === 'delete') {
    const nm = String(form.name || '').trim();
    if (!nm) throw new Error('消した卓の名前がありません。');
    payload = changePayload_(ctx, { name: nm }, '削除', me); label = '削除通知'; target = nm;
    kindKey = form.status === STATUS.RECRUIT ? 'recruit' : '';
  } else if (kind === 'announce') {
    s = ctx.sessions.filter(x => x.id === String(form.id || ''))[0];
    if (!s) throw new Error('その卓が見つかりません: ' + form.id);
    payload = announcePayload_(ctx, s, me); label = '案内'; target = s.name;
  } else if (kind === 'ask') {
    s = ctx.sessions.filter(x => x.id === String(form.id || ''))[0];
    if (!s) throw new Error('その卓が見つかりません: ' + form.id);
    if (s.status !== STATUS.RECRUIT) throw new Error('「' + s.name + '」は募集中ではありません（' + s.status + '）。');
    if (!s.interest.length) throw new Error('「' + s.name + '」に興味ありの人がいません。');
    if (String(form.message || '').trim().length > ASK_MESSAGE_MAX) throw new Error('添える一言は ' + ASK_MESSAGE_MAX + ' 文字までです。');
    payload = askPayload_(ctx, s, me, form.message); label = '参加確認'; target = s.name;
  } else if (kind === 'poll') {
    s = ctx.sessions.filter(x => x.id === String(form.id || ''))[0];
    if (!s) throw new Error('その卓が見つかりません: ' + form.id);
    if (s.status !== STATUS.ADJUSTING || !s.candidates.length) throw new Error('「' + s.name + '」は日程調整をしていません。');
    payload = pollPayload_(ctx, s, me); label = '日程調整'; target = s.name;
  } else if (kind === 'pollReady') {
    s = ctx.sessions.filter(x => x.id === String(form.id || ''))[0];
    if (!s) throw new Error('その卓が見つかりません: ' + form.id);
    if (s.status !== STATUS.ADJUSTING || !s.candidates.length) throw new Error('「' + s.name + '」は日程調整をしていません。');
    payload = pollReadyPayload_(ctx, s); label = '回答そろい'; target = s.name;
  } else if (kind === 'decided') {
    s = ctx.sessions.filter(x => x.id === String(form.id || ''))[0];
    if (!s) throw new Error('その卓が見つかりません: ' + form.id);
    if (!s.date) throw new Error('「' + s.name + '」の開催日がまだ決まっていません。');
    payload = decidedPayload_(ctx, s); label = '日程決定'; target = s.name;
  } else if (kind === 'bulk') {
    const names = (form.names || []).map(x => String(x || '').trim()).filter(Boolean);
    if (!names.length) throw new Error('対象の卓がありません。');
    // 複数日をまとめて登録したときは、その回の GM と参加者をメンションする
    const bulkIds = (form.ids || []).map(x => String(x || ''));
    const mentions = form.label === '登録' && bulkIds.length ? mentionsOf_(ctx, ctx.sessions.filter(x => bulkIds.indexOf(x.id) >= 0)) : '';
    payload = { content: '🔁 卓の予定を一括で' + String(form.label || '変更') + (me ? '（' + me + '）' : '') + '\n' + names.map(n => '・' + n).join('\n') + (mentions ? '\n' + mentions : '') };
    label = '一括変更'; target = names.join('、');
  } else {
    throw new Error('送る種類が不正です: ' + kind);
  }
  // 送り先。接続テストは基本のチャンネル（シリーズを指定したときはそのシリーズのチャンネルだけ）。
  // まとめての変更は基本のチャンネル（同じシリーズの回をまとめて登録したときは、そのシリーズの送り先）
  // 開催前の知らせ・募集の送り先は、状態が「募集」の卓と参加確認なら募集、それ以外は基本
  const series = s ? s.series : String(form.series || '').trim();
  if (s) kindKey = kind === 'ask' ? 'recruit' : sessionKind_(s);
  const channel = String(form.channel || '');
  let targets;
  if (kind === 'test' && series) {
    const sn = ctx.seriesNotify[series];
    if (!sn || !sn.webhook) throw new Error('シリーズ「' + series + '」には専用の Webhook URL がありません。');
    targets = [{ url: sn.webhook, label: 'シリーズ「' + series + '」のチャンネル', series: series }];
  } else if (kind === 'test' && KIND_WEBHOOK[channel]) {
    const own = String(ctx.settings[KIND_WEBHOOK[channel].key] || '').trim();
    if (!own) throw new Error(KIND_WEBHOOK[channel].label + 'の Webhook URL がありません。');
    targets = [{ url: own, label: KIND_WEBHOOK[channel].label, series: '', kind: channel }];
  } else if (kind === 'test') {
    targets = discordTargets_(ctx, '');
  } else {
    targets = discordTargets_(ctx, series, kindKey);
  }
  if (!targets.length) throw new Error('Webhook URL が空です。設定タブに貼って「URL を保存」してから送ってください。');
  const to = clampInt_(form.to, 0, targets.length - 1, 0);
  if (kind === 'test' && series) payload = { content: '✅ 卓予定管理から接続テスト（' + ss.getName() + ' / シリーズ「' + series + '」）' };
  else if (kind === 'test' && KIND_WEBHOOK[channel]) payload = { content: '✅ 卓予定管理から接続テスト（' + ss.getName() + ' / ' + KIND_WEBHOOK[channel].label + '）' };
  const r = discordAttempt_(ctx, payload, label, target + targetNote_(targets[to]), form.attempt, targets[to].url);
  r.to = to; r.targetCount = targets.length; r.targetLabel = targets[to].label;
  if (r.ok && kind === 'ask') {
    // 送った日時を卓に控える。カードに「確認文を送りました」と出す
    const stamp = fmtDateTime_(new Date());
    ss.getSheetByName(SHEET.SESSIONS).getRange(s.row, SC.ASK + 1).setValue(stamp);
    SpreadsheetApp.flush();
    markDirty_();
    r.asked = stampText_(stamp);
    r.data = consoleData_(ss, undefined, isAdmin_(form));
  }
  if (r.ok && kind === 'announce' && DATED.indexOf(s.status) >= 0 && notifyYmdOf_(ctx, s) === ymd_(ctx.now)) {
    ss.getSheetByName(SHEET.SESSIONS).getRange(s.row, SC.NOTIFIED + 1).setValue(fmtDateTime_(new Date()));
    SpreadsheetApp.flush();
    markDirty_();
    r.notified = true;
    r.data = consoleData_(ss, undefined, isAdmin_(form));
  }
  return r;
}

/** 開催前の知らせの状態。「開催前の知らせ 送信済み」「開催前の知らせ 9/20（日） 20 時台に送る」「開催前の知らせ 未送信」「開催前の知らせ 未設定」（自動通知を有効にしていない） */
function notifyStateText_(ctx, s) {
  if (s.notified) return '開催前の知らせ 送信済み';
  if (!String(ctx.settings['自動通知の設定者'] || '').trim()) return '開催前の知らせ 未設定';
  const k = notifyYmdOf_(ctx, s);
  if (k && k >= ymd_(ctx.now)) return '開催前の知らせ ' + fmtDateJa_(addDays_(s.date, -notifyDaysOf_(ctx, s))) + ' ' + notifyHourOf_(ctx, s) + ' 時台に送る';
  return '開催前の知らせ 未送信';
}

function toastUpcoming_(ctx) {
  const today = ymd_(ctx.now);
  const tomorrow = ymd_(addDays_(ctx.now, 1));
  const todays = ctx.sessions.filter(s => DATED.indexOf(s.status) >= 0 && s.ymd === today);
  const tomorrows = ctx.sessions.filter(s => DATED.indexOf(s.status) >= 0 && s.ymd === tomorrow);
  const parts = [];
  if (todays.length) parts.push('今日: ' + todays.map(s => s.name + ' ' + timeRange_(s)).join(' / '));
  if (tomorrows.length) parts.push('明日: ' + tomorrows.map(s => s.name + ' ' + timeRange_(s)).join(' / '));
  if (parts.length) ctx.ss.toast(parts.join('\n'), '卓の予定', 10);
}

/** 通知ログの新しい方から n 件。画面の設定タブで見せる */
function recentLog_(ss, n) {
  const sh = ss.getSheetByName(SHEET.LOG);
  if (!sh || sh.getLastRow() < 2) return [];
  const last = sh.getLastRow();
  const count = Math.min(n, last - 1);
  return sh.getRange(last - count + 1, 1, count, 4).getValues().reverse()
    .map(r => ({ at: stampText_(r[0]), kind: String(r[1] || ''), target: String(r[2] || ''), result: String(r[3] || '') }));
}

function appendLog_(ss, kind, target, result) {
  const sh = getOrCreateSheet_(ss, SHEET.LOG);
  if (sh.getLastRow() === 0) sh.appendRow(LOG_HEADER);
  sh.appendRow([new Date(), kind, target, result]);
}

/* ---------------------------------------------------------
 * 書き込みの順番待ち
 * シートへの書き込みは、すべてスクリプト全体で 1 本のロックの中で行う。
 * 表示の描き直し（都合表を丸ごと読んで丸ごと書き戻す。十数秒かかる）の最中に誰かが △× を付けると、
 * 古い中身で上書きされて消えていた。卓の保存（1 行まるごと書く）や削除（読んだ時点の行番号で消す）も、
 * 同時に走ると互いの書き込みを消す。ロックの中で読み直してから書けば、後の人は前の人の結果の上に書く。
 * 入れ子で呼ばれても取り直さない（LOCK_DEPTH_）
 * --------------------------------------------------------- */
let LOCK_DEPTH_ = 0;
const LOCK_WAIT_MS = 30 * 1000;
const LOCK_BUSY_MSG = 'ほかの人の操作と重なりました。少し待ってから、もう一度押してください。';

/** fn をロックの中で動かす。quiet なら、待ちきれないとき例外にせず undefined を返す（見回りと描き直し用） */
function withLock_(fn, waitMs, quiet) {
  if (LOCK_DEPTH_ > 0) return fn();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs || LOCK_WAIT_MS)) {
    if (quiet) return undefined;
    throw new Error(LOCK_BUSY_MSG);
  }
  LOCK_DEPTH_++;
  try {
    return fn();
  } finally {
    LOCK_DEPTH_--;
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

/* ---------------------------------------------------------
 * Web アプリ（Console.html）。ブラウザから見る・書く
 *   デプロイ → 新しいデプロイ → ウェブアプリ。実行ユーザーは「自分」
 * --------------------------------------------------------- */

function doGet(e) {
  // 使い方のページ（?page=tutorial）。卓のデータを持たないので合言葉は求めない。アプリへ戻るリンク用に URL を渡す
  if (e && e.parameter && e.parameter.page === 'tutorial') {
    return HtmlService.createHtmlOutputFromFile('Tutorial')
      .append('<script>window.APP_URL = ' + JSON.stringify(appUrl_()) + ';</script>')
      .setTitle('卓予定の使い方')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  ensureReady_(ss_());
  return HtmlService.createHtmlOutputFromFile('Console')
    .setTitle('卓予定')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ---------------------------------------------------------
 * 合言葉（ウェブアプリのログイン）
 * 全員共通の合言葉を 1 つ持つ。ハッシュと「版」をスクリプトのプロパティに置く（シートには出ない）。
 * 合言葉が通ったブラウザには版から作った「証」を渡し、以後はそれを添えて呼ぶ。期限は無い。
 * 合言葉を変えると版が変わり、すべてのブラウザの証が無効になる。メンバーを外したときはこれで締め出す。
 * 合言葉が無いうちは誰でも開ける（最初に決めるための状態）
 * --------------------------------------------------------- */
const PW = { HASH: 'WEB_PASS_HASH', SALT: 'WEB_PASS_SALT', VER: 'WEB_PASS_VER', SECRET: 'WEB_SECRET', FAILS: 'WEB_LOGIN_FAILS' };
const PW_MIN = 8;
const LOGIN_MAX_FAILS = 10;
const LOGIN_LOCK_MS = 10 * 60 * 1000;

function props_() { return PropertiesService.getScriptProperties(); }
function sha_(text) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)); }
function normPw_(pw) { return String(pw === undefined || pw === null ? '' : pw).trim(); }
function hasPassword_() { return !!props_().getProperty(PW.HASH); }

function secret_() {
  let sec = props_().getProperty(PW.SECRET);
  if (!sec) { sec = Utilities.getUuid() + Utilities.getUuid(); props_().setProperty(PW.SECRET, sec); }
  return sec;
}
function tokenOf_(ver) { return sha_(secret_() + '|' + ver); }
function tokenOk_(token) {
  const ver = props_().getProperty(PW.VER);
  return !!ver && !!token && String(token) === tokenOf_(ver);
}
function checkPassword_(pw) {
  const hash = props_().getProperty(PW.HASH);
  const salt = props_().getProperty(PW.SALT) || '';
  return !!hash && sha_(salt + '|' + normPw_(pw)) === hash;
}
/** 合言葉を保存して版を進める。全員の証が無効になる。新しい証を返す */
function storePassword_(pw) {
  const salt = Utilities.getUuid(), ver = Utilities.getUuid();
  props_().setProperty(PW.SALT, salt);
  props_().setProperty(PW.HASH, sha_(salt + '|' + normPw_(pw)));
  props_().setProperty(PW.VER, ver);
  props_().deleteProperty(PW.FAILS);
  return tokenOf_(ver);
}
function validateNewPw_(pw, confirm) {
  const t = normPw_(pw);
  if (t.length < PW_MIN) throw new Error('合言葉は ' + PW_MIN + ' 文字以上にしてください。');
  if (confirm !== undefined && normPw_(confirm) !== t) throw new Error('2 つの入力が合っていません。');
}
/** 証が無ければ「AUTH:」で始まるエラー。画面はこれを見てログインを求める */
function requireAuth_(token) {
  if (hasPassword_() && !tokenOk_(token)) throw new Error('AUTH: 合言葉を入れてください。');
}
function authFor_(form) { requireAuth_(form && form.token); }
/** 間違いが続いたら少し待たせる */
function loginThrottle_() {
  const raw = props_().getProperty(PW.FAILS);
  if (!raw) return;
  const f = JSON.parse(raw);
  const left = LOGIN_LOCK_MS - (Date.now() - f.at);
  if (f.n >= LOGIN_MAX_FAILS && left > 0) throw new Error('間違いが続いたので、' + Math.ceil(left / 60000) + ' 分ほど待ってから入れてください。');
}
function loginFailed_() {
  const raw = props_().getProperty(PW.FAILS);
  const f = raw ? JSON.parse(raw) : { n: 0, at: 0 };
  if (Date.now() - f.at > LOGIN_LOCK_MS) f.n = 0;
  f.n++;
  f.at = Date.now();
  props_().setProperty(PW.FAILS, JSON.stringify(f));
}

/* ---------------------------------------------------------
 * 管理者
 * みんなの合言葉とは別に「管理者の合言葉」を 1 つ持つ。作りはみんなの合言葉と同じで、
 * 通ったブラウザには「管理者の証」を渡す。名簿（設定シートの「管理者」）は誰が管理者かを見せるためのもので、
 * 実際の可否は証で決める。管理者の合言葉を決めていないあいだは、今までどおり誰でも操作できる
 * --------------------------------------------------------- */
const ADM = { HASH: 'ADMIN_PASS_HASH', SALT: 'ADMIN_PASS_SALT', VER: 'ADMIN_PASS_VER', FAILS: 'ADMIN_LOGIN_FAILS' };
const ADMIN_KEY = '管理者';

function hasAdminPassword_() { return !!props_().getProperty(ADM.HASH); }
function adminTokenOf_(ver) { return sha_(secret_() + '|admin|' + ver); }
function adminTokenOk_(token) {
  const ver = props_().getProperty(ADM.VER);
  return !!ver && !!token && String(token) === adminTokenOf_(ver);
}
function checkAdminPassword_(pw) {
  const hash = props_().getProperty(ADM.HASH);
  const salt = props_().getProperty(ADM.SALT) || '';
  return !!hash && sha_(salt + '|' + normPw_(pw)) === hash;
}
function storeAdminPassword_(pw) {
  const salt = Utilities.getUuid(), ver = Utilities.getUuid();
  props_().setProperty(ADM.SALT, salt);
  props_().setProperty(ADM.HASH, sha_(salt + '|' + normPw_(pw)));
  props_().setProperty(ADM.VER, ver);
  props_().deleteProperty(ADM.FAILS);
  return adminTokenOf_(ver);
}
/** 管理者かどうか。管理者の合言葉を決めていなければ、全員を管理者として扱う */
function isAdmin_(form) { return !hasAdminPassword_() || adminTokenOk_(form && form.adminToken); }
/** 管理者でなければ「ADMIN:」で始まるエラー。画面はこれを見て管理者の合言葉を聞く */
function requireAdmin_(form, what) {
  authFor_(form);
  if (isAdmin_(form)) return;
  throw new Error('ADMIN: ' + (what || 'この操作') + 'ができるのは管理者だけです。管理者の合言葉を入れてください。');
}
/** 自分のぶんなら誰でも。ほかの人の代わりに入れるのは管理者だけ */
function requireSelfOrAdmin_(form, name) {
  const me = String((form && form.me) || '').trim();
  if (me && me === String(name || '').trim()) { authFor_(form); return; }
  requireAdmin_(form, 'ほかの人の代わりに入れること');
}
function adminNames_(st) { return uniq_(splitNames_(st && st[ADMIN_KEY])); }
/** 名簿に足す。すでにいれば何もしない */
function addAdminName_(ss, name) {
  const n = String(name || '').trim();
  if (!n) return false;
  const list = adminNames_(getSettings_(ss));
  if (list.indexOf(n) >= 0) return false;
  setSetting_(ss, ADMIN_KEY, list.concat([n]).join('、'));
  return true;
}
function adminThrottle_() {
  const raw = props_().getProperty(ADM.FAILS);
  if (!raw) return;
  const f = JSON.parse(raw);
  const left = LOGIN_LOCK_MS - (Date.now() - f.at);
  if (f.n >= LOGIN_MAX_FAILS && left > 0) throw new Error('間違いが続いたので、' + Math.ceil(left / 60000) + ' 分ほど待ってから入れてください。');
}
function adminFailed_() {
  const raw = props_().getProperty(ADM.FAILS);
  const f = raw ? JSON.parse(raw) : { n: 0, at: 0 };
  if (Date.now() - f.at > LOGIN_LOCK_MS) f.n = 0;
  f.n++;
  f.at = Date.now();
  props_().setProperty(ADM.FAILS, JSON.stringify(f));
}

/** 管理者になる。form: { token, password, me } → { ok, adminToken } */
function loginAdmin(form) {
  authFor_(form);
  if (!hasAdminPassword_()) throw new Error('管理者の合言葉はまだ決まっていません。いまは全員が管理者の操作をできます。');
  adminThrottle_();
  if (!checkAdminPassword_(form && form.password)) { adminFailed_(); throw new Error('管理者の合言葉が違います。'); }
  props_().deleteProperty(ADM.FAILS);
  const ss = ss_();
  ensureReady_(ss);
  const added = addAdminName_(ss, form && form.me);
  return {
    ok: true,
    adminToken: adminTokenOf_(props_().getProperty(ADM.VER)),
    message: '管理者になりました。' + (added ? '名簿に「' + String(form.me).trim() + '」を足しました。' : ''),
    data: consoleData_(ss, undefined, true),
  };
}

/**
 * 管理者の合言葉を決める・変える。まだ無ければ誰でも決められる（決めた人が管理者になる）。
 * すでにあるときは管理者だけが変えられ、いまの合言葉が要る。form: { token, adminToken, current, password, confirm, me }
 */
function setAdminPassword(form) {
  authFor_(form);
  const had = hasAdminPassword_();
  if (had) {
    requireAdmin_(form, '管理者の合言葉を変えること');
    if (!checkAdminPassword_(form && form.current)) throw new Error('いまの管理者の合言葉が違います。');
  }
  validateNewPw_(form && form.password, form && form.confirm);
  if (checkPassword_(form && form.password)) throw new Error('みんなの合言葉と同じものは使えません。別の合言葉にしてください。');
  const adminToken = storeAdminPassword_(form.password);
  const ss = ss_();
  ensureReady_(ss);
  addAdminName_(ss, form && form.me);
  return {
    ok: true,
    adminToken: adminToken,
    message: had ? '管理者の合言葉を変えました。ほかの管理者は、次の操作のときに入れ直しになります。'
      : '管理者の合言葉を決めました。ここから先、管理者の操作にはこの合言葉が要ります。',
    data: consoleData_(ss, undefined, true),
  };
}

/** 名簿から外す。管理者だけ。form: { token, adminToken, name } */
function removeAdmin(...args) { return withLock_(() => removeAdminLocked_(...args)); }
function removeAdminLocked_(form) {
  requireAdmin_(form, '管理者の名簿を変えること');
  const ss = ss_();
  ensureReady_(ss);
  const name = String(form && form.name || '').trim();
  const list = adminNames_(getSettings_(ss));
  if (!name || list.indexOf(name) < 0) throw new Error('名簿に「' + name + '」はいません。');
  if (list.length <= 1) throw new Error('管理者が 1 人だけのときは外せません。先にもう 1 人足してください。');
  setSetting_(ss, ADMIN_KEY, list.filter(n => n !== name).join('、'));
  return { ok: true, message: '名簿から「' + name + '」を外しました。', data: consoleData_(ss, undefined, true) };
}

/** ログイン。form: { password } → { ok, token } */
function login(form) {
  if (!hasPassword_()) throw new Error('合言葉がまだ決まっていません。最初に決めてください。');
  loginThrottle_();
  if (!checkPassword_(form && form.password)) { loginFailed_(); throw new Error('合言葉が違います。'); }
  props_().deleteProperty(PW.FAILS);
  return { ok: true, token: tokenOf_(props_().getProperty(PW.VER)) };
}

/** 最初の合言葉を決める。まだ無いときだけ。決めた人が最初の管理者になる。form: { password, confirm, me } */
function setInitialPassword(form) {
  if (hasPassword_()) throw new Error('合言葉はもう決まっています。変えるには設定タブの「合言葉を変える」を使います。');
  validateNewPw_(form && form.password, form && form.confirm);
  const token = storePassword_(form.password);
  let named = '';
  try {
    const ss = ss_();
    ensureReady_(ss);
    named = String(form && form.me || '').trim();
    if (named) addAdminName_(ss, named);
  } catch (err) {
    Logger.log('setInitialPassword: ' + err);
  }
  return { ok: true, token: token, message: '合言葉を決めました。' + (named ? named + ' さんが最初の管理者です。' : '') };
}

/** 合言葉を変える。いまの合言葉が要る。変えると全員のブラウザで入れ直しになる。form: { token, current, password, confirm } */
function changePassword(form) {
  requireAdmin_(form, 'みんなの合言葉を変えること');
  if (!checkPassword_(form.current)) throw new Error('いまの合言葉が違います。');
  validateNewPw_(form.password, form.confirm);
  return { ok: true, token: storePassword_(form.password), message: '合言葉を変えました。ほかの人のブラウザでは、次に開いたときに新しい合言葉を求められます。' };
}

/** シートのメニュー「管理者の合言葉を設定…」。忘れたときはここから決め直す */
function setAdminPasswordFromSheet() {
  const ui = SpreadsheetApp.getUi();
  const had = hasAdminPassword_();
  const res = ui.prompt('管理者の合言葉',
    (had ? 'いまの管理者の合言葉を新しいものに置き換えます。ほかの管理者は入れ直しになります。' : '管理者の合言葉を決めます。シートを開く・ほかの人のぶんを入れる・メンバーと設定を変える、といった操作に要ります。')
    + '\n' + PW_MIN + ' 文字以上。空のまま OK を押すと、管理者の合言葉をやめて全員が操作できる状態に戻します。',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const pw = normPw_(res.getResponseText());
  if (!pw) {
    if (!had) { ui.alert('管理者の合言葉は決まっていません。'); return; }
    props_().deleteProperty(ADM.HASH);
    props_().deleteProperty(ADM.SALT);
    props_().deleteProperty(ADM.VER);
    props_().deleteProperty(ADM.FAILS);
    ui.alert('管理者の合言葉をやめました。いまは画面を開ける人なら誰でも管理者の操作ができます。');
    return;
  }
  try { validateNewPw_(pw); } catch (err) { ui.alert(err.message); return; }
  storeAdminPassword_(pw);
  ui.alert(had ? '管理者の合言葉を変えました。ほかの管理者は、次の操作のときに入れ直しになります。' : '管理者の合言葉を決めました。ウェブアプリで管理者の操作をするときに入れます。');
}

/** シートのメニュー「ウェブアプリの合言葉を設定…」。忘れたときはここから決め直す */
function setWebPassword() {
  const ui = SpreadsheetApp.getUi();
  const had = hasPassword_();
  const res = ui.prompt('ウェブアプリの合言葉',
    (had ? 'いまの合言葉を新しいものに置き換えます。全員のブラウザで入れ直しになります。' : '最初の合言葉を決めます。画面を開く人の全員で使います。') + '\n' + PW_MIN + ' 文字以上。',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  try { validateNewPw_(res.getResponseText()); } catch (err) { ui.alert(err.message); return; }
  storePassword_(res.getResponseText());
  ui.alert(had ? '合言葉を変えました。全員が次に開いたときに新しい合言葉を求められます。' : '合言葉を決めました。ウェブアプリを開いた人はこれを入れます。');
}

/** コンソールが最初に読む一式。auth: { token }。証が無ければデータを返さず、ログインを求める */
function getConsoleData(auth) {
  const ss = ss_();
  if (hasPassword_() && !tokenOk_(auth && auth.token)) return { needLogin: true, hasPassword: true, title: ss.getName(), appUrl: appUrl_() };
  return consoleData_(ss, undefined, isAdmin_(auth));
}

/**
 * 画面に渡す一式。書き込みの関数も、返事にこれを同梱して 2 往復目を無くす。
 * admin は管理者として見ているかどうか。書き込みの関数からは form を渡した結果を入れる
 */
function consoleData_(ss, ctx, admin) {
  ctx = ctx || loadContext_(ss);
  if (autoFinishPast_(ctx) > 0) markDirty_();
  const days = clampInt_(ctx.settings['都合表の日数'], 7, 366, 60);
  const start = startOfDay_(ctx.now);
  const availDays = [];
  for (let i = 0; i < days; i++) availDays.push(ymd_(addDays_(start, i)));
  const isAdm = admin === undefined ? !hasAdminPassword_() : !!admin;
  return {
    title: ss.getName(),
    hasPassword: hasPassword_(),
    isAdmin: isAdm,
    adminSet: hasAdminPassword_(),
    admins: adminNames_(ctx.settings),
    url: isAdm ? ss.getUrl() : '',
    appUrl: appUrl_(),
    today: ymd_(ctx.now),
    loadedAt: fmtDateTime_(ctx.now),
    members: ctx.members.map(m => ({ name: m.name, discordId: m.discordId, note: m.note, hasDiscord: !!m.discordId, idOk: !m.discordId || /^\d{17,20}$/.test(m.discordId) })),
    statuses: STATUS_LIST,
    sessions: ctx.sessions.map(s => ({
      id: s.id, name: s.name, gm: s.gm, members: s.members, date: s.ymd,
      start: s.start, end: s.end, status: s.status, place: s.place, memo: s.memo,
      notified: s.notifiedStamp, editor: s.editor, order: s.order,
      want: s.want, interest: s.interest,
      asked: s.askedStamp, series: s.series, seriesEnd: s.seriesEnd,
      window: s.window, windowFrom: s.windowFrom, windowTo: s.windowTo, windowLabel: s.windowLabel, windowKey: s.windowKey,
      candidates: s.candidates, votes: pollPlain_(ctx.polls[s.id]),
    })),
    avail: ctx.avail,
    notes: ctx.notes,
    availNotes: ctx.availNotes,
    log: recentLog_(ss, 10),
    booked: bookedMap_(ctx),
    availDays: availDays,
    webhookSet: !!String(ctx.settings['Discord Webhook URL'] || '').trim(),
    remindWebhookSet: !!String(ctx.settings[KIND_WEBHOOK.remind.key] || '').trim(),
    recruitWebhookSet: !!String(ctx.settings[KIND_WEBHOOK.recruit.key] || '').trim(),
    notifyDefault: isOn_(ctx.settings['登録時にDiscordへ通知']),
    notifySetter: String(ctx.settings['自動通知の設定者'] || '').trim(),
    settings: {
      webhookMasked: maskUrl_(String(ctx.settings['Discord Webhook URL'] || '').trim()),
      // 種類ごとの送り先。URL は伏せて渡す
      remindWebhookMasked: maskUrl_(String(ctx.settings[KIND_WEBHOOK.remind.key] || '').trim()),
      recruitWebhookMasked: maskUrl_(String(ctx.settings[KIND_WEBHOOK.recruit.key] || '').trim()),
      notifyHour: baseNotifyHour_(ctx.settings),
      notifyDays: baseNotifyDays_(ctx.settings),
      urge: isOn_(ctx.settings[URGE_KEY]),
      soon: isOn_(ctx.settings[SOON_KEY]),
      soonMinutes: soonMinutes_(ctx.settings),
      notifyOnSave: isOn_(ctx.settings['登録時にDiscordへ通知']),
      autoFinish: isOn_(ctx.settings['過ぎた卓を自動で終了']),
      calMonths: clampInt_(ctx.settings['カレンダーの表示月数'], 1, 12, 2),
      availDays: days,
      setter: String(ctx.settings['自動通知の設定者'] || '').trim(),
      triggerMine: hasMyTrigger_(),
    },
    // シリーズごとの通知。URL は伏せて渡す
    seriesNotify: Object.keys(ctx.seriesNotify || {}).sort().map(k => {
      const sn = ctx.seriesNotify[k];
      return { series: k, hasWebhook: !!sn.webhook, webhookMasked: maskUrl_(sn.webhook), alsoBase: sn.alsoBase, days: sn.days, hour: sn.hour };
    }),
  };
}

/** 公開したウェブアプリの URL（…/exec）。未公開や取れないときは空 */
function appUrl_() {
  try { return ScriptApp.getService().getUrl() || ''; } catch (err) { return ''; }
}

function maskUrl_(url) {
  if (!url) return '';
  if (url.length <= 48) return url.slice(0, 30) + '…';
  return url.slice(0, 40) + '…' + url.slice(-4);
}

/** 画面から来た「何日前」と「時刻」を読む。空なら undefined。範囲の外は弾く */
function parseNotifyDays_(v) {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  const d = Number(String(v).trim());
  if (!Number.isInteger(d) || d < 0 || d > NOTIFY_DAYS_MAX) throw new Error('何日前かは 0〜' + NOTIFY_DAYS_MAX + ' の整数です（0 は当日、1 は前日）。');
  return d;
}
function parseNotifyHour_(v) {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  const h = Number(String(v).trim());
  if (!Number.isInteger(h) || h < 0 || h > 23) throw new Error('時刻は 0〜23 です。');
  return h;
}

/** コンソールの設定タブ: 開催前の知らせを有効にする／解除する。form: { enabled, days, hour, me } */
function setAutoNotify(...args) { return withLock_(() => setAutoNotifyLocked_(...args)); }
function setAutoNotifyLocked_(form) {
  requireAdmin_(form, '知らせの設定を変えること');
  const ss = ss_();
  rememberSpreadsheet_(ss);
  ensureReady_(ss);
  let r;
  if (form.enabled) {
    const d = parseNotifyDays_(form.days), h = parseNotifyHour_(form.hour);
    if (d !== undefined) setSetting_(ss, NOTIFY_DAYS_KEY, d);
    if (h !== undefined) setSetting_(ss, NOTIFY_HOUR_KEY, h);
    const me = String(form.me || '').trim();
    r = installTriggers_(ss, (me || '（名前なし）') + '（ウェブアプリ' + (userEmail_() ? '・' + userEmail_() : '') + '）');
  } else {
    r = removeTriggers_(ss);
  }
  markDirty_();
  r.data = consoleData_(ss, undefined, isAdmin_(form));
  return r;
}

/** コンソールの設定タブ: この卓予定（スプレッドシート）の名前を変える。form: { name } */
function renameSpreadsheet(...args) { return withLock_(() => renameSpreadsheetLocked_(...args)); }
function renameSpreadsheetLocked_(form) {
  requireAdmin_(form, '卓予定の名前を変えること');
  const ss = ss_();
  const name = String(form && form.name || '').trim();
  if (!name) throw new Error('名前を入れてください。');
  if (name.length > 80) throw new Error('名前は 80 文字までです。');
  if (name !== ss.getName()) ss.rename(name);
  markDirty_();
  return { ok: true, message: '名前を「' + name + '」にしました。', data: consoleData_(ss, undefined, isAdmin_(form)) };
}

/** コンソールの設定タブ: 設定シートの値を書く。form: { webhook, clearWebhook, days, hour, notifyOnSave, calMonths, availDays } */
function saveConsoleSettings(...args) { return withLock_(() => saveConsoleSettingsLocked_(...args)); }
function saveConsoleSettingsLocked_(form) {
  requireAdmin_(form, '設定を変えること');
  const ss = ss_();
  ensureReady_(ss);
  const changes = [];
  let availDaysChanged = false;
  if (form.webhook !== undefined) {
    const w = String(form.webhook || '').trim();
    if (w) {
      if (!isDiscordWebhook_(w)) {
        throw new Error('Discord の Webhook URL の形ではありません。https://discord.com/api/webhooks/… で始まる URL を貼ってください。');
      }
      setSetting_(ss, 'Discord Webhook URL', w);
      changes.push('Webhook URL');
    } else if (form.clearWebhook) {
      setSetting_(ss, 'Discord Webhook URL', '');
      changes.push('Webhook URL を空に');
    }
  }
  if (form.kindWebhook && typeof form.kindWebhook === 'object') {
    const kw = KIND_WEBHOOK[String(form.kindWebhook.kind || '')];
    if (!kw) throw new Error('知らせの種類が不正です: ' + form.kindWebhook.kind);
    const w = String(form.kindWebhook.url || '').trim();
    if (w) {
      if (!isDiscordWebhook_(w)) throw new Error('Discord の Webhook URL の形ではありません。https://discord.com/api/webhooks/… で始まる URL を貼ってください。');
      setSetting_(ss, kw.key, w);
      changes.push(kw.label + 'の Webhook URL');
    } else if (form.kindWebhook.clear) {
      setSetting_(ss, kw.key, '');
      changes.push(kw.label + 'を外して基本へ');
    }
  }
  let hourChanged = false;
  const nd = parseNotifyDays_(form.days), nh = parseNotifyHour_(form.hour);
  if (nd !== undefined || nh !== undefined) {
    const st0 = getSettings_(ss);
    const d0 = baseNotifyDays_(st0), h0 = baseNotifyHour_(st0);
    const d1 = nd === undefined ? d0 : nd, h1 = nh === undefined ? h0 : nh;
    if (d1 !== d0) setSetting_(ss, NOTIFY_DAYS_KEY, d1);
    if (h1 !== h0) setSetting_(ss, NOTIFY_HOUR_KEY, h1);
    if (d1 !== d0 || h1 !== h0) { changes.push('開催前の知らせ ' + notifyWhenText_(d1, h1)); hourChanged = true; }
  }
  if (form.notifyOnSave !== undefined) {
    setSetting_(ss, '登録時にDiscordへ通知', form.notifyOnSave ? 'ON' : 'OFF');
    changes.push('登録時の通知 ' + (form.notifyOnSave ? 'ON' : 'OFF'));
  }
  if (form.urge !== undefined) {
    setSetting_(ss, URGE_KEY, form.urge ? 'ON' : 'OFF');
    changes.push(URGE_KEY + ' ' + (form.urge ? 'ON' : 'OFF'));
  }
  let soonChanged = false;
  if (form.soonMinutes !== undefined && String(form.soonMinutes) !== '') {
    const n = parseInt(form.soonMinutes, 10);
    if (isNaN(n) || n < 5 || n > 720) throw new Error('開始の何分前かは 5〜720 です。');
    setSetting_(ss, SOON_MIN_KEY, n);
    changes.push('開始の ' + n + ' 分前');
  }
  if (form.soon !== undefined) {
    setSetting_(ss, SOON_KEY, form.soon ? 'ON' : 'OFF');
    changes.push(SOON_KEY + ' ' + (form.soon ? 'ON' : 'OFF'));
    soonChanged = true;
  }
  // 開始直前の知らせを切り替えたら、見回りの間隔（毎時 ⇔ 5 分ごと）も合わせる
  if (soonChanged && ensureNotifyTrigger_(ss)) changes.push(form.soon ? '見回りを ' + SOON_PATROL_MIN + ' 分ごとに' : '見回りを毎時に');
  if (form.autoFinish !== undefined) {
    setSetting_(ss, '過ぎた卓を自動で終了', form.autoFinish ? 'ON' : 'OFF');
    changes.push('過ぎた卓の自動終了 ' + (form.autoFinish ? 'ON' : 'OFF'));
  }
  if (form.calMonths !== undefined && String(form.calMonths) !== '') {
    const n = parseInt(form.calMonths, 10);
    if (isNaN(n) || n < 1 || n > 12) throw new Error('カレンダーの表示月数は 1〜12 です。');
    setSetting_(ss, 'カレンダーの表示月数', n);
    changes.push('表示月数 ' + n);
  }
  if (form.availDays !== undefined && String(form.availDays) !== '') {
    const n = parseInt(form.availDays, 10);
    if (isNaN(n) || n < 7 || n > 366) throw new Error('メンバーの予定の日数は 7〜366 です。');
    if (clampInt_(getSettings_(ss)['都合表の日数'], 7, 366, 60) !== n) availDaysChanged = true;
    setSetting_(ss, '都合表の日数', n);
    changes.push('予定の日数 ' + n);
  }
  if (hourChanged && hasMyTrigger_()) changes.push('次の見回りからこの時刻で送ります');
  // 予定の日数が変わったときだけ、都合シートの行をその場で作り直す（予定表の範囲に直結するため）
  if (availDaysChanged) renderAvailability_(loadContext_(ss));
  markDirty_();
  return { ok: true, message: changes.length ? '保存しました: ' + changes.join('、') : '変更はありません。', data: consoleData_(ss, undefined, isAdmin_(form)) };
}

/**
 * 設定タブの「シリーズごとの通知」。form: { series, webhook, clearWebhook, alsoBase, hour（'' なら基本の時刻）, remove }
 * webhook は変えるときだけ送る（空なら今の値を残す。clearWebhook で空にする）
 */
function saveSeriesNotify(...args) { return withLock_(() => saveSeriesNotifyLocked_(...args)); }
function saveSeriesNotifyLocked_(form) {
  requireAdmin_(form, 'シリーズごとの設定を変えること');
  const ss = ss_();
  ensureReady_(ss);
  const series = String(form.series || '').trim();
  if (!series) throw new Error('シリーズを選んでください。');
  const sh = getOrCreateSheet_(ss, SHEET.SERIES_NOTIFY);
  const cur = getSeriesNotify_(ss)[series];
  if (form.remove) {
    if (cur) sh.deleteRow(cur.row);
    SpreadsheetApp.flush();
    return { ok: true, message: '「' + series + '」の通知の設定を消しました。基本のチャンネルと基本の時刻で送ります。', data: consoleData_(ss, undefined, isAdmin_(form)) };
  }
  let webhook = cur ? cur.webhook : '';
  const w = String(form.webhook || '').trim();
  if (w) {
    if (!isDiscordWebhook_(w)) throw new Error('Discord の Webhook URL の形ではありません。https://discord.com/api/webhooks/… で始まる URL を貼ってください。');
    webhook = w;
  } else if (form.clearWebhook) {
    webhook = '';
  }
  // 何日前と時刻。'' は基本と同じ、渡さなければいまの値のまま
  let days = cur && cur.days !== null ? cur.days : '';
  if (form.days !== undefined && form.days !== null) { const d = parseNotifyDays_(form.days); days = d === undefined ? '' : d; }
  let hour = cur && cur.hour !== null ? cur.hour : '';
  if (form.hour !== undefined && form.hour !== null) { const h = parseNotifyHour_(form.hour); hour = h === undefined ? '' : h; }
  const alsoBase = form.alsoBase === undefined ? (cur ? cur.alsoBase : true) : !!form.alsoBase;
  const row = [series, webhook, alsoBase ? 'ON' : 'OFF', days, hour, fmtDateTime_(new Date())];
  if (cur) sh.getRange(cur.row, 1, 1, row.length).setValues([row]);
  else sh.getRange(Math.max(sh.getLastRow() + 1, 2), 1, 1, row.length).setValues([row]);
  SpreadsheetApp.flush();
  const st = getSettings_(ss);
  const parts = [webhook ? '専用のチャンネルへ' + (alsoBase ? '（基本のチャンネルにも）' : '') : '基本のチャンネルへ',
    days === '' && hour === '' ? '基本と同じ日時（開催日の' + notifyWhenText_(baseNotifyDays_(st), baseNotifyHour_(st)) + '）に' : '開催日の' + notifyWhenText_(days === '' ? baseNotifyDays_(st) : days, hour === '' ? baseNotifyHour_(st) : hour) + 'に'];
  return { ok: true, message: '「' + series + '」の通知を保存しました: ' + parts.join('、') + '送ります。', data: consoleData_(ss, undefined, isAdmin_(form)) };
}

/** シリーズ通知シートの見出しから、列の位置を引く表を作る。旧い版の見出しも読み替える */
function seriesNotifyCols_(sh) {
  const width = Math.max(sh.getLastColumn(), 1);
  const col = {};
  sh.getRange(1, 1, 1, width).getValues()[0].forEach((v, i) => {
    const h = String(v || '').trim();
    const k = OLD_NOTIFY_KEYS[h] || h;
    if (k && col[k] === undefined) col[k] = i;
  });
  return { col: col, width: width };
}
/** シリーズ通知シートを { シリーズ名: { row, webhook, alsoBase, days, hour（数か null） } } に読む */
function getSeriesNotify_(ss) {
  const out = {};
  const sh = ss.getSheetByName(SHEET.SERIES_NOTIFY);
  if (!sh || sh.getLastRow() < 2) return out;
  const c = seriesNotifyCols_(sh), col = c.col;
  const at = (r, key) => col[key] === undefined ? '' : r[col[key]];
  const num = (v, max) => {
    const t = String(v === undefined || v === null ? '' : v).trim();
    const n = t === '' ? NaN : Number(t);
    return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
  };
  sh.getRange(2, 1, sh.getLastRow() - 1, c.width).getValues().forEach((r, i) => {
    const name = String(at(r, 'シリーズ') || '').trim();
    if (!name) return;
    const also = String(at(r, '基本のチャンネルにも送る') || '').trim();
    out[name] = {
      row: i + 2,
      webhook: String(at(r, 'Discord Webhook URL') || '').trim(),
      alsoBase: also === '' ? true : isOn_(also),
      days: num(at(r, NOTIFY_DAYS_KEY), NOTIFY_DAYS_MAX),
      hour: num(at(r, NOTIFY_HOUR_KEY), 23),
    };
  });
  return out;
}
/** シリーズ通知シートの見出しの注と幅 */
function formatSeriesNotify_(sn) {
  sn.getRange(1, 1, 1, SERIES_NOTIFY_HEADER.length).setValues([SERIES_NOTIFY_HEADER]).setFontWeight('bold').setBackground(COLOR.HEAD);
  sn.getRange(1, 2).setNote('このシリーズの卓の知らせを送る Discord のチャンネル（ウェブフックの URL）。空なら基本のチャンネル（「設定」シート）へ送る。');
  sn.getRange(1, 3).setNote('ON なら、専用のチャンネルと基本のチャンネルの両方へ送る。OFF なら専用のチャンネルだけ。');
  sn.getRange(1, 4).setNote('開催前の知らせを送る日。開催日の何日前か（0〜' + NOTIFY_DAYS_MAX + '。0 は当日、1 は前日）。空なら「設定」シートの値。');
  sn.getRange(1, 5).setNote('開催前の知らせを送る時刻（0〜23 の時刻台）。空なら「設定」シートの値。');
  [180, 360, 150, 150, 110, 140].forEach((w, i) => sn.setColumnWidth(i + 1, w));
  sn.setFrozenRows(1);
}
/** 旧い版（何日前の列が無い）のシリーズ通知シートを、いまの列の並びに組み直す */
function migrateSeriesNotify_(sn) {
  const width = Math.max(sn.getLastColumn(), 1);
  const head = sn.getRange(1, 1, 1, width).getValues()[0].map(v => String(v || '').trim());
  if (head.length >= SERIES_NOTIFY_HEADER.length && SERIES_NOTIFY_HEADER.every((h, i) => head[i] === h)) return false;
  const c = seriesNotifyCols_(sn), col = c.col;
  const rows = sn.getLastRow() >= 2 ? sn.getRange(2, 1, sn.getLastRow() - 1, c.width).getValues() : [];
  const out = rows.filter(r => String(r[col['シリーズ']] || '').trim()).map(r => SERIES_NOTIFY_HEADER.map(h => col[h] === undefined ? '' : r[col[h]]));
  sn.clear();
  formatSeriesNotify_(sn);
  if (out.length) sn.getRange(2, 1, out.length, SERIES_NOTIFY_HEADER.length).setValues(out);
  return true;
}

/** コンソールの設定タブ: 接続テスト */
function testDiscordConsole(form) {
  authFor_(form);
  const ss = ss_();
  const ctx = loadContext_(ss);
  if (!String(ctx.settings['Discord Webhook URL'] || '').trim()) throw new Error('Webhook URL が空です。上の欄に貼って「保存」してから試してください。');
  const ok = postDiscord_(ctx, { content: '✅ 卓予定管理から接続テスト（' + ss.getName() + '）' }, '接続テスト', '-');
  if (!ok) throw new Error('送信に失敗しました。URL が正しいか、Discord 側でウェブフックが消えていないか確かめてください。');
  return { ok: true, message: 'Discord に届きました。' };
}

/** 都合シートの 1 マスを書く。mark は ○ △ × か空 */
function setAvailability(...args) { return withLock_(() => setAvailabilityLocked_(...args)); }
function setAvailabilityLocked_(name, ymd, mark, token, me, adminToken) {
  requireSelfOrAdmin_({ token: token, me: me, adminToken: adminToken }, name);
  const ss = ss_();
  name = String(name || '').trim();
  mark = String(mark || '').trim();
  if (!name) throw new Error('名前を選んでください。');
  if (mark && MARKS.indexOf(mark) < 0) throw new Error('印は △ か × です（空欄は参加できる扱い）。');
  const d = toDate_(ymd);
  if (!d) throw new Error('日付が読めません: ' + ymd);
  const sh = availSheetFor_(ss, name);
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(v => String(v).trim());
  const col = header.indexOf(name) + 1;
  if (col < 4) throw new Error('「メンバー」シートに ' + name + ' がありません。');
  const dates = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  const key = ymd_(d);
  let row = 0;
  for (let i = 0; i < dates.length; i++) {
    const x = toDate_(dates[i][0]);
    if (x && ymd_(x) === key) { row = i + 2; break; }
  }
  if (!row) throw new Error(key + ' は都合表の範囲外です。「設定」シートの「都合表の日数」を増やしてください。');
  const booked = bookedMap_(loadContext_(ss));
  if (booked[key] && booked[key][name]) throw new Error(fmtDateJa_(d) + ' は ' + name + ' が卓に入っている日なので、都合は変えられません。');
  const wk = d.getDay() === 0 || d.getDay() === 6;
  const base = key === ymd_(new Date()) ? COLOR.TODAY : wk ? COLOR.WEEKEND : COLOR.WHITE;
  sh.getRange(row, col).setValue(mark)
    .setBackground(mark === '△' ? COLOR.SOFT : mark === '×' ? COLOR.WARN : base);
  SpreadsheetApp.flush();
  markDirty_();
  return { ok: true, name: name, ymd: key, mark: mark };
}

/**
 * 都合シートを返す。無い、または名前の列が無い（メンバーを足した直後など）なら、その場で作り直す
 */
function availSheetFor_(ss, name) {
  let sh = ss.getSheetByName(SHEET.AVAIL);
  const hasCol = () => sh && sh.getLastRow() >= 2 && sh.getLastColumn() >= 4 &&
    sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(v => String(v).trim()).indexOf(name) >= 3;
  if (!hasCol()) {
    const ctx = loadContext_(ss);
    if (!ctx.members.some(m => m.name === name)) throw new Error('「メンバー」シートに ' + name + ' がありません。');
    renderAvailability_(ctx);
    sh = ss.getSheetByName(SHEET.AVAIL);
  }
  return sh;
}

/**
 * 自分の列に、期間と曜日を絞ってまとめて印を入れる。
 * form: { name, from, to, weekdays: [0-6], mark: '△'|'×'|'', keep: true なら入力済みのマスは残す }
 */
function setAvailabilityBulk(...args) { return withLock_(() => setAvailabilityBulkLocked_(...args)); }
function setAvailabilityBulkLocked_(form) {
  requireSelfOrAdmin_(form, form && form.name);
  const ss = ss_();
  const name = String(form.name || '').trim();
  if (!name) throw new Error('名前を選んでください。');
  const mark = String(form.mark || '').trim();
  if (mark && MARKS.indexOf(mark) < 0) throw new Error('印は △ か × です（空欄は参加できる扱い）。');
  const from = toDate_(form.from);
  const to = toDate_(form.to);
  if (!from || !to) throw new Error('期間を入れてください。');
  if (from.getTime() > to.getTime()) throw new Error('期間の始まりが終わりより後になっています。');
  const wds = (Array.isArray(form.weekdays) ? form.weekdays : [0, 1, 2, 3, 4, 5, 6]).map(Number).filter(n => n >= 0 && n <= 6);
  if (!wds.length) throw new Error('曜日を選んでください。');
  const keep = !!form.keep;
  const sh = availSheetFor_(ss, name);
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(v => String(v).trim());
  const col = header.indexOf(name) + 1;
  if (col < 4) throw new Error('「メンバー」シートに ' + name + ' がありません。');
  const n = sh.getLastRow() - 1;
  const dates = sh.getRange(2, 1, n, 1).getValues();
  const rng = sh.getRange(2, col, n, 1);
  const vals = rng.getValues();
  const bgs = rng.getBackgrounds();
  const booked = bookedMap_(loadContext_(ss));
  const todayKey = ymd_(new Date());
  let count = 0, skippedBooked = 0, skippedKeep = 0;
  for (let i = 0; i < n; i++) {
    const d = toDate_(dates[i][0]);
    if (!d || d.getTime() < from.getTime() || d.getTime() > to.getTime()) continue;
    if (wds.indexOf(d.getDay()) < 0) continue;
    const key = ymd_(d);
    if (booked[key] && booked[key][name]) { skippedBooked++; continue; }
    const cur = String(vals[i][0] || '').trim();
    if (cur === mark) continue;
    if (keep && cur) { skippedKeep++; continue; }
    const wk = d.getDay() === 0 || d.getDay() === 6;
    const base = key === todayKey ? COLOR.TODAY : wk ? COLOR.WEEKEND : COLOR.WHITE;
    vals[i][0] = mark;
    bgs[i][0] = mark === '△' ? COLOR.SOFT : mark === '×' ? COLOR.WARN : base;
    count++;
  }
  if (count) {
    rng.setValues(vals).setBackgrounds(bgs);
    SpreadsheetApp.flush();
    markDirty_();
  }
  let msg = name + ' の ' + count + ' 日に「' + (mark || '空欄') + '」を入れました。';
  const notes = [];
  if (skippedBooked) notes.push('卓の日 ' + skippedBooked + ' 日');
  if (skippedKeep) notes.push('入力済み ' + skippedKeep + ' 日');
  if (notes.length) msg += '（' + notes.join('、') + 'は飛ばしました）';
  return { ok: true, count: count, skippedBooked: skippedBooked, skippedKeep: skippedKeep, message: msg, data: consoleData_(ss, undefined, isAdmin_(form)) };
}

/** 紐付いたスプレッドシート。Web アプリからはアクティブが取れないことがあるので ID でも引けるようにする */
function ss_() {
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (err) { ss = null; }
  if (ss) return ss;
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('スプレッドシートが見つかりません。シート側でメニュー「卓予定 → 初期設定」を一度実行してください。');
  return SpreadsheetApp.openById(id);
}

function rememberSpreadsheet_(ss) {
  try { PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId()); } catch (err) { Logger.log('rememberSpreadsheet_: ' + err); }
}

/* ---------------------------------------------------------
 * 登録・削除（Console.html から呼ばれる）
 * --------------------------------------------------------- */

/** シートのメニューから、公開済みのウェブアプリの URL を出す */
function showWebAppUrl() {
  let url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (err) { url = ''; }
  const ui = SpreadsheetApp.getUi();
  if (!url) {
    ui.alert('まだウェブアプリとして公開されていません。\nApps Script エディタの「デプロイ → 新しいデプロイ → ウェブアプリ」で公開すると、ここに URL が出ます。');
    return;
  }
  const safe = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const html = HtmlService.createHtmlOutput(
    '<div style="font:14px/1.6 sans-serif;padding:4px 8px">登録・編集と都合の入力はこの画面で行います。<br>' +
    '<a href="' + safe + '" target="_blank" rel="noopener">' + safe + '</a><br>' +
    '<input type="text" value="' + safe + '" readonly style="width:100%;margin-top:8px;font:13px monospace" onclick="this.select()"></div>'
  ).setWidth(560).setHeight(150);
  ui.showModalDialog(html, 'ウェブアプリ');
}

function saveSession(...args) { return withLock_(() => saveSessionLocked_(...args)); }
function saveSessionLocked_(form) {
  authFor_(form);
  const ss = ss_();
  ensureReady_(ss);
  const name = String(form.name || '').trim();
  if (!name) throw new Error('卓の名前を入れてください。');
  const dates = Array.isArray(form.dates) ? uniq_(form.dates.map(d => String(d || '').trim()).filter(Boolean)).sort() : [];
  if (dates.length > 1) return saveSessionDates_(ss, form, name, dates);
  const rawStatus = form.status;
  const status = STATUS_LIST.indexOf(rawStatus) >= 0 ? rawStatus : (OLD_STATUS[rawStatus] || STATUS.HELD);
  const date = form.date ? toDate_(form.date) : null;
  if (form.date && !date) throw new Error('開催日の形式が読めません: ' + form.date);
  if (!date && DATED.indexOf(status) >= 0) {
    throw new Error('開催日を入れてください。まだ決まっていなければ状態を「募集」か「調整中」にします。');
  }
  // 期間。募集は「開催したい期間」、調整中は「候補の期間」。この 2 つの状態だけが持つ
  const winText = (status === STATUS.RECRUIT || status === STATUS.ADJUSTING) ? windowTextOf_(form.windowFrom, form.windowTo) : '';
  const gm = String(form.gm || '').trim();
  const series = String(form.series || '').trim();
  let members = uniq_(splitNames_((form.members || []).join('、') + '、' + (form.extra || '')));
  const me = String(form.me || '').trim();
  if (me) PropertiesService.getUserProperties().setProperty('me', me);

  const sh = ss.getSheetByName(SHEET.SESSIONS);
  const ctx = loadContext_(ss);
  const existing = form.id ? ctx.sessions.filter(s => s.id === form.id)[0] : null;
  const id = existing ? existing.id : nextSessionId_(ctx.sessions);
  const row = existing ? existing.row : Math.max(sh.getLastRow() + 1, 2);
  const dateChanged = !existing || (existing.ymd !== (date ? ymd_(date) : ''));
  // 参加希望・興味あり。参加者や GM になった人は外す。状態が「調整中」「開催」になったら、参加希望の人を参加者に移す
  const notIn = n => members.indexOf(n) < 0 && n !== gm;
  let want = existing ? existing.want.filter(notIn) : [];
  let interest = existing ? existing.interest.filter(notIn) : [];
  let promoted = [], dropped = [];
  if (existing && existing.status === STATUS.RECRUIT && PROMOTE.indexOf(status) >= 0) {
    // 募集をやめて日程を決める卓になった。参加希望はそのまま参加者に、興味ありは画面で選ばれた人だけ参加者に入っている
    promoted = want.slice();
    members = uniq_(members.concat(promoted));
    want = [];
    dropped = interest.filter(n => members.indexOf(n) < 0);
    interest = [];
  }
  const values = [];
  values[SC.ID] = id;
  values[SC.NAME] = name;
  values[SC.GM] = gm;
  values[SC.MEMBERS] = members.join('、');
  values[SC.DATE] = date || '';
  values[SC.START] = normTime_(form.start);
  values[SC.END] = normTime_(form.end);
  values[SC.STATUS] = status;
  values[SC.PLACE] = String(form.place || '').trim();
  values[SC.MEMO] = String(form.memo || '').trim();
  values[SC.EDITOR] = me || userEmail_();
  values[SC.UPDATED] = fmtDateTime_(new Date());
  values[SC.NOTIFIED] = (existing && !dateChanged && existing.notifiedStamp) || '';
  values[SC.PERIOD] = '';   // 旧い「募集時期」の列。いまは期間に入れる
  values[SC.WANT] = want.join('、');
  values[SC.INTEREST] = interest.join('、');
  values[SC.ASK] = existing && status === STATUS.RECRUIT ? existing.askedStamp : '';
  values[SC.SERIES] = series;
  values[SC.SERIES_END] = series ? seriesEndText_(form.seriesEnd) : '';
  values[SC.WINDOW] = winText;
  values[SC.CANDS] = existing && status === STATUS.ADJUSTING ? candsText_(existing.candidates) : '';
  // 期間を変えたら期間前の催促を、開催日か開始時刻を変えたら開始直前の知らせを、もう一度送れるようにする
  values[SC.URGED] = (existing && existing.window === winText && existing.urgedStamp) || '';
  values[SC.SOON] = (existing && !dateChanged && existing.start === values[SC.START] && existing.soonStamp) || '';
  sh.getRange(row, 1, 1, SESSION_HEADER.length).setValues([values]);
  sh.getRange(row, SC.DATE + 1).setNumberFormat('yyyy/mm/dd');
  // 単発の卓から「続けて登録」したときは、元の回にも同じシリーズ名を入れて 1 つのシリーズにする
  const linked = series && form.seriesFrom ? linkSeries_(ss, String(form.seriesFrom), series, values[SC.SERIES_END]) : 0;
  SpreadsheetApp.flush();

  const ctx2 = loadContext_(ss);
  markDirty_();
  const saved = ctx2.sessions.filter(s => s.id === id)[0];
  let msg = (existing ? '更新しました: ' : '登録しました: ') + name + '（' + id + '）';
  if (linked) msg += '　前の回も「' + series + '」にまとめました。';
  if (promoted.length) msg += '　参加希望の ' + promoted.join('、') + ' を参加者に加えました。';
  if (dropped.length) msg += '　興味ありの ' + dropped.join('、') + ' は外しました。';
  if (form.notify && saved) {
    const ok = notifyChange_(ctx2, saved, existing ? '変更' : '登録');
    msg += ok ? '　Discord に送りました。' : '　Discord への送信は失敗しました。';
  }
  return { ok: true, id: id, message: msg, promoted: promoted, dropped: dropped, data: consoleData_(ss, ctx2, isAdmin_(form)) };
}

/** シリーズの最終日。読めなければ空にする。この日を過ぎたシリーズは、登録画面の候補から消える */
function seriesEndText_(v) {
  const d = v ? toDate_(v) : null;
  return d ? d : '';
}

/**
 * 「続けて登録」で単発の卓からシリーズを作ったとき、元の回にも同じシリーズ名（と最終日）を入れる。
 * 元の回にすでにシリーズ名があれば触らない。書き換えた行数を返す
 */
function linkSeries_(ss, fromId, series, seriesEnd) {
  const sh = ss.getSheetByName(SHEET.SESSIONS);
  const src = getSessions_(ss).filter(x => x.id === fromId)[0];
  if (!src || src.series) return 0;
  sh.getRange(src.row, SC.SERIES + 1).setValue(series);
  if (seriesEnd) sh.getRange(src.row, SC.SERIES_END + 1).setValue(seriesEnd);
  return 1;
}

/**
 * 複数の開催日をまとめて登録する（新規だけ）。GM・参加者・時間・場所・メモ・シリーズは全部同じ。
 * 名前は末尾の数字を進める（「#1」→「#2」）。数字が無ければ「名前 #1」「名前 #2」
 */
function saveSessionDates_(ss, form, name, dates) {
  if (form.id) throw new Error('複数日をまとめて登録できるのは新規のときだけです。');
  const status = STATUS_LIST.indexOf(form.status) >= 0 ? form.status : (OLD_STATUS[form.status] || STATUS.HELD);
  if (DATED.indexOf(status) < 0) throw new Error('複数日をまとめて登録するときは、状態を「開催」にします。');
  const ds = dates.map(d => { const x = toDate_(d); if (!x) throw new Error('開催日の形式が読めません: ' + d); return x; });
  const gm = String(form.gm || '').trim();
  const series = String(form.series || '').trim();
  const members = uniq_(splitNames_((form.members || []).join('、') + '、' + (form.extra || '')));
  const me = String(form.me || '').trim();
  if (me) PropertiesService.getUserProperties().setProperty('me', me);
  const sh = ss.getSheetByName(SHEET.SESSIONS);
  const ctx = loadContext_(ss);
  const m = /^(.*?)(\d+)(\D*)$/.exec(name);
  const names = ds.map((d, i) => (i === 0 ? name : m ? m[1] + (Number(m[2]) + i) + m[3] : name + ' #' + (i + 1)));
  const list = ctx.sessions.slice();
  const stamp = fmtDateTime_(new Date());
  const rows = ds.map((d, i) => {
    const id = nextSessionId_(list);
    list.push({ id: id });
    const v = fill_([], SESSION_HEADER.length, '');
    v[SC.ID] = id; v[SC.NAME] = names[i]; v[SC.GM] = gm; v[SC.MEMBERS] = members.join('、'); v[SC.DATE] = d;
    v[SC.START] = normTime_(form.start); v[SC.END] = normTime_(form.end); v[SC.STATUS] = status;
    v[SC.PLACE] = String(form.place || '').trim(); v[SC.MEMO] = String(form.memo || '').trim();
    v[SC.EDITOR] = me || userEmail_(); v[SC.UPDATED] = stamp; v[SC.SERIES] = series;
    v[SC.SERIES_END] = series ? seriesEndText_(form.seriesEnd) : '';
    return v;
  });
  const start = Math.max(sh.getLastRow() + 1, 2);
  sh.getRange(start, 1, rows.length, SESSION_HEADER.length).setValues(rows);
  sh.getRange(start, SC.DATE + 1, rows.length, 1).setNumberFormat('yyyy/mm/dd');
  SpreadsheetApp.flush();
  markDirty_();
  const ids = rows.map(v => v[SC.ID]);
  return { ok: true, id: ids[0], ids: ids, names: names, count: rows.length, message: rows.length + ' 回分を登録しました: ' + names.join('、'), data: consoleData_(ss, undefined, isAdmin_(form)) };
}

/**
 * 募集タブの「参加希望」「興味あり」「取り消す」。form: { id, name, level: 'want' | 'interest' | 'none' }
 * 片方だけ付く。Discord には送らない。状態が「調整中」「開催」になったとき、参加希望の人はそのまま参加者になる
 */
function setInterest(...args) { return withLock_(() => setInterestLocked_(...args)); }
function setInterestLocked_(form) {
  requireSelfOrAdmin_(form, form && form.name);
  const ss = ss_();
  ensureReady_(ss);
  const name = String(form.name || '').trim();
  if (!name) throw new Error('上の「あなた」で自分を選んでください。');
  const level = String(form.level || 'none');
  if (['want', 'interest', 'none'].indexOf(level) < 0) throw new Error('操作が不正です: ' + level);
  const ctx = loadContext_(ss);
  const s = ctx.sessions.filter(x => x.id === String(form.id || ''))[0];
  if (!s) throw new Error('その卓が見つかりません: ' + form.id);
  if (s.status !== STATUS.RECRUIT) throw new Error('「' + s.name + '」は募集中ではありません（' + s.status + '）。');
  if (level !== 'none' && peopleOf_(s).indexOf(name) >= 0) {
    throw new Error(name + ' はすでにこの卓の' + (s.gm === name ? 'GM' : '参加者') + 'です。');
  }
  const want = s.want.filter(n => n !== name);
  const interest = s.interest.filter(n => n !== name);
  if (level === 'want') want.push(name);
  if (level === 'interest') interest.push(name);
  const sh = ss.getSheetByName(SHEET.SESSIONS);
  sh.getRange(s.row, SC.WANT + 1, 1, 2).setValues([[want.join('、'), interest.join('、')]]);
  sh.getRange(s.row, SC.UPDATED + 1).setValue(fmtDateTime_(new Date()));
  SpreadsheetApp.flush();
  markDirty_();
  const msg = level === 'want' ? '「' + s.name + '」に参加希望を出しました: ' + name
    : level === 'interest' ? '「' + s.name + '」に興味ありを付けました: ' + name
    : '「' + s.name + '」への希望を取り消しました: ' + name;
  return { ok: true, id: s.id, level: level, message: msg, data: consoleData_(ss, undefined, isAdmin_(form)) };
}

function deleteSession(...args) { return withLock_(() => deleteSessionLocked_(...args)); }
function deleteSessionLocked_(form) {
  requireAdmin_(form, '卓の削除');
  const ss = ss_();
  const ctx = loadContext_(ss);
  const s = ctx.sessions.filter(x => x.id === form.id)[0];
  if (!s) throw new Error('その ID の卓が見つかりません: ' + form.id);
  const me = String(form.me || '').trim();
  s.editor = me || s.editor;
  ss.getSheetByName(SHEET.SESSIONS).deleteRow(s.row);
  deletePollRows_(ss, s.id);
  SpreadsheetApp.flush();
  const ctx2 = loadContext_(ss);
  markDirty_();
  let msg = '削除しました: ' + s.name;
  if (form.notify) {
    const ok = notifyChange_(ctx2, s, '削除');
    msg += ok ? '　Discord に送りました。' : '　Discord への送信は失敗しました。';
  }
  return { ok: true, message: msg, data: consoleData_(ss, ctx2, isAdmin_(form)) };
}

/** メンバーを追加・更新する。form: { name, discordId, note, oldName } */
function saveMember(...args) { return withLock_(() => saveMemberLocked_(...args)); }
function saveMemberLocked_(form) {
  requireAdmin_(form, 'メンバーの追加や変更');
  const ss = ss_();
  ensureReady_(ss);
  const name = String(form.name || '').trim();
  if (!name) throw new Error('名前を入れてください。');
  if (/[、,，;；\n\/／]/.test(name)) throw new Error('名前に区切り文字（、 , ; /）は使えません。');
  if (name === TARGET_ALL || name === TARGET_NONE) throw new Error('その名前は使えません: ' + name);
  const oldName = String(form.oldName || '').trim();
  const discordId = String(form.discordId || '').trim().replace(/[<@!>\s]/g, '');
  if (discordId && !/^\d{5,}$/.test(discordId)) throw new Error('Discord ユーザーID は数字だけです（例: 123456789012345678）。');
  const note = String(form.note || '').trim();
  const sh = ss.getSheetByName(SHEET.MEMBERS);
  const rows = sh.getLastRow() >= 2 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues() : [];
  let target = 0;
  rows.forEach((r, i) => { if (oldName && String(r[0] || '').trim() === oldName) target = i + 2; });
  if (oldName && !target) throw new Error('編集対象が見つかりません: ' + oldName);
  rows.forEach((r, i) => {
    if (String(r[0] || '').trim() === name && i + 2 !== target) throw new Error('同じ名前のメンバーがいます: ' + name);
  });
  const row = target || Math.max(sh.getLastRow() + 1, 2);
  sh.getRange(row, 1, 1, 3).setValues([[name, discordId, note]]);
  sh.getRange(row, 2).setNumberFormat('@');
  if (target && oldName !== name) renameMember_(ss, oldName, name);
  SpreadsheetApp.flush();
  markDirty_();
  return { ok: true, name: name, message: (target ? '更新しました: ' : '追加しました: ') + name, data: consoleData_(ss, undefined, isAdmin_(form)) };
}

/** メンバーを消す。卓の GM・参加者に残っている名前はそのまま（管理表に「メンバーに無い参加者」として出る） */
function deleteMember(...args) { return withLock_(() => deleteMemberLocked_(...args)); }
function deleteMemberLocked_(form) {
  requireAdmin_(form, 'メンバーを外すこと');
  const ss = ss_();
  const name = String(form.name || '').trim();
  const sh = ss.getSheetByName(SHEET.MEMBERS);
  if (!sh || sh.getLastRow() < 2) throw new Error('メンバーがいません。');
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  let row = 0;
  for (let i = 0; i < rows.length; i++) if (String(rows[i][0] || '').trim() === name) { row = i + 2; break; }
  if (!row) throw new Error('見つかりません: ' + name);
  sh.deleteRow(row);
  SpreadsheetApp.flush();
  markDirty_();
  return { ok: true, message: '削除しました: ' + name, data: consoleData_(ss, undefined, isAdmin_(form)) };
}

/** 名前の変更を、セッションの GM・参加者と都合表の見出しに反映する */
function renameMember_(ss, oldName, newName) {
  const an = ss.getSheetByName(SHEET.AVAIL_NOTES);
  if (an && an.getLastRow() >= 2) {
    const rng = an.getRange(2, 2, an.getLastRow() - 1, 1);
    const vals = rng.getValues();
    let changed = false;
    vals.forEach(r => { if (String(r[0] || '').trim() === oldName) { r[0] = newName; changed = true; } });
    if (changed) rng.setValues(vals);
  }
  const ses = ss.getSheetByName(SHEET.SESSIONS);
  if (ses && ses.getLastRow() >= 2) {
    const rng = ses.getRange(2, SC.GM + 1, ses.getLastRow() - 1, 2);
    const vals = rng.getValues();
    let changed = false;
    vals.forEach(r => {
      if (String(r[0] || '').trim() === oldName) { r[0] = newName; changed = true; }
      const names = splitNames_(r[1]);
      if (names.indexOf(oldName) >= 0) { r[1] = names.map(x => (x === oldName ? newName : x)).join('、'); changed = true; }
    });
    if (changed) rng.setValues(vals);
  }
  const av = ss.getSheetByName(SHEET.AVAIL);
  if (av && av.getLastColumn() >= 4) {
    const header = av.getRange(1, 1, 1, av.getLastColumn()).getValues()[0];
    for (let c = 3; c < header.length; c++) {
      if (String(header[c] || '').trim() === oldName) av.getRange(1, c + 1).setValue(newName);
    }
  }
}

/**
 * 複数の卓をまとめて変える。form: { ids, action, value, notify, me }
 * action: status / addMember / removeMember / setGm / shiftDays / delete
 */
function bulkUpdateSessions(...args) { return withLock_(() => bulkUpdateSessionsLocked_(...args)); }
function bulkUpdateSessionsLocked_(form) {
  requireAdmin_(form, '卓をまとめて変えること');
  const ss = ss_();
  ensureReady_(ss);
  const ids = (form.ids || []).map(String);
  if (!ids.length) throw new Error('卓を選んでください。');
  const action = String(form.action || '');
  const value = String(form.value === undefined || form.value === null ? '' : form.value).trim();
  const me = String(form.me || '').trim();
  const ctx = loadContext_(ss);
  const targets = ctx.sessions.filter(s => ids.indexOf(s.id) >= 0);
  if (!targets.length) throw new Error('選んだ卓が見つかりません。');

  // 先に検査して、途中で止まらないようにする
  let label = '';
  let days = 0;
  if (action === 'status') {
    if (STATUS_LIST.indexOf(value) < 0) throw new Error('状態が不正です: ' + value);
    const noDate = targets.filter(s => !s.date);
    if (DATED.indexOf(value) >= 0 && noDate.length) throw new Error('開催日が無いので「' + value + '」にできません: ' + noDate.map(s => s.name).join('、'));
    label = '状態を「' + value + '」に';
  } else if (action === 'addMember' || action === 'removeMember' || action === 'setGm') {
    if (!value) throw new Error('名前を選んでください。');
    label = action === 'addMember' ? '参加者に ' + value + ' を追加' : action === 'removeMember' ? '参加者から ' + value + ' を外す' : 'GM を ' + value + ' に';
  } else if (action === 'shiftDays') {
    days = parseInt(value, 10);
    if (isNaN(days) || days === 0) throw new Error('ずらす日数を入れてください（例: 7 や -1）。');
    label = '開催日を ' + (days > 0 ? '+' : '') + days + ' 日';
  } else if (action === 'setSeries') {
    label = value ? 'シリーズを「' + value + '」に' : 'シリーズを外す';
  } else if (action === 'delete') {
    label = '削除';
  } else {
    throw new Error('操作が不正です: ' + action);
  }

  const sh = ss.getSheetByName(SHEET.SESSIONS);
  const stamp = fmtDateTime_(new Date());
  const promoted = [];
  if (action === 'delete') {
    targets.slice().sort((a, b) => b.row - a.row).forEach(s => sh.deleteRow(s.row));
    targets.forEach(s => deletePollRows_(ss, s.id));
  } else {
    targets.forEach(s => {
      const rng = sh.getRange(s.row, 1, 1, SESSION_HEADER.length);
      const v = rng.getValues()[0];
      v[SC.STATUS] = s.status;   // 読み替えた状態で書く
      if (action === 'status') {
        v[SC.STATUS] = value;
        if (PROMOTE.indexOf(value) >= 0 && s.want.length) {
          // 参加希望の人を参加者に移す
          const add = s.want.filter(n => s.members.indexOf(n) < 0 && n !== s.gm);
          v[SC.MEMBERS] = uniq_(s.members.concat(add)).join('、');
          v[SC.WANT] = '';
          add.forEach(n => promoted.push(n + '（' + s.name + '）'));
        }
        if (value !== STATUS.RECRUIT) v[SC.ASK] = '';
        if (value !== STATUS.ADJUSTING) v[SC.CANDS] = '';
        // 期間を持つのは募集と調整中だけ。そこから出たら期間と催促の印を消す
        if (value !== STATUS.RECRUIT && value !== STATUS.ADJUSTING) { v[SC.WINDOW] = ''; v[SC.URGED] = ''; }
      } else if (action === 'addMember') {
        v[SC.MEMBERS] = uniq_(s.members.concat([value])).join('、');
      } else if (action === 'removeMember') {
        v[SC.MEMBERS] = s.members.filter(n => n !== value).join('、');
      } else if (action === 'setGm') {
        v[SC.GM] = value;
      } else if (action === 'setSeries') {
        v[SC.SERIES] = value;
      } else if (action === 'shiftDays') {
        if (!s.date) return;
        v[SC.DATE] = addDays_(s.date, days);
        v[SC.NOTIFIED] = '';
        v[SC.SOON] = '';
      }
      if (me) v[SC.EDITOR] = me;
      v[SC.UPDATED] = stamp;
      rng.setValues([v]);
    });
  }
  SpreadsheetApp.flush();
  const ctx2 = loadContext_(ss);
  markDirty_();
  let msg = targets.length + ' 件を' + label + 'しました: ' + targets.map(s => s.name).join('、');
  if (promoted.length) msg += '　参加希望の人を参加者に加えました: ' + promoted.join('、');
  if (form.notify && String(ctx2.settings['Discord Webhook URL'] || '').trim()) {
    const ok = postDiscord_(ctx2, {
      content: '🔁 卓の予定を一括で' + label + (me ? '（' + me + '）' : '') + '\n' + targets.map(s => '・' + s.name).join('\n'),
    }, '一括変更', targets.map(s => s.name).join('、'));
    msg += ok ? '　Discord に送りました。' : '　Discord への送信は失敗しました。';
  }
  return { ok: true, count: targets.length, message: msg, names: targets.map(s => s.name), label: label, data: consoleData_(ss, ctx2, isAdmin_(form)) };
}

/** コンソールの「Discord に通知」ボタン。卓 1 件の案内をいま送る。今日が開催前の知らせの日なら、開催前の知らせ済みの印も付ける */
function notifySessionNow(...args) { return withLock_(() => notifySessionNowLocked_(...args)); }
function notifySessionNowLocked_(form) {
  authFor_(form);
  const ss = ss_();
  const ctx = loadContext_(ss);
  const s = ctx.sessions.filter(x => x.id === String(form.id || ''))[0];
  if (!s) throw new Error('その卓が見つかりません: ' + form.id);
  const targets = sessionTargets_(ctx, s);
  if (!targets.length) throw new Error('「設定」シートの Discord Webhook URL が空です。');
  const me = String(form.me || '').trim();
  const ok = postToTargets_(ctx, announcePayload_(ctx, s, me), '案内', s.name, targets);
  if (!ok) throw new Error('Discord への送信に失敗しました。通知ログを確認してください。');
  let msg = 'Discord に送りました: ' + s.name;
  if (DATED.indexOf(s.status) >= 0 && notifyYmdOf_(ctx, s) === ymd_(ctx.now)) {
    ss.getSheetByName(SHEET.SESSIONS).getRange(s.row, SC.NOTIFIED + 1).setValue(fmtDateTime_(new Date()));
    SpreadsheetApp.flush();
    markDirty_();
    msg += '（今日が開催前の知らせの日なので、開催前の知らせ済みにしました）';
  }
  return { ok: true, message: msg, data: consoleData_(ss, undefined, isAdmin_(form)) };
}

function nextSessionId_(sessions) {
  let max = 0;
  sessions.forEach(s => {
    const m = /^S(\d+)$/.exec(s.id);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return 'S' + ('000' + (max + 1)).slice(-3);
}

/* ---------------------------------------------------------
 * サンプルデータ
 * --------------------------------------------------------- */

function seedSample() {
  const ss = ss_();
  ensureSheets_(ss);
  const ui = SpreadsheetApp.getUi();
  const res = ui.alert('サンプルのメンバー 4 人と卓 4 件を追加します。よろしいですか？', ui.ButtonSet.OK_CANCEL);
  if (res !== ui.Button.OK) return;
  seedSample_(ss, new Date());
  refreshAll_(loadContext_(ss));
  ui.alert('サンプルを入れました。「セッション」「メンバー」シートの行を消せば元に戻ります。');
}

function seedSample_(ss, now) {
  const mem = ss.getSheetByName(SHEET.MEMBERS);
  const names = ['アリス', 'ボブ', 'カレン', 'ダン'];
  const have = getMembers_(ss).map(m => m.name);
  const add = names.filter(n => have.indexOf(n) < 0).map(n => [n, '', 'サンプル']);
  if (add.length) mem.getRange(Math.max(mem.getLastRow() + 1, 2), 1, add.length, 3).setValues(add);

  const sessions = getSessions_(ss);
  const sh = ss.getSheetByName(SHEET.SESSIONS);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const recruitWindow = windowOf_(nextMonth, new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 15)).text;
  const rows = [
    ['鉄鳴界の夜明け #1', 'アリス', 'ボブ、カレン、ダン', addDays_(now, 1), '20:00', '23:00', STATUS.HELD, 'Discord ボイス', 'キャンペーンの第 1 回', 'サンプル', fmtDateTime_(now), '', '', '', '', '', '鉄鳴界の夜明け'],
    ['連れて帰る', 'ボブ', 'アリス、カレン', addDays_(now, 9), '14:00', '18:00', STATUS.HELD, '', 'サンプル', 'サンプル', fmtDateTime_(now), '', '', '', ''],
    ['新キャンペーン顔合わせ', 'カレン', 'アリス、ボブ', '', '', '', STATUS.RECRUIT, '', '募集中のサンプル。状態を「開催」にすると、参加希望の人が参加者になる', 'サンプル', fmtDateTime_(now), '', '', 'ダン', '', '', '', recruitWindow],
    ['迷宮の底へ', 'ダン', 'アリス、カレン', '', '', '', STATUS.ADJUSTING, '', '日程を選んでいるサンプル。候補の期間のどこかで開く', 'サンプル', fmtDateTime_(now), '', '', '', '', '', '', windowOf_(addDays_(now, 14), addDays_(now, 28)).text],
  ];
  const out = [];
  const list = sessions.slice();
  rows.forEach(r => {
    if (sessions.some(s => s.name === r[0])) return;
    const id = nextSessionId_(list);
    list.push({ id: id });
    out.push(fill_([id].concat(r), SESSION_HEADER.length, ''));
  });
  if (out.length) {
    const start = Math.max(sh.getLastRow() + 1, 2);
    sh.getRange(start, 1, out.length, SESSION_HEADER.length).setValues(out);
  }

  // 都合のサンプル。3 日後と 12 日後は全員空き、それ以外は △× をばらつかせる（卓の日は「参」「GM」に置き換わる）
  const av = getOrCreateSheet_(ss, SHEET.AVAIL);
  renderAvailability_(loadContext_(ss));
  const lastRow = av.getLastRow();
  const lastCol = av.getLastColumn();
  if (lastRow >= 2 && lastCol > 3) {
    const header = av.getRange(1, 1, 1, lastCol).getValues()[0];
    const dates = av.getRange(2, 1, lastRow - 1, 1).getValues();
    const rng = av.getRange(2, 4, lastRow - 1, lastCol - 3);
    const cur = rng.getValues();
    for (let i = 0; i < dates.length; i++) {
      const d = toDate_(dates[i][0]);
      const n = d ? daysBetween_(now, d) : -1;
      for (let c = 3; c < header.length; c++) {
        if (names.indexOf(String(header[c])) < 0) continue;
        cur[i][c - 3] = (n === 3 || n === 12) ? '' : sampleMark_(n, c);
      }
    }
    rng.setValues(cur);
  }
}

function sampleMark_(n, c) {
  const v = (n * 7 + c * 13) % 10;
  if (v < 6) return '';
  if (v < 8) return '△';
  return '×';
}

/* ---------------------------------------------------------
 * データ読み込み
 * --------------------------------------------------------- */

function loadContext_(ss) {
  const settings = getSettings_(ss);
  const members = getMembers_(ss);
  const memberByName = {};
  members.forEach(m => { memberByName[m.name] = m; });
  return {
    ss: ss,
    settings: settings,
    members: members,
    memberByName: memberByName,
    sessions: getSessions_(ss),
    avail: getAvailability_(ss),
    notes: getDayNotes_(ss),
    availNotes: getAvailNotes_(ss),
    polls: getPollVotes_(ss),
    seriesNotify: getSeriesNotify_(ss),
    now: new Date(),
  };
}

function getSettings_(ss) {
  const out = {};
  DEFAULT_SETTINGS.forEach(r => { out[r[0]] = r[1]; });
  const sh = ss.getSheetByName(SHEET.SETTINGS);
  if (!sh || sh.getLastRow() < 2) return out;
  const have = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
    const k = String(r[0] || '').trim();
    if (k) { out[k] = r[1]; have[k] = true; }
  });
  // 旧い版の項目名（シートを整え直す前でも読めるように）
  Object.keys(OLD_NOTIFY_KEYS).forEach(o => { if (have[o] && !have[OLD_NOTIFY_KEYS[o]]) out[OLD_NOTIFY_KEYS[o]] = out[o]; });
  return out;
}

function setSetting_(ss, key, value) {
  const sh = getOrCreateSheet_(ss, SHEET.SETTINGS);
  const last = sh.getLastRow();
  if (last >= 2) {
    const keys = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      const k = String(keys[i][0]).trim();
      if (k === key) { sh.getRange(i + 2, 2).setValue(value); return; }
    }
    // 旧い版の項目名で残っていれば、その行を今の名前に直して書く
    for (let i = 0; i < keys.length; i++) {
      if (OLD_NOTIFY_KEYS[String(keys[i][0]).trim()] === key) {
        const d0 = DEFAULT_SETTINGS.filter(r => r[0] === key)[0];
        sh.getRange(i + 2, 1, 1, 3).setValues([[key, value, d0 ? d0[2] : '']]);
        return;
      }
    }
  }
  const def = DEFAULT_SETTINGS.filter(r => r[0] === key)[0];
  sh.appendRow([key, value, def ? def[2] : '']);
}

function getMembers_(ss) {
  const sh = ss.getSheetByName(SHEET.MEMBERS);
  if (!sh || sh.getLastRow() < 2) return [];
  const out = [];
  const seen = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(r => {
    const name = String(r[0] || '').trim();
    if (!name || seen[name]) return;
    seen[name] = true;
    out.push({ name: name, discordId: String(r[1] || '').trim().replace(/[<@!>]/g, ''), note: String(r[2] || '') });
  });
  return out;
}

function getSessions_(ss) {
  const sh = ss.getSheetByName(SHEET.SESSIONS);
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, SESSION_HEADER.length).getValues();
  const out = [];
  values.forEach((r, i) => {
    const name = String(r[SC.NAME] || '').trim();
    const id = String(r[SC.ID] || '').trim();
    if (!name && !id) return;
    const date = toDate_(r[SC.DATE]);
    const rawStatus = String(r[SC.STATUS] || '').trim();
    const status = OLD_STATUS[rawStatus] || rawStatus;
    // 期間。まだシートを整え直していない古い行は、旧い「募集時期」を期間として読む
    let win = parseWindow_(r[SC.WINDOW]);
    if (!win) { const p = parsePeriod_(r[SC.PERIOD]); if (p) win = periodWindow_(p); }
    out.push({
      row: i + 2,
      id: id,
      name: name || '（名前なし）',
      gm: String(r[SC.GM] || '').trim(),
      members: uniq_(splitNames_(r[SC.MEMBERS])),
      date: date,
      ymd: date ? ymd_(date) : '',
      start: timeStr_(r[SC.START]),
      end: timeStr_(r[SC.END]),
      status: STATUS_LIST.indexOf(status) >= 0 ? status : (date ? STATUS.HELD : STATUS.RECRUIT),
      want: uniq_(splitNames_(r[SC.WANT])),
      interest: uniq_(splitNames_(r[SC.INTEREST])),
      askedStamp: stampText_(r[SC.ASK]),
      series: String(r[SC.SERIES] || '').trim(),
      seriesEnd: (function () { const e = toDate_(r[SC.SERIES_END]); return e ? ymd_(e) : ''; })(),
      window: win ? win.text : '', windowFrom: win ? win.fromYmd : '', windowTo: win ? win.toYmd : '', windowLabel: win ? win.label : '', windowKey: win ? win.fromYmd : '',
      candidates: parseCands_(r[SC.CANDS]),
      place: String(r[SC.PLACE] || '').trim(),
      memo: String(r[SC.MEMO] || '').trim(),
      editor: String(r[SC.EDITOR] || '').trim(),
      notifiedStamp: stampText_(r[SC.NOTIFIED]),
      notified: !!stampText_(r[SC.NOTIFIED]),
      urgedStamp: stampText_(r[SC.URGED]),
      urged: !!stampText_(r[SC.URGED]),
      soonStamp: stampText_(r[SC.SOON]),
      soon: !!stampText_(r[SC.SOON]),
    });
  });
  return out;
}

/** 都合シートを { 'yyyy-MM-dd': { 名前: '△' } } に読む。空欄と旧い「○」は載せない（参加できる） */
function getAvailability_(ss) {
  const out = {};
  const sh = ss.getSheetByName(SHEET.AVAIL);
  if (!sh || sh.getLastRow() < 2 || sh.getLastColumn() < 4) return out;
  const values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const header = values[0];
  for (let i = 1; i < values.length; i++) {
    const d = toDate_(values[i][0]);
    if (!d) continue;
    const key = ymd_(d);
    const marks = {};
    for (let c = 3; c < header.length; c++) {
      const who = String(header[c] || '').trim();
      if (!who) continue;
      const v = String(values[i][c] || '').trim();
      if (v && v !== '○') marks[who] = v;   // 旧い「○」は空欄（参加できる）と同じ
    }
    out[key] = marks;
  }
  return out;
}

/** 日付メモを { 'yyyy-MM-dd': { text, by, at } } に読む */
function getDayNotes_(ss) {
  const out = {};
  const sh = ss.getSheetByName(SHEET.NOTES);
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach((r, i) => {
    const d = toDate_(r[0]);
    const text = String(r[1] || '').trim();
    if (!d || !text) return;
    out[ymd_(d)] = { text: text, by: String(r[2] || '').trim(), at: stampText_(r[3]), row: i + 2 };
  });
  return out;
}

/** 日付メモを書く。空にすると消す。form: { ymd, text, me } */
/* ---------------------------------------------------------
 * 日程調整
 * 調整中の卓に候補日を出し、GM と参加者が候補日ごとに ◯ か × を付ける。
 * 開催日は自動では決めない。全員の回答がそろったら GM に知らせ、GM が候補日から選んで「開催」にする。
 * 候補日は卓の行の「候補日」列、回答は「日程調整」シートに 1 行ずつ置く
 * --------------------------------------------------------- */

/** 「2026/10/03、2026/10/04」を ['2026-10-03', '2026-10-04'] に読む（重なりを除いて日付順） */
function parseCands_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return [ymd_(v)];
  const out = [];
  String(v === undefined || v === null ? '' : v).split(/[、,，;；\s]+/).forEach(t => {
    const d = t ? toDate_(t) : null;
    if (d && out.indexOf(ymd_(d)) < 0) out.push(ymd_(d));
  });
  return out.sort();
}

function candsText_(list) {
  return (list || []).map(k => Utilities.formatDate(toDate_(k), tz_(), 'yyyy/MM/dd')).join('、');
}

/** 回答を { 卓ID: { 'yyyy-MM-dd': { 名前: { vote, row } } } } に読む */
function getPollVotes_(ss) {
  const out = {};
  const sh = ss.getSheetByName(SHEET.POLL);
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, POLL_HEADER.length).getValues().forEach((r, i) => {
    const sid = String(r[0] || '').trim();
    const d = toDate_(r[1]);
    const name = String(r[2] || '').trim();
    const vote = String(r[3] || '').trim();
    if (!sid || !d || !name || POLL_MARKS.indexOf(vote) < 0) return;
    const k = ymd_(d);
    if (!out[sid]) out[sid] = {};
    if (!out[sid][k]) out[sid][k] = {};
    out[sid][k][name] = { vote: vote, row: i + 2 };
  });
  return out;
}

/** 画面に渡す形 { 'yyyy-MM-dd': { 名前: '◯' } } */
function pollPlain_(v) {
  const out = {};
  Object.keys(v || {}).forEach(k => {
    out[k] = {};
    Object.keys(v[k]).forEach(n => { out[k][n] = v[k][n].vote; });
  });
  return out;
}

/** まだ回答していない候補日がある人（過ぎた候補日は数えない） */
function pollPending_(ctx, s) {
  const votes = ctx.polls[s.id] || {};
  const today = ymd_(ctx.now);
  const future = (s.candidates || []).filter(k => k >= today);
  return peopleOf_(s).filter(n => future.some(k => !(votes[k] && votes[k][n])));
}

/** 卓の回答を消す。keep に入っている日の回答は残す */
function deletePollRows_(ss, sid, keep) {
  const sh = ss.getSheetByName(SHEET.POLL);
  if (!sh || sh.getLastRow() < 2) return 0;
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  let n = 0;
  for (let i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0] || '').trim() !== sid) continue;
    const d = toDate_(vals[i][1]);
    if (keep && d && keep.indexOf(ymd_(d)) >= 0) continue;
    sh.deleteRow(i + 2);
    n++;
  }
  return n;
}

/** 1 人ぶんの回答を書く。vote が空なら消す */
function writePollVote_(ss, sid, k, name, vote) {
  const sh = ss.getSheetByName(SHEET.POLL);
  const cur = ((getPollVotes_(ss)[sid] || {})[k] || {})[name];
  if (!vote) {
    if (cur) sh.deleteRow(cur.row);
    return;
  }
  const vals = [[sid, toDate_(k), name, vote, fmtDateTime_(new Date())]];
  if (cur) {
    sh.getRange(cur.row, 1, 1, POLL_HEADER.length).setValues(vals);
  } else {
    const row = Math.max(sh.getLastRow() + 1, 2);
    sh.getRange(row, 1, 1, POLL_HEADER.length).setValues(vals);
    sh.getRange(row, 2).setNumberFormat('yyyy/mm/dd');
  }
}

/**
 * 1 人の回答を、渡した候補日すべてに書く。vote が空なら、その人のその日の回答を消す。
 * 1 日ずつ書くとシートを何度も読み直すので、ここで読みは 1 回にまとめる
 */
function writePollVotesAll_(ss, sid, days, name, vote) {
  const sh = ss.getSheetByName(SHEET.POLL);
  const cur = getPollVotes_(ss)[sid] || {};
  const stamp = fmtDateTime_(new Date());
  const add = [], dels = [];
  days.forEach(k => {
    const hit = (cur[k] || {})[name];
    if (!vote) { if (hit) dels.push(hit.row); return; }
    if (hit) sh.getRange(hit.row, 1, 1, POLL_HEADER.length).setValues([[sid, toDate_(k), name, vote, stamp]]);
    else add.push([sid, toDate_(k), name, vote, stamp]);
  });
  if (add.length) {
    const row = Math.max(sh.getLastRow() + 1, 2);
    sh.getRange(row, 1, add.length, POLL_HEADER.length).setValues(add);
    sh.getRange(row, 2, add.length, 1).setNumberFormat('yyyy/mm/dd');
  }
  dels.sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
  return add.length + dels.length;
}

/** 全員が、これからの候補日すべてに答えたか */
function pollComplete_(ctx, s) {
  const today = ymd_(ctx.now);
  return peopleOf_(s).length > 0 && (s.candidates || []).some(k => k >= today) && !pollPending_(ctx, s).length;
}

/** 回答を書いたあと、この回答で全員がそろったかを見る。before は書く前に読んだ ctx */
function pollJustCompleted_(ss, before, sid) {
  const s0 = before.sessions.filter(x => x.id === sid)[0];
  if (!s0 || pollComplete_(before, s0)) return false;
  const ctx = loadContext_(ss);
  const s = ctx.sessions.filter(x => x.id === sid)[0];
  return !!s && pollComplete_(ctx, s);
}

/** 候補日の 1 日（hit）を開催日にして、状態を「開催」にする。GM が選んだ日で呼ぶ */
function settlePoll_(ss, s, hit) {
  const sid = s.id;
  const sh = ss.getSheetByName(SHEET.SESSIONS);
  const rng = sh.getRange(s.row, 1, 1, SESSION_HEADER.length);
  const v = rng.getValues()[0];
  v[SC.DATE] = toDate_(hit);
  v[SC.STATUS] = STATUS.HELD;
  v[SC.WINDOW] = '';
  v[SC.CANDS] = '';
  v[SC.NOTIFIED] = '';
  v[SC.UPDATED] = fmtDateTime_(new Date());
  rng.setValues([v]);
  sh.getRange(s.row, SC.DATE + 1).setNumberFormat('yyyy/mm/dd');
  deletePollRows_(ss, sid);
  SpreadsheetApp.flush();
  markDirty_();
  appendLog_(ss, '日程決定', s.name, 'GM が選んだ日: ' + fmtDateJa_(toDate_(hit)));
  return hit;
}

/**
 * 日程調整の知らせ（kind: 'decided' | 'pollReady'）を、サーバーからその場で送る。
 * 画面から送ると、送り終わる前に閉じられたときに届かない（2026-09-29 に「日程が決まりました」が届かなかった）。
 * 返り値: true（届いた）／ false（失敗。画面が送り直す）／ null（Webhook が無いので送らない）
 */
function sendPollNotice_(ss, sid, kind) {
  const ctx = loadContext_(ss);
  const s = ctx.sessions.filter(x => x.id === sid)[0];
  if (!s) return null;
  const targets = sessionTargets_(ctx, s);
  if (!targets.length) return null;
  return kind === 'decided'
    ? postToTargets_(ctx, decidedPayload_(ctx, s), '日程決定', s.name, targets)
    : postToTargets_(ctx, pollReadyPayload_(ctx, s), '回答そろい', s.name, targets);
}

/** 送った結果を、返事の文に添える */
function noticeNote_(sent, what) {
  return sent === true ? '　' + what + 'を Discord に送りました。' : sent === false ? '　' + what + 'を Discord に送れませんでした。' : '';
}

/** GM が候補日から開催日を選ぶ。GM のほかは管理者だけ。決めたら「日程が決まりました」をサーバーから送る。form: { id, ymd, me } */
function decidePoll(form) {
  const r = decidePollLocked_(form);
  const ss = ss_();
  r.notified = sendPollNotice_(ss, r.id, 'decided');
  r.message += noticeNote_(r.notified, '決まった知らせ');
  r.data = consoleData_(ss, undefined, isAdmin_(form));
  return r;
}

function decidePollLocked_(form) {
  const ss = ss_();
  ensureReady_(ss);
  const lock = pollLock_();
  try {
    const ctx = loadContext_(ss);
    const s = findAdjusting_(ctx, form.id);
    const me = String(form.me || '').trim();
    if (me && s.gm && me === s.gm) authFor_(form);
    else requireAdmin_(form, 'GM のほかが開催日を決めること');
    const d = toDate_(form.ymd);
    if (!d) throw new Error('日付が読めません: ' + form.ymd);
    const k = ymd_(d);
    if (s.candidates.indexOf(k) < 0) throw new Error(fmtDateJa_(d) + ' は「' + s.name + '」の候補日ではありません。');
    if (k < ymd_(ctx.now)) throw new Error('過ぎた候補日には決められません。');
    settlePoll_(ss, s, k);
    return { ok: true, id: s.id, decided: k, message: '日程を決めました: ' + s.name + '（' + fmtDateJa_(d) + '）' };
  } finally {
    lock.releaseLock();
  }
}

function pollLock_() {
  if (LOCK_DEPTH_ > 0) return { releaseLock: function () {} };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) throw new Error(LOCK_BUSY_MSG);
  LOCK_DEPTH_++;
  return { releaseLock: function () { LOCK_DEPTH_--; SpreadsheetApp.flush(); lock.releaseLock(); } };
}

function findAdjusting_(ctx, id) {
  const s = ctx.sessions.filter(x => x.id === String(id || ''))[0];
  if (!s) throw new Error('その卓が見つかりません: ' + id);
  if (s.status !== STATUS.ADJUSTING) throw new Error('「' + s.name + '」は日程調整中ではありません（' + s.status + '）。');
  return s;
}

/**
 * 日程調整を始める／候補日を選び直す。form: { id, dates: ['yyyy-MM-dd'], start, end, me }
 * 始め直しなら前の回答は消す。選び直しなら外した日の回答だけ消す。
 * 出した人が GM か参加者なら、新しく足した候補日に ◯ を付けておく
 */
function startPoll(form) {
  authFor_(form);
  const ss = ss_();
  ensureReady_(ss);
  const lock = pollLock_();
  try {
    const ctx = loadContext_(ss);
    const s = findAdjusting_(ctx, form.id);
    if (!s.members.length) throw new Error('「' + s.name + '」には参加者がいません。参加者を入れてから日程を調整してください。');
    const today = ymd_(ctx.now);
    const dates = [];
    (form.dates || []).forEach(d => {
      const x = toDate_(d);
      if (!x) throw new Error('日付が読めません: ' + d);
      if (dates.indexOf(ymd_(x)) < 0) dates.push(ymd_(x));
    });
    dates.sort();
    if (!dates.length) throw new Error('候補日を 1 日以上選んでください。');
    if (dates.length > POLL_MAX_DATES) throw new Error('候補日は ' + POLL_MAX_DATES + ' 日までです。');
    const past = dates.filter(k => k < today);
    if (past.length) throw new Error('過ぎた日は候補にできません: ' + past.map(k => fmtDateJa_(toDate_(k))).join('、'));
    const me = String(form.me || '').trim();
    const fresh = !s.candidates.length;
    const sh = ss.getSheetByName(SHEET.SESSIONS);
    sh.getRange(s.row, SC.CANDS + 1).setValue(candsText_(dates));
    if (form.start !== undefined) sh.getRange(s.row, SC.START + 1).setValue(normTime_(form.start));
    if (form.end !== undefined) sh.getRange(s.row, SC.END + 1).setValue(normTime_(form.end));
    if (me) sh.getRange(s.row, SC.EDITOR + 1).setValue(me);
    sh.getRange(s.row, SC.UPDATED + 1).setValue(fmtDateTime_(new Date()));
    deletePollRows_(ss, s.id, fresh ? [] : dates);
    if (me && peopleOf_(s).indexOf(me) >= 0) {
      dates.filter(k => fresh || s.candidates.indexOf(k) < 0).forEach(k => writePollVote_(ss, s.id, k, me, '◯'));
    }
    SpreadsheetApp.flush();
    markDirty_();
    const msg = '「' + s.name + '」の日程調整を' + (fresh ? '始めました' : '更新しました') + '（候補 ' + dates.length + ' 日）。';
    return { ok: true, id: s.id, dates: dates, fresh: fresh, message: msg, data: consoleData_(ss, undefined, isAdmin_(form)) };
  } finally {
    lock.releaseLock();
  }
}

/** 候補日に回答する。form: { id, ymd, name, vote: '◯' | '×' | '' }。この回答で全員がそろったら ready を返す（画面が GM に知らせる） */
function setPollVote(form) { return withReadyNotice_(setPollVoteLocked_(form)); }

/** 回答で全員がそろったら、GM への知らせをサーバーから送る（ロックを放してから） */
function withReadyNotice_(r) {
  if (!r.ready) return r;
  r.notified = sendPollNotice_(ss_(), r.id, 'pollReady');
  r.message += noticeNote_(r.notified, 'GM への知らせ');
  return r;
}

function setPollVoteLocked_(form) {
  requireSelfOrAdmin_(form, form && form.name);
  const ss = ss_();
  ensureReady_(ss);
  const name = String(form.name || '').trim();
  if (!name) throw new Error('上の「あなた」で自分を選んでください。');
  const vote = String(form.vote || '').trim();
  if (vote && POLL_MARKS.indexOf(vote) < 0) throw new Error('回答は ◯ か × です。');
  const lock = pollLock_();
  try {
    const ctx = loadContext_(ss);
    const s = findAdjusting_(ctx, form.id);
    const d = toDate_(form.ymd);
    if (!d) throw new Error('日付が読めません: ' + form.ymd);
    const k = ymd_(d);
    if (s.candidates.indexOf(k) < 0) throw new Error(fmtDateJa_(d) + ' は「' + s.name + '」の候補日ではありません。');
    if (k < ymd_(ctx.now)) throw new Error('過ぎた候補日には回答できません。');
    if (peopleOf_(s).indexOf(name) < 0) throw new Error(name + ' は「' + s.name + '」の GM でも参加者でもないので、回答できません。');
    writePollVote_(ss, s.id, k, name, vote);
    SpreadsheetApp.flush();
    markDirty_();
    const ready = !!vote && pollJustCompleted_(ss, ctx, s.id);
    const msg = fmtDateJa_(d) + ' ' + name + ': ' + (vote || '回答を取り消しました') + (ready ? '　全員の回答がそろいました。' : '');
    return { ok: true, id: s.id, ymd: k, vote: vote, ready: ready, message: msg, data: consoleData_(ss, undefined, isAdmin_(form)) };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 「どの日でもいい」（おまかせ）。候補日すべてに ◯ を付ける。form: { id, name, vote }
 * vote が '◯' なら全部に ◯（× を付けていた日も ◯ に変わる）、空なら自分の回答を全部消す。
 * 過ぎた候補日は触らない。この回答で全員がそろったら ready を返す
 */
function setPollVoteAll(form) { return withReadyNotice_(setPollVoteAllLocked_(form)); }

function setPollVoteAllLocked_(form) {
  requireSelfOrAdmin_(form, form && form.name);
  const ss = ss_();
  ensureReady_(ss);
  const name = String(form.name || '').trim();
  if (!name) throw new Error('上の「あなた」で自分を選んでください。');
  const vote = String(form.vote === undefined ? POLL_MARKS[0] : form.vote || '').trim();
  if (vote && vote !== POLL_MARKS[0]) throw new Error('おまかせで付けられるのは ◯ だけです。');
  const lock = pollLock_();
  try {
    const ctx = loadContext_(ss);
    const s = findAdjusting_(ctx, form.id);
    if (peopleOf_(s).indexOf(name) < 0) throw new Error(name + ' は「' + s.name + '」の GM でも参加者でもないので、回答できません。');
    const today = ymd_(ctx.now);
    const days = s.candidates.filter(k => k >= today);
    if (!days.length) throw new Error('「' + s.name + '」には、これからの候補日がありません。');
    writePollVotesAll_(ss, s.id, days, name, vote);
    SpreadsheetApp.flush();
    markDirty_();
    const ready = !!vote && pollJustCompleted_(ss, ctx, s.id);
    const msg = (vote ? name + ': 候補日 ' + days.length + ' 日すべてに ◯ を付けました（どの日でもいい）'
      : name + ': 「' + s.name + '」の回答を取り消しました') + (ready ? '　全員の回答がそろいました。' : '');
    return { ok: true, id: s.id, days: days, vote: vote, ready: ready, message: msg, data: consoleData_(ss, undefined, isAdmin_(form)) };
  } finally {
    lock.releaseLock();
  }
}

/** 日程調整をやめる。候補日と回答を消す（卓は調整中のまま）。form: { id } */
function cancelPoll(form) {
  authFor_(form);
  const ss = ss_();
  ensureReady_(ss);
  const lock = pollLock_();
  try {
    const ctx = loadContext_(ss);
    const s = findAdjusting_(ctx, form.id);
    const sh = ss.getSheetByName(SHEET.SESSIONS);
    sh.getRange(s.row, SC.CANDS + 1).setValue('');
    sh.getRange(s.row, SC.UPDATED + 1).setValue(fmtDateTime_(new Date()));
    deletePollRows_(ss, s.id);
    SpreadsheetApp.flush();
    markDirty_();
    return { ok: true, id: s.id, message: '「' + s.name + '」の日程調整をやめました。', data: consoleData_(ss, undefined, isAdmin_(form)) };
  } finally {
    lock.releaseLock();
  }
}

/** 日程調整の知らせ。GM と参加者を呼び、候補日と答え方を書く */
function pollPayload_(ctx, s, me) {
  const noId = peopleOf_(s).filter(n => !(ctx.memberByName[n] && ctx.memberByName[n].discordId)).map(n => n + ' さん');
  const call = [mentionsOf_(ctx, [s])].concat(noId).filter(Boolean).join(' ');
  let url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (err) { url = ''; }
  const lines = [
    '🗓️ 「' + s.name + '」の日程を決めます。' + call,
    '候補日: ' + s.candidates.map(k => fmtDateJa_(toDate_(k))).join('、') + (s.start || s.end ? '　' + timeRange_(s) : ''),
    '卓予定の「募集・調整」タブで、候補日ごとに ◯ か × を押してください。全員の回答がそろったら、GM が開催日を選びます。' + (me ? '　by ' + me : '') + (url ? '\n' + url : ''),
  ];
  return { content: lines.join('\n'), embeds: [sessionEmbed_(ctx, s)] };
}

/** 日程調整の回答がそろった知らせ。GM だけを呼び、候補日ごとの ◯ の数を並べる */
function pollReadyPayload_(ctx, s) {
  const g = ctx.memberByName[s.gm];
  const call = g && g.discordId ? '<@' + g.discordId + '>' : (s.gm ? s.gm + ' さん' : '');
  const votes = ctx.polls[s.id] || {};
  const voters = peopleOf_(s);
  const today = ymd_(ctx.now);
  const days = s.candidates.filter(k => k >= today).map(k => {
    const ok = voters.filter(n => votes[k] && votes[k][n] && votes[k][n].vote === '◯');
    return '・' + fmtDateJa_(toDate_(k)) + '　◯ ' + ok.length + '/' + voters.length + (ok.length === voters.length ? '（全員 ◯）' : '');
  });
  const url = appUrl_();
  return {
    content: ['📝 「' + s.name + '」の日程調整の回答がそろいました。' + call, days.join('\n'),
      '卓予定の「募集・調整」タブで、開催日を選んでください。' + (url ? '\n' + url : '')].join('\n'),
  };
}

/** 日程が決まった知らせ。卓予定の URL を添える */
function decidedPayload_(ctx, s) {
  const mentions = mentionsOf_(ctx, [s]);
  const url = appUrl_();
  return {
    content: '✅ 「' + s.name + '」の日程が決まりました: ' + fmtDateJa_(s.date) + ' ' + timeRange_(s) + (mentions ? '\n' + mentions : '') + (url ? '\n🔗 卓予定: ' + url : ''),
    embeds: [sessionEmbed_(ctx, s)],
  };
}

/** 予定メモを { 'yyyy-MM-dd': { 名前: { text, at, row } } } に読む */
function getAvailNotes_(ss) {
  const out = {};
  const sh = ss.getSheetByName(SHEET.AVAIL_NOTES);
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach((r, i) => {
    const d = toDate_(r[0]);
    const name = String(r[1] || '').trim();
    const text = String(r[2] || '').trim();
    if (!d || !name || !text) return;
    const key = ymd_(d);
    (out[key] = out[key] || {})[name] = { text: text, at: stampText_(r[3]), row: i + 2 };
  });
  return out;
}

/**
 * メンバーの予定の 1 マスにメモを書く。○△×とは別で、卓に入っている日にも書ける。
 * form: { name, ymd, text, token }。空にすると消える
 */
function setAvailNote(...args) { return withLock_(() => setAvailNoteLocked_(...args)); }
function setAvailNoteLocked_(form) {
  requireSelfOrAdmin_(form, form && form.name);
  const ss = ss_();
  ensureReady_(ss);
  const name = String(form.name || '').trim();
  if (!name) throw new Error('上の「あなた」で自分を選んでください。');
  if (!getMembers_(ss).some(m => m.name === name)) throw new Error('「メンバー」シートに ' + name + ' がありません。');
  const d = toDate_(form.ymd);
  if (!d) throw new Error('日付が読めません: ' + form.ymd);
  const text = String(form.text || '').trim();
  if (text.length > AVAIL_NOTE_MAX) throw new Error('メモは ' + AVAIL_NOTE_MAX + ' 文字までです。');
  const key = ymd_(d);
  const sh = ss.getSheetByName(SHEET.AVAIL_NOTES);
  const cur = (getAvailNotes_(ss)[key] || {})[name];
  if (!text) {
    if (cur) sh.deleteRow(cur.row);
  } else if (cur) {
    sh.getRange(cur.row, 1, 1, 4).setValues([[d, name, text, fmtDateTime_(new Date())]]);
  } else {
    const row = Math.max(sh.getLastRow() + 1, 2);
    sh.getRange(row, 1, 1, 4).setValues([[d, name, text, fmtDateTime_(new Date())]]);
    sh.getRange(row, 1).setNumberFormat('yyyy/mm/dd');
  }
  SpreadsheetApp.flush();
  markDirty_();
  return { ok: true, ymd: key, name: name, message: fmtDateJa_(d) + ' ' + name + ' のメモを' + (text ? '保存' : '消') + 'しました。', data: consoleData_(ss, undefined, isAdmin_(form)) };
}

function setDayNote(...args) { return withLock_(() => setDayNoteLocked_(...args)); }
function setDayNoteLocked_(form) {
  authFor_(form);
  const ss = ss_();
  ensureReady_(ss);
  const me = String(form.me || '').trim();
  const d = toDate_(form.ymd);
  if (!d) throw new Error('日付が読めません: ' + form.ymd);
  const text = String(form.text || '').trim();
  if (text.length > 500) throw new Error('メモは 500 文字までです。');
  const key = ymd_(d);
  const sh = ss.getSheetByName(SHEET.NOTES);
  const notes = getDayNotes_(ss);
  const cur = notes[key];
  if (!text) {
    if (cur) sh.deleteRow(cur.row);
  } else if (cur) {
    sh.getRange(cur.row, 1, 1, 4).setValues([[d, text, me, fmtDateTime_(new Date())]]);
  } else {
    const row = Math.max(sh.getLastRow() + 1, 2);
    sh.getRange(row, 1, 1, 4).setValues([[d, text, me, fmtDateTime_(new Date())]]);
    sh.getRange(row, 1).setNumberFormat('yyyy/mm/dd');
  }
  SpreadsheetApp.flush();
  markDirty_();
  return { ok: true, ymd: key, message: text ? fmtDateJa_(d) + ' のメモを保存しました。' : fmtDateJa_(d) + ' のメモを消しました。', data: consoleData_(ss, undefined, isAdmin_(form)) };
}

function peopleOf_(s) {
  return uniq_((s.gm ? [s.gm] : []).concat(s.members));
}

function activeSessions_(ctx) {
  return ctx.sessions.filter(s => ACTIVE.indexOf(s.status) >= 0);
}

function sortedActive_(ctx) {
  return sortSessions_(activeSessions_(ctx));
}

/** 開催日の近い順。同じ日どうしは開始時刻、次に名前。日付の無い卓は期間の始まりが早い順で後ろに並び、期間未定はその後 */
function sortSessions_(list) {
  return list.slice().sort((a, b) => {
    if (!!a.date !== !!b.date) return a.date ? -1 : 1;
    if (a.date && b.date && a.ymd !== b.ymd) return a.ymd < b.ymd ? -1 : 1;
    if (!a.date && !b.date) {
      const ka = a.windowKey || '9999', kb = b.windowKey || '9999';
      if (ka !== kb) return ka < kb ? -1 : 1;
    }
    if (a.start !== b.start) return (a.start || '99') < (b.start || '99') ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

/** 都合を見る相手。GM と参加者に、募集中なら参加希望の人も加える */
function candidatesOf_(s) {
  return uniq_(peopleOf_(s).concat(s.status === STATUS.RECRUIT ? (s.want || []) : []));
}

/**
 * 募集時期「2026/10 前期」を { y, m, half, text, label: '10月前期', key: '2026-10-01' } に読む。
 * 「2026-10 後期」「2026年10月後期」も読める。シートが日付型に変えていれば、日で前期・後期を決める。読めなければ null
 */
function parsePeriod_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return periodOf_(v.getFullYear(), v.getMonth() + 1, v.getDate() >= 16 ? 2 : 1);
  const t = String(v === undefined || v === null ? '' : v).trim();
  if (!t) return null;
  const m = /^(\d{4})[\/\-.年]\s*(\d{1,2})月?\s*(前期|後期|前半|後半|上旬|下旬)?/.exec(t);
  if (!m) return null;
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return periodOf_(Number(m[1]), mo, (m[3] === '後期' || m[3] === '後半' || m[3] === '下旬') ? 2 : 1);
}

function periodOf_(y, mo, half) {
  const h = half === 2 ? 2 : 1;
  const mm = ('0' + mo).slice(-2);
  return { y: y, m: mo, half: h, text: y + '/' + mm + ' ' + HALVES[h - 1], label: mo + '月' + HALVES[h - 1], key: y + '-' + mm + '-' + (h === 2 ? '16' : '01') };
}

/** 旧い「2026/10 前期」を期間（10/1〜10/15）に、「後期」を（10/16〜月末）にする */
function periodWindow_(p) {
  return windowOf_(new Date(p.y, p.m - 1, p.half === 2 ? 16 : 1), p.half === 2 ? new Date(p.y, p.m, 0) : new Date(p.y, p.m - 1, 15));
}

/**
 * 旧い版の「募集時期」（2026/10 前期）を「期間」に移す。移したら募集時期の列は空にする。
 * 期間がすでに入っている行は、期間のほうを残す。シートを整え直すときに走る
 */
function migratePeriodToWindow_(ses) {
  const last = ses.getLastRow();
  if (last < 2) return 0;
  const rng = ses.getRange(2, 1, last - 1, SESSION_HEADER.length);
  const values = rng.getValues();
  let n = 0;
  values.forEach(r => {
    const p = parsePeriod_(r[SC.PERIOD]);
    if (!p) return;
    if (!String(r[SC.WINDOW] || '').trim()) r[SC.WINDOW] = periodWindow_(p).text;
    r[SC.PERIOD] = '';
    n++;
  });
  if (n) rng.setValues(values);
  return n;
}

/** 期間「2026/10/03〜2026/10/17」を読む。「~」「～」区切りも可。逆なら直す。読めなければ null */
function parseWindow_(v) {
  const t = String(v === undefined || v === null ? '' : v).trim();
  if (!t) return null;
  const m = /^(.+?)\s*[〜～~]\s*(.+)$/.exec(t);
  if (!m) return null;
  const a = toDate_(m[1]), b = toDate_(m[2]);
  if (!a || !b) return null;
  return windowOf_(a, b);
}

function windowOf_(a, b) {
  if (b < a) { const x = a; a = b; b = x; }
  const f = d => Utilities.formatDate(d, tz_(), 'yyyy/MM/dd');
  return { from: a, to: b, fromYmd: ymd_(a), toYmd: ymd_(b), text: f(a) + '〜' + f(b), label: fmtDateJa_(a) + '〜' + fmtDateJa_(b) };
}

/** フォームの始まり・終わり（'yyyy-MM-dd'）を「2026/10/03〜2026/10/17」にする。両方空なら ''。片方だけは弾く */
function windowTextOf_(from, to) {
  const a = String(from || '').trim(), b = String(to || '').trim();
  if (!a && !b) return '';
  if (!a || !b) throw new Error('期間は、始まりと終わりの両方の日を入れてください。');
  const da = toDate_(a), db = toDate_(b);
  if (!da || !db) throw new Error('期間の日付が読めません: ' + a + '〜' + b);
  return windowOf_(da, db).text;
}

/** 調整中の卓を日ごとに { 'yyyy-MM-dd': [卓] } で返す。日程調整中なら候補日、そうでなければ候補の期間（1 卓あたり 120 日まで） */
function windowByDay_(ctx) {
  const out = {};
  ctx.sessions.forEach(s => {
    if (s.status !== STATUS.ADJUSTING) return;
    if (s.candidates && s.candidates.length) { s.candidates.forEach(k => { (out[k] = out[k] || []).push(s); }); return; }
    if (!s.windowFrom) return;
    const b = toDate_(s.windowTo);
    for (let d = toDate_(s.windowFrom), i = 0; d <= b && i < 120; d = addDays_(d, 1), i++) (out[ymd_(d)] = out[ymd_(d)] || []).push(s);
  });
  return out;
}

/** 「開催」の卓に入っている人を { 'yyyy-MM-dd': { 名前: '参' | 'GM' } } で返す */
function bookedMap_(ctx) {
  const out = {};
  ctx.sessions.forEach(s => {
    if (DATED.indexOf(s.status) < 0 || !s.ymd) return;
    const day = out[s.ymd] = out[s.ymd] || {};
    if (s.gm) day[s.gm] = 'GM';
    s.members.forEach(n => { if (day[n] !== 'GM') day[n] = '参'; });
  });
  return out;
}

/** 都合シートの 1 マスが編集されたとき、その日の卓に入っている人なら「参」「GM」に戻す */
function fixAvailCell_(ctx, range) {
  if (range.getNumRows() !== 1 || range.getNumColumns() !== 1) return;
  const sh = range.getSheet();
  const row = range.getRow(), col = range.getColumn();
  if (row < 2 || col < 4) return;
  const name = String(sh.getRange(1, col).getValue() || '').trim();
  const d = toDate_(sh.getRange(row, 1).getValue());
  if (!name || !d) return;
  const key = ymd_(d);
  const booked = bookedMap_(ctx);
  const b = booked[key] && booked[key][name];
  if (b && String(range.getValue() || '').trim() !== b) {
    range.setValue(b).setBackground(COLOR.SESSION);
    ctx.avail[key] = ctx.avail[key] || {};
    ctx.avail[key][name] = b;
  }
}

/**
 * 対象（全員 / 卓の名前 / なし）に対して、日付ごとの都合を返す。
 * 空欄は参加できる扱い。'ok' = 誰も △× を付けておらず卓にも入っていない、'soft' = ×も卓も無いが △ の人がいる、それ以外は undefined
 */
function availabilityMap_(ctx, target) {
  const out = {};
  if (target === TARGET_NONE) return out;
  let people;
  if (target === TARGET_ALL) {
    people = ctx.members.map(m => m.name);
  } else {
    const s = activeSessions_(ctx).filter(x => x.name === target)[0];
    people = s ? candidatesOf_(s) : [];
  }
  if (people.length === 0) return out;
  Object.keys(ctx.avail).forEach(key => {
    const marks = ctx.avail[key];
    let allOk = true;
    for (let i = 0; i < people.length; i++) {
      const v = marks[people[i]];
      if (v === '×' || BOOKED_MARKS.indexOf(v) >= 0) return;
      if (v === '△') allOk = false;
    }
    out[key] = allOk ? 'ok' : 'soft';
  });
  return out;
}

/* ---------------------------------------------------------
 * 表示の作り直し
 * --------------------------------------------------------- */

/**
 * 開催日が過ぎた「開催」の卓を「終了」にする。当日はそのまま。カレンダーからは消えない。
 * 表示を作り直すたびに走る。ctx の中身も書き換えるので、この後の描画に反映される。書き換えた件数を返す
 */
function autoFinishPast_(ctx) {
  const sh = ctx.ss.getSheetByName(SHEET.SESSIONS);
  const stamp = fmtDateTime_(new Date());
  let n = 0;
  const set = (s, status) => {
    sh.getRange(s.row, SC.STATUS + 1).setValue(status);
    sh.getRange(s.row, SC.UPDATED + 1).setValue(stamp);
    s.status = status;
    n++;
  };
  if (isOn_(ctx.settings['過ぎた卓を自動で終了'])) {
    const today = ymd_(ctx.now);
    ctx.sessions.forEach(s => {
      if (!s.ymd || DATED.indexOf(s.status) < 0) return;
      if (s.ymd < today) set(s, STATUS.DONE);
    });
  }
  if (n) SpreadsheetApp.flush();
  return n;
}

function refreshAll_(ctx) {
  // ロックを待つあいだに中身が変わりうるので、ロックを取ってから読み直す
  if (LOCK_DEPTH_ === 0) return withLock_(() => refreshAll_(loadContext_(ctx.ss)));
  ensureSheets_(ctx.ss);
  autoFinishPast_(ctx);
  renderAvailability_(ctx);
  renderCalendar_(ctx);
  renderList_(ctx);
  renderAdmin_(ctx);
  SpreadsheetApp.flush();
  clearDirty_();
}

/* ---- カレンダー ---- */

function renderCalendar_(ctx) {
  const sh = getOrCreateSheet_(ctx.ss, SHEET.CALENDAR);
  const prevTarget = String(sh.getRange(2, 2).getValue() || '').trim();
  resetSheet_(sh);

  const months = clampInt_(ctx.settings['カレンダーの表示月数'], 1, 12, 2);
  const active = activeSessions_(ctx);
  const options = [TARGET_ALL].concat(uniq_(active.map(s => s.name))).concat([TARGET_NONE]);
  const target = options.indexOf(prevTarget) >= 0 ? prevTarget : TARGET_ALL;
  const availMap = availabilityMap_(ctx, target);
  // 終了・中止もカレンダーには残す
  const byDay = {};
  ctx.sessions.forEach(s => { if (s.ymd) (byDay[s.ymd] = byDay[s.ymd] || []).push(s); });
  const winByDay = windowByDay_(ctx);
  const todayKey = ymd_(ctx.now);

  const rows = [], bgs = [], weights = [], colors = [], aligns = [], heights = [], wraps = [];
  const merges = [];
  const push = (vals, opt) => {
    opt = opt || {};
    rows.push(fill_(vals, CAL_COLS, ''));
    bgs.push(fill_(opt.bg || [], CAL_COLS, COLOR.WHITE));
    weights.push(fill_(opt.w || [], CAL_COLS, 'normal'));
    colors.push(fill_(opt.c || [], CAL_COLS, '#000000'));
    aligns.push(fill_(opt.a || [], CAL_COLS, 'left'));
    heights.push(opt.h || 21);
    wraps.push(fill_([], CAL_COLS, opt.nowrap ? false : true));
    return rows.length;
  };

  // 1 行目: 見出し
  let r = push(['卓カレンダー', '', '', '', '', '', '更新 ' + fmtDateTime_(ctx.now)],
    { w: ['bold'], a: ['left', '', '', '', '', '', 'right'], h: 28 });
  merges.push([r, 1, 1, 6]);
  // 2 行目: 都合の対象と凡例
  push(['都合を見る卓 ▶', target, '凡例', '全員空き', '△あり', '卓あり', '終わった卓'], {
    bg: [COLOR.HEAD, COLOR.WHITE, COLOR.HEAD, COLOR.OK, COLOR.SOFT, COLOR.SESSION, COLOR.PAST],
    w: ['bold', 'bold', 'bold'], a: ['right', 'left', 'center', 'center', 'center', 'center', 'center'],
  });
  // 3 行目以降: お知らせ
  r = push(['お知らせ'], { bg: [COLOR.ACCENT], c: ['#ffffff'], w: ['bold'] });
  merges.push([r, 1, 1, CAL_COLS]);
  // お知らせの行は結合しない。結合セルは行の自動高さが効かないので、右の空セルへはみ出させる
  noticeLines_(ctx).forEach(line => {
    push([line.text], { w: [line.bold ? 'bold' : 'normal'], c: [line.color || '#000000'], nowrap: true });
  });
  push([]);

  // 月の格子。週ごとに「日付の行」と「中身の行」の 2 行
  const first = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), 1);
  for (let m = 0; m < months; m++) {
    const mStart = new Date(first.getFullYear(), first.getMonth() + m, 1);
    const y = mStart.getFullYear(), mo = mStart.getMonth();
    const daysInMonth = new Date(y, mo + 1, 0).getDate();
    r = push([y + '年' + (mo + 1) + '月'], { bg: [COLOR.HEAD], w: ['bold'], h: 26 });
    merges.push([r, 1, 1, CAL_COLS]);
    push(WD.slice(), {
      bg: fill_([], CAL_COLS, COLOR.HEAD), w: fill_([], CAL_COLS, 'bold'), a: fill_([], CAL_COLS, 'center'),
      c: ['#c00000', '', '', '', '', '', '#1155cc'],
    });

    let day = 1 - mStart.getDay();
    while (day <= daysInMonth) {
      const numVals = [], numBg = [], numColor = [], bodyVals = [], bodyBg = [], bodyBold = [];
      for (let c = 0; c < CAL_COLS; c++, day++) {
        if (day < 1 || day > daysInMonth) {
          numVals.push(''); numBg.push(COLOR.OUT); numColor.push('#999999');
          bodyVals.push(''); bodyBg.push(COLOR.OUT); bodyBold.push('normal');
          continue;
        }
        const d = new Date(y, mo, day);
        const key = ymd_(d);
        const list = sortSessions_(byDay[key] || []);
        const isToday = key === todayKey;
        const av = availMap[key];
        const hol = holidayName_(d);
        const wk = c === 0 || c === 6 || !!hol;
        numVals.push((isToday ? day + '（今日）' : String(day)) + (hol ? ' ' + hol : ''));
        numColor.push((c === 0 || hol) ? '#c00000' : c === 6 ? '#1155cc' : '#000000');
        numBg.push(isToday ? COLOR.TODAY : wk ? COLOR.WEEKEND : COLOR.WHITE);
        const lines = list.map(s => {
          const head = s.status === STATUS.RECRUIT ? '募集 ' : s.status === STATUS.HELD ? '開催 ' : s.status === STATUS.DONE ? '済 ' : s.status === STATUS.CANCELED ? '中止 ' : '';
          return head + (s.start ? s.start + ' ' : '') + s.name + (s.gm ? '／' + s.gm : '');
        });
        const liveCount = list.filter(s => ACTIVE.indexOf(s.status) >= 0).length;
        (winByDay[key] || []).forEach(s => lines.push(s.candidates.length ? '🗳 候補日: ' + s.name : '◇ ' + s.name + '（調整中）'));
        const note = ctx.notes[key];
        if (note) lines.push('📝 ' + note.text.split('\n')[0]);
        if (av === 'ok') lines.push('◎ 全員空き');
        else if (av === 'soft') lines.push('△ あり');
        bodyVals.push(lines.join('\n'));
        bodyBg.push(av === 'ok' ? COLOR.OK : av === 'soft' ? COLOR.SOFT : liveCount ? COLOR.SESSION : list.length ? COLOR.PAST : wk ? COLOR.WEEKEND : COLOR.WHITE);
        bodyBold.push(liveCount ? 'bold' : 'normal');
      }
      push(numVals, { bg: numBg, c: numColor, w: fill_([], CAL_COLS, 'bold'), h: 18 });
      push(bodyVals, { bg: bodyBg, w: bodyBold, h: 96 });
    }
    push([]);
  }

  ensureSize_(sh, rows.length, CAL_COLS);
  const rng = sh.getRange(1, 1, rows.length, CAL_COLS);
  rng.setValues(rows).setBackgrounds(bgs).setFontWeights(weights).setFontColors(colors)
    .setHorizontalAlignments(aligns).setVerticalAlignment('top').setWraps(wraps);
  merges.forEach(m => sh.getRange(m[0], m[1], m[2], m[3]).merge());
  applyRowHeights_(sh, heights);
  sh.setColumnWidths(1, CAL_COLS, 165);
  sh.getRange(2, 2).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(options, true).setAllowInvalid(false).build()
  ).setBorder(true, true, true, true, false, false, COLOR.ACCENT, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sh.setFrozenRows(2);
  sh.setTabColor(COLOR.ACCENT);
}

function noticeLines_(ctx) {
  const lines = [];
  const todayKey = ymd_(ctx.now);
  const tomorrowKey = ymd_(addDays_(ctx.now, 1));
  const planned = sortedActive_(ctx).filter(s => DATED.indexOf(s.status) >= 0 && s.date);
  const desc = s => s.name + '　' + timeRange_(s) + '　GM: ' + (s.gm || '未定') + '　参加: ' + (s.members.join('、') || '未定');

  const todays = planned.filter(s => s.ymd === todayKey);
  const tomorrows = planned.filter(s => s.ymd === tomorrowKey);
  const week = planned.filter(s => {
    const n = daysBetween_(ctx.now, s.date);
    return n >= 2 && n <= 7;
  });
  const overdue = planned.filter(s => daysBetween_(ctx.now, s.date) < 0);
  const recruiting = sortSessions_(activeSessions_(ctx).filter(s => s.status === STATUS.RECRUIT));
  const adjusting = sortSessions_(activeSessions_(ctx).filter(s => s.status === STATUS.ADJUSTING));

  todays.forEach(s => lines.push({ text: '🔴 今日: ' + desc(s), bold: true, color: '#c00000' }));
  tomorrows.forEach(s => lines.push({
    text: '🟠 明日: ' + desc(s) + '　［' + notifyStateText_(ctx, s) + '］',
    bold: true, color: '#b45f06',
  }));
  if (!todays.length && !tomorrows.length) lines.push({ text: '今日・明日の卓はありません。' });
  week.forEach(s => lines.push({ text: '🔵 ' + fmtDateJa_(s.date) + ': ' + desc(s) }));
  if (recruiting.length) {
    lines.push({
      text: '🟡 募集中: ' + recruiting.map(s => s.name + '（GM: ' + (s.gm || '未定') + '、' + (s.windowLabel || '時期未定') +
        (s.want.length ? '、参加希望 ' + s.want.length + ' 人' : '') + '）').join('、') +
        '　→ ウェブアプリの「募集・調整」タブで参加希望を出せます。左上の「都合を見る卓」で選ぶと、全員が空いている日に色が付きます。',
    });
  }
  if (adjusting.length) {
    lines.push({
      text: '🔶 日程調整中: ' + adjusting.map(s => s.name + '（GM: ' + (s.gm || '未定') + '、' + (s.candidates.length ? '候補日 ' + s.candidates.length + ' 日・未回答 ' + pollPending_(ctx, s).length + ' 人' : (s.windowLabel ? s.windowLabel + ' のどこか' : '期間未定')) + '）').join('、') +
        '　→ 左上の「都合を見る卓」で選ぶと、全員が空いている日に色が付きます。候補の期間には ◇ が付いています。',
    });
  }
  adjusting.filter(s => s.windowTo && s.windowTo < todayKey).forEach(s => lines.push({
    text: '⚪ 候補の期間を過ぎています: ' + s.name + '（' + s.windowLabel + '）　→ 開催日を決めて「開催」にするか、期間を延ばしてください。',
    color: '#666666',
  }));
  overdue.forEach(s => lines.push({
    text: '⚪ 開催日を過ぎています: ' + s.name + '（' + fmtDateJa_(s.date) + '）　→ 「設定」の「過ぎた卓を自動で終了」を ON にすると、翌日に自動で終了になります。',
    color: '#666666',
  }));

  const setter = String(ctx.settings['自動通知の設定者'] || '').trim();
  const hook = String(ctx.settings['Discord Webhook URL'] || '').trim();
  lines.push({ text: 'ウェブアプリで変えた内容は、シートを開いたときと 10 分おきにこの表へ反映されます。', color: '#666666' });
  lines.push({
    text: 'Discord: ' + (hook ? 'Webhook 設定済み' : 'Webhook 未設定（「設定」シート）') +
      '　／　開催前の知らせ: ' + (setter ? '有効（' + setter + '）' : '未設定（メニュー「卓予定 → 自動通知を設定」）'),
    color: '#666666',
  });
  return lines;
}

/* ---- 一覧 ---- */

function renderList_(ctx) {
  const sh = getOrCreateSheet_(ctx.ss, SHEET.LIST);
  resetSheet_(sh);
  const header = ['ID', '卓の名前', 'シリーズ', 'GM', '参加者', '人数', '開催日', '曜日', '時間', '状態', 'あと', '参加希望', '興味あり', '開催前の知らせ', '場所 / URL', 'メモ'];
  const list = sortedActive_(ctx);
  const rows = [fill_(['予定されている卓　' + list.length + ' 件（更新 ' + fmtDateTime_(ctx.now) + '）'], header.length, ''), header];
  const bgs = [fill_([], header.length, COLOR.WHITE), fill_([], header.length, COLOR.HEAD)];
  list.forEach(s => {
    const n = s.date ? daysBetween_(ctx.now, s.date) : null;
    rows.push([
      s.id, s.name, s.series, s.gm, s.members.join('、'), peopleOf_(s).length,
      s.date || '', s.date ? WD[s.date.getDay()] : '', s.date ? timeRange_(s) : '',
      s.status, daysLabel_(n, s), s.want.join('、'), s.interest.join('、'), s.notifiedStamp ? '済 ' + s.notifiedStamp : '',
      s.place, s.memo,
    ]);
    let bg = COLOR.WHITE;
    if (n === null) bg = COLOR.WHITE;
    else if (n < 0) bg = COLOR.PAST;
    else if (n === 0) bg = COLOR.WARN;
    else if (n === 1) bg = COLOR.SOON;
    else if (n <= 7) bg = COLOR.SESSION;
    bgs.push(fill_([], header.length, bg));
  });
  if (list.length === 0) {
    rows.push(fill_(['まだ卓が登録されていません。メニュー「卓予定 → 予定を登録・編集…」から登録します。'], header.length, ''));
    bgs.push(fill_([], header.length, COLOR.WHITE));
  }
  ensureSize_(sh, rows.length, header.length);
  const rng = sh.getRange(1, 1, rows.length, header.length);
  rng.setValues(rows).setBackgrounds(bgs).setVerticalAlignment('top').setWrap(true);
  sh.getRange(1, 1, 1, header.length).merge().setFontWeight('bold').setFontSize(12);
  sh.getRange(2, 1, 1, header.length).setFontWeight('bold');
  if (list.length) sh.getRange(3, 7, list.length, 1).setNumberFormat('yyyy/mm/dd');
  if (rows.length > 2) sh.autoResizeRows(3, rows.length - 2);
  sh.setFrozenRows(2);
  [50, 200, 120, 90, 220, 45, 95, 40, 100, 60, 100, 120, 120, 130, 160, 220].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.setTabColor('#6aa84f');
}

function daysLabel_(n, s) {
  if (n === null) {
    if (s && s.status === STATUS.RECRUIT) return (s.windowLabel || '時期未定') + ' 募集中';
    if (s && s.status === STATUS.ADJUSTING) return (s.windowLabel ? s.windowLabel + ' のどこか' : '期間未定') + ' 調整中';
    return '日程未定';
  }
  if (n === 0) return '今日';
  if (n === 1) return '明日';
  if (n > 1) return n + '日後';
  return (-n) + '日前';
}

/* ---- 管理 ---- */

function renderAdmin_(ctx) {
  const sh = getOrCreateSheet_(ctx.ss, SHEET.ADMIN);
  resetSheet_(sh);
  const active = sortedActive_(ctx);
  const planned = active.filter(s => DATED.indexOf(s.status) >= 0);
  const recruiting = active.filter(s => s.status === STATUS.RECRUIT || s.status === STATUS.ADJUSTING);
  const y = ctx.now.getFullYear(), mo = ctx.now.getMonth();
  const thisMonth = planned.filter(s => s.date && s.date.getFullYear() === y && s.date.getMonth() === mo);
  const next = new Date(y, mo + 1, 1);
  const nextMonth = planned.filter(s => s.date && s.date.getFullYear() === next.getFullYear() && s.date.getMonth() === next.getMonth());
  const gms = uniq_(active.map(s => s.gm).filter(Boolean));
  const memberNames = ctx.members.map(m => m.name);
  const unknown = uniq_([].concat.apply([], active.map(peopleOf_)).filter(n => memberNames.indexOf(n) < 0));

  const width = Math.max(6, memberNames.length + 5);
  const rows = [], bgs = [], weights = [], aligns = [], wraps = [];
  const merges = [];
  const whiteRows = [];
  const push = (vals, bg, w, a, nowrap) => {
    rows.push(fill_(vals, width, ''));
    bgs.push(fill_(bg || [], width, COLOR.WHITE));
    weights.push(fill_(w || [], width, 'normal'));
    aligns.push(fill_(a || [], width, 'left'));
    wraps.push(fill_([], width, nowrap ? false : true));
    return rows.length;
  };
  const tileBg = [COLOR.HEAD, '', COLOR.HEAD, '', COLOR.HEAD, ''];
  const tileW = ['bold', 'bold', 'bold', 'bold', 'bold', 'bold'];
  const matrixAlign = ['left', 'center', 'center', 'center'].concat(fill_([], memberNames.length, 'center')).concat(['center']);

  let r = push(['全体管理（更新 ' + fmtDateTime_(ctx.now) + '）'], [], ['bold']);
  merges.push([r, 1, 1, width]);
  push(['稼働中の卓', active.length, 'うち募集・調整中', recruiting.length, 'うち予定・開催', planned.length], tileBg, tileW);
  push(['今月の開催', thisMonth.length, '来月の開催', nextMonth.length, '動いている GM', gms.length], tileBg, tileW);
  push(['登録メンバー', memberNames.length, '終了した卓', ctx.sessions.filter(s => s.status === STATUS.DONE).length,
    '中止', ctx.sessions.filter(s => s.status === STATUS.CANCELED).length], tileBg, tileW);
  if (unknown.length) {
    push(['⚠ メンバーシートに無い参加者: ' + unknown.join('、') + '　→ 「メンバー」に加えると都合表に列ができます。'],
      fill_([], width, COLOR.SOON), [], [], true);
  }
  push([]);

  // 卓 × メンバー
  r = push(['卓 × メンバー（GM = ゲームマスター、PL = 参加者、希望 = 参加希望、興味 = 興味あり）'], [COLOR.ACCENT], ['bold']);
  merges.push([r, 1, 1, width]);
  whiteRows.push(r);
  push(['卓の名前', '状態', '開催日', 'GM'].concat(memberNames).concat(['人数']),
    fill_([], width, COLOR.HEAD), fill_([], width, 'bold'), matrixAlign);
  const partCount = memberNames.map(() => 0);
  const gmCount = memberNames.map(() => 0);
  active.forEach(s => {
    const rec = s.status === STATUS.RECRUIT;
    const cells = memberNames.map((n, i) => {
      if (s.gm === n) { gmCount[i]++; return 'GM'; }
      if (s.members.indexOf(n) >= 0) { partCount[i]++; return 'PL'; }
      if (rec && s.want.indexOf(n) >= 0) return '希望';
      if (rec && s.interest.indexOf(n) >= 0) return '興味';
      return '';
    });
    const bg = ['', '', '', ''].concat(memberNames.map(n =>
      s.gm === n ? COLOR.GM : s.members.indexOf(n) >= 0 ? COLOR.MARK
        : rec && s.want.indexOf(n) >= 0 ? COLOR.SOON : rec && s.interest.indexOf(n) >= 0 ? COLOR.OUT : COLOR.WHITE)).concat(['']);
    push([s.name, s.status, s.date ? fmtDateJa_(s.date) : (rec || s.status === STATUS.ADJUSTING) ? (s.windowLabel || '期間未定') : '未定', s.gm].concat(cells).concat([peopleOf_(s).length]),
      bg, [], matrixAlign);
  });
  if (active.length === 0) push(['（稼働中の卓はありません）']);
  push(['参加している卓数', '', '', ''].concat(partCount).concat(['']), fill_([], width, COLOR.HEAD), fill_([], width, 'bold'), matrixAlign);
  push(['GM をしている卓数', '', '', ''].concat(gmCount).concat(['']), fill_([], width, COLOR.HEAD), fill_([], width, 'bold'), matrixAlign);
  push([]);

  // メンバー別
  r = push(['メンバー別'], [COLOR.ACCENT], ['bold']);
  merges.push([r, 1, 1, width]);
  whiteRows.push(r);
  push(['名前', '参加', 'GM', '合計', '参加している卓（GM の卓は ★）'], fill_([], width, COLOR.HEAD), fill_([], width, 'bold'));
  memberNames.forEach((n, i) => {
    const mine = active.filter(s => peopleOf_(s).indexOf(n) >= 0)
      .map(s => (s.gm === n ? '★' : '') + s.name + (s.date ? '（' + fmtDateJa_(s.date) + '）' : s.windowLabel ? '（' + s.windowLabel + '）' : '（未定）'));
    push([n, partCount[i], gmCount[i], partCount[i] + gmCount[i], mine.join('、') || '—'],
      [], [], ['left', 'center', 'center', 'center', 'left'], true);
  });
  if (memberNames.length === 0) push(['（メンバーが登録されていません）']);

  ensureSize_(sh, rows.length, width);
  const rng = sh.getRange(1, 1, rows.length, width);
  rng.setValues(rows).setBackgrounds(bgs).setFontWeights(weights)
    .setHorizontalAlignments(aligns).setVerticalAlignment('top').setWraps(wraps);
  merges.forEach(m => sh.getRange(m[0], m[1], m[2], m[3]).merge());
  whiteRows.forEach(row => sh.getRange(row, 1).setFontColor('#ffffff'));
  sh.setColumnWidth(1, 200);
  sh.setColumnWidth(2, 70);
  sh.setColumnWidth(3, 90);
  sh.setColumnWidth(4, 90);
  if (memberNames.length) sh.setColumnWidths(5, memberNames.length, 70);
  sh.setColumnWidth(width, 60);
  sh.setTabColor('#e69138');
}

/* ---- 都合 ---- */

function renderAvailability_(ctx) {
  if (LOCK_DEPTH_ === 0) return withLock_(() => renderAvailability_(loadContext_(ctx.ss)));
  const sh = getOrCreateSheet_(ctx.ss, SHEET.AVAIL);
  const days = clampInt_(ctx.settings['都合表の日数'], 7, 366, 60);
  const names = ctx.members.map(m => m.name);
  const old = ctx.avail;
  resetSheet_(sh);

  const byDay = {};
  activeSessions_(ctx).forEach(s => { if (s.ymd) (byDay[s.ymd] = byDay[s.ymd] || []).push(s); });

  const booked = bookedMap_(ctx);
  const winByDay = windowByDay_(ctx);
  const width = 3 + names.length;
  const rows = [['日付', '曜日', 'その日の卓'].concat(names)];
  const bgs = [fill_([], width, COLOR.HEAD)];
  const colors = [fill_([], width, '#000000')];
  const satRows = [];
  const start = startOfDay_(ctx.now);
  for (let i = 0; i < days; i++) {
    const d = addDays_(start, i);
    const key = ymd_(d);
    const marks = old[key] || {};
    const bk = booked[key] || {};
    const hol = holidayName_(d);
    const list = (byDay[key] || []).map(s => (s.status === STATUS.RECRUIT ? '募集 ' : '') + s.name).concat((winByDay[key] || []).map(s => (s.candidates.length ? '候補: ' : '調整: ') + s.name));
    // 卓に入っている人は「参」「GM」。以前の「参」「GM」が残っていて今は入っていないなら空に戻す
    const cell = n => bk[n] || (BOOKED_MARKS.indexOf(marks[n]) >= 0 || marks[n] === '○' ? '' : (marks[n] || ''));
    rows.push([d, WD[d.getDay()] + (hol ? '祝' : ''), list.join('、')].concat(names.map(cell)));
    const wk = d.getDay() === 0 || d.getDay() === 6 || !!hol;
    const base = i === 0 ? COLOR.TODAY : wk ? COLOR.WEEKEND : COLOR.WHITE;
    bgs.push([base, base, list.length ? COLOR.SESSION : base].concat(names.map(n => {
      const v = cell(n);
      return BOOKED_MARKS.indexOf(v) >= 0 ? COLOR.SESSION : v === '△' ? COLOR.SOFT : v === '×' ? COLOR.WARN : base;
    })));
    const dayColor = (d.getDay() === 0 || hol) ? '#c00000' : d.getDay() === 6 ? '#1155cc' : '#000000';
    colors.push([dayColor, dayColor].concat(fill_([], width - 2, '#000000')));
    if (d.getDay() === 6) satRows.push(i + 2);
  }
  ensureSize_(sh, rows.length, width);
  const rng = sh.getRange(1, 1, rows.length, width);
  rng.setValues(rows).setBackgrounds(bgs).setFontColors(colors);
  // 週の区切り（土曜の下）に灰色の線
  satRows.forEach(r => sh.getRange(r, 1, 1, width).setBorder(null, null, true, null, null, null, '#999999', SpreadsheetApp.BorderStyle.SOLID_MEDIUM));
  sh.getRange(1, 1, 1, width).setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange(2, 1, days, 1).setNumberFormat('yyyy/mm/dd');
  if (names.length) {
    sh.getRange(2, 4, days, names.length).setHorizontalAlignment('center').setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(MARKS.concat(BOOKED_MARKS), true).setAllowInvalid(false).build()
    );
    sh.setColumnWidths(4, names.length, 70);
    // 予定メモはセルのメモに出す（シート側でも読める）
    const noteGrid = [];
    for (let i = 0; i < days; i++) {
      const n = ctx.availNotes[ymd_(addDays_(start, i))] || {};
      noteGrid.push(names.map(nm => (n[nm] ? n[nm].text : '')));
    }
    sh.getRange(2, 4, days, names.length).setNotes(noteGrid);
  }
  sh.getRange(1, 1).setNote('空欄 = 参加できる、△ = 調整すれば可、× = 不可。都合の悪い日だけ入れます。\n自分の列に入れると、カレンダーの色に反映されます。\n「参」「GM」は、その日の卓に入っている人に自動で付きます（手で変えても戻ります）。\n曜日の「祝」は祝日（振替休日・国民の休日を含む）。\n行は「表示を更新」のたびに今日から作り直されますが、入れた印は残ります。');
  sh.setColumnWidth(1, 95);
  sh.setColumnWidth(2, 40);
  sh.setColumnWidth(3, 220);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(3);
  sh.setTabColor('#8e7cc3');
}

/* ---------------------------------------------------------
 * シートの用意
 * --------------------------------------------------------- */

function noteSessionHeader_(ses) {
  ses.getRange(1, SC.MEMBERS + 1).setNote('参加者は「、」区切り。メンバーシートの名前に合わせると、都合表と管理表に反映されます。');
  ses.getRange(1, SC.DATE + 1).setNote('未定なら空欄にして、状態を「募集」か「調整中」にし、「期間」の列に開きたい期間を入れます。');
  ses.getRange(1, SC.STATUS + 1).setNote('募集 → 調整中 → 開催 → 終了 と進みます。中止は別。開催日を過ぎた卓は、設定の「過ぎた卓を自動で終了」が ON なら終了になります。');
  ses.getRange(1, SC.NOTIFIED + 1).setNote('開催前の知らせを送った日時。空にすると、開催前の知らせの日なら次の見回りで送り直します。');
  ses.getRange(1, SC.PERIOD + 1).setNote('旧い版の「募集時期」。いまは「期間」の列に移してあります。空のままで構いません。');
  ses.getRange(1, SC.WANT + 1).setNote('募集中の卓に参加希望を出した人。「、」区切り。状態が「調整中」「開催」になると参加者に移ります。');
  ses.getRange(1, SC.INTEREST + 1).setNote('募集中の卓に興味ありを付けた人。「、」区切り。参加者には自動でなりません。');
  ses.getRange(1, SC.ASK + 1).setNote('募集タブの「興味ありの人に聞く」で Discord に確認文を送った日時（自動で書かれる）。募集でなくなると空になります。');
  ses.getRange(1, SC.SERIES + 1).setNote('何日かに分けて開く卓の名前。同じ名前の回をまとめます。登録画面でこの名前を選ぶと、直前の回から GM・参加者・時間・場所・メモを引き継ぎます。1 日で終わる卓には要りません。');
  ses.getRange(1, SC.SERIES_END + 1).setNote('シリーズの最終日。この日を過ぎると、登録画面のシリーズの候補から消えます（古いシリーズが何年も残らないように）。空なら、いちばん新しい回から 180 日で消えます。');
  ses.getRange(1, SC.CANDS + 1).setNote('日程調整の候補日（自動で書かれる）。「2026/10/03、2026/10/04」の形。回答は「日程調整」シートにあります。全員の回答がそろうと GM に知らせが届き、GM が選んだ日が開催日になって、ここは空になります。');
  ses.getRange(1, SC.WINDOW + 1).setNote('募集中・調整中の卓の期間。「2026/10/03〜2026/10/17」の形。この期間のどこかで開く。調整中の卓はカレンダーと都合表に ◇ が付きます。開催日が決まると空になります。');
  ses.getRange(1, SC.URGED + 1).setNote('期間前の催促を送った日時（自動で書かれる）。期間の始まる前日に、まだ募集中・調整中なら GM に知らせます。空にすると送り直します。');
  ses.getRange(1, SC.SOON + 1).setNote('開始直前の知らせを送った日時（自動で書かれる）。「設定」の「開始直前の知らせ」が ON のときだけ送ります。空にすると送り直します。');
}

function ensureSheets_(ss) {
  // 設定
  const st = getOrCreateSheet_(ss, SHEET.SETTINGS);
  if (st.getLastRow() === 0) {
    st.getRange(1, 1, 1, 3).setValues([['項目', '値', '説明']]).setFontWeight('bold').setBackground(COLOR.HEAD);
    st.getRange(2, 1, DEFAULT_SETTINGS.length, 3).setValues(DEFAULT_SETTINGS);
    st.setColumnWidth(1, 200);
    st.setColumnWidth(2, 320);
    st.setColumnWidth(3, 520);
    st.setFrozenRows(1);
  } else {
    const have = st.getLastRow() >= 2 ? st.getRange(2, 1, st.getLastRow() - 1, 1).getValues().map(r => String(r[0]).trim()) : [];
    // 旧い版の項目名は、値を残したまま今の名前に直す
    Object.keys(OLD_NOTIFY_KEYS).forEach(o => {
      const i = have.indexOf(o), n = OLD_NOTIFY_KEYS[o];
      if (i < 0 || have.indexOf(n) >= 0) return;
      const d0 = DEFAULT_SETTINGS.filter(r => r[0] === n)[0];
      st.getRange(i + 2, 1).setValue(n);
      if (d0) st.getRange(i + 2, 3).setValue(d0[2]);
      have[i] = n;
    });
    DEFAULT_SETTINGS.forEach(r => { if (have.indexOf(r[0]) < 0) st.appendRow(r); });
  }

  // メンバー
  const mem = getOrCreateSheet_(ss, SHEET.MEMBERS);
  if (mem.getLastRow() === 0) {
    mem.getRange(1, 1, 1, 3).setValues([MEMBER_HEADER]).setFontWeight('bold').setBackground(COLOR.HEAD);
    mem.getRange(1, 2).setNote('Discord で「ユーザー設定 → 詳細設定 → 開発者モード」を ON にし、名前を右クリック →「ユーザーIDをコピー」。\n入れておくと開催前の知らせなどでメンションされます。');
    mem.setColumnWidth(1, 140);
    mem.setColumnWidth(2, 200);
    mem.setColumnWidth(3, 300);
    mem.setFrozenRows(1);
  }
  mem.getRange(2, 2, Math.max(mem.getMaxRows() - 1, 1), 1).setNumberFormat('@');

  // セッション
  const ses = getOrCreateSheet_(ss, SHEET.SESSIONS);
  const sesWidths = [50, 200, 90, 220, 95, 55, 55, 65, 160, 220, 110, 130, 130, 110, 160, 160, 130, 140, 170, 200, 130, 130, 130];
  if (ses.getLastRow() === 0) {
    ses.getRange(1, 1, 1, SESSION_HEADER.length).setValues([SESSION_HEADER]).setFontWeight('bold').setBackground(COLOR.HEAD);
    noteSessionHeader_(ses);
    sesWidths.forEach((w, i) => ses.setColumnWidth(i + 1, w));
    ses.setFrozenRows(1);
  } else if (ses.getRange(1, 1, 1, SESSION_HEADER.length).getValues()[0].some((v, i) => String(v || '').trim() !== SESSION_HEADER[i])) {
    // 旧い版のシート。期間・参加希望・興味あり・期間前の催促 などの列を足し、見出しの名前を今に合わせる
    const added = ses.getRange(1, SC.PERIOD + 1, 1, SESSION_HEADER.length - SC.PERIOD).getValues()[0].some((v, i) => String(v || '').trim() !== SESSION_HEADER[SC.PERIOD + i]);
    ses.getRange(1, 1, 1, SESSION_HEADER.length).setValues([SESSION_HEADER]).setFontWeight('bold').setBackground(COLOR.HEAD);
    noteSessionHeader_(ses);
    if (added) sesWidths.slice(SC.PERIOD).forEach((w, i) => ses.setColumnWidth(SC.PERIOD + 1 + i, w));
  }
  const n = Math.max(ses.getMaxRows() - 1, 1);
  ses.getRange(2, SC.DATE + 1, n, 1).setNumberFormat('yyyy/mm/dd');
  ses.getRange(2, SC.START + 1, n, 2).setNumberFormat('@');
  ses.getRange(2, SC.PERIOD + 1, n, 1).setNumberFormat('@');
  ses.getRange(2, SC.WINDOW + 1, n, 1).setNumberFormat('@');
  ses.getRange(2, SC.CANDS + 1, n, 1).setNumberFormat('@');
  ses.getRange(2, SC.SERIES_END + 1, n, 1).setNumberFormat('yyyy/mm/dd');
  migrateOldStatus_(ses);
  migratePeriodToWindow_(ses);
  ses.getRange(2, SC.STATUS + 1, n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUS_LIST, true).setAllowInvalid(false).build()
  );

  // 表示用と通知ログ
  getOrCreateSheet_(ss, SHEET.CALENDAR);
  getOrCreateSheet_(ss, SHEET.LIST);
  getOrCreateSheet_(ss, SHEET.ADMIN);
  getOrCreateSheet_(ss, SHEET.AVAIL);
  const notes = getOrCreateSheet_(ss, SHEET.NOTES);
  if (notes.getLastRow() === 0) {
    notes.getRange(1, 1, 1, NOTE_HEADER.length).setValues([NOTE_HEADER]).setFontWeight('bold').setBackground(COLOR.HEAD);
    notes.getRange(1, 2).setNote('その日のメモ。卓と関係のない予定（合宿・イベント・忙しい週）を書く。カレンダーに出る。');
    [95, 420, 110, 130].forEach((w, i) => notes.setColumnWidth(i + 1, w));
    notes.setFrozenRows(1);
  }
  notes.getRange(2, 1, Math.max(notes.getMaxRows() - 1, 1), 1).setNumberFormat('yyyy/mm/dd');

  const an = getOrCreateSheet_(ss, SHEET.AVAIL_NOTES);
  if (an.getLastRow() === 0) {
    an.getRange(1, 1, 1, AVAIL_NOTE_HEADER.length).setValues([AVAIL_NOTE_HEADER]).setFontWeight('bold').setBackground(COLOR.HEAD);
    an.getRange(1, 3).setNote('メンバーの予定の 1 マスに添えるメモ（「21 時から」「午前だけ」など）。ウェブアプリの「メンバーの予定」で、自分の列の ✎ から書く。都合シートのセルのメモにも出る。');
    [95, 110, 360, 130].forEach((w, i) => an.setColumnWidth(i + 1, w));
    an.setFrozenRows(1);
  }
  an.getRange(2, 1, Math.max(an.getMaxRows() - 1, 1), 1).setNumberFormat('yyyy/mm/dd');

  const pl = getOrCreateSheet_(ss, SHEET.POLL);
  if (pl.getLastRow() === 0) {
    pl.getRange(1, 1, 1, POLL_HEADER.length).setValues([POLL_HEADER]).setFontWeight('bold').setBackground(COLOR.HEAD);
    pl.getRange(1, 4).setNote('日程調整の候補日ごとの回答（◯ か ×）。ウェブアプリの「募集・調整」タブで付ける。全員がそろうと GM に知らせが届き、GM が開催日を選ぶ。');
    [70, 95, 110, 60, 130].forEach((w, i) => pl.setColumnWidth(i + 1, w));
    pl.setFrozenRows(1);
  }
  pl.getRange(2, 2, Math.max(pl.getMaxRows() - 1, 1), 1).setNumberFormat('yyyy/mm/dd');

  const sn = getOrCreateSheet_(ss, SHEET.SERIES_NOTIFY);
  if (sn.getLastRow() === 0) formatSeriesNotify_(sn);
  else migrateSeriesNotify_(sn);
  sn.getRange(2, 4, Math.max(sn.getMaxRows() - 1, 1), 2).setNumberFormat('0');
  ensureNotifyTrigger_(ss);

  const log = getOrCreateSheet_(ss, SHEET.LOG);
  if (log.getLastRow() === 0) {
    log.getRange(1, 1, 1, LOG_HEADER.length).setValues([LOG_HEADER]).setFontWeight('bold').setBackground(COLOR.HEAD);
    log.getRange(2, 1, Math.max(log.getMaxRows() - 1, 1), 1).setNumberFormat('yyyy/mm/dd hh:mm');
    log.setColumnWidth(1, 140);
    log.setColumnWidth(3, 240);
    log.setColumnWidth(4, 400);
  }

  // タブの並び
  const order = [SHEET.CALENDAR, SHEET.LIST, SHEET.ADMIN, SHEET.AVAIL, SHEET.SESSIONS, SHEET.MEMBERS, SHEET.NOTES, SHEET.AVAIL_NOTES, SHEET.POLL, SHEET.SETTINGS, SHEET.SERIES_NOTIFY, SHEET.LOG];
  order.forEach((name, i) => {
    const s = ss.getSheetByName(name);
    if (s && s.getIndex() !== i + 1) { ss.setActiveSheet(s); ss.moveActiveSheet(i + 1); }
  });
  // 初期の空シートを消す
  ss.getSheets().forEach(s => {
    const nm = s.getName();
    if ((nm === 'シート1' || nm === 'Sheet1') && s.getLastRow() === 0 && s.getLastColumn() === 0 && ss.getSheets().length > 1) {
      ss.deleteSheet(s);
    }
  });
  try { PropertiesService.getScriptProperties().setProperty(SCHEMA_KEY, SCHEMA_VERSION); } catch (err) { Logger.log('ensureSheets_: ' + err); }
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/** 書き込む行数・列数がシートの大きさを超えるなら広げる */
function ensureSize_(sh, rows, cols) {
  const maxR = sh.getMaxRows();
  const maxC = sh.getMaxColumns();
  if (rows > maxR) sh.insertRowsAfter(maxR, rows - maxR);
  if (cols > maxC) sh.insertColumnsAfter(maxC, cols - maxC);
}

/** 行の高さを、同じ高さが続く区間ごとにまとめて設定する */
function applyRowHeights_(sh, heights) {
  let i = 0;
  while (i < heights.length) {
    let j = i;
    while (j + 1 < heights.length && heights[j + 1] === heights[i]) j++;
    if (heights[i] !== 21) sh.setRowHeights(i + 1, j - i + 1, heights[i]);
    i = j + 1;
  }
}

/** 表示用シートを白紙に戻す（値・書式・結合・入力規則・メモ） */
function resetSheet_(sh) {
  const all = sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns());
  all.breakApart();
  all.clearDataValidations();
  all.clearNote();
  sh.clearConditionalFormatRules();
  sh.clear();
  sh.setFrozenRows(0);
  sh.setFrozenColumns(0);
  sh.setRowHeights(1, sh.getMaxRows(), 21);
}

/* ---------------------------------------------------------
 * 小道具
 * --------------------------------------------------------- */

/* ---- 日本の祝日（1980〜2099 年の春分・秋分の近似式を含む） ---- */
const HOLIDAY_CACHE_ = {};
function jpHolidays_(year) {
  if (HOLIDAY_CACHE_[year]) return HOLIDAY_CACHE_[year];
  const base = {};
  const key = (m, d) => ymd_(new Date(year, m - 1, d));
  const add = (m, d, name) => { base[key(m, d)] = name; };
  add(1, 1, '元日'); add(2, 11, '建国記念の日'); add(2, 23, '天皇誕生日'); add(4, 29, '昭和の日');
  add(5, 3, '憲法記念日'); add(5, 4, 'みどりの日'); add(5, 5, 'こどもの日'); add(8, 11, '山の日');
  add(11, 3, '文化の日'); add(11, 23, '勤労感謝の日');
  const nthMon = (m, n) => { const first = new Date(year, m - 1, 1).getDay(); return 1 + ((8 - first) % 7) + (n - 1) * 7; };
  add(1, nthMon(1, 2), '成人の日'); add(7, nthMon(7, 3), '海の日'); add(9, nthMon(9, 3), '敬老の日'); add(10, nthMon(10, 2), 'スポーツの日');
  const ve = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  const ae = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  add(3, ve, '春分の日'); add(9, ae, '秋分の日');
  const out = {};
  Object.keys(base).forEach(k => { out[k] = base[k]; });
  // 振替休日: 祝日が日曜なら、その後の最初の「祝日でない日」
  Object.keys(base).forEach(k => {
    const d = toDate_(k);
    if (d.getDay() !== 0) return;
    const x = new Date(d.getTime());
    do { x.setDate(x.getDate() + 1); } while (base[ymd_(x)]);
    if (!out[ymd_(x)]) out[ymd_(x)] = '振替休日';
  });
  // 国民の休日: 前日と翌日が祝日で、その日が祝日でも日曜でもない
  for (let d = new Date(year, 0, 1); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
    const k = ymd_(d);
    if (out[k] || d.getDay() === 0) continue;
    if (base[ymd_(addDays_(d, -1))] && base[ymd_(addDays_(d, 1))]) out[k] = '国民の休日';
  }
  HOLIDAY_CACHE_[year] = out;
  return out;
}
function holidayName_(d) {
  return jpHolidays_(d.getFullYear())[ymd_(d)] || '';
}

let TZ_ = '';
function tz_() {
  if (!TZ_) { try { TZ_ = Session.getScriptTimeZone() || 'Asia/Tokyo'; } catch (err) { TZ_ = 'Asia/Tokyo'; } }
  return TZ_;
}

/*
 * 日時の組み立ては自前でやる。Utilities.formatDate と Session.getScriptTimeZone はスクリプトの外への呼び出しで、
 * 画面を 1 回読み込むだけで何百回も呼ぶと目に見えて遅い。V8 の Date はスクリプトのタイムゾーンで動くので、
 * getFullYear などの値はタイムゾーンを渡した formatDate と同じになる
 */
function ymd_(d) {
  return d.getFullYear() + '-' + pad2_(d.getMonth() + 1) + '-' + pad2_(d.getDate());
}

function fmtDateTime_(d) {
  return d.getFullYear() + '/' + pad2_(d.getMonth() + 1) + '/' + pad2_(d.getDate()) + ' ' + pad2_(d.getHours()) + ':' + pad2_(d.getMinutes());
}

/**
 * シートから読んだ日時を「2026/09/15（火） 21:23」にする。
 * 文字列で書いた日時もスプレッドシートが日付型に変えることがあり、そのまま String() すると英語表記になる
 */
function stampText_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return fmtStampJa_(v);
  const t = String(v === undefined || v === null ? '' : v).trim();
  const m = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})[ T](\d{1,2}):(\d{2})/.exec(t);
  if (m) return fmtStampJa_(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])));
  return t;
}

function fmtStampJa_(d) {
  return d.getFullYear() + '/' + pad2_(d.getMonth() + 1) + '/' + pad2_(d.getDate()) + '（' + WD[d.getDay()] + '） ' + pad2_(d.getHours()) + ':' + pad2_(d.getMinutes());
}

function fmtDateJa_(d) {
  return (d.getMonth() + 1) + '/' + d.getDate() + '（' + WD[d.getDay()] + '）';
}

function timeRange_(s) {
  if (!s.start && !s.end) return '時間未定';
  return (s.start || '？') + '〜' + (s.end || '');
}

function toDate_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : startOfDay_(v);
  if (typeof v === 'number' && v > 20000) {
    // シリアル値（1899-12-30 起点）
    const d = new Date(1899, 11, 30);
    d.setDate(d.getDate() + Math.floor(v));
    return d;
  }
  const s = String(v || '').trim();
  const m = /^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const m2 = /^(\d{1,2})[\/月](\d{1,2})/.exec(s);
  if (m2) {
    const now = new Date();
    return new Date(now.getFullYear(), Number(m2[1]) - 1, Number(m2[2]));
  }
  return null;
}

function timeStr_(v) {
  if (v instanceof Date) return pad2_(v.getHours()) + ':' + pad2_(v.getMinutes());
  if (typeof v === 'number') {
    const mins = Math.round((v % 1) * 24 * 60);
    return pad2_(Math.floor(mins / 60)) + ':' + pad2_(mins % 60);
  }
  return normTime_(v);
}

function normTime_(v) {
  const s = String(v || '').trim().replace(/：/g, ':');
  const m = /^(\d{1,2})(?::(\d{2}))?/.exec(s);
  if (!m) return s;
  return pad2_(Number(m[1])) + ':' + (m[2] || '00');
}

function pad2_(n) {
  return ('0' + n).slice(-2);
}

function startOfDay_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays_(d, n) {
  const r = startOfDay_(d);
  r.setDate(r.getDate() + n);
  return r;
}

function daysBetween_(a, b) {
  return Math.round((startOfDay_(b).getTime() - startOfDay_(a).getTime()) / 86400000);
}

function splitNames_(v) {
  return String(v || '').split(/[、,，;；\n\/／]+/).map(s => s.trim()).filter(Boolean);
}

function uniq_(arr) {
  const seen = {};
  return arr.filter(x => (seen[x] ? false : (seen[x] = true)));
}

function fill_(arr, n, v) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[i] === undefined || arr[i] === '' ? v : arr[i]);
  return out;
}

function clampInt_(v, min, max, def) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function isOn_(v) {
  const s = String(v === undefined || v === null ? '' : v).trim().toUpperCase();
  return s === 'ON' || s === 'TRUE' || s === '1' || s === 'はい' || s === '○';
}

function userEmail_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (err) {
    return '';
  }
}
