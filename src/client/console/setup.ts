// はじめの 3 ステップ。メンバーと卓がそろうまで、カレンダーの上に出す。「使い方」の隣のボタンで、いつでも出し直せる
import { adminUrl } from './area';
import { $, hit, mi, toast } from './dom';
import { fillForm, openForm } from './form';
import { isActive } from './model';
import { D, selDay } from './state';
import { showTab } from './tabs';

/** '' はメンバーと卓がそろうまで出す。'open' は出し直した（閉じるまで出す）。'closed' は閉じた（この画面を開いているあいだは出さない） */
let guideMode: '' | 'open' | 'closed' = '';

export function renderSetup(): void {
  const box = $('setupGuide'), hasMembers = D.members.length > 0, hasSession = D.sessions.some(isActive);
  const show = guideMode === 'open' || (guideMode !== 'closed' && !(hasMembers && hasSession));
  syncGuideBtns(show);
  if (!show) { box.hidden = true; box.innerHTML = ''; return; }
  const step = (n: number, state: string, title: string, text: string, btn: string) =>
    '<li class="' + state + '"><span class="n">' + (state === 'done' ? mi('check', 'sm') : n) + '</span><div><b>' + title + '</b><p class="hint">' + text + '</p>' + btn + '</div></li>';
  const hasDiscord = !!D.webhookSet;
  // メンバーの登録と Discord の設定は、管理者が管理画面でする。管理者でない人には、頼むように出す
  const ask = '<span class="hint">管理者に頼んでください</span>';
  box.innerHTML = '<h3>' + mi('flag', 'sm') + 'はじめの 3 ステップ' + '<button type="button" class="btn icon close-guide" data-go="close" aria-label="はじめの 3 ステップを閉じる">' + mi('close') + '</button>' + '</h3><ol class="setup">' +
    step(1, hasMembers ? 'done' : 'now', 'メンバーを登録する', '卓に出る人の名前を入れます。ここで入れた名前が、予定表の列と参加者の候補になります。',
      hasMembers ? '<span class="hint">' + D.members.length + ' 人を登録しています</span>' + (D.isAdmin ? ' <button type="button" class="btn small" data-go="members">開く</button>' : '') : D.isAdmin ? '<button type="button" class="btn primary" data-go="members">' + mi('person_add', 'sm') + 'メンバーを登録</button>' : ask) +
    step(2, hasDiscord ? 'done' : hasMembers ? 'now' : '', 'Discord を登録する', '管理画面の「知らせ」で Webhook URL を貼ると、卓の案内と開催前の知らせがチャンネルに届きます。Discord を使わないなら飛ばせます。',
      hasDiscord ? '<span class="hint">登録してあります</span>' + (D.isAdmin ? ' <button type="button" class="btn small" data-go="discord">開く</button>' : '') : D.isAdmin ? '<button type="button" class="btn" data-go="discord">' + mi('notifications', 'sm') + 'Discord を登録</button>' : ask) +
    step(3, !hasMembers ? '' : hasSession ? 'done' : 'now', '予定を登録する', 'カレンダーで日を選んで「卓を登録」を押します。日が決まっていなければ、状態を「募集」か「調整中」にします。',
      hasMembers ? (hasSession ? '<span class="hint">' + D.sessions.filter(isActive).length + ' 件の卓があります</span> ' : '') + '<button type="button" class="btn ' + (hasSession ? 'small' : 'primary') + '" data-go="new">' + mi('add', 'sm') + '卓を登録</button>' : '<span class="hint">先にメンバーを登録します</span>') +
    '</ol>';
  box.hidden = false;
}
function syncGuideBtns(show: boolean): void {
  ['guideBtn', 'guideBtnM'].forEach((id) => {
    const b = $(id);
    b.setAttribute('aria-expanded', show ? 'true' : 'false');
    b.title = show ? 'はじめの 3 ステップを閉じる' : 'はじめの 3 ステップをカレンダーの上に出す';
  });
}

export function init(): void {
  $('setupGuide').addEventListener('click', (ev) => {
    const b = hit(ev, 'button[data-go]'); if (!b) return;
    if (b.dataset.go === 'close') { guideMode = 'closed'; renderSetup(); return; }
    // メンバーと Discord は管理画面へ（管理者でなければボタンは出ないが、念のため）
    if (b.dataset.go === 'members' || b.dataset.go === 'discord') {
      if (!D.isAdmin) { toast('メンバーの登録と Discord の設定は、管理者が管理画面でします'); return; }
      location.href = adminUrl(b.dataset.go === 'members' ? 'members' : 'notify');
      return;
    }
    fillForm(''); if (selDay) $('date').value = selDay; openForm();
  });
  /* 「はじめの 3 ステップ」ボタン。カレンダーで出ていれば閉じ、それ以外は出す（押すたびに切り替わる） */
  $('guideBtn').onclick = $('guideBtnM').onclick = () => {
    const box = $('setupGuide');
    if (document.body.getAttribute('data-tab') === 'cal' && !box.hidden) { guideMode = 'closed'; renderSetup(); return; }
    guideMode = 'open'; showTab('cal'); renderSetup();
    box.setAttribute('tabindex', '-1'); window.scrollTo(0, 0); box.focus({ preventScroll: true });   // 上の帯に隠れないよう、ページの頭まで戻す
  };
}
