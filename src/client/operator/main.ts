// 運営者の管理画面（/admin/ で開く。ファイルは src/client/operator/）。様子（数・見回り・送信の失敗）・グループ（管理者と Discord サーバーの付け替え・消す）・利用者（ログインを切る・締め出す）。
// 読み書きは /api/admin/*（サーバーが運営者かを確かめる）。形は src/shared/admin.ts
import type { AdminGroupDetail, AdminGroupRow, AdminOverview, AdminResult, AdminUserRow } from '../../shared/admin';
import { $, esc, hit, load, store, toast } from '../console/dom';
import { askConfirm, init as initModal } from '../console/modal';

const PANES = ['overview', 'groups', 'users'];
/** Material Icons の 1 つ。飾りなので読み上げない */
const mi = (name: string, cls = 'sm') => '<span class="material-icons ' + cls + '" aria-hidden="true">' + name + '</span>';

let groups: AdminGroupRow[] = [];
let users: AdminUserRow[] = [];
/** 詳しく開いているグループ */
let openId = '';

/* ---- 小道具 ---- */
const JST = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
/** 日時（日本時間）。空なら —。HTML に入れるので、読めない値はそのまま出さずに文字を逃がす */
function fmt(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? esc(iso) : JST.format(d);
}
/** どれくらい前か（3 分前・2 時間前・5 日前） */
function ago(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!iso || Number.isNaN(ms)) return '';
  if (ms < 60_000) return 'たったいま';
  if (ms < 3600_000) return Math.floor(ms / 60_000) + ' 分前';
  if (ms < 86400_000) return Math.floor(ms / 3600_000) + ' 時間前';
  return Math.floor(ms / 86400_000) + ' 日前';
}

/** サーバーを呼ぶ。ログインが切れていたらログインし直して戻る。失敗は Error（message はサーバーの文） */
async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (res.ok) return data;
  const msg = String(data.error || 'うまくいきませんでした。');
  if (/^AUTH:/.test(msg)) location.href = '/auth/login?return_to=' + encodeURIComponent('/admin/');
  throw new Error(msg.replace(/^AUTH:\s*/, ''));
}
/** 変える操作。結果を吹き出しに出し、読み直す */
async function act(path: string, body: unknown, after: () => Promise<void>): Promise<void> {
  try {
    const r = await call<AdminResult>(path, body);
    toast(r.message);
    await after();
  } catch (e) {
    toast((e as Error).message);
  }
}

