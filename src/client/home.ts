// 入口: ログインしているかを /api/me で聞き、グループの一覧・グループを作る・ログインを出す
import type { CreateGroupResult, MeResponse } from '../shared/api';

type Field = HTMLInputElement & HTMLSelectElement;
const $ = <T extends HTMLElement = Field>(id: string) => document.getElementById(id) as T;
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]!);
const avatarUrl = (u: { id: string; avatar: string | null }) => u.avatar ? 'https://cdn.discordapp.com/avatars/' + u.id + '/' + u.avatar + '.png?size=64' : '';

const q = new URLSearchParams(location.search);
const NOTICE: Record<string, string> = {
  cancelled: 'ログインをやめました。',
  banned: 'このアカウントでは入れません（運営者が締め出しています）。',
  deleted: 'グループを消しました。',
};
const say = NOTICE[q.get('login') || ''] || (q.get('deleted') === '1' ? NOTICE.deleted : '');
if (say) { $('notice').textContent = say; $('notice').hidden = false; }

function showGuest(me: MeResponse): void {
  $('guest').hidden = false;
  $('loginBtn').hidden = !me.discord;
  $('noDiscord').hidden = me.discord || !!me.dev;
  if (me.dev) {
    $('devForm').hidden = false;
    $('devAs').innerHTML = me.dev.users.map((n) => '<option>' + esc(n) + '</option>').join('');
  }
  const back = q.get('return_to');
  if (back && /^\/(g\/[a-z0-9-]+\/(admin\/)?|admin\/)$/.test(back)) $<HTMLAnchorElement>('loginBtn').href = '/auth/login?return_to=' + encodeURIComponent(back);
}

function showHome(me: Extract<MeResponse, { loggedIn: true }>): void {
  $('who').hidden = false;
  const av = avatarUrl(me.user);
  $('who').innerHTML = (av ? '<img src="' + esc(av) + '" alt="">' : '') + '<span>' + esc(me.user.name) + '</span>' +
    '<form method="post" action="/auth/logout"><button class="btn ghost" type="submit"><span class="ms" aria-hidden="true">logout</span>ログアウト</button></form>';
  $('home').hidden = false;
  $('opLink').hidden = !me.operator;
  $('groups').innerHTML = me.groups.map((g) =>
    '<li><a href="/g/' + encodeURIComponent(g.id) + '/"><b>' + esc(g.title) + '</b><small>' + esc(g.guildName) + '</small><span class="ms" aria-hidden="true">arrow_forward</span></a></li>').join('');
  $('noGroups').hidden = me.groups.length > 0;
  $('stale').hidden = !me.stale;
  if (me.creatable.length) {
    $('create').hidden = false;
    $('cGuild').innerHTML = me.creatable.map((g) => '<option value="' + esc(g.guildId) + '">' + esc(g.name) + '</option>').join('');
  }
}

$('createForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  $('cOk').disabled = true; $('cMsg').textContent = '作っています…';
  fetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guildId: $('cGuild').value, title: $('cTitle').value }) })
    .then((r) => r.json().then((b: CreateGroupResult & { error?: string }) => ({ ok: r.ok, body: b })))
    .then((r) => {
      if (r.ok) { location.href = r.body.url; return; }
      $('cOk').disabled = false; $('cMsg').textContent = r.body.error || '作れませんでした。';
    })
    .catch(() => { $('cOk').disabled = false; $('cMsg').textContent = '通信できませんでした。'; });
});

fetch('/api/me').then((r) => r.json() as Promise<MeResponse>).then((me) => {
  $('loading').hidden = true;
  if (me.loggedIn) showHome(me); else showGuest(me);
}).catch(() => { $('loading').textContent = '読み込めませんでした。少し待ってから開き直してください。'; });
