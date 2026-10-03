// タブ（カレンダー・募集・調整・メンバーの予定・メンバーの登録・設定）
import { $, hit, load, store } from './dom';
import { showSetPane } from './settings';

const TABS = ['cal', 'recruit', 'avail', 'members', 'settings'];

export function showTab(nameIn: string): void {
  const name = TABS.indexOf(nameIn) < 0 ? 'cal' : nameIn;
  const prev = document.body.getAttribute('data-tab');
  TABS.forEach((t) => { $('tab-' + t).hidden = t !== name; });
  document.querySelectorAll<HTMLElement>('nav.tabs button[data-tab]').forEach((b) => {
    const on = b.dataset.tab === name;
    b.className = on ? 'on' : '';
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  document.body.setAttribute('data-tab', name);
  if (name === 'settings') showSetPane(load('setPane') || 'notify');   // 前に見ていた区分から開く
  if (prev && prev !== name && window.scrollY > 0) window.scrollTo(0, 0);   // 別の画面に移ったら先頭から
  store('tab', name);
}

export function init(): void {
  document.querySelector('nav.tabs')!.addEventListener('click', (ev) => { const b = hit(ev, 'button[data-tab]'); if (b) showTab(b.dataset.tab!); });
}