/* ---- 区分 ---- */
function showPane(k: string): void {
  const name = PANES.indexOf(k) < 0 ? 'overview' : k;
  document.querySelectorAll<HTMLElement>('.set-pane').forEach((p) => { p.hidden = p.dataset.pane !== name; });
  document.querySelectorAll<HTMLElement>('#opNav button').forEach((b) => { if (b.dataset.set === name) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
  store('opPane', name);
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
}

/* ---- 様子 ---- */
async function loadOverview(): Promise<void> {
  const o = await call<AdminOverview>('/api/admin/overview');
  const c = o.counts;
  const box = (n: number, label: string, sub = '') => '<div class="op-count"><b>' + n + '</b><span>' + label + '</span>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
  $('opReg').innerHTML = '<h3>' + mi('person_add') + '新規登録の受付</h3>' +
    '<p class="op-state ' + (o.registrationOpen ? 'ok">受け付けています' : 'warn">止めています') + '</p>' +
    '<p class="hint">止めると、新しいグループの作成と、初めての人のログインを断ります。もう使っている人と今あるグループは、そのまま使えます。運営者は、止めていてもログインでき、グループも作れます。</p>' +
    '<button type="button" class="btn small" id="opRegToggle" data-open="' + (o.registrationOpen ? '0' : '1') + '">' + (o.registrationOpen ? '受付を止める' : '受け付ける') + '</button>';
  $('opCounts').innerHTML = box(c.groups, 'グループ') + box(c.users, '利用者', c.bannedUsers ? '締め出し ' + c.bannedUsers + ' 人' : '') + box(c.logins, '有効なログイン') + box(c.activeSessions, '動いている卓', '募集・調整中・開催');
  const p = o.patrol, last = p.last;
  const state = !last ? ['bad', '記録がありません（cron がまだ一度も動いていないか、止まっています）']
    : p.stale ? ['bad', '最後の見回りが ' + ago(last.at) + 'です。cron が止まっているかもしれません']
      : !last.ok ? ['warn', '最後の見回りが失敗しました: ' + last.error]
        : ['ok', '動いています（' + ago(last.at) + '、' + last.ms + ' ミリ秒）'];
  $('opPatrol').innerHTML = '<h3>' + mi('monitor_heart') + '知らせの見回り（cron、5 分おき）</h3>' +
    '<p class="op-state ' + state[0] + '">' + esc(state[1]) + '</p>' +
    '<dl class="op-dl"><dt>最後の見回り</dt><dd>' + (last ? fmt(last.at) : '—') + '</dd>' +
    '<dt>最後にうまくいった見回り</dt><dd>' + fmt(p.okAt) + '</dd>' +
    '<dt>毎時の仕事（開催前の知らせ・期間前の催促・自動終了）</dt><dd>' + (p.hourly ? esc(p.hourly.replace('T', ' ') + ' 時台') : '—') + '</dd>' +
    '<dt>毎日の片付け</dt><dd>' + esc(p.daily || '—') + '</dd></dl>';
  $('opFailSum').textContent = '24 時間で ' + o.failures.day + ' 件、7 日で ' + o.failures.week + ' 件。';
  $('opFails').innerHTML = o.failures.recent.length
    ? '<tr><th>日時</th><th>グループ</th><th>種別</th><th>対象</th><th>結果</th></tr>' + o.failures.recent.map((f) =>
      '<tr><td class="nw">' + fmt(f.at) + '</td><td><a href="#groups" data-open="' + esc(f.groupId) + '">' + esc(f.groupTitle) + '</a></td><td class="nw">' + esc(f.kind) + '</td><td>' + esc(f.target) + '</td><td>' + esc(f.result) + '</td></tr>').join('')
    : '<tr><td class="hint">失敗はありません。</td></tr>';
}

/* ---- グループ ---- */
async function loadGroups(): Promise<void> {
  groups = await call<AdminGroupRow[]>('/api/admin/groups');
  $('opGroups').innerHTML = '<tr><th>グループ</th><th>Discord サーバー</th><th class="c">メンバー</th><th class="c">管理者の印</th><th class="c">卓</th><th>最後に使われた</th><th class="c">7 日の失敗</th></tr>' +
    (groups.length ? groups.map((g) =>
      '<tr class="click' + (g.id === openId ? ' on' : '') + '" data-gid="' + esc(g.id) + '"><td><b>' + esc(g.title) + '</b><small class="op-id">' + esc(g.id) + '</small></td><td>' + esc(g.guildName) + '<small class="op-id">' + esc(g.guildId) + '</small></td>' +
      '<td class="c">' + g.memberCount + '<small class="op-id">ログイン ' + g.linkedCount + '</small></td><td class="c">' + g.adminCount + '</td><td class="c">' + g.activeCount + ' / ' + g.sessionCount + '</td>' +
      '<td class="nw">' + fmt(g.lastUsedAt) + '<small class="op-id">' + esc(ago(g.lastUsedAt)) + '</small></td><td class="c' + (g.failuresWeek ? ' op-bad' : '') + '">' + g.failuresWeek + '</td></tr>').join('')
      : '<tr><td colspan="7" class="hint">まだグループがありません。</td></tr>');
  if (openId) {
    if (groups.some((g) => g.id === openId)) await openGroup(openId); else { openId = ''; $('opGroup').hidden = true; }
  }
}
async function openGroup(id: string): Promise<void> {
  openId = id;
  const d = await call<AdminGroupDetail>('/api/admin/groups/' + encodeURIComponent(id));
  document.querySelectorAll<HTMLElement>('#opGroups tr[data-gid]').forEach((tr) => { tr.classList.toggle('on', tr.dataset.gid === id); });
  $('opGroup').innerHTML = groupDetailHtml(d);
  $('opGroup').hidden = false;
}
function groupDetailHtml(d: AdminGroupDetail): string {
  const members = d.members.map((m) =>
    '<tr><td><b>' + esc(m.name) + '</b>' + (m.isAdmin ? ' <span class="op-chip">管理者</span>' : '') + '</td><td>' + (m.userId ? esc(m.userName) + '<small class="op-id">' + esc(m.userId) + '</small>' : '<span class="hint">まだ開いていない</span>' + (m.discordId ? '<small class="op-id">' + esc(m.discordId) + '</small>' : '')) + '</td>' +
    '<td class="nw">' + fmt(m.lastLoginAt) + '</td><td class="nw">' + (m.isAdmin
      ? '<button type="button" class="btn small" data-admin="0" data-mid="' + m.id + '">管理者から外す</button>'
      : '<button type="button" class="btn small" data-admin="1" data-mid="' + m.id + '">' + mi('shield') + '管理者にする</button>') + '</td></tr>').join('');
  return '<div class="op-detail-h"><h3>' + esc(d.title) + '</h3><button type="button" class="btn small" data-close>' + mi('close') + '閉じる</button></div>' +
    '<dl class="op-dl"><dt>Discord サーバー</dt><dd>' + esc(d.guildName) + ' <small class="op-id">' + esc(d.guildId) + '</small></dd>' +
    '<dt>作った人</dt><dd>' + esc(d.createdByName || d.createdBy) + ' ／ ' + fmt(d.createdAt) + '</dd>' +
    '<dt>最後に使われた</dt><dd>' + fmt(d.lastUsedAt) + '</dd>' +
    '<dt>卓</dt><dd>' + d.activeCount + ' 件が動いている（全部で ' + d.sessionCount + ' 件）</dd>' +
    '<dt>知らせの基本のチャンネル</dt><dd>' + (d.channelSet ? 'あり' : 'なし') + '</dd>' +
    '<dt>サーバーの管理者</dt><dd>' + (d.guildManagers.length ? d.guildManagers.map((x) => esc(x.name)).join('、') + ' <span class="hint">（印が無くても管理者）</span>' : '<span class="hint">ログインした人の中にはいません</span>') + '</dd></dl>' +
    '<h4>' + mi('shield') + 'メンバーと管理者</h4>' +
    '<div class="wrap"><table class="op-table"><tr><th>名前</th><th>Discord</th><th>最後のログイン</th><th></th></tr>' + (members || '<tr><td colspan="4" class="hint">メンバーがいません。</td></tr>') + '</table></div>' +
    '<form class="op-form" id="opAddAdmin"><b>' + mi('person_add') + 'まだ開いていない人を管理者として足す</b>' +
    '<div class="row"><label>Discord ユーザー ID<input type="text" name="discordId" inputmode="numeric" placeholder="123456789012345678" required></label><label>名前 <small>メンバーにいなければ使う</small><input type="text" name="name"></label></div>' +
    '<button type="submit" class="btn">管理者として足す</button><p class="hint">初めてグループを開いたときに、その人に結びつきます。管理者の印は 0 人にできないので、付け替えるときは足してから外します。</p></form>' +
    '<form class="op-form" id="opGuild"><b>' + mi('swap_horiz') + 'Discord サーバーを付け替える</b>' +
    '<div class="row"><label>新しいサーバーの ID<input type="text" name="guildId" inputmode="numeric" placeholder="123456789012345678" required></label><label>サーバーの名前 <small>分からないときだけ要る</small><input type="text" name="guildName"></label></div>' +
    '<button type="submit" class="btn">付け替える</button><p class="hint">新しいサーバーの人が入れるようになり、いまのサーバーの人は入れなくなります。メンバーの行と管理者の印は残ります。知らせのチャンネルは外れるので、新しいサーバーに Bot を招いて選び直してもらいます。</p></form>' +
    '<form class="op-form danger-card" id="opDelete"><b>' + mi('delete') + 'グループを消す</b>' +
    '<p>卓・メンバーの予定・メモ・日程調整の回答・送信の記録が、すべて消えます。元に戻せません。</p>' +
    '<label>確かめのために、グループの名前「' + esc(d.title) + '」を入れてください<input type="text" name="confirm" autocomplete="off" data-title="' + esc(d.title) + '"></label>' +
    '<button type="submit" class="btn danger-fill" disabled>グループを消す</button></form>';
}

/* ---- 利用者 ---- */
async function loadUsers(): Promise<void> {
  users = await call<AdminUserRow[]>('/api/admin/users');
  renderUsers();
}
function renderUsers(): void {
  const q = $('opUserFilter').value.trim().toLowerCase();
  const list = users.filter((u) => !q || u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || u.id.includes(q));
  $('opUsers').innerHTML = '<tr><th>名前</th><th>入っているグループ</th><th>最後のログイン</th><th class="c">ログイン</th><th></th></tr>' +
    (list.length ? list.map((u) =>
      '<tr class="' + (u.bannedAt ? 'op-banned' : '') + '"><td><b>' + esc(u.name) + '</b>' + (u.operator ? ' <span class="op-chip">運営者</span>' : '') + (u.bannedAt ? ' <span class="op-chip bad">締め出し中</span>' : '') +
      '<small class="op-id">' + esc(u.id) + '（' + esc(u.username) + '）</small>' + (u.bannedAt ? '<small class="op-id">' + fmt(u.bannedAt) + (u.bannedReason ? '：' + esc(u.bannedReason) : '') + '</small>' : '') + '</td>' +
      '<td>' + (u.groups.map((g) => esc(g.title)).join('、') || '<span class="hint">なし</span>') + '</td>' +
      '<td class="nw">' + fmt(u.lastLoginAt) + '<small class="op-id">はじめて ' + fmt(u.createdAt) + '</small></td><td class="c">' + u.logins + '</td>' +
      '<td class="nw op-acts">' + (u.logins ? '<button type="button" class="btn small" data-logout="' + esc(u.id) + '">' + mi('logout') + 'ログインを切る</button>' : '') +
      (u.operator ? '' : u.bannedAt ? '<button type="button" class="btn small" data-unban="' + esc(u.id) + '">' + mi('undo') + '戻す</button>' : '<button type="button" class="btn small danger" data-ban="' + esc(u.id) + '">' + mi('block') + '締め出す</button>') + '</td></tr>').join('')
      : '<tr><td colspan="5" class="hint">' + (q ? '合う人がいません。' : 'まだ誰もログインしていません。') + '</td></tr>');
}
let banId = '';
function openBan(id: string): void {
  const u = users.filter((x) => x.id === id)[0]; if (!u) return;
  banId = id;
  $('banTitle').textContent = u.name + ' を締め出す';
  $('banText').textContent = 'ログインをすべて消し、Discord でログインし直しても入れなくします。あとで戻せます。';
  $('banReason').value = '';
  $('banModal').hidden = false;
  $('banReason').focus();
}

/* ---- 読み込み ---- */
async function loadAll(): Promise<void> {
  try {
    await Promise.all([loadOverview(), loadGroups(), loadUsers()]);
  } catch (e) {
    toast((e as Error).message);
  }
}

function init(): void {
  initModal();
  document.querySelectorAll<HTMLElement>('#opNav button').forEach((b) => { b.onclick = () => { showPane(b.dataset.set!); }; });
  window.addEventListener('hashchange', () => { showPane(location.hash.slice(1)); });
  $('reload').onclick = () => { loadAll().then(() => toast('読み直しました')); };
  // 新規登録の受付。止めるときだけ確かめる
  $('opReg').addEventListener('click', (ev) => {
    const b = hit(ev, '#opRegToggle'); if (!b) return;
    const open = b.dataset.open === '1';
    const go = () => { act('/api/admin/registration', { open }, loadOverview); };
    if (open) go();
    else askConfirm({ title: '新規登録の受付を止めますか？', message: '新しいグループの作成と、初めての人のログインを断ります。もう使っている人と今あるグループは、そのまま使えます。', ok: '受付を止める' }, go);
  });
  // 失敗の一覧からグループを開く
  $('opFails').addEventListener('click', (ev) => {
    const a = hit(ev, 'a[data-open]'); if (!a) return;
    ev.preventDefault(); showPane('groups'); openGroup(a.dataset.open!).catch((e: Error) => toast(e.message));
  });
  $('opGroups').addEventListener('click', (ev) => { const tr = hit(ev, 'tr[data-gid]'); if (tr) openGroup(tr.dataset.gid!).catch((e: Error) => toast(e.message)); });
  const detail = $('opGroup');
  detail.addEventListener('click', (ev) => {
    if (hit(ev, '[data-close]')) { openId = ''; detail.hidden = true; document.querySelectorAll('#opGroups tr.on').forEach((tr) => tr.classList.remove('on')); return; }
    const b = hit(ev, 'button[data-mid]'); if (!b) return;
    const admin = b.dataset.admin === '1', id = openId;
    act('/api/admin/groups/' + encodeURIComponent(id) + '/admins', { memberId: Number(b.dataset.mid), admin }, loadGroups);
  });
  detail.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t instanceof HTMLInputElement && t.name === 'confirm') (t.form!.querySelector('button[type=submit]') as HTMLButtonElement).disabled = t.value.trim() !== t.dataset.title;
  });
  detail.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = ev.target as HTMLFormElement, data = new FormData(f), id = openId;
    const g = groups.filter((x) => x.id === id)[0];
    const path = '/api/admin/groups/' + encodeURIComponent(id);
    if (f.id === 'opAddAdmin') act(path + '/admins', { discordId: String(data.get('discordId') || ''), name: String(data.get('name') || ''), admin: true }, loadGroups);
    else if (f.id === 'opGuild') {
      const body = { guildId: String(data.get('guildId') || '').trim(), guildName: String(data.get('guildName') || '').trim() };
      askConfirm({ title: 'Discord サーバーを付け替えますか？', message: '「' + (g ? g.title : id) + '」を、サーバー ' + body.guildId + ' に結び直します。いまのサーバーの人は入れなくなります。知らせのチャンネルも外れます。', ok: '付け替える', danger: true },
        () => { act(path + '/guild', body, loadAll); });
    } else if (f.id === 'opDelete') {
      const confirm = String(data.get('confirm') || '');
      askConfirm({ title: '「' + (g ? g.title : id) + '」を消しますか？', message: '中身もすべて消え、元に戻せません。', ok: '消す', danger: true },
        () => { act(path + '/delete', { confirm }, async () => { openId = ''; $('opGroup').hidden = true; await loadAll(); }); });
    }
  });
  $('opUserFilter').addEventListener('input', renderUsers);
  $('opUsers').addEventListener('click', (ev) => {
    const lo = hit(ev, 'button[data-logout]');
    if (lo) {
      const u = users.filter((x) => x.id === lo.dataset.logout)[0];
      askConfirm({ title: (u ? u.name : '') + ' のログインを切りますか？', message: 'その人のログインをすべて消します。Discord でログインし直せば、また入れます。', ok: 'ログインを切る' },
        () => { act('/api/admin/users/' + encodeURIComponent(lo.dataset.logout!) + '/logout', {}, async () => { await Promise.all([loadUsers(), loadOverview()]); }); });
      return;
    }
    const ban = hit(ev, 'button[data-ban]');
    if (ban) { openBan(ban.dataset.ban!); return; }
    const un = hit(ev, 'button[data-unban]');
    if (un) act('/api/admin/users/' + encodeURIComponent(un.dataset.unban!) + '/ban', { banned: false }, async () => { await Promise.all([loadUsers(), loadOverview()]); });
  });
  $('banForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    $('banModal').hidden = true;
    act('/api/admin/users/' + encodeURIComponent(banId) + '/ban', { banned: true, reason: $('banReason').value.trim() }, async () => { await Promise.all([loadUsers(), loadOverview()]); });
  });
  $('banCancel').onclick = () => { $('banModal').hidden = true; };
  showPane(location.hash.slice(1) || load('opPane') || 'overview');
  loadAll();
}

init();
