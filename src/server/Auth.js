/* ---------------------------------------------------------
 * 合言葉（ウェブアプリのログイン）
 * 全員共通の合言葉を 1 つ持つ。ハッシュと「版」をスクリプトのプロパティに置く（シートには出ない）。
 * 合言葉が通ったブラウザには版から作った「証」を渡し、以後はそれを添えて呼ぶ。期限は無い。
 * 合言葉を変えると版が変わり、すべてのブラウザの証が無効になる。メンバーを外したときはこれで締め出す。
 * 合言葉が無いうちは誰でも開ける（最初に決めるための状態）
 * --------------------------------------------------------- */
const PW = { HASH: 'WEB_PASS_HASH', SALT: 'WEB_PASS_SALT', VER: 'WEB_PASS_VER', SECRET: 'WEB_SECRET', FAILS: 'WEB_LOGIN_FAILS' };
const PW_MIN = 8;
const LOGIN_MAX_FAILS = 10;
const LOGIN_LOCK_MS = 10 * 60 * 1000;

function props_() { return PropertiesService.getScriptProperties(); }
function sha_(text) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)); }
function normPw_(pw) { return String(pw === undefined || pw === null ? '' : pw).trim(); }
function hasPassword_() { return !!props_().getProperty(PW.HASH); }

function secret_() {
  let sec = props_().getProperty(PW.SECRET);
  if (!sec) { sec = Utilities.getUuid() + Utilities.getUuid(); props_().setProperty(PW.SECRET, sec); }
  return sec;
}
function tokenOf_(ver) { return sha_(secret_() + '|' + ver); }
function tokenOk_(token) {
  const ver = props_().getProperty(PW.VER);
  return !!ver && !!token && String(token) === tokenOf_(ver);
}
function checkPassword_(pw) {
  const hash = props_().getProperty(PW.HASH);
  const salt = props_().getProperty(PW.SALT) || '';
  return !!hash && sha_(salt + '|' + normPw_(pw)) === hash;
}
/** 合言葉を保存して版を進める。全員の証が無効になる。新しい証を返す */
function storePassword_(pw) {
  const salt = Utilities.getUuid(), ver = Utilities.getUuid();
  props_().setProperty(PW.SALT, salt);
  props_().setProperty(PW.HASH, sha_(salt + '|' + normPw_(pw)));
  props_().setProperty(PW.VER, ver);
  props_().deleteProperty(PW.FAILS);
  return tokenOf_(ver);
}
function validateNewPw_(pw, confirm) {
  const t = normPw_(pw);
  if (t.length < PW_MIN) throw new Error('合言葉は ' + PW_MIN + ' 文字以上にしてください。');
  if (confirm !== undefined && normPw_(confirm) !== t) throw new Error('2 つの入力が合っていません。');
}
/** 証が無ければ「AUTH:」で始まるエラー。画面はこれを見てログインを求める */
function requireAuth_(token) {
  if (hasPassword_() && !tokenOk_(token)) throw new Error('AUTH: 合言葉を入れてください。');
}
function authFor_(form) { requireAuth_(form && form.token); }
/** 間違いが続いたら少し待たせる */
function loginThrottle_() {
  const raw = props_().getProperty(PW.FAILS);
  if (!raw) return;
  const f = JSON.parse(raw);
  const left = LOGIN_LOCK_MS - (Date.now() - f.at);
  if (f.n >= LOGIN_MAX_FAILS && left > 0) throw new Error('間違いが続いたので、' + Math.ceil(left / 60000) + ' 分ほど待ってから入れてください。');
}
function loginFailed_() {
  const raw = props_().getProperty(PW.FAILS);
  const f = raw ? JSON.parse(raw) : { n: 0, at: 0 };
  if (Date.now() - f.at > LOGIN_LOCK_MS) f.n = 0;
  f.n++;
  f.at = Date.now();
  props_().setProperty(PW.FAILS, JSON.stringify(f));
}

/* ---------------------------------------------------------
 * 管理者
 * みんなの合言葉とは別に「管理者の合言葉」を 1 つ持つ。作りはみんなの合言葉と同じで、
 * 通ったブラウザには「管理者の証」を渡す。名簿（設定シートの「管理者」）は誰が管理者かを見せるためのもので、
 * 実際の可否は証で決める。管理者の合言葉を決めていないあいだは、今までどおり誰でも操作できる
 * --------------------------------------------------------- */
const ADM = { HASH: 'ADMIN_PASS_HASH', SALT: 'ADMIN_PASS_SALT', VER: 'ADMIN_PASS_VER', FAILS: 'ADMIN_LOGIN_FAILS' };
const ADMIN_KEY = '管理者';

