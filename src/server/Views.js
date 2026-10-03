/* ---------------------------------------------------------
 * 表示の作り直し
 * --------------------------------------------------------- */

/**
 * 開催日が過ぎた「開催」の卓を「終了」にする。当日はそのまま。カレンダーからは消えない。
 * 表示を作り直すたびに走る。ctx の中身も書き換えるので、この後の描画に反映される。書き換えた件数を返す
 */
function autoFinishPast_(ctx) {
  const sh = ctx.ss.getSheetByName(SHEET.SESSIONS);
  const stamp = fmtDateTime_(new Date());
  let n = 0;
  const set = (s, status) => {
    sh.getRange(s.row, SC.STATUS + 1).setValue(status);
    sh.getRange(s.row, SC.UPDATED + 1).setValue(stamp);
    s.status = status;
    n++;
  };
  if (isOn_(ctx.settings['過ぎた卓を自動で終了'])) {
    const today = ymd_(ctx.now);
    ctx.sessions.forEach(s => {
      if (!s.ymd || DATED.indexOf(s.status) < 0) return;
      if (s.ymd < today) set(s, STATUS.DONE);
    });
  }
  if (n) SpreadsheetApp.flush();
  return n;
}

function refreshAll_(ctx) {
  // ロックを待つあいだに中身が変わりうるので、ロックを取ってから読み直す
  if (LOCK_DEPTH_ === 0) return withLock_(() => refreshAll_(loadContext_(ctx.ss)));
  ensureSheets_(ctx.ss);
  autoFinishPast_(ctx);
  renderAvailability_(ctx);
  renderCalendar_(ctx);
  renderList_(ctx);
  renderAdmin_(ctx);
  SpreadsheetApp.flush();
  clearDirty_();
}

/* ---- カレンダー ---- */

