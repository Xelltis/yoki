/* ---------------------------------------------------------
 * 小道具
 * --------------------------------------------------------- */

/* ---- 日本の祝日（1980〜2099 年の春分・秋分の近似式を含む） ---- */
const HOLIDAY_CACHE_ = {};
function jpHolidays_(year) {
  if (HOLIDAY_CACHE_[year]) return HOLIDAY_CACHE_[year];
  const base = {};
  const key = (m, d) => ymd_(new Date(year, m - 1, d));
  const add = (m, d, name) => { base[key(m, d)] = name; };
  add(1, 1, '元日'); add(2, 11, '建国記念の日'); add(2, 23, '天皇誕生日'); add(4, 29, '昭和の日');
  add(5, 3, '憲法記念日'); add(5, 4, 'みどりの日'); add(5, 5, 'こどもの日'); add(8, 11, '山の日');
  add(11, 3, '文化の日'); add(11, 23, '勤労感謝の日');
  const nthMon = (m, n) => { const first = new Date(year, m - 1, 1).getDay(); return 1 + ((8 - first) % 7) + (n - 1) * 7; };
  add(1, nthMon(1, 2), '成人の日'); add(7, nthMon(7, 3), '海の日'); add(9, nthMon(9, 3), '敬老の日'); add(10, nthMon(10, 2), 'スポーツの日');
  const ve = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  const ae = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  add(3, ve, '春分の日'); add(9, ae, '秋分の日');
  const out = {};
  Object.keys(base).forEach(k => { out[k] = base[k]; });
  // 振替休日: 祝日が日曜なら、その後の最初の「祝日でない日」
  Object.keys(base).forEach(k => {
    const d = toDate_(k);
    if (d.getDay() !== 0) return;
    const x = new Date(d.getTime());
    do { x.setDate(x.getDate() + 1); } while (base[ymd_(x)]);
    if (!out[ymd_(x)]) out[ymd_(x)] = '振替休日';
  });
  // 国民の休日: 前日と翌日が祝日で、その日が祝日でも日曜でもない
  for (let d = new Date(year, 0, 1); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
    const k = ymd_(d);
    if (out[k] || d.getDay() === 0) continue;
    if (base[ymd_(addDays_(d, -1))] && base[ymd_(addDays_(d, 1))]) out[k] = '国民の休日';
  }
  HOLIDAY_CACHE_[year] = out;
  return out;
}
function holidayName_(d) {
  return jpHolidays_(d.getFullYear())[ymd_(d)] || '';
}

let TZ_ = '';
function tz_() {
  if (!TZ_) { try { TZ_ = Session.getScriptTimeZone() || 'Asia/Tokyo'; } catch (err) { TZ_ = 'Asia/Tokyo'; } }
  return TZ_;
}

/*
 * 日時の組み立ては自前でやる。Utilities.formatDate と Session.getScriptTimeZone はスクリプトの外への呼び出しで、
 * 画面を 1 回読み込むだけで何百回も呼ぶと目に見えて遅い。V8 の Date はスクリプトのタイムゾーンで動くので、
 * getFullYear などの値はタイムゾーンを渡した formatDate と同じになる
 */
function ymd_(d) {
  return d.getFullYear() + '-' + pad2_(d.getMonth() + 1) + '-' + pad2_(d.getDate());
}

function fmtDateTime_(d) {
  return d.getFullYear() + '/' + pad2_(d.getMonth() + 1) + '/' + pad2_(d.getDate()) + ' ' + pad2_(d.getHours()) + ':' + pad2_(d.getMinutes());
}

/**
 * シートから読んだ日時を「2026/09/15（火） 21:23」にする。
 * 文字列で書いた日時もスプレッドシートが日付型に変えることがあり、そのまま String() すると英語表記になる
 */
function stampText_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return fmtStampJa_(v);
  const t = String(v === undefined || v === null ? '' : v).trim();
  const m = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})[ T](\d{1,2}):(\d{2})/.exec(t);
  if (m) return fmtStampJa_(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])));
  return t;
}

function fmtStampJa_(d) {
  return d.getFullYear() + '/' + pad2_(d.getMonth() + 1) + '/' + pad2_(d.getDate()) + '（' + WD[d.getDay()] + '） ' + pad2_(d.getHours()) + ':' + pad2_(d.getMinutes());
}

function fmtDateJa_(d) {
  return (d.getMonth() + 1) + '/' + d.getDate() + '（' + WD[d.getDay()] + '）';
}

function timeRange_(s) {
  if (!s.start && !s.end) return '時間未定';
  return (s.start || '？') + '〜' + (s.end || '');
}

function toDate_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : startOfDay_(v);
  if (typeof v === 'number' && v > 20000) {
    // シリアル値（1899-12-30 起点）
    const d = new Date(1899, 11, 30);
    d.setDate(d.getDate() + Math.floor(v));
    return d;
  }
  const s = String(v || '').trim();
  const m = /^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const m2 = /^(\d{1,2})[\/月](\d{1,2})/.exec(s);
  if (m2) {
    const now = new Date();
    return new Date(now.getFullYear(), Number(m2[1]) - 1, Number(m2[2]));
  }
  return null;
}

function timeStr_(v) {
  if (v instanceof Date) return pad2_(v.getHours()) + ':' + pad2_(v.getMinutes());
  if (typeof v === 'number') {
    const mins = Math.round((v % 1) * 24 * 60);
    return pad2_(Math.floor(mins / 60)) + ':' + pad2_(mins % 60);
  }
  return normTime_(v);
}

function normTime_(v) {
  const s = String(v || '').trim().replace(/：/g, ':');
  const m = /^(\d{1,2})(?::(\d{2}))?/.exec(s);
  if (!m) return s;
  return pad2_(Number(m[1])) + ':' + (m[2] || '00');
}

function pad2_(n) {
  return ('0' + n).slice(-2);
}

function startOfDay_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays_(d, n) {
  const r = startOfDay_(d);
  r.setDate(r.getDate() + n);
  return r;
}

function daysBetween_(a, b) {
  return Math.round((startOfDay_(b).getTime() - startOfDay_(a).getTime()) / 86400000);
}

function splitNames_(v) {
  return String(v || '').split(/[、,，;；\n\/／]+/).map(s => s.trim()).filter(Boolean);
}

function uniq_(arr) {
  const seen = {};
  return arr.filter(x => (seen[x] ? false : (seen[x] = true)));
}

function fill_(arr, n, v) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[i] === undefined || arr[i] === '' ? v : arr[i]);
  return out;
}

function clampInt_(v, min, max, def) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function isOn_(v) {
  const s = String(v === undefined || v === null ? '' : v).trim().toUpperCase();
  return s === 'ON' || s === 'TRUE' || s === '1' || s === 'はい' || s === '○';
}

function userEmail_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (err) {
    return '';
  }
}