function hasAdminPassword_() { return !!props_().getProperty(ADM.HASH); }
function adminTokenOf_(ver) { return sha_(secret_() + '|admin|' + ver); }
function adminTokenOk_(token) {
  const ver = props_().getProperty(ADM.VER);
  return !!ver && !!token && String(token) === adminTokenOf_(ver);
}
function checkAdminPassword_(pw) {
  const hash = props_().getProperty(ADM.HASH);
  const salt = props_().getProperty(ADM.SALT) || '';
  return !!hash && sha_(salt + '|' + normPw_(pw)) === hash;
}
function storeAdminPassword_(pw) {
  const salt = Utilities.getUuid(), ver = Utilities.getUuid();
  props_().setProperty(ADM.SALT, salt);
  props_().setProperty(ADM.HASH, sha_(salt + '|' + normPw_(pw)));
  props_().setProperty(ADM.VER, ver);
  props_().deleteProperty(ADM.FAILS);
  return adminTokenOf_(ver);
}
/** 管理者かどうか。管理者の合言葉を決めていなければ、全員を管理者として扱う */
function isAdmin_(form) { return !hasAdminPassword_() || adminTokenOk_(form && form.adminToken); }
/** 管理者でなければ「ADMIN:」で始まるエラー。画面はこれを見て管理者の合言葉を聞く */
function requireAdmin_(form, what) {
  authFor_(form);
  if (isAdmin_(form)) return;
  throw new Error('ADMIN: ' + (what || 'この操作') + 'ができるのは管理者だけです。管理者の合言葉を入れてください。');
}
/** 自分のぶんなら誰でも。ほかの人の代わりに入れるのは管理者だけ */
function requireSelfOrAdmin_(form, name) {
  const me = String((form && form.me) || '').trim();
  if (me && me === String(name || '').trim()) { authFor_(form); return; }
  requireAdmin_(form, 'ほかの人の代わりに入れること');
}
function adminNames_(st) { return uniq_(splitNames_(st && st[ADMIN_KEY])); }
/** 名簿に足す。すでにいれば何もしない */
function addAdminName_(ss, name) {
  const n = String(name || '').trim();
  if (!n) return false;
  const list = adminNames_(getSettings_(ss));
  if (list.indexOf(n) >= 0) return false;
  setSetting_(ss, ADMIN_KEY, list.concat([n]).join('、'));
  return true;
}
function adminThrottle_() {
  const raw = props_().getProperty(ADM.FAILS);
  if (!raw) return;
  const f = JSON.parse(raw);
  const left = LOGIN_LOCK_MS - (Date.now() - f.at);
  if (f.n >= LOGIN_MAX_FAILS && left > 0) throw new Error('間違いが続いたので、' + Math.ceil(left / 60000) + ' 分ほど待ってから入れてください。');
}
function adminFailed_() {
  const raw = props_().getProperty(ADM.FAILS);
  const f = raw ? JSON.parse(raw) : { n: 0, at: 0 };
  if (Date.now() - f.at > LOGIN_LOCK_MS) f.n = 0;
  f.n++;
  f.at = Date.now();
  props_().setProperty(ADM.FAILS, JSON.stringify(f));
}

/** 管理者になる。form: { token, password, me } → { ok, adminToken } */
function loginAdmin(form) {
  authFor_(form);
  if (!hasAdminPassword_()) throw new Error('管理者の合言葉はまだ決まっていません。いまは全員が管理者の操作をできます。');
  adminThrottle_();
  if (!checkAdminPassword_(form && form.password)) { adminFailed_(); throw new Error('管理者の合言葉が違います。'); }
  props_().deleteProperty(ADM.FAILS);
  const ss = ss_();
  ensureReady_(ss);
  const added = addAdminName_(ss, form && form.me);
  return {
    ok: true,
    adminToken: adminTokenOf_(props_().getProperty(ADM.VER)),
    message: '管理者になりました。' + (added ? '名簿に「' + String(form.me).trim() + '」を足しました。' : ''),
    data: consoleData_(ss, undefined, true),
  };
}

/**
 * 管理者の合言葉を決める・変える。まだ無ければ誰でも決められる（決めた人が管理者になる）。
 * すでにあるときは管理者だけが変えられ、いまの合言葉が要る。form: { token, adminToken, current, password, confirm, me }
 */
function setAdminPassword(form) {
  authFor_(form);
  const had = hasAdminPassword_();
  if (had) {
    requireAdmin_(form, '管理者の合言葉を変えること');
    if (!checkAdminPassword_(form && form.current)) throw new Error('いまの管理者の合言葉が違います。');
  }
  validateNewPw_(form && form.password, form && form.confirm);
  if (checkPassword_(form && form.password)) throw new Error('みんなの合言葉と同じものは使えません。別の合言葉にしてください。');
  const adminToken = storeAdminPassword_(form.password);
  const ss = ss_();
  ensureReady_(ss);
  addAdminName_(ss, form && form.me);
  return {
    ok: true,
    adminToken: adminToken,
    message: had ? '管理者の合言葉を変えました。ほかの管理者は、次の操作のときに入れ直しになります。'
      : '管理者の合言葉を決めました。ここから先、管理者の操作にはこの合言葉が要ります。',
    data: consoleData_(ss, undefined, true),
  };
}

