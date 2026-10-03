// 設定のタブ。区分（知らせ・この卓予定・この端末・管理者・送信の記録）と、それぞれの保存
import type { RpcName } from '../../shared/api';
import { api, discordSend, failToast, refetch, useData } from './api';
import { addDaysYmd, fmtJa } from './dates';
import { $, esc, fillSelect, load, mi, store, toast } from './dom';
import { autoMinutes, showLoadedAt } from './load';
import { askConfirm } from './modal';
import { kindSet, whenText } from './notify';
import { readWhen, renderSeriesNotify } from './series-notify';
import { D, drafts } from './state';
import { setFont, setTheme } from './theme';

export function renderSettings(): void {
  const st = D.settings;
  const lg = D.log || [];
  let lh = '<tr><th>日時</th><th>種別</th><th>対象</th><th>結果</th></tr>';
  lg.forEach((row) => {
    const bad = /^(HTTP|ERROR|送らず|送信失敗)/.test(row.result);
    lh += '<tr' + (bad ? ' class="r-past"' : '') + '><td class="nw">' + esc(row.at) + '</td><td class="nw">' + esc(row.kind) + '</td><td>' + esc(row.target) + '</td><td>' + esc(row.result) + '</td></tr>';
  });
  if (!lg.length) lh += '<tr><td colspan="4" class="hint">まだ送っていません。「接続テスト」を押すとここに記録が出ます。</td></tr>';
  $('stLog').innerHTML = lh;
  if (document.activeElement !== $('stName')) $('stName').value = D.title || '';
  $('stWebhook').textContent = st.webhookMasked || '（未設定）';
  setSw('stNotifyOnSave', !!st.notifyOnSave);
  $('stAutoFinish').checked = !!st.autoFinish;
  setSw('stUrge', !!st.urge);
  setSw('stSoon', !!st.soon);
  setSw('ntRemind', !!st.setter);
  if (!drafts.settings) {   // 書きかけの数値は、読み込み直しても上書きしない
    $('stDays').value = String(st.notifyDays === undefined ? 1 : st.notifyDays);
    $('stHour').value = String(st.notifyHour === undefined ? 20 : st.notifyHour);
    $('stSoonMin').value = String(st.soonMinutes === undefined ? 30 : st.soonMinutes);
    $('stAvailDays').value = String(st.availDays || 60);
  }
  $('stAutoRefresh').value = String(autoMinutes());
  $('stFont').value = load('font') === 'm' || load('font') === 'l' ? load('font') : '';
  // 送り先の札。種類ごとのチャンネルを決めていれば、そちらを出す
  const destR = D.remindWebhookSet ? '開催前のチャンネル' : '基本のチャンネル';
  const destC = D.recruitWebhookSet ? '募集のチャンネル' : '基本のチャンネル';
  ([['ntDestRemind', destR, D.remindWebhookSet], ['ntDestSoon', destR, D.remindWebhookSet],
    ['ntDestUrge', destC, D.recruitWebhookSet], ['ntDestRecruit', destC, D.recruitWebhookSet]] as [string, string, boolean][]).forEach((x) => {
    const el = document.getElementById(x[0]); if (!el) return;
    el.textContent = x[1]; el.className = 'dest-chip' + (x[2] ? ' set' : '');
  });
  $('chSum').textContent = D.webhookSet ? '基本' + (D.remindWebhookSet ? '・開催前' : '') + (D.recruitWebhookSet ? '・募集' : '') : 'まだ決めていません';
  $('snSum').textContent = (D.seriesNotify || []).length ? (D.seriesNotify || []).length + ' 件' : 'なし';
  sayWhen();
  $('stTest').disabled = !D.webhookSet;
  $('stClear').disabled = !D.webhookSet;
  renderSeriesNotify();
  renderKindWebhooks();
  renderAdminPane();
}
/** 管理者の区分。名簿と、管理者を足す・外す */
function renderAdminPane(): void {
  const st = $('admState'), list = D.admins || [];
  st.className = 'adm-state' + (D.isAdmin ? ' on' : '');
  st.textContent = D.isAdmin ? 'あなたは管理者です' : 'あなたは管理者ではありません';
  $('admLead').textContent = D.isAdmin ? '管理者は、ほかの人のぶんを入れる・卓を消す・メンバーと設定を変える、ができます。' : '管理者の操作が要るときは、管理者に頼んでください。';
  const box = $('admList');
  box.innerHTML = '';
  if (!list.length) box.innerHTML = '<span class="adm-none">名簿はまだ空です。</span>';
  list.forEach((n) => {
    const chip = document.createElement('span');
    chip.className = 'adm-chip';
    chip.innerHTML = esc(n);
    if (D.isAdmin && list.length > 1) {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = '管理者から外す';
      b.setAttribute('aria-label', n + ' を管理者から外す');
      b.innerHTML = mi('close', 'xs');
      b.onclick = () => {
        askConfirm({ title: '管理者から外しますか？', message: '「' + n + '」を管理者の名簿から外します。', ok: '外す', danger: true },
          () => { stCall('admAdd', 'admMsg', 'setAdmin', { name: n, admin: false }); });
      };
      chip.appendChild(b);
    }
    box.appendChild(chip);
  });
  $('admAddCard').hidden = !D.isAdmin;
  const others = D.members.filter((m) => list.indexOf(m.name) < 0).map((m) => ({ value: m.name, text: m.name }));
  fillSelect($('admPick'), others);
  $('admAdd').disabled = !others.length;
}
/* ON/OFF のつまみ。checkbox ではなく button[role=switch] で持つ */
function swOn(id: string): boolean { return $(id).getAttribute('aria-checked') === 'true'; }
function setSw(id: string, on: boolean): void { const b = document.getElementById(id); if (b) b.setAttribute('aria-checked', String(!!on)); }
/** 設定の区分を切り替える */
export function showSetPane(k: string): void {
  document.querySelectorAll<HTMLElement>('#tab-settings .set-pane').forEach((p) => { p.hidden = p.dataset.pane !== k; });
  document.querySelectorAll<HTMLElement>('#setNav button').forEach((b) => {
    if (b.dataset.set === k) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  });
  store('setPane', k);
}
/** 設定を保存する呼び出し。ボタンを押せなくして、結果を msgId の欄と吹き出しに出す */
export function stCall(btnId: string, msgId: string, fnName: RpcName, form?: object): void {
  const btn = $(btnId), msg = $(msgId);
  btn.disabled = true; msg.textContent = '保存しています…';
  const runner = api().withSuccessHandler((res) => { btn.disabled = false; msg.textContent = res.message; toast(res.message); useData(res, () => { msg.textContent = res.message; }); })
    .withFailureHandler((e) => { btn.disabled = false; msg.textContent = e.message; toast(e.message); });
  runner[fnName](form);
}

