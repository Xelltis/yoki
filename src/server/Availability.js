/* ---------------------------------------------------------
 * メンバーの予定（都合の △× と予定メモ）と日付メモ
 * --------------------------------------------------------- */

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

/** 日付メモを書く。空にすると消す。form: { ymd, text, me } */
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
