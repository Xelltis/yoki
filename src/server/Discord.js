/* ---------------------------------------------------------
 * Discord への送信（送り先・送り直し・文面・通知ログ）
 * --------------------------------------------------------- */

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

/**
 * Discord へ送る。429（Cloudflare の 1015 を含む）と 5xx のときは、少し待って最大 3 回まで送り直す。
 * Apps Script の通信は Google の共有サーバーから出るので、こちらが 1 通でも混雑で弾かれることがある。
 * トリガーやシートのメニューから呼ぶときはこの関数が待ちも受け持つ。
 * ウェブアプリは 1 回ずつ sendDiscordStep() を呼び、待ちと回数の表示を画面側で行う
 */
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
