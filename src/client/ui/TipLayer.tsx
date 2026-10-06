// 吹き出し。項目ごとの説明（data-tipを持つ「？」）と、予定のメモ（data-memoを持つマス）。
// 1つずつの吹き出しを使い回し、置き場所は押した要素のそばに合わせる（画面の外にはみ出さない）
import { useEffect, useRef } from 'react';

const closestOf = <T extends HTMLElement = HTMLElement>(ev: Event, sel: string): T | null => {
  const t = ev.target;
  return t instanceof Element ? (t.closest(sel) as T | null) : null;
};

export function TipLayer() {
  const bubbleRef = useRef<HTMLDivElement>(null), popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bubble = bubbleRef.current!, pop = popRef.current!;
    /* 項目ごとの説明。「？」にマウスを載せるか、押すと出す */
    let cur: HTMLElement | null = null;
    const place = (btn: HTMLElement) => {
      const r = btn.getBoundingClientRect();
      bubble.hidden = false;
      const bw = bubble.offsetWidth, bh = bubble.offsetHeight, gap = 8;
      const left = Math.min(Math.max(8, r.left + r.width / 2 - bw / 2), window.innerWidth - bw - 8);
      const top = r.bottom + gap + bh > window.innerHeight ? r.top - bh - gap : r.bottom + gap;
      bubble.style.left = left + 'px';
      bubble.style.top = Math.max(8, top) + 'px';
    };
    const hide = () => { if (cur) cur.removeAttribute('aria-expanded'); cur = null; bubble.hidden = true; };
    const show = (btn: HTMLElement) => {
      if (cur === btn) return;
      hide();
      cur = btn; bubble.textContent = btn.dataset.tip || ''; btn.setAttribute('aria-expanded', 'true');
      place(btn);
    };
    const onOver = (ev: PointerEvent) => { const b = closestOf(ev, '.tip[data-tip]'); if (b) show(b); else if (cur && !closestOf(ev, '#tipBubble')) hide(); };
    const onFocus = (ev: FocusEvent) => { const b = closestOf(ev, '.tip[data-tip]'); if (b) show(b); else hide(); };
    // 押したときは出すだけ（触って開く端末では、載せたのと同時に押されるため）
    const onClick = (ev: MouseEvent) => { const b = closestOf(ev, '.tip[data-tip]'); if (b) { ev.preventDefault(); show(b); return; } hide(); };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') hide(); };
    /* メモの吹き出し。data-memoを持つ要素にマウスを載せると、そのそばに出る */
    const showMemo = (el: HTMLElement) => {
      pop.textContent = el.dataset.memo || ''; pop.hidden = false;
      const r = el.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
      const left = Math.min(Math.max(4, r.left), window.innerWidth - pw - 4);
      const top = r.bottom + 4 + ph > window.innerHeight ? r.top - ph - 4 : r.bottom + 4;
      pop.style.left = left + 'px'; pop.style.top = Math.max(4, top) + 'px';
    };
    const onMemoOver = (ev: MouseEvent) => { const el = closestOf(ev, '[data-memo]'); if (el && el.dataset.memo) showMemo(el); else pop.hidden = true; };
    const onMemoOut = (ev: MouseEvent) => { const el = closestOf(ev, '[data-memo]'); if (el && !el.contains(ev.relatedTarget as Node | null)) pop.hidden = true; };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mouseover', onMemoOver);
    document.addEventListener('mouseout', onMemoOut);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mouseover', onMemoOver);
      document.removeEventListener('mouseout', onMemoOut);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, []);
  return (
    <>
      <div id="tipBubble" role="tooltip" hidden ref={bubbleRef}
        className="fixed z-[var(--z-toast,90)] max-w-[min(320px,calc(100vw-24px))] rounded-md bg-toast px-12 py-10 text-13 leading-[1.6] text-pretty text-toast-text shadow-pop" />
      <div id="memoPop" hidden ref={popRef}
        className="pointer-events-none fixed z-(--z-pop) max-w-280 whitespace-pre-wrap rounded-sm bg-toast px-10 py-6 text-12 leading-[1.5] text-toast-text shadow-pop" />
    </>
  );
}
