// 窓の共通の振る舞いと、確かめる窓（ブラウザの confirm の代わり）
import { $ } from './dom';

/* 開いているあいだは後ろ（ヘッダー・本文・下にある窓）を inert にして触れなくし、ページのスクロールを止める。
 * 閉じたら、開く前にフォーカスがあった場所へ戻す。Esc はいちばん手前の窓だけを閉じる */
let lastFocus: HTMLElement | null = null;
function openModals(): HTMLElement[] { return Array.prototype.filter.call(document.querySelectorAll<HTMLElement>('.modal'), (m: HTMLElement) => !m.hidden) as HTMLElement[]; }
function syncModals(): void {
  const open = openModals(), top = open[open.length - 1] || null;
  [document.querySelector('header'), document.querySelector('main')].forEach((el) => { if (!el) return; if (top) el.setAttribute('inert', ''); else el.removeAttribute('inert'); });
  open.forEach((m) => { if (m === top) m.removeAttribute('inert'); else m.setAttribute('inert', ''); });
  document.documentElement.classList.toggle('modal-open', !!top);
  if (top && !top.contains(document.activeElement)) top.querySelector<HTMLElement>('.box')!.focus({ preventScroll: true });
  if (!top && lastFocus && document.contains(lastFocus) && !lastFocus.closest('[hidden], [inert]')) { try { lastFocus.focus({ preventScroll: true }); } catch { /* 消えた要素 */ } }
}

export type ConfirmOptions = {
  title?: string;
  message?: string;
  /** 進むボタンの名前 */
  ok?: string;
  /** 消す・止めるなど戻しにくい操作なら true */
  danger?: boolean;
};
let confirmCb: (() => void) | null = null;
/** 確かめる窓。進むを押したら yes() を呼ぶ */
export function askConfirm(o: ConfirmOptions, yes: () => void): void {
  confirmCb = yes;
  $('confirmTitle').textContent = o.title || '確認';
  $('confirmText').textContent = o.message || ''; $('confirmText').hidden = !o.message;
  $('confirmOk').textContent = o.ok || 'OK';
  $('confirmOk').className = 'btn ' + (o.danger ? 'danger-fill' : 'primary');
  $('confirmModal').hidden = false;
  (o.danger ? $('confirmCancel') : $('confirmOk')).focus();
}
function closeConfirm(yes: boolean): void { const cb = confirmCb; confirmCb = null; $('confirmModal').hidden = true; if (yes && cb) cb(); }

export function init(): void {
  document.addEventListener('focusin', (ev) => { const t = ev.target; if (t instanceof HTMLElement && !t.closest('.modal')) lastFocus = t; });
  const mo = new MutationObserver(syncModals);
  document.querySelectorAll('.modal').forEach((m) => mo.observe(m, { attributes: true, attributeFilter: ['hidden'] }));
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    const open = openModals(), top = open[open.length - 1];
    if (!top) return;
    ev.preventDefault();
    if (top.id === 'confirmModal') closeConfirm(false); else top.hidden = true;
  });
  $('confirmForm').addEventListener('submit', (ev) => { ev.preventDefault(); closeConfirm(true); });
  $('confirmCancel').onclick = () => { closeConfirm(false); };
  const modal = $('confirmModal');
  modal.addEventListener('click', (ev) => { if (ev.target === modal) closeConfirm(false); });   // 窓の外を押したら「やめる」
}
