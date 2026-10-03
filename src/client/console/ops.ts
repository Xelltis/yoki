// 管理画面の「卓をまとめて変える」。卓の一覧から選び、状態・参加者・開催日などをまとめて変える。メンバーに無い参加者の注意は、メンバーの予定のタブに出す
import { api, discordSend, failToast, useData } from './api';
import { renderAvail } from './avail';
import { daysBetween, fmtJa } from './dates';
import { $, esc, hit, mi, store, toast } from './dom';
import { fillForm, openForm } from './form';
import { askConfirm } from './modal';
import { byId, isActive, isAdjusting, isRecruit, me, peopleOf, sortSessions, sortedActive } from './model';
import { D } from './state';

/** 選んでいる卓（id） */
const selected: Record<string, true> = {};
function clearSelected(): void { Object.keys(selected).forEach((id) => { delete selected[id]; }); }

function matrixRows() {
  let rows = sortedActive();
  if ($('showAll').checked) rows = rows.concat(sortSessions(D.sessions.filter((s) => !isActive(s))));
  return rows;
}
/** 卓の一覧と、メンバーに無い参加者の注意 */
export function renderOps(): void {
  const act = sortedActive(), names = D.members.map((m) => m.name);
  const unknown: string[] = [];
  act.forEach((s) => { peopleOf(s).forEach((n) => { if (names.indexOf(n) < 0 && unknown.indexOf(n) < 0) unknown.push(n); }); });
  $('unknownWarn').innerHTML = unknown.length ? '<div class="notice adjust" style="margin-bottom:8px">' + mi('warning') + 'メンバーに無い参加者: ' + esc(unknown.join('、')) + '　→ 管理画面の「メンバー」で足すと、予定表に列ができます。</div>' : '';

  const rows = matrixRows();
  const ids: Record<string, boolean> = {};
  rows.forEach((s) => { ids[s.id] = true; });
  Object.keys(selected).forEach((id) => { if (!ids[id]) delete selected[id]; });
  let html = '<tr><th class="sel"><input type="checkbox" id="selAll"></th><th>セッション名</th><th class="c">シリーズ</th><th class="c">状態</th><th class="c">開催日</th><th class="c">GM</th><th>参加者</th><th></th></tr>';
  rows.forEach((s) => {
    const when = s.date ? fmtJa(s.date) : (isRecruit(s) || isAdjusting(s)) ? esc(s.windowLabel || '期間未定') : '未定';
    html += '<tr class="' + (isActive(s) ? '' : 'done') + (selected[s.id] ? ' checked' : '') + '" data-id="' + esc(s.id) + '"><td class="sel"><input type="checkbox" class="rowsel" data-id="' + esc(s.id) + '"' + (selected[s.id] ? ' checked' : '') + '></td><td class="nw"><b>' + esc(s.name) + '</b></td><td class="c nw">' + esc(s.series) + '</td><td class="c nw">' + esc(s.status) + '</td><td class="c nw">' + when + '</td><td class="c nw">' + esc(s.gm) + '</td><td class="ppl">' + esc(s.members.join('、')) + '</td><td class="nw"><button type="button" class="btn small" data-edit="' + esc(s.id) + '">編集</button></td></tr>';
  });
  if (!rows.length) html += '<tr><td colspan="8" class="hint">稼働中の卓はありません。カレンダーの「卓を登録」から。</td></tr>';
  $('matrix').innerHTML = html;
  const all = rows.length > 0 && rows.every((s) => selected[s.id]);
  const selAll = document.getElementById('selAll') as HTMLInputElement | null;
  if (selAll) selAll.checked = all;
  renderOpsBar();
}
/** 下の操作の欄。選んだ操作に合わせて、値の欄を出し分ける */
function renderOpsBar(): void {
  const n = Object.keys(selected).length;
  $('bulkCount').textContent = '選択 ' + n + ' 件';
  const a = $('bulkAction').value;
  $('bulkStatus').hidden = a !== 'status';
  $('bulkMember').hidden = !(a === 'addMember' || a === 'removeMember' || a === 'setGm');
  $('bulkDays').hidden = a !== 'shiftDays';
  $('bulkSeries').hidden = a !== 'setSeries';
  $('bulkRun').disabled = n === 0;
  $('bulkRun').className = 'btn ' + (a === 'delete' ? 'danger' : 'primary');
  $('bulkNotify').disabled = !D.webhookSet;
}

export function init(): void {
  $('matrix').addEventListener('click', (ev) => {
    const cb = hit<HTMLInputElement>(ev, 'input.rowsel');
    if (cb) { if (cb.checked) selected[cb.dataset.id!] = true; else delete selected[cb.dataset.id!]; renderOps(); return; }
    if (hit(ev, '#selAll')) { const on = $('selAll').checked; matrixRows().forEach((s) => { if (on) selected[s.id] = true; else delete selected[s.id]; }); renderOps(); return; }
    const ed = hit(ev, 'button[data-edit]');
    if (ed) { fillForm(ed.dataset.edit!); openForm(); return; }
    const tr = hit(ev, 'tr[data-id]'); if (!tr) return;
    if (selected[tr.dataset.id!]) delete selected[tr.dataset.id!]; else selected[tr.dataset.id!] = true;
    renderOps();
  });
  $('showAll').addEventListener('change', renderOps);
  const sort = $('sortByLoad');
  sort.addEventListener('change', () => { store('sortByLoad', sort.checked ? '1' : '0'); renderOps(); renderAvail(); });
  $('bulkAction').addEventListener('change', renderOpsBar);
  $('bulkPast').onclick = () => { matrixRows().forEach((s) => { if (s.date && daysBetween(D.today, s.date) < 0 && isActive(s)) selected[s.id] = true; }); renderOps(); };
  $('bulkNone').onclick = () => { clearSelected(); renderOps(); };
  $('bulkRun').onclick = () => {
    const ids = Object.keys(selected); if (!ids.length) return;
    const a = $('bulkAction').value, value = a === 'status' ? $('bulkStatus').value : a === 'shiftDays' ? $('bulkDays').value.trim() : a === 'setSeries' ? $('bulkSeries').value.trim() : $('bulkMember').value;
    const names = ids.map((id) => { const s = byId(id); return s ? s.name : id; });
    const what = $('bulkAction').options[$('bulkAction').selectedIndex]!.textContent + (a === 'delete' ? '' : '（' + (value || (a === 'setSeries' ? '外す' : '')) + '）');
    if (a !== 'delete' && a !== 'setSeries' && !value) { $('bulkMsg').textContent = '値を選んでください。'; return; }
    askConfirm({ title: ids.length + ' 件を「' + what + '」しますか？', message: names.join('、'), ok: a === 'delete' ? '削除する' : '実行する', danger: a === 'delete' }, () => {
      $('bulkRun').disabled = true; $('bulkMsg').textContent = '保存しています…';
      const wantBulkNotify = $('bulkNotify').checked;
      api().withSuccessHandler((res) => {
        $('bulkMsg').textContent = res.message; toast(res.message); clearSelected(); useData(res);
        if (!wantBulkNotify) return;
        discordSend({ kind: 'bulk', names: res.names || names, ids: res.ids || ids, label: res.label || what },
          (t) => { $('bulkMsg').textContent = res.message + '　' + t; },
          (ok, r) => { toast(ok ? 'Discord に送りました' : failToast(r)); });
      }).withFailureHandler((e) => { $('bulkRun').disabled = false; $('bulkMsg').textContent = e.message; toast(e.message); })
        .bulkUpdateSessions({ ids, action: a, value, notify: false, me: me() });
    });
  };
}
