// 入口: ログインしているかを /api/me で聞き、グループの一覧・グループを作る・ログインを出す
var $ = function (id) { return document.getElementById(id); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var avatarUrl = function (u) { return u.avatar ? 'https://cdn.discordapp.com/avatars/' + u.id + '/' + u.avatar + '.png?size=64' : ''; };

var q = new URLSearchParams(location.search);
if (q.get('login') === 'cancelled') { $('notice').textContent = 'ログインをやめました。'; $('notice').hidden = false; }

function showGuest(me) {
  $('guest').hidden = false;
  $('loginBtn').hidden = !me.discord;
  $('noDiscord').hidden = me.discord || !!me.dev;
  if (me.dev) {
    $('devForm').hidden = false;
    $('devAs').innerHTML = me.dev.users.map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('');
  }
  var back = q.get('return_to');
  if (back && /^\/g\/[a-z0-9-]+\/$/.test(back)) $('loginBtn').href = '/auth/login?return_to=' + encodeURIComponent(back);
}

function showHome(me) {
  $('who').hidden = false;
  var av = avatarUrl(me.user);
  $('who').innerHTML = (av ? '<img src="' + esc(av) + '" alt="">' : '') + '<span>' + esc(me.user.name) + '</span>' +
    '<form method="post" action="/auth/logout"><button class="btn ghost" type="submit"><span class="ms" aria-hidden="true">logout</span>ログアウト</button></form>';
  $('home').hidden = false;
  $('groups').innerHTML = me.groups.map(function (g) {
    return '<li><a href="/g/' + encodeURIComponent(g.id) + '/"><b>' + esc(g.title) + '</b><small>' + esc(g.guildName) + '</small><span class="ms" aria-hidden="true">arrow_forward</span></a></li>';
  }).join('');
  $('noGroups').hidden = me.groups.length > 0;
  $('stale').hidden = !me.stale;
  if (me.creatable.length) {
    $('create').hidden = false;
    $('cGuild').innerHTML = me.creatable.map(function (g) { return '<option value="' + esc(g.guildId) + '">' + esc(g.name) + '</option>'; }).join('');
  }
}

$('createForm').addEventListener('submit', function (ev) {
  ev.preventDefault();
  $('cOk').disabled = true; $('cMsg').textContent = '作っています…';
  fetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guildId: $('cGuild').value, title: $('cTitle').value }) })
    .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
    .then(function (r) {
      if (r.ok) { location.href = r.body.url; return; }
      $('cOk').disabled = false; $('cMsg').textContent = r.body.error || '作れませんでした。';
    })
    .catch(function () { $('cOk').disabled = false; $('cMsg').textContent = '通信できませんでした。'; });
});

fetch('/api/me').then(function (r) { return r.json(); }).then(function (me) {
  $('loading').hidden = true;
  if (me.loggedIn) showHome(me); else showGuest(me);
}).catch(function () { $('loading').textContent = '読み込めませんでした。少し待ってから開き直してください。'; });