function renderCalendar_(ctx) {
  const sh = getOrCreateSheet_(ctx.ss, SHEET.CALENDAR);
  const prevTarget = String(sh.getRange(2, 2).getValue() || '').trim();
  resetSheet_(sh);

  const months = clampInt_(ctx.settings['カレンダーの表示月数'], 1, 12, 2);
  const active = activeSessions_(ctx);
  const options = [TARGET_ALL].concat(uniq_(active.map(s => s.name))).concat([TARGET_NONE]);
  const target = options.indexOf(prevTarget) >= 0 ? prevTarget : TARGET_ALL;
  const availMap = availabilityMap_(ctx, target);
  // 終了・中止もカレンダーには残す
  const byDay = {};
  ctx.sessions.forEach(s => { if (s.ymd) (byDay[s.ymd] = byDay[s.ymd] || []).push(s); });
  const winByDay = windowByDay_(ctx);
  const todayKey = ymd_(ctx.now);

  const rows = [], bgs = [], weights = [], colors = [], aligns = [], heights = [], wraps = [];
  const merges = [];
  const push = (vals, opt) => {
    opt = opt || {};
    rows.push(fill_(vals, CAL_COLS, ''));
    bgs.push(fill_(opt.bg || [], CAL_COLS, COLOR.WHITE));
    weights.push(fill_(opt.w || [], CAL_COLS, 'normal'));
    colors.push(fill_(opt.c || [], CAL_COLS, '#000000'));
    aligns.push(fill_(opt.a || [], CAL_COLS, 'left'));
    heights.push(opt.h || 21);
    wraps.push(fill_([], CAL_COLS, opt.nowrap ? false : true));
    return rows.length;
  };

  // 1 行目: 見出し
  let r = push(['卓カレンダー', '', '', '', '', '', '更新 ' + fmtDateTime_(ctx.now)],
    { w: ['bold'], a: ['left', '', '', '', '', '', 'right'], h: 28 });
  merges.push([r, 1, 1, 6]);
  // 2 行目: 都合の対象と凡例
  push(['都合を見る卓 ▶', target, '凡例', '全員空き', '△あり', '卓あり', '終わった卓'], {
    bg: [COLOR.HEAD, COLOR.WHITE, COLOR.HEAD, COLOR.OK, COLOR.SOFT, COLOR.SESSION, COLOR.PAST],
    w: ['bold', 'bold', 'bold'], a: ['right', 'left', 'center', 'center', 'center', 'center', 'center'],
  });
  // 3 行目以降: お知らせ
  r = push(['お知らせ'], { bg: [COLOR.ACCENT], c: ['#ffffff'], w: ['bold'] });
  merges.push([r, 1, 1, CAL_COLS]);
  // お知らせの行は結合しない。結合セルは行の自動高さが効かないので、右の空セルへはみ出させる
  noticeLines_(ctx).forEach(line => {
    push([line.text], { w: [line.bold ? 'bold' : 'normal'], c: [line.color || '#000000'], nowrap: true });
  });
  push([]);

  // 月の格子。週ごとに「日付の行」と「中身の行」の 2 行
  const first = new Date(ctx.now.getFullYear(), ctx.now.getMonth(), 1);
  for (let m = 0; m < months; m++) {
    const mStart = new Date(first.getFullYear(), first.getMonth() + m, 1);
    const y = mStart.getFullYear(), mo = mStart.getMonth();
    const daysInMonth = new Date(y, mo + 1, 0).getDate();
    r = push([y + '年' + (mo + 1) + '月'], { bg: [COLOR.HEAD], w: ['bold'], h: 26 });
    merges.push([r, 1, 1, CAL_COLS]);
    push(WD.slice(), {
      bg: fill_([], CAL_COLS, COLOR.HEAD), w: fill_([], CAL_COLS, 'bold'), a: fill_([], CAL_COLS, 'center'),
      c: ['#c00000', '', '', '', '', '', '#1155cc'],
    });

    let day = 1 - mStart.getDay();
    while (day <= daysInMonth) {
      const numVals = [], numBg = [], numColor = [], bodyVals = [], bodyBg = [], bodyBold = [];
      for (let c = 0; c < CAL_COLS; c++, day++) {
        if (day < 1 || day > daysInMonth) {
          numVals.push(''); numBg.push(COLOR.OUT); numColor.push('#999999');
          bodyVals.push(''); bodyBg.push(COLOR.OUT); bodyBold.push('normal');
          continue;
        }
        const d = new Date(y, mo, day);
        const key = ymd_(d);
        const list = sortSessions_(byDay[key] || []);
        const isToday = key === todayKey;
        const av = availMap[key];
        const hol = holidayName_(d);
        const wk = c === 0 || c === 6 || !!hol;
        numVals.push((isToday ? day + '（今日）' : String(day)) + (hol ? ' ' + hol : ''));
        numColor.push((c === 0 || hol) ? '#c00000' : c === 6 ? '#1155cc' : '#000000');
        numBg.push(isToday ? COLOR.TODAY : wk ? COLOR.WEEKEND : COLOR.WHITE);
        const lines = list.map(s => {
          const head = s.status === STATUS.RECRUIT ? '募集 ' : s.status === STATUS.HELD ? '開催 ' : s.status === STATUS.DONE ? '済 ' : s.status === STATUS.CANCELED ? '中止 ' : '';
          return head + (s.start ? s.start + ' ' : '') + s.name + (s.gm ? '／' + s.gm : '');
        });
        const liveCount = list.filter(s => ACTIVE.indexOf(s.status) >= 0).length;
        (winByDay[key] || []).forEach(s => lines.push(s.candidates.length ? '🗳 候補日: ' + s.name : '◇ ' + s.name + '（調整中）'));
        const note = ctx.notes[key];
        if (note) lines.push('📝 ' + note.text.split('\n')[0]);
        if (av === 'ok') lines.push('◎ 全員空き');
        else if (av === 'soft') lines.push('△ あり');
        bodyVals.push(lines.join('\n'));
        bodyBg.push(av === 'ok' ? COLOR.OK : av === 'soft' ? COLOR.SOFT : liveCount ? COLOR.SESSION : list.length ? COLOR.PAST : wk ? COLOR.WEEKEND : COLOR.WHITE);
        bodyBold.push(liveCount ? 'bold' : 'normal');
      }
      push(numVals, { bg: numBg, c: numColor, w: fill_([], CAL_COLS, 'bold'), h: 18 });
      push(bodyVals, { bg: bodyBg, w: bodyBold, h: 96 });
    }
    push([]);
  }

  ensureSize_(sh, rows.length, CAL_COLS);
  const rng = sh.getRange(1, 1, rows.length, CAL_COLS);
  rng.setValues(rows).setBackgrounds(bgs).setFontWeights(weights).setFontColors(colors)
    .setHorizontalAlignments(aligns).setVerticalAlignment('top').setWraps(wraps);
  merges.forEach(m => sh.getRange(m[0], m[1], m[2], m[3]).merge());
  applyRowHeights_(sh, heights);
  sh.setColumnWidths(1, CAL_COLS, 165);
  sh.getRange(2, 2).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(options, true).setAllowInvalid(false).build()
  ).setBorder(true, true, true, true, false, false, COLOR.ACCENT, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  sh.setFrozenRows(2);
  sh.setTabColor(COLOR.ACCENT);
}

