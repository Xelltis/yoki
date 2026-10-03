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
