// 窓（.modal）と、窓の共通の振る舞い（ModalManager）。
// 開いているあいだは後ろ（header・main・下にある窓）を inert にして触れなくし、ページのスクロールを止める。
// 閉じたら、開く前にフォーカスがあった場所へ戻す。Esc はいちばん手前の窓だけを閉じる。
// 窓は描いたまま hidden で開け閉めする（ID と hidden の形は、e2e とスクリーンショットの道具が使う）。
// 窓は body の直下に描く（タブの中の部品から開いても、後ろの main ごと触れなくならないように）
import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** 窓の要素 → 閉じる関数（Esc で閉じるとき） */
const closers = new WeakMap<HTMLElement, () => void>();

/**
 * 窓を置く場所。ふつうの窓の層と、その上の層（確かめる窓）の 2 つを、この順で body に置く。
 * 重なりの手前は、置いた順で決まる（ModalManager も、後ろにある窓ほど手前とみる）
 */
function layer(top: boolean): HTMLElement {
  const make = (id: string) => {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('div'); el.id = id; document.body.appendChild(el); }
    return el;
  };
  const base = make('modalLayer'), over = make('modalLayerTop');
  return top ? over : base;
}

export function Modal({ id, open, onClose, backdropClose, top, children }: {
  id: string;
  open: boolean;
  onClose: () => void;
  /** 窓の外を押したら閉じる */
  backdropClose?: boolean;
  /** ほかの窓より手前に出す（確かめる窓） */
  top?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (ref.current) closers.set(ref.current, onClose); });
  return createPortal(
    // 窓の外を押したら閉じる（キーボードでは Esc。ModalManager）
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="modal" id={id} hidden={!open} ref={ref} onClick={backdropClose ? (ev) => { if (ev.target === ref.current) onClose(); } : undefined}>
      {children}
    </div>,
    layer(!!top),
  );
}

function openModals(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.modal')).filter((m) => !m.hidden);
}

/** 窓の共通の振る舞い。画面に 1 つだけ置く */
export function ModalManager() {
  useEffect(() => {
    let lastFocus: HTMLElement | null = null;
    const sync = () => {
      const open = openModals(), top = open[open.length - 1] || null;
      [document.querySelector('header'), document.querySelector('main')].forEach((el) => { if (!el) return; if (top) el.setAttribute('inert', ''); else el.removeAttribute('inert'); });
      open.forEach((m) => { if (m === top) m.removeAttribute('inert'); else m.setAttribute('inert', ''); });
      document.documentElement.classList.toggle('modal-open', !!top);
      if (top && !top.contains(document.activeElement)) top.querySelector<HTMLElement>('.box')?.focus({ preventScroll: true });
      if (!top && lastFocus && document.contains(lastFocus) && !lastFocus.closest('[hidden], [inert]')) { try { lastFocus.focus({ preventScroll: true }); } catch { /* 消えた要素 */ } }
    };
    const onFocus = (ev: FocusEvent) => { const t = ev.target; if (t instanceof HTMLElement && !t.closest('.modal')) lastFocus = t; };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      const open = openModals(), top = open[open.length - 1];
      if (!top) return;
      ev.preventDefault();
      closers.get(top)?.();
    };
    // 窓の hidden が変わったとき・窓が描かれたときに、後ろを触れなくするかを決め直す
    const mo = new MutationObserver((records) => { if (records.some((r) => r.type === 'childList' || (r.target as Element).classList?.contains('modal'))) sync(); });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('focusin', onFocus);
    document.addEventListener('keydown', onKey);
    return () => { mo.disconnect(); document.removeEventListener('focusin', onFocus); document.removeEventListener('keydown', onKey); };
  }, []);
  return null;
}
