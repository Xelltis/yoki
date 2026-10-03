// タブ。ふだんの画面はカレンダー・募集・調整・メンバーの予定・設定、管理画面は管理の 1 枚（中を区分で切り替える）
import { AREA, paneFromHash } from './area';
import { $, hit, load, store } from './dom';
import { showSetPane } from './settings';

const ALL = ['cal', 'recruit', 'avail', 'settings', 'admin'];
const TABS = AREA === 'admin' ? ['admin'] : ['cal', 'recruit', 'avail', 'settings'];

export function showTab(nameIn: string): void {
  const name = TABS.indexOf(nameIn) < 0 ? TABS[0]! : nameIn;
  const prev = document.body.getAttribute('data-tab');
  ALL.forEach((t) => { $('tab-' + t).hidden = t !== name; });
  document.querySelectorAll<HTMLElement>('nav.tabs button[data-tab]').forEach((b) => {
    const on = b.dataset.tab === name;
    b.className = on ? 'on' : '';
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  document.body.setAttribute('data-tab', name);
  if (name === 'admin') showSetPane(paneFromHash() || load('adminPane') || 'members');   // 前に見ていた区分から開く
  if (prev && prev !== name && window.scrollY > 0) window.scrollTo(0, 0);   // 別の画面に移ったら先頭から
  if (AREA === 'main') store('tab', name);
}

export function init(): void {
  document.querySelector('nav.tabs')!.addEventListener('click', (ev) => { const b = hit(ev, 'button[data-tab]'); if (b) showTab(b.dataset.tab!); });
  window.addEventListener('hashchange', () => { const p = paneFromHash(); if (AREA === 'admin' && p) showSetPane(p); });
}
