// Google Apps Script の SpreadsheetApp などの最小モック。
// 未定義のメソッドを呼ぶと例外にして、API 名の打ち間違いを捕まえる。
var OUT = [];
function print() { OUT.push(Array.prototype.slice.call(arguments).map(function (x) { return typeof x === 'string' ? x : JSON.stringify(x); }).join(' ')); }
var CALLS = {};
var FETCHES = [];
var ALERTS = [];
var TRIGGERS = [];
var TOASTS = [];
var UI_ANSWER = 'OK';

function strict(obj, kind) {
  return new Proxy(obj, {
    get: function (t, p) {
      if (typeof p === 'symbol' || p === 'then' || p === 'toJSON' || p === 'constructor' || p === 'inspect') return t[p];
      if (!(p in t)) throw new Error('モック未定義: ' + kind + '.' + String(p));
      var v = t[p];
      if (typeof v === 'function') CALLS[kind + '.' + p] = (CALLS[kind + '.' + p] || 0) + 1;
      return v;
    }
  });
}

function is2D(v) { return Array.isArray(v) && v.every(function (r) { return Array.isArray(r); }); }

function Range(sheet, row, col, nr, nc) {
  if (row < 1 || col < 1) throw new Error('範囲の座標が不正: ' + row + ',' + col);
  if (nr < 1 || nc < 1) throw new Error('範囲の行数・列数は 1 以上: ' + nr + 'x' + nc);
  this.sheet = sheet; this.row = row; this.col = col; this.nr = nr; this.nc = nc;
}
Range.prototype = {
  _check2D: function (vals, what) {
    if (!is2D(vals)) throw new Error(what + ': 2次元配列が必要');
    if (vals.length !== this.nr) throw new Error(what + ': 行数が合わない (range ' + this.nr + ', data ' + vals.length + ') at ' + this.sheet.name + ' r' + this.row);
    for (var i = 0; i < vals.length; i++) if (vals[i].length !== this.nc) throw new Error(what + ': 列数が合わない (range ' + this.nc + ', data ' + vals[i].length + ') at ' + this.sheet.name + ' row ' + (this.row + i));
  },
  getValues: function () {
    var out = [];
    for (var r = 0; r < this.nr; r++) { var row = []; for (var c = 0; c < this.nc; c++) row.push(this.sheet._get(this.row + r, this.col + c)); out.push(row); }
    return out;
  },
  setValues: function (vals) {
    this._check2D(vals, 'setValues');
    for (var r = 0; r < this.nr; r++) for (var c = 0; c < this.nc; c++) this.sheet._set(this.row + r, this.col + c, vals[r][c]);
    return this;
  },
  getValue: function () { return this.sheet._get(this.row, this.col); },
  setValue: function (v) { this.sheet._set(this.row, this.col, v); return this; },
  setBackground: function (c) { this.sheet.bg = this.sheet.bg || {}; for (var r = 0; r < this.nr; r++) for (var cc = 0; cc < this.nc; cc++) this.sheet.bg[(this.row + r) + ',' + (this.col + cc)] = c; return this; },
  getBackgrounds: function () { var out = []; for (var r = 0; r < this.nr; r++) { var row = []; for (var c = 0; c < this.nc; c++) row.push((this.sheet.bg && this.sheet.bg[(this.row + r) + ',' + (this.col + c)]) || '#ffffff'); out.push(row); } return out; },
  setBackgrounds: function (v) { this._check2D(v, 'setBackgrounds'); this.sheet.bg = this.sheet.bg || {}; for (var r = 0; r < this.nr; r++) for (var c = 0; c < this.nc; c++) this.sheet.bg[(this.row + r) + ',' + (this.col + c)] = v[r][c]; return this; },
  setFontWeight: function (w) { return this; },
  setFontWeights: function (v) { this._check2D(v, 'setFontWeights'); return this; },
  setFontColor: function (c) { return this; },
  setFontColors: function (v) { this._check2D(v, 'setFontColors'); return this; },
  setFontSize: function (n) { return this; },
  setHorizontalAlignment: function (a) { return this; },
  setHorizontalAlignments: function (v) { this._check2D(v, 'setHorizontalAlignments'); return this; },
  setVerticalAlignment: function (a) { return this; },
  setWrap: function (b) { return this; },
  setWraps: function (v) { this._check2D(v, 'setWraps'); return this; },
  setNumberFormat: function (f) { return this; },
  setDataValidation: function (rule) { if (!rule || !rule._built) throw new Error('setDataValidation: build() されていない'); this.sheet.validations.push([this.row, this.col, this.nr, this.nc, rule.list]); return this; },
  clearDataValidations: function () { this.sheet.validations = []; return this; },
  setNote: function (n) { this.sheet.notes = this.sheet.notes || {}; this.sheet.notes[this.row + ',' + this.col] = n; return this; },
  setNotes: function (v) { this._check2D(v, 'setNotes'); this.sheet.notes = this.sheet.notes || {}; for (var r = 0; r < this.nr; r++) for (var c = 0; c < this.nc; c++) { var k = (this.row + r) + ',' + (this.col + c); if (v[r][c]) this.sheet.notes[k] = v[r][c]; else delete this.sheet.notes[k]; } return this; },
  clearNote: function () { if (this.sheet.notes) for (var r = 0; r < this.nr; r++) for (var c = 0; c < this.nc; c++) delete this.sheet.notes[(this.row + r) + ',' + (this.col + c)]; return this; },
  setBorder: function () { if (arguments.length !== 4 && arguments.length !== 6 && arguments.length !== 8) throw new Error('setBorder: 引数の数が不正 ' + arguments.length); return this; },
  merge: function () {
    var me = this;
    this.sheet.merges.forEach(function (m) {
      var overlap = !(me.row + me.nr - 1 < m[0] || me.row > m[0] + m[2] - 1 || me.col + me.nc - 1 < m[1] || me.col > m[1] + m[3] - 1);
      if (overlap) throw new Error('merge: 既存の結合と重なる at ' + me.sheet.name + ' r' + me.row + ' c' + me.col);
    });
    this.sheet.merges.push([this.row, this.col, this.nr, this.nc]);
    return this;
  },
  breakApart: function () { this.sheet.merges = []; return this; },
  getSheet: function () { return this.sheet._proxy; },
  getRow: function () { return this.row; },
  getColumn: function () { return this.col; },
  getNumRows: function () { return this.nr; },
  getNumColumns: function () { return this.nc; },
};