function noticeLines_(ctx) {
  const lines = [];
  const todayKey = ymd_(ctx.now);
  const tomorrowKey = ymd_(addDays_(ctx.now, 1));
  const planned = sortedActive_(ctx).filter(s => DATED.indexOf(s.status) >= 0 && s.date);
  const desc = s => s.name + '　' + timeRange_(s) + '　GM: ' + (s.gm || '未定') + '　参加: ' + (s.members.join('、') || '未定');

  const todays = planned.filter(s => s.ymd === todayKey);
  const tomorrows = planned.filter(s => s.ymd === tomorrowKey);
  const week = planned.filter(s => {
    const n = daysBetween_(ctx.now, s.date);
    return n >= 2 && n <= 7;
  });
  const overdue = planned.filter(s => daysBetween_(ctx.now, s.date) < 0);
  const recruiting = sortSessions_(activeSessions_(ctx).filter(s => s.status === STATUS.RECRUIT));
  const adjusting = sortSessions_(activeSessions_(ctx).filter(s => s.status === STATUS.ADJUSTING));

  todays.forEach(s => lines.push({ text: '🔴 今日: ' + desc(s), bold: true, color: '#c00000' }));
  tomorrows.forEach(s => lines.push({
    text: '🟠 明日: ' + desc(s) + '　［' + notifyStateText_(ctx, s) + '］',
    bold: true, color: '#b45f06',
  }));
  if (!todays.length && !tomorrows.length) lines.push({ text: '今日・明日の卓はありません。' });
  week.forEach(s => lines.push({ text: '🔵 ' + fmtDateJa_(s.date) + ': ' + desc(s) }));
  if (recruiting.length) {
    lines.push({
      text: '🟡 募集中: ' + recruiting.map(s => s.name + '（GM: ' + (s.gm || '未定') + '、' + (s.windowLabel || '時期未定') +
        (s.want.length ? '、参加希望 ' + s.want.length + ' 人' : '') + '）').join('、') +
        '　→ ウェブアプリの「募集・調整」タブで参加希望を出せます。左上の「都合を見る卓」で選ぶと、全員が空いている日に色が付きます。',
    });
  }
  if (adjusting.length) {
    lines.push({
      text: '🔶 日程調整中: ' + adjusting.map(s => s.name + '（GM: ' + (s.gm || '未定') + '、' + (s.candidates.length ? '候補日 ' + s.candidates.length + ' 日・未回答 ' + pollPending_(ctx, s).length + ' 人' : (s.windowLabel ? s.windowLabel + ' のどこか' : '期間未定')) + '）').join('、') +
        '　→ 左上の「都合を見る卓」で選ぶと、全員が空いている日に色が付きます。候補の期間には ◇ が付いています。',
    });
  }
  adjusting.filter(s => s.windowTo && s.windowTo < todayKey).forEach(s => lines.push({
    text: '⚪ 候補の期間を過ぎています: ' + s.name + '（' + s.windowLabel + '）　→ 開催日を決めて「開催」にするか、期間を延ばしてください。',
    color: '#666666',
  }));
  overdue.forEach(s => lines.push({
    text: '⚪ 開催日を過ぎています: ' + s.name + '（' + fmtDateJa_(s.date) + '）　→ 「設定」の「過ぎた卓を自動で終了」を ON にすると、翌日に自動で終了になります。',
    color: '#666666',
  }));

  const setter = String(ctx.settings['自動通知の設定者'] || '').trim();
  const hook = String(ctx.settings['Discord Webhook URL'] || '').trim();
  lines.push({ text: 'ウェブアプリで変えた内容は、シートを開いたときと 10 分おきにこの表へ反映されます。', color: '#666666' });
  lines.push({
    text: 'Discord: ' + (hook ? 'Webhook 設定済み' : 'Webhook 未設定（「設定」シート）') +
      '　／　開催前の知らせ: ' + (setter ? '有効（' + setter + '）' : '未設定（メニュー「卓予定 → 自動通知を設定」）'),
    color: '#666666',
  });
  return lines;
}

