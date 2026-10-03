/* ---------------------------------------------------------
 * メンバーの登録・変更・削除（画面から呼ばれる）
 * --------------------------------------------------------- */

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