function Sheet(ss, name) {
  this.ss = ss; this.name = name; this.cells = {}; this.maxRows = 1000; this.maxCols = 26;
  this.bg = {}; this.notes = {}; this.merges = []; this.validations = []; this.frozenRows = 0; this.frozenCols = 0; this.heights = {}; this.widths = {};
  this._proxy = strict(this, 'Sheet');
}
Sheet.prototype = {
  _get: function (r, c) { var v = this.cells[r + ',' + c]; return v === undefined || v === null ? '' : v; },
  _set: function (r, c, v) {
    if (r > this.maxRows) this.maxRows = r;
    if (c > this.maxCols) this.maxCols = c;
    if (v === null || v === undefined || v === '') delete this.cells[r + ',' + c]; else this.cells[r + ',' + c] = v;
  },
  getName: function () { return this.name; },
  getParent: function () { return this.ss._proxy; },
  getIndex: function () { return this.ss.sheets.indexOf(this) + 1; },
  getLastRow: function () { var m = 0; for (var k in this.cells) { var r = +k.split(',')[0]; if (r > m) m = r; } return m; },
  getLastColumn: function () { var m = 0; for (var k in this.cells) { var c = +k.split(',')[1]; if (c > m) m = c; } return m; },
  getMaxRows: function () { return this.maxRows; },
  getMaxColumns: function () { return this.maxCols; },
  getRange: function (r, c, nr, nc) {
    if (typeof r === 'string') throw new Error('モック: A1 記法は未対応');
    return strict(new Range(this, r, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc), 'Range');
  },
  getDataRange: function () { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); },
  clear: function () { this.cells = {}; this.bg = {}; return this; },
  clearConditionalFormatRules: function () { return this; },
  setFrozenRows: function (n) { this.frozenRows = n; return this; },
  setFrozenColumns: function (n) { this.frozenCols = n; return this; },
  setRowHeight: function (r, h) { this.heights[r] = h; return this; },
  setRowHeights: function (r, n, h) { for (var i = 0; i < n; i++) this.heights[r + i] = h; return this; },
  setColumnWidth: function (c, w) { this.widths[c] = w; return this; },
  setColumnWidths: function (c, n, w) { for (var i = 0; i < n; i++) this.widths[c + i] = w; return this; },
  insertRowsAfter: function (after, n) { this.maxRows += n; return this; },
  insertColumnsAfter: function (after, n) { this.maxCols += n; return this; },
  appendRow: function (arr) { if (!Array.isArray(arr)) throw new Error('appendRow: 配列が必要'); var r = this.getLastRow() + 1; for (var i = 0; i < arr.length; i++) this._set(r, i + 1, arr[i]); return this; },
  deleteRow: function (r) {
    var next = {}; for (var k in this.cells) { var p = k.split(',').map(Number); if (p[0] === r) continue; if (p[0] > r) next[(p[0] - 1) + ',' + p[1]] = this.cells[k]; else next[k] = this.cells[k]; }
    this.cells = next; return this;
  },
  setTabColor: function (c) { return this; },
  autoResizeRows: function (r, n) { if (r < 1 || n < 1) throw new Error('autoResizeRows: 不正 ' + r + ',' + n); if (r + n - 1 > this.maxRows) throw new Error('autoResizeRows: 範囲外'); return this; },
  activate: function () { this.ss.active = this; return this._proxy; },
};

