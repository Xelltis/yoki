/* ---------------------------------------------------------
 * 卓・期間・都合を読み解く小道具（並べ替え、期間と候補日、卓に入っている人、全員空きの日）
 * --------------------------------------------------------- */

function peopleOf_(s) {
  return uniq_((s.gm ? [s.gm] : []).concat(s.members));
}

function activeSessions_(ctx) {
  return ctx.sessions.filter(s => ACTIVE.indexOf(s.status) >= 0);
}

function sortedActive_(ctx) {
  return sortSessions_(activeSessions_(ctx));
}

/** 開催日の近い順。同じ日どうしは開始時刻、次に名前。日付の無い卓は期間の始まりが早い順で後ろに並び、期間未定はその後 */
function sortSessions_(list) {
  return list.slice().sort((a, b) => {
    if (!!a.date !== !!b.date) return a.date ? -1 : 1;
    if (a.date && b.date && a.ymd !== b.ymd) return a.ymd < b.ymd ? -1 : 1;
    if (!a.date && !b.date) {
      const ka = a.windowKey || '9999', kb = b.windowKey || '9999';
      if (ka !== kb) return ka < kb ? -1 : 1;
    }
    if (a.start !== b.start) return (a.start || '99') < (b.start || '99') ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

/** 都合を見る相手。GM と参加者に、募集中なら参加希望の人も加える */
function candidatesOf_(s) {
  return uniq_(peopleOf_(s).concat(s.status === STATUS.RECRUIT ? (s.want || []) : []));
}

/**
 * 募集時期「2026/10 前期」を { y, m, half, text, label: '10月前期', key: '2026-10-01' } に読む。
 * 「2026-10 後期」「2026年10月後期」も読める。シートが日付型に変えていれば、日で前期・後期を決める。読めなければ null
 */
function parsePeriod_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return periodOf_(v.getFullYear(), v.getMonth() + 1, v.getDate() >= 16 ? 2 : 1);
  const t = String(v === undefined || v === null ? '' : v).trim();
  if (!t) return null;
  const m = /^(\d{4})[\/\-.年]\s*(\d{1,2})月?\s*(前期|後期|前半|後半|上旬|下旬)?/.exec(t);
  if (!m) return null;
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return periodOf_(Number(m[1]), mo, (m[3] === '後期' || m[3] === '後半' || m[3] === '下旬') ? 2 : 1);
}

function periodOf_(y, mo, half) {
  const h = half === 2 ? 2 : 1;
  const mm = ('0' + mo).slice(-2);
  return { y: y, m: mo, half: h, text: y + '/' + mm + ' ' + HALVES[h - 1], label: mo + '月' + HALVES[h - 1], key: y + '-' + mm + '-' + (h === 2 ? '16' : '01') };
}

/** 旧い「2026/10 前期」を期間（10/1〜10/15）に、「後期」を（10/16〜月末）にする */
function periodWindow_(p) {
  return windowOf_(new Date(p.y, p.m - 1, p.half === 2 ? 16 : 1), p.half === 2 ? new Date(p.y, p.m, 0) : new Date(p.y, p.m - 1, 15));
}

/**
 * 旧い版の「募集時期」（2026/10 前期）を「期間」に移す。移したら募集時期の列は空にする。
 * 期間がすでに入っている行は、期間のほうを残す。シートを整え直すときに走る
 */
function migratePeriodToWindow_(ses) {
  const last = ses.getLastRow();
  if (last < 2) return 0;
  const rng = ses.getRange(2, 1, last - 1, SESSION_HEADER.length);
  const values = rng.getValues();
  let n = 0;
  values.forEach(r => {
    const p = parsePeriod_(r[SC.PERIOD]);
    if (!p) return;
    if (!String(r[SC.WINDOW] || '').trim()) r[SC.WINDOW] = periodWindow_(p).text;
    r[SC.PERIOD] = '';
    n++;
  });
  if (n) rng.setValues(values);
  return n;
}

/** 期間「2026/10/03〜2026/10/17」を読む。「~」「～」区切りも可。逆なら直す。読めなければ null */
function parseWindow_(v) {
  const t = String(v === undefined || v === null ? '' : v).trim();
  if (!t) return null;
  const m = /^(.+?)\s*[〜～~]\s*(.+)$/.exec(t);
  if (!m) return null;
  const a = toDate_(m[1]), b = toDate_(m[2]);
  if (!a || !b) return null;
  return windowOf_(a, b);
}

function windowOf_(a, b) {
  if (b < a) { const x = a; a = b; b = x; }
  const f = d => Utilities.formatDate(d, tz_(), 'yyyy/MM/dd');
  return { from: a, to: b, fromYmd: ymd_(a), toYmd: ymd_(b), text: f(a) + '〜' + f(b), label: fmtDateJa_(a) + '〜' + fmtDateJa_(b) };
}

/** フォームの始まり・終わり（'yyyy-MM-dd'）を「2026/10/03〜2026/10/17」にする。両方空なら ''。片方だけは弾く */
function windowTextOf_(from, to) {
  const a = String(from || '').trim(), b = String(to || '').trim();
  if (!a && !b) return '';
  if (!a || !b) throw new Error('期間は、始まりと終わりの両方の日を入れてください。');
  const da = toDate_(a), db = toDate_(b);
  if (!da || !db) throw new Error('期間の日付が読めません: ' + a + '〜' + b);
  return windowOf_(da, db).text;
}

/** 調整中の卓を日ごとに { 'yyyy-MM-dd': [卓] } で返す。日程調整中なら候補日、そうでなければ候補の期間（1 卓あたり 120 日まで） */
function windowByDay_(ctx) {
  const out = {};
  ctx.sessions.forEach(s => {
    if (s.status !== STATUS.ADJUSTING) return;
    if (s.candidates && s.candidates.length) { s.candidates.forEach(k => { (out[k] = out[k] || []).push(s); }); return; }
    if (!s.windowFrom) return;
    const b = toDate_(s.windowTo);
    for (let d = toDate_(s.windowFrom), i = 0; d <= b && i < 120; d = addDays_(d, 1), i++) (out[ymd_(d)] = out[ymd_(d)] || []).push(s);
  });
  return out;
}

/** 「開催」の卓に入っている人を { 'yyyy-MM-dd': { 名前: '参' | 'GM' } } で返す */
function bookedMap_(ctx) {
  const out = {};
  ctx.sessions.forEach(s => {
    if (DATED.indexOf(s.status) < 0 || !s.ymd) return;
    const day = out[s.ymd] = out[s.ymd] || {};
    if (s.gm) day[s.gm] = 'GM';
    s.members.forEach(n => { if (day[n] !== 'GM') day[n] = '参'; });
  });
  return out;
}

/** 都合シートの 1 マスが編集されたとき、その日の卓に入っている人なら「参」「GM」に戻す */
function fixAvailCell_(ctx, range) {
  if (range.getNumRows() !== 1 || range.getNumColumns() !== 1) return;
  const sh = range.getSheet();
  const row = range.getRow(), col = range.getColumn();
  if (row < 2 || col < 4) return;
  const name = String(sh.getRange(1, col).getValue() || '').trim();
  const d = toDate_(sh.getRange(row, 1).getValue());
  if (!name || !d) return;
  const key = ymd_(d);
  const booked = bookedMap_(ctx);
  const b = booked[key] && booked[key][name];
  if (b && String(range.getValue() || '').trim() !== b) {
    range.setValue(b).setBackground(COLOR.SESSION);
    ctx.avail[key] = ctx.avail[key] || {};
    ctx.avail[key][name] = b;
  }
}

/**
 * 対象（全員 / 卓の名前 / なし）に対して、日付ごとの都合を返す。
 * 空欄は参加できる扱い。'ok' = 誰も △× を付けておらず卓にも入っていない、'soft' = ×も卓も無いが △ の人がいる、それ以外は undefined
 */
function availabilityMap_(ctx, target) {
  const out = {};
  if (target === TARGET_NONE) return out;
  let people;
  if (target === TARGET_ALL) {
    people = ctx.members.map(m => m.name);
  } else {
    const s = activeSessions_(ctx).filter(x => x.name === target)[0];
    people = s ? candidatesOf_(s) : [];
  }
  if (people.length === 0) return out;
  Object.keys(ctx.avail).forEach(key => {
    const marks = ctx.avail[key];
    let allOk = true;
    for (let i = 0; i < people.length; i++) {
      const v = marks[people[i]];
      if (v === '×' || BOOKED_MARKS.indexOf(v) >= 0) return;
      if (v === '△') allOk = false;
    }
    out[key] = allOk ? 'ok' : 'soft';
  });
  return out;
}
