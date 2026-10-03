/* ---------------------------------------------------------
 * データ読み込み
 * --------------------------------------------------------- */

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