/** 名簿から外す。管理者だけ。form: { token, adminToken, name } */
function removeAdmin(...args) { return withLock_(() => removeAdminLocked_(...args)); }
function removeAdminLocked_(form) {
  requireAdmin_(form, '管理者の名簿を変えること');
  const ss = ss_();
  ensureReady_(ss);
  const name = String(form && form.name || '').trim();
  const list = adminNames_(getSettings_(ss));
  if (!name || list.indexOf(name) < 0) throw new Error('名簿に「' + name + '」はいません。');
  if (list.length <= 1) throw new Error('管理者が 1 人だけのときは外せません。先にもう 1 人足してください。');
  setSetting_(ss, ADMIN_KEY, list.filter(n => n !== name).join('、'));
  return { ok: true, message: '名簿から「' + name + '」を外しました。', data: consoleData_(ss, undefined, true) };
}

/** ログイン。form: { password } → { ok, token } */
function login(form) {
  if (!hasPassword_()) throw new Error('合言葉がまだ決まっていません。最初に決めてください。');
  loginThrottle_();
  if (!checkPassword_(form && form.password)) { loginFailed_(); throw new Error('合言葉が違います。'); }
  props_().deleteProperty(PW.FAILS);
  return { ok: true, token: tokenOf_(props_().getProperty(PW.VER)) };
}

/** 最初の合言葉を決める。まだ無いときだけ。決めた人が最初の管理者になる。form: { password, confirm, me } */
function setInitialPassword(form) {
  if (hasPassword_()) throw new Error('合言葉はもう決まっています。変えるには設定タブの「合言葉を変える」を使います。');
  validateNewPw_(form && form.password, form && form.confirm);
  const token = storePassword_(form.password);
  let named = '';
  try {
    const ss = ss_();
    ensureReady_(ss);
    named = String(form && form.me || '').trim();
    if (named) addAdminName_(ss, named);
  } catch (err) {
    Logger.log('setInitialPassword: ' + err);
  }
  return { ok: true, token: token, message: '合言葉を決めました。' + (named ? named + ' さんが最初の管理者です。' : '') };
}

/** 合言葉を変える。いまの合言葉が要る。変えると全員のブラウザで入れ直しになる。form: { token, current, password, confirm } */
function changePassword(form) {
  requireAdmin_(form, 'みんなの合言葉を変えること');
  if (!checkPassword_(form.current)) throw new Error('いまの合言葉が違います。');
  validateNewPw_(form.password, form.confirm);
  return { ok: true, token: storePassword_(form.password), message: '合言葉を変えました。ほかの人のブラウザでは、次に開いたときに新しい合言葉を求められます。' };
}

/** シートのメニュー「管理者の合言葉を設定…」。忘れたときはここから決め直す */
function setAdminPasswordFromSheet() {
  const ui = SpreadsheetApp.getUi();
  const had = hasAdminPassword_();
  const res = ui.prompt('管理者の合言葉',
    (had ? 'いまの管理者の合言葉を新しいものに置き換えます。ほかの管理者は入れ直しになります。' : '管理者の合言葉を決めます。シートを開く・ほかの人のぶんを入れる・メンバーと設定を変える、といった操作に要ります。')
    + '\n' + PW_MIN + ' 文字以上。空のまま OK を押すと、管理者の合言葉をやめて全員が操作できる状態に戻します。',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const pw = normPw_(res.getResponseText());
  if (!pw) {
    if (!had) { ui.alert('管理者の合言葉は決まっていません。'); return; }
    props_().deleteProperty(ADM.HASH);
    props_().deleteProperty(ADM.SALT);
    props_().deleteProperty(ADM.VER);
    props_().deleteProperty(ADM.FAILS);
    ui.alert('管理者の合言葉をやめました。いまは画面を開ける人なら誰でも管理者の操作ができます。');
    return;
  }
  try { validateNewPw_(pw); } catch (err) { ui.alert(err.message); return; }
  storeAdminPassword_(pw);
  ui.alert(had ? '管理者の合言葉を変えました。ほかの管理者は、次の操作のときに入れ直しになります。' : '管理者の合言葉を決めました。ウェブアプリで管理者の操作をするときに入れます。');
}

/** シートのメニュー「ウェブアプリの合言葉を設定…」。忘れたときはここから決め直す */
function setWebPassword() {
  const ui = SpreadsheetApp.getUi();
  const had = hasPassword_();
  const res = ui.prompt('ウェブアプリの合言葉',
    (had ? 'いまの合言葉を新しいものに置き換えます。全員のブラウザで入れ直しになります。' : '最初の合言葉を決めます。画面を開く人の全員で使います。') + '\n' + PW_MIN + ' 文字以上。',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  try { validateNewPw_(res.getResponseText()); } catch (err) { ui.alert(err.message); return; }
  storePassword_(res.getResponseText());
  ui.alert(had ? '合言葉を変えました。全員が次に開いたときに新しい合言葉を求められます。' : '合言葉を決めました。ウェブアプリを開いた人はこれを入れます。');
}