/* ---- 一覧 ---- */

function renderList_(ctx) {
  const sh = getOrCreateSheet_(ctx.ss, SHEET.LIST);
  resetSheet_(sh);
  const header = ['ID', '卓の名前', 'シリーズ', 'GM', '参加者', '人数', '開催日', '曜日', '時間', '状態', 'あと', '参加希望', '興味あり', '開催前の知らせ', '場所 / URL', 'メモ'];
  const list = sortedActive_(ctx);
  const rows = [fill_(['予定されている卓　' + list.length + ' 件（更新 ' + fmtDateTime_(ctx.now) + '）'], header.length, ''), header];
  const bgs = [fill_([], header.length, COLOR.WHITE), fill_([], header.length, COLOR.HEAD)];
  list.forEach(s => {
    const n = s.date ? daysBetween_(ctx.now, s.date) : null;
    rows.push([
      s.id, s.name, s.series, s.gm, s.members.join('、'), peopleOf_(s).length,
      s.date || '', s.date ? WD[s.date.getDay()] : '', s.date ? timeRange_(s) : '',
      s.status, daysLabel_(n, s), s.want.join('、'), s.interest.join('、'), s.notifiedStamp ? '済 ' + s.notifiedStamp : '',
      s.place, s.memo,
    ]);
    let bg = COLOR.WHITE;
    if (n === null) bg = COLOR.WHITE;
    else if (n < 0) bg = COLOR.PAST;
    else if (n === 0) bg = COLOR.WARN;
    else if (n === 1) bg = COLOR.SOON;
    else if (n <= 7) bg = COLOR.SESSION;
    bgs.push(fill_([], header.length, bg));
  });
  if (list.length === 0) {
    rows.push(fill_(['まだ卓が登録されていません。メニュー「卓予定 → 予定を登録・編集…」から登録します。'], header.length, ''));
    bgs.push(fill_([], header.length, COLOR.WHITE));
  }
  ensureSize_(sh, rows.length, header.length);
  const rng = sh.getRange(1, 1, rows.length, header.length);
  rng.setValues(rows).setBackgrounds(bgs).setVerticalAlignment('top').setWrap(true);
  sh.getRange(1, 1, 1, header.length).merge().setFontWeight('bold').setFontSize(12);
  sh.getRange(2, 1, 1, header.length).setFontWeight('bold');
  if (list.length) sh.getRange(3, 7, list.length, 1).setNumberFormat('yyyy/mm/dd');
  if (rows.length > 2) sh.autoResizeRows(3, rows.length - 2);
  sh.setFrozenRows(2);
  [50, 200, 120, 90, 220, 45, 95, 40, 100, 60, 100, 120, 120, 130, 160, 220].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.setTabColor('#6aa84f');
}

