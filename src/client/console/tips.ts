// 吹き出し。項目ごとの説明（data-tip を持つ「？」）と、予定のメモ（data-memo を持つマス）
import { $, hit } from './dom';

/* 項目ごとの説明。「？」にマウスを載せるか、押すと出す。1 つの吹き出しを使い回す */
function initTips(): void {
  const bubble = $('tipBubble');
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
  const hide = () => {
    if (cur) cur.removeAttribute('aria-expanded');
    cur = null; bubble.hidden = true;
  };
  const show = (btn: HTMLElement) => {
    if (cur === btn) return;
    hide();
    cur = btn; bubble.textContent = btn.dataset.tip || ''; btn.setAttribute('aria-expanded', 'true');
    place(btn);
  };
  document.addEventListener('pointerover', (ev) => {
    const b = hit(ev, '.tip[data-tip]');
    if (b) show(b); else if (cur && !hit(ev, '#tipBubble')) hide();
  });
  document.addEventListener('focusin', (ev) => {
    const b = hit(ev, '.tip[data-tip]');
    if (b) show(b); else hide();
  });
  document.addEventListener('click', (ev) => {
    const b = hit(ev, '.tip[data-tip]');
    if (b) { ev.preventDefault(); show(b); return; }   // 押したときは出すだけ（触って開く端末では、載せたのと同時に押されるため）
    hide();
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
}

/* メモの吹き出し。data-memo を持つ要素にマウスを載せると、そのそばに出る。タップは吹き出し（toast）で全文 */
function showMemoPop(el: HTMLElement): void {
  const pop = $('memoPop');
  pop.textContent = el.dataset.memo || ''; pop.hidden = false;
  const r = el.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  const left = Math.min(Math.max(4, r.left), window.innerWidth - pw - 4);
  const top = r.bottom + 4 + ph > window.innerHeight ? r.top - ph - 4 : r.bottom + 4;
  pop.style.left = left + 'px'; pop.style.top = Math.max(4, top) + 'px';
}
function hideMemoPop(): void { $('memoPop').hidden = true; }
function initMemoPop(): void {
  document.addEventListener('mouseover', (ev) => { const el = hit(ev, '[data-memo]'); if (el && el.dataset.memo) showMemoPop(el); else hideMemoPop(); });
  document.addEventListener('mouseout', (ev) => { const el = hit(ev, '[data-memo]'); if (el && !el.contains(ev.relatedTarget as Node | null)) hideMemoPop(); });
}

export function init(): void {
  initTips();
  initMemoPop();
}
