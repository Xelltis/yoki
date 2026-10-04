// メンバー。管理画面の「メンバー」（一覧と、足す・名前を変える・外す）と、ふだんの画面の設定の「あなたの名前と備考」
import type { RpcResult } from '../../shared/api';
import { api, useData } from './api';
import { $, esc, fillSelect, hit, mi, toast } from './dom';
import { askConfirm } from './modal';
import { active, isActive, peopleOf } from './model';
import { D, drafts } from './state';

export function renderMembers(): void {
  const act = active();
  let html = '<tr><th>名前</th><th>Discord ユーザーID</th><th>備考</th><th class="c">参加</th><th class="c">GM</th></tr>';
  D.members.forEach((m) => {
    const part = act.filter((s) => s.members.indexOf(m.name) >= 0 && s.gm !== m.name).length;
    const gm = act.filter((s) => s.gm === m.name).length;
    html += '<tr class="click" data-name="' + esc(m.name) + '"><td><b>' + esc(m.name) + '</b>' + (m.linked ? ' <span class="hint" title="Discord でログインしたことがある">' + mi('check', 'xs') + 'ログイン済み</span>' : '') + '</td><td>' + (m.discordId ? esc(m.discordId) + (m.idOk === false ? ' <span class="hint" style="color:var(--err-text)" title="Discord のユーザーID は 17〜20 桁の数字です">' + mi('warning', 'xs') + ' 桁がおかしい</span>' : '') : '<span class="hint">（未設定）</span>') + '</td><td>' + esc(m.note) + '</td><td class="c">' + part + '</td><td class="c">' + gm + '</td></tr>';
  });
  if (!D.members.length) html += '<tr><td colspan="5" class="hint">まだメンバーがいません。上のフォームから足します。</td></tr>';
  $('memberTable').innerHTML = html;
  const keep = fillSelect($('mpick'), D.members.map((m) => ({ value: m.name, text: m.name })), '（新規追加）');
  $('mpick').value = D.members.some((m) => m.name === keep) ? keep : '';
}
export function fillMemberForm(name: string): void {
  const m = D.members.filter((x) => x.name === name)[0] || null;
  $('mpick').value = m ? m.name : '';
  $('mname').value = m ? m.name : ''; $('mdiscord').value = m ? m.discordId : ''; $('mnote').value = m ? m.note : '';
  // ログインした人の Discord ID は、ログインから自動で入る
  $('mdiscord').readOnly = !!(m && m.linked); $('mdiscord').title = m && m.linked ? 'ログインした人の Discord ID は、自動で入ります' : '';
  $('mdel').hidden = !m; $('msave').textContent = m ? '更新' : '追加';
  $('mmsg').textContent = ''; $('mmsg').className = '';
  drafts.member = false;
}
/** 設定の「あなたの名前と備考」。ログインした本人のぶん */
export function renderMeCard(): void {
  const m = D.members.filter((x) => x.name === D.me.name)[0];
  const card = $('meCard');
  if (!drafts.me && !card.contains(document.activeElement)) {
    $('meName').value = m ? m.name : D.me.name;
    $('meNote').value = m ? m.note : '';
  }
  $('meDiscord').textContent = m && m.linked ? 'Discord でログインしています。Discord の ID は自動で入るので、知らせでメンションが付きます。' : '';
}

function mmsg(t: string, err: boolean): void { $('mmsg').textContent = t; $('mmsg').className = err ? 'err' : 'ok'; }
function mbusy(on: boolean): void { $('msave').disabled = on; $('mdel').disabled = on; if (on) mmsg('保存しています…', false); }
function afterMemberChange(res: RpcResult, keepName: string): void {
  mbusy(false); drafts.member = false;
  toast(res.message + (D && D.members.length && !D.sessions.some(isActive) ? '　次は「カレンダー」タブで卓を登録します。' : ''));
  useData(res, () => { fillMemberForm(keepName); mmsg(res.message, false); });
}

export function init(): void {
  $('memberTable').addEventListener('click', (ev) => { const tr = hit(ev, 'tr[data-name]'); if (tr) { fillMemberForm(tr.dataset.name!); window.scrollTo(0, 0); } });
  $('mpick').addEventListener('change', () => { fillMemberForm($('mpick').value); });
  $('mclear').onclick = () => { fillMemberForm(''); };
  $('mf').addEventListener('input', (ev) => { const t = ev.target; if (!(t instanceof HTMLElement && t.id === 'mpick')) drafts.member = true; });
  $('mf').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const form = { oldName: $('mpick').value, name: $('mname').value.trim(), discordId: $('mdiscord').value.trim(), note: $('mnote').value.trim() };
    if (!form.name) { mmsg('名前を入れてください。', true); return; }
    mbusy(true);
    api().withSuccessHandler((res) => { afterMemberChange(res, res.name || ''); })
      .withFailureHandler((e) => { mbusy(false); mmsg(e.message, true); }).saveMember(form);
  });
  $('meCard').addEventListener('input', () => { drafts.me = true; });
  $('meCard').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const m = D.members.filter((x) => x.name === D.me.name)[0];
    const form = { oldName: D.me.name, name: $('meName').value.trim(), note: $('meNote').value.trim(), discordId: m ? m.discordId : '' };
    if (!form.name) { $('meMsg').textContent = '名前を入れてください。'; return; }
    $('meSave').disabled = true; $('meMsg').textContent = '保存しています…';
    api().withSuccessHandler((res) => {
      $('meSave').disabled = false; drafts.me = false;
      toast(res.message);
      useData(res, () => { $('meMsg').textContent = res.message; });
    }).withFailureHandler((e) => { $('meSave').disabled = false; $('meMsg').textContent = e.message; }).saveMember(form);
  });
  $('mdel').onclick = () => {
    const name = $('mpick').value; if (!name) return;
    const inUse = active().filter((s) => peopleOf(s).indexOf(name) >= 0).length;
    askConfirm({ title: 'メンバーから外しますか？', message: '「' + name + '」をメンバーから外します。' + (inUse ? '\n参加中の卓 ' + inUse + ' 件には名前が残ります（「メンバーの予定」タブに注意が出ます）。' : ''), ok: '外す', danger: true }, () => {
      mbusy(true);
      api().withSuccessHandler((res) => { afterMemberChange(res, ''); })
        .withFailureHandler((e) => { mbusy(false); mmsg(e.message, true); }).deleteMember({ name });
    });
  };
}