function daysLabel_(n, s) {
  if (n === null) {
    if (s && s.status === STATUS.RECRUIT) return (s.windowLabel || '時期未定') + ' 募集中';
    if (s && s.status === STATUS.ADJUSTING) return (s.windowLabel ? s.windowLabel + ' のどこか' : '期間未定') + ' 調整中';
    return '日程未定';
  }
  if (n === 0) return '今日';
  if (n === 1) return '明日';
  if (n > 1) return n + '日後';
  return (-n) + '日前';
}

/* ---- 管理 ---- */

function renderAdmin_(ctx) {
  const sh = getOrCreateSheet_(ctx.ss, SHEET.ADMIN);
  resetSheet_(sh);
  const active = sortedActive_(ctx);
  const planned = active.filter(s => DATED.indexOf(s.status) >= 0);
  const recruiting = active.filter(s => s.status === STATUS.RECRUIT || s.status === STATUS.ADJUSTING);
  const y = ctx.now.getFullYear(), mo = ctx.now.getMonth();
  const thisMonth = planned.filter(s => s.date && s.date.getFullYear() === y && s.date.getMonth() === mo);
  const next = new Date(y, mo + 1, 1);
  const nextMonth = planned.filter(s => s.date && s.date.getFullYear() === next.getFullYear() && s.date.getMonth() === next.getMonth());
  const gms = uniq_(active.map(s => s.gm).filter(Boolean));
  const memberNames = ctx.members.map(m => m.name);
  const unknown = uniq_([].concat.apply([], active.map(peopleOf_)).filter(n => memberNames.indexOf(n) < 0));

  const width = Math.max(6, memberNames.length + 5);
  const rows = [], bgs = [], weights = [], aligns = [], wraps = [];
  const merges = [];
  const whiteRows = [];
  const push = (vals, bg, w, a, nowrap) => {
    rows.push(fill_(vals, width, ''));
    bgs.push(fill_(bg || [], width, COLOR.WHITE));
    weights.push(fill_(w || [], width, 'normal'));
    aligns.push(fill_(a || [], width, 'left'));
    wraps.push(fill_([], width, nowrap ? false : true));
    return rows.length;
  };
  const tileBg = [COLOR.HEAD, '', COLOR.HEAD, '', COLOR.HEAD, ''];
  const tileW = ['bold', 'bold', 'bold', 'bold', 'bold', 'bold'];
  const matrixAlign = ['left', 'center', 'center', 'center'].concat(fill_([], memberNames.length, 'center')).concat(['center']);

  let r = push(['全体管理（更新 ' + fmtDateTime_(ctx.now) + '）'], [], ['bold']);
  merges.push([r, 1, 1, width]);
  push(['稼働中の卓', active.length, 'うち募集・調整中', recruiting.length, 'うち予定・開催', planned.length], tileBg, tileW);
  push(['今月の開催', thisMonth.length, '来月の開催', nextMonth.length, '動いている GM', gms.length], tileBg, tileW);
  push(['登録メンバー', memberNames.length, '終了した卓', ctx.sessions.filter(s => s.status === STATUS.DONE).length,
    '中止', ctx.sessions.filter(s => s.status === STATUS.CANCELED).length], tileBg, tileW);
  if (unknown.length) {
    push(['⚠ メンバーシートに無い参加者: ' + unknown.join('、') + '　→ 「メンバー」に加えると都合表に列ができます。'],
      fill_([], width, COLOR.SOON), [], [], true);
  }
  push([]);

  // 卓 × メンバー
  r = push(['卓 × メンバー（GM = ゲームマスター、PL = 参加者、希望 = 参加希望、興味 = 興味あり）'], [COLOR.ACCENT], ['bold']);
  merges.push([r, 1, 1, width]);
  whiteRows.push(r);
  push(['卓の名前', '状態', '開催日', 'GM'].concat(memberNames).concat(['人数']),
    fill_([], width, COLOR.HEAD), fill_([], width, 'bold'), matrixAlign);
  const partCount = memberNames.map(() => 0);
  const gmCount = memberNames.map(() => 0);
  active.forEach(s => {
    const rec = s.status === STATUS.RECRUIT;
    const cells = memberNames.map((n, i) => {
      if (s.gm === n) { gmCount[i]++; return 'GM'; }
      if (s.members.indexOf(n) >= 0) { partCount[i]++; return 'PL'; }
      if (rec && s.want.indexOf(n) >= 0) return '希望';
      if (rec && s.interest.indexOf(n) >= 0) return '興味';
      return '';
    });
    const bg = ['', '', '', ''].concat(memberNames.map(n =>
      s.gm === n ? COLOR.GM : s.members.indexOf(n) >= 0 ? COLOR.MARK
        : rec && s.want.indexOf(n) >= 0 ? COLOR.SOON : rec && s.interest.indexOf(n) >= 0 ? COLOR.OUT : COLOR.WHITE)).concat(['']);
    push([s.name, s.status, s.date ? fmtDateJa_(s.date) : (rec || s.status === STATUS.ADJUSTING) ? (s.windowLabel || '期間未定') : '未定', s.gm].concat(cells).concat([peopleOf_(s).length]),
      bg, [], matrixAlign);
  });
  if (active.length === 0) push(['（稼働中の卓はありません）']);
  push(['参加している卓数', '', '', ''].concat(partCount).concat(['']), fill_([], width, COLOR.HEAD), fill_([], width, 'bold'), matrixAlign);
  push(['GM をしている卓数', '', '', ''].concat(gmCount).concat(['']), fill_([], width, COLOR.HEAD), fill_([], width, 'bold'), matrixAlign);
  push([]);

  // メンバー別
  r = push(['メンバー別'], [COLOR.ACCENT], ['bold']);
  merges.push([r, 1, 1, width]);
  whiteRows.push(r);
  push(['名前', '参加', 'GM', '合計', '参加している卓（GM の卓は ★）'], fill_([], width, COLOR.HEAD), fill_([], width, 'bold'));
  memberNames.forEach((n, i) => {
    const mine = active.filter(s => peopleOf_(s).indexOf(n) >= 0)
      .map(s => (s.gm === n ? '★' : '') + s.name + (s.date ? '（' + fmtDateJa_(s.date) + '）' : s.windowLabel ? '（' + s.windowLabel + '）' : '（未定）'));
    push([n, partCount[i], gmCount[i], partCount[i] + gmCount[i], mine.join('、') || '—'],
      [], [], ['left', 'center', 'center', 'center', 'left'], true);
  });
  if (memberNames.length === 0) push(['（メンバーが登録されていません）']);

  ensureSize_(sh, rows.length, width);
  const rng = sh.getRange(1, 1, rows.length, width);
  rng.setValues(rows).setBackgrounds(bgs).setFontWeights(weights)
    .setHorizontalAlignments(aligns).setVerticalAlignment('top').setWraps(wraps);
  merges.forEach(m => sh.getRange(m[0], m[1], m[2], m[3]).merge());
  whiteRows.forEach(row => sh.getRange(row, 1).setFontColor('#ffffff'));
  sh.setColumnWidth(1, 200);
  sh.setColumnWidth(2, 70);
  sh.setColumnWidth(3, 90);
  sh.setColumnWidth(4, 90);
  if (memberNames.length) sh.setColumnWidths(5, memberNames.length, 70);
  sh.setColumnWidth(width, 60);
  sh.setTabColor('#e69138');
}

