/* ---------------------------------------------------------
 * サンプルデータ
 * --------------------------------------------------------- */

function seedSample() {
  const ss = ss_();
  ensureSheets_(ss);
  const ui = SpreadsheetApp.getUi();
  const res = ui.alert('サンプルのメンバー 4 人と卓 4 件を追加します。よろしいですか？', ui.ButtonSet.OK_CANCEL);
  if (res !== ui.Button.OK) return;
  seedSample_(ss, new Date());
  refreshAll_(loadContext_(ss));
  ui.alert('サンプルを入れました。「セッション」「メンバー」シートの行を消せば元に戻ります。');
}

function seedSample_(ss, now) {
  const mem = ss.getSheetByName(SHEET.MEMBERS);
  const names = ['アリス', 'ボブ', 'カレン', 'ダン'];
  const have = getMembers_(ss).map(m => m.name);
  const add = names.filter(n => have.indexOf(n) < 0).map(n => [n, '', 'サンプル']);
  if (add.length) mem.getRange(Math.max(mem.getLastRow() + 1, 2), 1, add.length, 3).setValues(add);

  const sessions = getSessions_(ss);
  const sh = ss.getSheetByName(SHEET.SESSIONS);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const recruitWindow = windowOf_(nextMonth, new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 15)).text;
  const rows = [
    ['鉄鳴界の夜明け #1', 'アリス', 'ボブ、カレン、ダン', addDays_(now, 1), '20:00', '23:00', STATUS.HELD, 'Discord ボイス', 'キャンペーンの第 1 回', 'サンプル', fmtDateTime_(now), '', '', '', '', '', '鉄鳴界の夜明け'],
    ['連れて帰る', 'ボブ', 'アリス、カレン', addDays_(now, 9), '14:00', '18:00', STATUS.HELD, '', 'サンプル', 'サンプル', fmtDateTime_(now), '', '', '', ''],
    ['新キャンペーン顔合わせ', 'カレン', 'アリス、ボブ', '', '', '', STATUS.RECRUIT, '', '募集中のサンプル。状態を「開催」にすると、参加希望の人が参加者になる', 'サンプル', fmtDateTime_(now), '', '', 'ダン', '', '', '', recruitWindow],
    ['迷宮の底へ', 'ダン', 'アリス、カレン', '', '', '', STATUS.ADJUSTING, '', '日程を選んでいるサンプル。候補の期間のどこかで開く', 'サンプル', fmtDateTime_(now), '', '', '', '', '', '', windowOf_(addDays_(now, 14), addDays_(now, 28)).text],
  ];
  const out = [];
  const list = sessions.slice();
  rows.forEach(r => {
    if (sessions.some(s => s.name === r[0])) return;
    const id = nextSessionId_(list);
    list.push({ id: id });
    out.push(fill_([id].concat(r), SESSION_HEADER.length, ''));
  });
  if (out.length) {
    const start = Math.max(sh.getLastRow() + 1, 2);
    sh.getRange(start, 1, out.length, SESSION_HEADER.length).setValues(out);
  }

  // 都合のサンプル。3 日後と 12 日後は全員空き、それ以外は △× をばらつかせる（卓の日は「参」「GM」に置き換わる）
  const av = getOrCreateSheet_(ss, SHEET.AVAIL);
  renderAvailability_(loadContext_(ss));
  const lastRow = av.getLastRow();
  const lastCol = av.getLastColumn();
  if (lastRow >= 2 && lastCol > 3) {
    const header = av.getRange(1, 1, 1, lastCol).getValues()[0];
    const dates = av.getRange(2, 1, lastRow - 1, 1).getValues();
    const rng = av.getRange(2, 4, lastRow - 1, lastCol - 3);
    const cur = rng.getValues();
    for (let i = 0; i < dates.length; i++) {
      const d = toDate_(dates[i][0]);
      const n = d ? daysBetween_(now, d) : -1;
      for (let c = 3; c < header.length; c++) {
        if (names.indexOf(String(header[c])) < 0) continue;
        cur[i][c - 3] = (n === 3 || n === 12) ? '' : sampleMark_(n, c);
      }
    }
    rng.setValues(cur);
  }
}

function sampleMark_(n, c) {
  const v = (n * 7 + c * 13) % 10;
  if (v < 6) return '';
  if (v < 8) return '△';
  return '×';
}
