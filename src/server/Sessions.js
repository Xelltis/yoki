/* ---------------------------------------------------------
 * 卓の登録・変更・削除（画面から呼ばれる）
 * --------------------------------------------------------- */

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