/* ---- 種類ごとのチャンネル（開催前の知らせ・募集） ---- */
const KW: Record<'remind' | 'recruit', { id: string; label: string }> = { remind: { id: 'kwRemind', label: '開催前の知らせのチャンネル' }, recruit: { id: 'kwRecruit', label: '募集のチャンネル' } };
function renderKindWebhooks(): void {
  const st = D.settings;
  (Object.keys(KW) as (keyof typeof KW)[]).forEach((k) => {
    const id = KW[k].id, on = kindSet(k);
    $(id + 'Now').textContent = on ? (k === 'remind' ? st.remindWebhookMasked : st.recruitWebhookMasked) : '（基本のチャンネルと同じ）';
    $(id + 'Test').disabled = !on; $(id + 'Clear').disabled = !on;
  });
}

/* ---- 知らせのつまみと日時 ---- */
/** 開始の何分前か。5〜720 の整数だけ通す */
function soonMin(): { n: number; err?: undefined } | { err: string; n?: undefined } {
  const v = String($('stSoonMin').value || '').trim(), n = Number(v);
  if (!/^\d+$/.test(v) || n < 5 || n > 720) return { err: '開始の何分前は 5〜720 の数で入れてください。' };
  return { n };
}
function ntMsg(t: string, bad: boolean): void { $('ntMsg').textContent = t; $('ntMsg').className = 'hint' + (bad ? ' bad' : ''); }
/** 基本の日時の例え。「9/26（土）の卓なら、9/25（金）の 20 時台に届きます」 */
function sayWhen(): void {
  const el = $('stWhenSay'), wn = readWhen('stDays', 'stHour');
  el.classList.toggle('bad', !!wn.err);
  if (wn.err) { el.textContent = wn.err; return; }
  const ex = addDaysYmd(D.today, 7);
  const line = '例: ' + fmtJa(ex) + 'の卓なら、' + fmtJa(addDaysYmd(ex, -wn.days)) + 'の ' + wn.hour + ' 時台に届きます。';
  el.textContent = D.settings.setter ? line : line + '（いまは送っていません。右のつまみで始められます）';
}