function Spreadsheet(name) { this.name = name; this.sheets = []; this.active = null; this._proxy = strict(this, 'Spreadsheet'); }
Spreadsheet.prototype = {
  getName: function () { return this.name; },
  getId: function () { return 'mock-id-' + this.name; },
  rename: function (n) { if (!n) throw new Error('rename: 名前が空'); this.name = String(n); return this; },
  getUrl: function () { return 'https://docs.google.com/spreadsheets/d/mock'; },
  getSheetByName: function (n) { for (var i = 0; i < this.sheets.length; i++) if (this.sheets[i].name === n) return this.sheets[i]._proxy; return null; },
  insertSheet: function (n) { if (this.getSheetByName(n)) throw new Error('同名シートあり: ' + n); var s = new Sheet(this, n); this.sheets.push(s); this.active = s; return s._proxy; },
  getSheets: function () { return this.sheets.map(function (s) { return s._proxy; }); },
  deleteSheet: function (sp) { var i = this.sheets.findIndex(function (s) { return s._proxy === sp || s === sp; }); if (i < 0) throw new Error('deleteSheet: 不明'); this.sheets.splice(i, 1); return this; },
  setActiveSheet: function (sp) { var s = this.sheets.find(function (x) { return x._proxy === sp; }); if (!s) throw new Error('setActiveSheet: 不明'); this.active = s; return sp; },
  moveActiveSheet: function (pos) { if (!this.active) throw new Error('moveActiveSheet: active なし'); var i = this.sheets.indexOf(this.active); this.sheets.splice(i, 1); this.sheets.splice(pos - 1, 0, this.active); return this; },
  toast: function (msg, title, sec) { TOASTS.push(msg); return this; },
};

var SS = new Spreadsheet('卓予定テスト');
(function () { var s = new Sheet(SS, 'シート1'); SS.sheets.push(s); })();

var PROMPTS = [];
var PROMPT_ANSWER = { button: 'OK', text: '' };
var ACTIVE_AVAILABLE = true;
var SpreadsheetApp = strict({
  getActiveSpreadsheet: function () { if (!ACTIVE_AVAILABLE) return null; return SS._proxy; },
  openById: function (id) { if (id !== 'mock-id-' + SS.name) throw new Error('openById: 不明な ID ' + id); return SS._proxy; },
  getUi: function () {
    var menu = strict({ addItem: function () { return menu; }, addSeparator: function () { return menu; }, addToUi: function () { return null; } }, 'Menu');
    return strict({
      createMenu: function () { return menu; },
      alert: function (msg, buttons) { ALERTS.push(msg); return UI_ANSWER; },
      prompt: function (title, msg, buttons) {
        PROMPTS.push(title + ': ' + msg);
        return strict({ getSelectedButton: function () { return PROMPT_ANSWER.button; }, getResponseText: function () { return PROMPT_ANSWER.text; } }, 'PromptResponse');
      },
      showModalDialog: function (html, title) { ALERTS.push('[dialog] ' + title); },
      ButtonSet: { OK_CANCEL: 'OK_CANCEL', OK: 'OK' },
      Button: { OK: 'OK', CANCEL: 'CANCEL' },
    }, 'Ui');
  },
  newDataValidation: function () {
    var b = { list: null, _built: false };
    var p = strict({
      requireValueInList: function (list, show) { if (!Array.isArray(list)) throw new Error('requireValueInList: 配列が必要'); b.list = list; return p; },
      setAllowInvalid: function (x) { return p; },
      build: function () { b._built = true; return b; },
    }, 'DataValidationBuilder');
    return p;
  },
  flush: function () {},
  BorderStyle: { SOLID: 'SOLID', SOLID_MEDIUM: 'SOLID_MEDIUM', SOLID_THICK: 'SOLID_THICK', DASHED: 'DASHED', DOTTED: 'DOTTED', DOUBLE: 'DOUBLE' },
}, 'SpreadsheetApp');

