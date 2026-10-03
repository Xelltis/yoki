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