export function init(): void {
  document.querySelectorAll<HTMLElement>('#setNav button').forEach((b) => { b.onclick = () => { showSetPane(b.dataset.set!); }; });
  $('admAdd').onclick = () => { const n = $('admPick').value; if (n) stCall('admAdd', 'admMsg', 'setAdmin', { name: n, admin: true }); };
  $('stNameSave').onclick = () => {
    const n = $('stName').value.trim();
    if (!n) { $('stNameMsg').textContent = '名前を入れてください。'; return; }
    if (n === D.title) { $('stNameMsg').textContent = 'いまの名前と同じです。'; return; }
    askConfirm({ title: '名前を変えますか？', message: '画面の左上と、Discord の知らせに出る名前が「' + n + '」になります。', ok: '変える' },
      () => { stCall('stNameSave', 'stNameMsg', 'renameGroup', { name: n }); });
  };
  $('stWebhookSave').onclick = () => {
    const w = $('stWebhookNew').value.trim();
    if (!w) { $('stWebhookMsg').textContent = '新しい URL を貼ってください。'; return; }
    stCall('stWebhookSave', 'stWebhookMsg', 'saveConsoleSettings', { webhook: w });
    $('stWebhookNew').value = '';
  };
  $('stTest').onclick = () => {
    $('stTest').disabled = true;
    discordSend({ kind: 'test' },
      (t) => { $('stWebhookMsg').textContent = t; },
      (ok, r) => { $('stTest').disabled = false; toast(ok ? 'Discord に届きました' : failToast(r)); refetch(() => {}); });
  };
  (Object.keys(KW) as (keyof typeof KW)[]).forEach((k) => {
    const id = KW[k].id;
    $(id + 'Save').onclick = () => {
      const w = $(id).value.trim();
      if (!w) { $(id + 'Msg').textContent = '新しい URL を貼ってください。'; return; }
      stCall(id + 'Save', id + 'Msg', 'saveConsoleSettings', { kindWebhook: { kind: k, url: w } });
      $(id).value = '';
    };
    $(id + 'Test').onclick = () => {
      $(id + 'Test').disabled = true;
      discordSend({ kind: 'test', channel: k },
        (t) => { $(id + 'Msg').textContent = t; },
        (ok, r) => { $(id + 'Test').disabled = false; toast(ok ? KW[k].label + 'に届きました' : failToast(r)); refetch(() => {}); });
    };
    $(id + 'Clear').onclick = () => {
      askConfirm({ title: KW[k].label + 'を外しますか？', message: 'この種類の知らせは、基本のチャンネルへ送るようになります。', ok: '外す', danger: true },
        () => { stCall(id + 'Clear', id + 'Msg', 'saveConsoleSettings', { kindWebhook: { kind: k, url: '', clear: true } }); });
    };
  });
  $('stClear').onclick = () => {
    askConfirm({ title: 'Webhook URL を空にしますか？', message: 'Discord への通知はすべて止まります。', ok: '空にする', danger: true },
      () => { stCall('stClear', 'stWebhookMsg', 'saveConsoleSettings', { webhook: '', clearWebhook: true }); });
  };
  const autoFinish = $('stAutoFinish');
  autoFinish.addEventListener('change', () => { stCall('stSave', 'stMsg', 'saveConsoleSettings', { autoFinish: autoFinish.checked }); });
  $('stNotifyOnSave').onclick = () => { stCall('stNotifyOnSave', 'ntMsg', 'saveConsoleSettings', { notifyOnSave: !swOn('stNotifyOnSave') }); };
  $('stUrge').onclick = () => { stCall('stUrge', 'ntMsg', 'saveConsoleSettings', { urge: !swOn('stUrge') }); };
  $('stSoon').onclick = () => {
    const m = soonMin();
    if (m.err !== undefined) { ntMsg(m.err, true); $('stSoonMin').focus(); return; }
    drafts.settings = false;
    stCall('stSoon', 'ntMsg', 'saveConsoleSettings', { soon: !swOn('stSoon'), soonMinutes: String(m.n) });
  };
  /* 分を変えたら、ON のときだけその場で保存する（OFF なら ON にしたときに一緒に送る） */
  $('stSoonMin').addEventListener('change', () => {
    if (!swOn('stSoon')) return;
    const m = soonMin();
    if (m.err !== undefined) { ntMsg(m.err, true); return; }
    drafts.settings = false;
    stCall('stSoon', 'ntMsg', 'saveConsoleSettings', { soonMinutes: String(m.n) });
  });
  /* 開催前の知らせ。つまみで有効・解除、日時は欄を離れたときに保存する */
  $('ntRemind').onclick = () => {
    const wn = readWhen('stDays', 'stHour');
    if (wn.err) { sayWhen(); $('stDays').focus(); return; }
    if (swOn('ntRemind')) {
      askConfirm({ title: '開催前の知らせを止めますか？', message: '自動で送るのをやめます。あとからいつでも戻せます。', ok: '止める', danger: true },
        () => { stCall('ntRemind', 'ntMsg', 'saveConsoleSettings', { remind: false }); });
      return;
    }
    askConfirm({ title: '開催前の知らせを送りますか？', message: '開催日の' + whenText(wn.days, wn.hour) + 'に、卓の知らせを Discord に送ります。シリーズごとに日時を決めた卓は、その日時に送ります。', ok: '送る' }, () => {
      drafts.settings = false;
      stCall('ntRemind', 'ntMsg', 'saveConsoleSettings', { remind: true, days: String(wn.days), hour: String(wn.hour) });
    });
  };
  ['stDays', 'stHour'].forEach((id) => {
    $(id).addEventListener('change', () => {
      if (!swOn('ntRemind')) return;   // まだ送っていないなら、つまみを入れたときに一緒に送る
      const wn = readWhen('stDays', 'stHour');
      if (wn.err) { sayWhen(); return; }
      drafts.settings = false;
      stCall('ntRemind', 'ntMsg', 'saveConsoleSettings', { days: String(wn.days), hour: String(wn.hour) });
    });
  });
  ['stDays', 'stHour'].forEach((id) => { $(id).addEventListener('input', sayWhen); });
  ['stDays', 'stHour', 'stAvailDays', 'stSoonMin'].forEach((id) => { $(id).addEventListener('input', () => { drafts.settings = true; }); });
  /* この端末 */
  const autoRefresh = $('stAutoRefresh');
  autoRefresh.addEventListener('change', () => {
    store('autoRefresh', autoRefresh.value); showLoadedAt();
    toast(+autoRefresh.value ? '自動更新を ' + autoRefresh.value + ' 分ごとにしました（この端末だけ）' : '自動更新を止めました（この端末だけ）');
  });
  const theme = $('stTheme');
  theme.addEventListener('change', () => { setTheme(theme.value); });
  const font = $('stFont');
  font.addEventListener('change', () => {
    setFont(font.value);
    toast('文字サイズを' + (font.value === 'l' ? '大' : font.value === 'm' ? '中' : '小') + 'にしました（この端末だけ）');
  });
  $('stSave').onclick = () => { drafts.settings = false; stCall('stSave', 'stMsg', 'saveConsoleSettings', { availDays: $('stAvailDays').value.trim() }); };
}
