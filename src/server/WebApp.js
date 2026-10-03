/* ---------------------------------------------------------
 * Web アプリ（client/Console.html）。ブラウザから見る・書く
 *   デプロイ → 新しいデプロイ → ウェブアプリ。実行ユーザーは「自分」
 *   画面は client/ の HTML をテンプレートとして組み立てる。CSS と JS は別のファイルにしてあり、
 *   テンプレートの <?!= include_('client/ConsoleCss'); ?> で差し込む
 * --------------------------------------------------------- */

/** 画面の HTML（clasp の rootDir からのパスで、拡張子は付けない） */
const PAGE = { CONSOLE: 'client/Console', TUTORIAL: 'client/Tutorial' };

function doGet(e) {
  // 使い方のページ（?page=tutorial）。卓のデータを持たないので合言葉は求めない。アプリへ戻るリンク用に URL を渡す
  if (e && e.parameter && e.parameter.page === 'tutorial') {
    return HtmlService.createTemplateFromFile(PAGE.TUTORIAL).evaluate()
      .append('<script>window.APP_URL = ' + JSON.stringify(appUrl_()) + ';</script>')
      .setTitle('卓予定の使い方')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  ensureReady_(ss_());
  return HtmlService.createTemplateFromFile(PAGE.CONSOLE).evaluate()
    .setTitle('卓予定')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * テンプレートから呼ぶ。HTML ファイルの中身を、そのまま差し込む。
 * 名前を _ で終えて、画面（google.script.run）からは呼べないようにしておく
 */
function include_(file) {
  return HtmlService.createHtmlOutputFromFile(file).getContent();
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