/* ---- 都合 ---- */

function renderAvailability_(ctx) {
  if (LOCK_DEPTH_ === 0) return withLock_(() => renderAvailability_(loadContext_(ctx.ss)));
  const sh = getOrCreateSheet_(ctx.ss, SHEET.AVAIL);
  const days = clampInt_(ctx.settings['都合表の日数'], 7, 366, 60);
  const names = ctx.members.map(m => m.name);
  const old = ctx.avail;
  resetSheet_(sh);

  const byDay = {};
  activeSessions_(ctx).forEach(s => { if (s.ymd) (byDay[s.ymd] = byDay[s.ymd] || []).push(s); });

  const booked = bookedMap_(ctx);
  const winByDay = windowByDay_(ctx);
  const width = 3 + names.length;
  const rows = [['日付', '曜日', 'その日の卓'].concat(names)];
  const bgs = [fill_([], width, COLOR.HEAD)];
  const colors = [fill_([], width, '#000000')];
  const satRows = [];
  const start = startOfDay_(ctx.now);
  for (let i = 0; i < days; i++) {
    const d = addDays_(start, i);
    const key = ymd_(d);
    const marks = old[key] || {};
    const bk = booked[key] || {};
    const hol = holidayName_(d);
    const list = (byDay[key] || []).map(s => (s.status === STATUS.RECRUIT ? '募集 ' : '') + s.name).concat((winByDay[key] || []).map(s => (s.candidates.length ? '候補: ' : '調整: ') + s.name));
    // 卓に入っている人は「参」「GM」。以前の「参」「GM」が残っていて今は入っていないなら空に戻す
    const cell = n => bk[n] || (BOOKED_MARKS.indexOf(marks[n]) >= 0 || marks[n] === '○' ? '' : (marks[n] || ''));
    rows.push([d, WD[d.getDay()] + (hol ? '祝' : ''), list.join('、')].concat(names.map(cell)));
    const wk = d.getDay() === 0 || d.getDay() === 6 || !!hol;
    const base = i === 0 ? COLOR.TODAY : wk ? COLOR.WEEKEND : COLOR.WHITE;
    bgs.push([base, base, list.length ? COLOR.SESSION : base].concat(names.map(n => {
      const v = cell(n);
      return BOOKED_MARKS.indexOf(v) >= 0 ? COLOR.SESSION : v === '△' ? COLOR.SOFT : v === '×' ? COLOR.WARN : base;
    })));
    const dayColor = (d.getDay() === 0 || hol) ? '#c00000' : d.getDay() === 6 ? '#1155cc' : '#000000';
    colors.push([dayColor, dayColor].concat(fill_([], width - 2, '#000000')));
    if (d.getDay() === 6) satRows.push(i + 2);
  }
  ensureSize_(sh, rows.length, width);
  const rng = sh.getRange(1, 1, rows.length, width);
  rng.setValues(rows).setBackgrounds(bgs).setFontColors(colors);
  // 週の区切り（土曜の下）に灰色の線
  satRows.forEach(r => sh.getRange(r, 1, 1, width).setBorder(null, null, true, null, null, null, '#999999', SpreadsheetApp.BorderStyle.SOLID_MEDIUM));
  sh.getRange(1, 1, 1, width).setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange(2, 1, days, 1).setNumberFormat('yyyy/mm/dd');
  if (names.length) {
    sh.getRange(2, 4, days, names.length).setHorizontalAlignment('center').setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(MARKS.concat(BOOKED_MARKS), true).setAllowInvalid(false).build()
    );
    sh.setColumnWidths(4, names.length, 70);
    // 予定メモはセルのメモに出す（シート側でも読める）
    const noteGrid = [];
    for (let i = 0; i < days; i++) {
      const n = ctx.availNotes[ymd_(addDays_(start, i))] || {};
      noteGrid.push(names.map(nm => (n[nm] ? n[nm].text : '')));
    }
    sh.getRange(2, 4, days, names.length).setNotes(noteGrid);
  }
  sh.getRange(1, 1).setNote('空欄 = 参加できる、△ = 調整すれば可、× = 不可。都合の悪い日だけ入れます。\n自分の列に入れると、カレンダーの色に反映されます。\n「参」「GM」は、その日の卓に入っている人に自動で付きます（手で変えても戻ります）。\n曜日の「祝」は祝日（振替休日・国民の休日を含む）。\n行は「表示を更新」のたびに今日から作り直されますが、入れた印は残ります。');
  sh.setColumnWidth(1, 95);
  sh.setColumnWidth(2, 40);
  sh.setColumnWidth(3, 220);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(3);
  sh.setTabColor('#8e7cc3');
}