function pad(n) { return ('0' + n).slice(-2); }
// 簡易ハッシュ（暗号強度は不要。決定的であればよい）と base64
function fakeBytes(text, seed) { var out = []; var h = seed || 2166136261; for (var i = 0; i < 32; i++) { for (var j = 0; j < text.length; j++) { h ^= text.charCodeAt(j) + i; h = Math.imul(h, 16777619) >>> 0; } out.push((h & 0xff) - 128); } return out; }
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64enc(bytes, websafe) { var s = ''; for (var i = 0; i < bytes.length; i += 3) { var a = bytes[i] & 255, b = i + 1 < bytes.length ? bytes[i + 1] & 255 : 0, c = i + 2 < bytes.length ? bytes[i + 2] & 255 : 0; var n = (a << 16) | (b << 8) | c; s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < bytes.length ? B64[n >> 6 & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '='); } return websafe ? s.replace(/\+/g, '-').replace(/\//g, '_') : s; }
function b64dec(s) { s = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, ''); var out = []; var bits = 0, val = 0; for (var i = 0; i < s.length; i++) { val = (val << 6) | B64.indexOf(s[i]); bits += 6; if (bits >= 8) { bits -= 8; out.push((val >> bits) & 255); } } return out; }
function strBytes(str) { var out = []; for (var i = 0; i < str.length; i++) { var c = str.charCodeAt(i); if (c < 128) out.push(c); else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63)); else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } return out; }
function bytesStr(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) { var c = bytes[i] & 255; if (c < 128) s += String.fromCharCode(c); else if (c >= 224) { s += String.fromCharCode(((c & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 2; } else { s += String.fromCharCode(((c & 31) << 6) | (bytes[i + 1] & 63)); i += 1; } } return s; }
var UUID_N = 0;
var Utilities = strict({
  DigestAlgorithm: { SHA_256: 'SHA_256', MD5: 'MD5' },
  Charset: { UTF_8: 'UTF_8' },
  computeDigest: function (alg, text, charset) { if (typeof text !== 'string') throw new Error('computeDigest: 文字列が必要'); return fakeBytes(text, 7); },
  computeHmacSha256Signature: function (text, key, charset) { if (typeof text !== 'string' || typeof key !== 'string') throw new Error('computeHmacSha256Signature: 文字列が必要'); return fakeBytes(key + '|' + text, 13); },
  base64Encode: function (data) { return b64enc(typeof data === 'string' ? strBytes(data) : data, false); },
  base64EncodeWebSafe: function (data, charset) { return b64enc(typeof data === 'string' ? strBytes(data) : data, true); },
  base64DecodeWebSafe: function (s) { return b64dec(s); },
  getUuid: function () { UUID_N++; return 'uuid-' + ('00000000' + UUID_N).slice(-8) + '-4000-8000-000000000000'; },
  newBlob: function (bytes) { return strict({ getDataAsString: function () { return bytesStr(bytes); } }, 'Blob'); },
  sleep: function (ms) { if (typeof ms !== 'number' || ms < 0) throw new Error('sleep: ミリ秒が必要'); SLEEPS.push(ms); },
  formatDate: function (d, tz, fmt) {
    if (!(d instanceof Date)) throw new Error('formatDate: Date が必要 (' + typeof d + ')');
    return fmt.replace('yyyy', d.getFullYear()).replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate())).replace('HH', pad(d.getHours())).replace('mm', pad(d.getMinutes()));
  },
}, 'Utilities');
var Session = strict({
  getScriptTimeZone: function () { return 'Asia/Tokyo'; },
  getActiveUser: function () { return strict({ getEmail: function () { return 'tester@example.com'; } }, 'User'); },
}, 'Session');
var Logger = strict({ log: function (m) { OUT.push('[Logger] ' + m); } }, 'Logger');
var PROPS = {};
var SPROPS = {};
var PropertiesService = strict({
  getScriptProperties: function () { return strict({ getProperty: function (k) { return SPROPS[k] === undefined ? null : SPROPS[k]; }, setProperty: function (k, v) { SPROPS[k] = v; return this; }, deleteProperty: function (k) { delete SPROPS[k]; return this; } }, 'Properties'); },
  getUserProperties: function () { return strict({ getProperty: function (k) { return PROPS[k] === undefined ? null : PROPS[k]; }, setProperty: function (k, v) { PROPS[k] = v; return this; } }, 'Properties'); },
}, 'PropertiesService');
var LockService = strict({
  getScriptLock: function () { return strict({ tryLock: function (ms) { return true; }, releaseLock: function () {} }, 'Lock'); },
}, 'LockService');
var FETCH_CODE = 204;
var FETCH_CODES = [];      // 空でなければ、呼び出しごとに先頭から使う（429 → 429 → 204 のような並びを試すため）
var FETCH_HEADERS = {};
var FETCH_BODY = null;     // null なら既定の本文
var SLEEPS = [];
var UrlFetchApp = strict({
  fetch: function (url, params) {
    var code = FETCH_CODES.length ? FETCH_CODES.shift() : FETCH_CODE;
    FETCHES.push({ url: url, params: params, body: params && params.payload ? JSON.parse(params.payload) : null, code: code });
    var body = FETCH_BODY !== null ? FETCH_BODY : (code >= 300 ? (code === 429 ? 'error code: 1015' : '{"message":"mock error"}') : '');
    return strict({ getResponseCode: function () { return code; }, getContentText: function () { return body; }, getHeaders: function () { return FETCH_HEADERS; } }, 'HTTPResponse');
  },
}, 'UrlFetchApp');
var WEBAPP_URL = '';
var ScriptApp = strict({
  getService: function () { return strict({ getUrl: function () { return WEBAPP_URL || null; } }, 'Service'); },
  newTrigger: function (fn) {
    var t = { fn: fn };
    var b = strict({ timeBased: function () { return b; }, atHour: function (h) { t.hour = h; return b; }, everyDays: function (n) { t.days = n; return b; }, everyHours: function (n) { if ([1, 2, 4, 6, 8, 12].indexOf(n) < 0) throw new Error('everyHours: 1,2,4,6,8,12 のどれか'); t.hours = n; return b; },everyMinutes: function (n) { if ([1, 5, 10, 15, 30].indexOf(n) < 0) throw new Error('everyMinutes: 1,5,10,15,30 のどれか'); t.minutes = n; return b; }, create: function () { TRIGGERS.push(t); return t; } }, 'TriggerBuilder');
    return b;
  },
  getProjectTriggers: function () { return TRIGGERS.map(function (t) { return strict({ getHandlerFunction: function () { return t.fn; }, _t: t }, 'Trigger'); }); },
  deleteTrigger: function (tp) { var i = TRIGGERS.indexOf(tp._t); if (i >= 0) TRIGGERS.splice(i, 1); },
}, 'ScriptApp');
var HtmlService = strict({
  createHtmlOutput: function (html) { var h = strict({ setWidth: function () { return h; }, setHeight: function () { return h; }, setTitle: function () { return h; }, html: html }, 'HtmlOutput'); return h; },
  createHtmlOutputFromFile: function (name) { var raw = { setWidth: function () { return h; }, setHeight: function () { return h; }, setTitle: function (t) { raw.title = t; return h; }, addMetaTag: function () { return h; }, append: function (c) { raw.appended += c; return h; }, name: name, title: '', appended: '' }; var h = strict(raw, 'HtmlOutput'); return h; },
}, 'HtmlService');

// シートをテキストで出す
function dumpSheet(name, maxRows, maxCols) {
  var s = SS.sheets.find(function (x) { return x.name === name; });
  if (!s) return '(no sheet ' + name + ')';
  var lr = Math.min(s.getLastRow(), maxRows || 60), lc = Math.min(s.getLastColumn(), maxCols || 20);
  var lines = ['=== ' + name + ' (' + s.getLastRow() + 'x' + s.getLastColumn() + ', merges ' + s.merges.length + ', frozen ' + s.frozenRows + '/' + s.frozenCols + ') ==='];
  for (var r = 1; r <= lr; r++) {
    var row = [];
    for (var c = 1; c <= lc; c++) {
      var v = s._get(r, c);
      if (v instanceof Date) v = v.getFullYear() + '/' + (v.getMonth() + 1) + '/' + v.getDate();
      v = String(v).replace(/\n/g, '⏎');
      var bg = s.bg && s.bg[r + ',' + c];
      row.push(v + (bg && bg !== '#ffffff' ? '{' + bg.slice(1, 4) + '}' : ''));
    }
    lines.push(r + ': ' + row.join(' | '));
  }
  return lines.join('\n');
}
