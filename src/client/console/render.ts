// 読み込んだデータで画面を描く。buildStatic は選ぶ欄などの骨組み、renderAll は各タブの中身
import { buildFilter, renderAvail } from './avail';
import { initBulkRange } from './avail-input';
import { renderCal } from './calendar';
import { parseYmd } from './dates';
import { $, fillSelect, load } from './dom';
import { fillForm, syncNotifyUi } from './form';
import { showLoadedAt } from './load';
import { fillMemberForm, renderMeCard, renderMembers } from './members';
import { active, byId, pickLabel, seriesNames, sortedActive, sortSessions } from './model';
import { renderNotices } from './notices';
import { renderOps } from './ops';
import { renderRecruit } from './recruit';
import { renderSettings } from './settings';
import { renderSetup } from './setup';
import { D, drafts, view } from './state';

export function buildStatic(): void {
  document.title = D.title + ' - 卓予定';
  $('title').textContent = D.title;
  showLoadedAt();
  const names = D.members.map((m) => ({ value: m.name, text: m.name }));
  // 「あなた」はログインした本人（ほかの人に切り替えない）
  $('me').textContent = D.me.name;
  // 管理画面への入口（管理者だけ）
  $('adminLink').hidden = !D.isAdmin;
  $('adminEntry').hidden = !D.isAdmin;
  const dl = $('memberList');
  dl.innerHTML = '';
  D.members.forEach((m) => { const o = document.createElement('option'); o.value = m.name; dl.appendChild(o); });
  const sl = $('seriesList');
  sl.innerHTML = '';
  seriesNames().forEach((n) => { const o = document.createElement('option'); o.value = n; sl.appendChild(o); });
  const statuses = D.statuses.map((s) => ({ value: s, text: s }));
  fillSelect($('status'), statuses);
  fillSelect($('bulkStatus'), statuses);
  fillSelect($('bulkMember'), names);
  const box = $('membersBox');
  box.innerHTML = '';
  D.members.forEach((m) => {
    const lab = document.createElement('label'), cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = m.name; cb.className = 'm';
    lab.appendChild(cb); lab.appendChild(document.createTextNode(m.name)); box.appendChild(lab);
  });
  if (!D.members.length) box.innerHTML = '<span class="hint">管理画面の「メンバー」で名前を足すと、ここにチェック欄が出ます。</span>';
  syncNotifyUi(true);
  const pickKeep = fillSelect($('pick'), sortedActive().concat(sortSessions(D.sessions.filter((s) => s.status === '中止'))).map((s) => ({ value: s.id, text: pickLabel(s) })), '（新規登録）');
  $('pick').value = byId(pickKeep) ? pickKeep : '';
  const tkeep = $('target').value || load('target') || '全員';
  const tlist = ['全員'].concat(active().map((s) => s.name)).concat(['（なし）']).map((n) => ({ value: n, text: n }));
  fillSelect($('target'), tlist);
  const akeep = $('afTarget').value;
  fillSelect($('afTarget'), [{ value: '（なし）', text: '卓で絞らない' }].concat(active().map((s) => ({ value: s.name, text: s.name }))));
  $('afTarget').value = Array.prototype.some.call($('afTarget').options, (o: HTMLOptionElement) => o.value === akeep) ? akeep : '（なし）';
  $('target').value = Array.prototype.some.call($('target').options, (o: HTMLOptionElement) => o.value === tkeep) ? tkeep : '全員';
  if (!view.y) { const t = parseYmd(D.today); view.y = t.getFullYear(); view.m = t.getMonth(); }
  if (load('sortByLoad') === '0') $('sortByLoad').checked = false;
  initBulkRange();
  buildFilter();
}

export function renderAll(): void {
  renderSetup(); renderNotices(); renderCal(); renderRecruit(); renderOps(); renderAvail();
  if ($('formModal').hidden) fillForm($('pick').value);
  renderMembers();
  if (!drafts.member) fillMemberForm($('mpick').value);
  renderMeCard();
  renderSettings();
}
