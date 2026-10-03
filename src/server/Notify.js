/* ---------------------------------------------------------
 * 通知（見回り・開催前の知らせ・期間前の催促・開始直前の知らせ）
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
