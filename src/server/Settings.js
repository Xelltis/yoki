/* ---------------------------------------------------------
 * 設定タブ（知らせの設定・卓予定の名前・シリーズごとの通知・接続テスト）
 * --------------------------------------------------------- */

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
