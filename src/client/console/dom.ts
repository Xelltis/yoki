// 画面の部品を扱う小道具（要素を引く・文字を差し込む・吹き出し・この端末の控え）

/** 入力欄・選ぶ欄・文の欄のどれにも使える要素の型。$() の既定 */
type Field = HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement;

/** id で要素を引く。ページに必ずある要素だけに使う */
export function $<T extends HTMLElement = Field>(id: string): T {
  return document.getElementById(id) as T;
}

/** イベントの起きた要素から、sel に合う祖先（自分を含む）を探す */
export function hit<T extends HTMLElement = HTMLElement>(ev: Event, sel: string): T | null {
  const t = ev.target;
  return t instanceof Element ? (t.closest(sel) as T | null) : null;
}

/** Material Icons の 1 つ。飾りなので読み上げない */
export function mi(name: string, cls?: string): string {
  return '<span class="material-icons' + (cls ? ' ' + cls : '') + '" aria-hidden="true">' + name + '</span>';
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** HTML に差し込む文字を逃がす */
export function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]!);
}

/** 選ぶ欄の中身を入れ替える。前に選んでいた値を返す（呼んだ側で選び直す） */
export function fillSelect(sel: HTMLSelectElement, items: { value: string; text: string }[], first?: string): string {
  const keep = sel.value;
  sel.innerHTML = '';
  if (first) {
    const o0 = document.createElement('option');
    o0.value = '';
    o0.textContent = first;
    sel.appendChild(o0);
  }
  items.forEach((it) => {
    const o = document.createElement('option');
    o.value = it.value;
    o.textContent = it.text;
    sel.appendChild(o);
  });
  return keep;
}

let toastTimer = 0;
/** 画面の下に吹き出しを出す。長い文は長めに出す */
export function toast(t: string): void {
  const el = $('toast');
  el.textContent = t;
  el.className = 'show';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { el.className = ''; }, t && t.length > 40 ? 5000 : 2500);
}

/** この端末に控える（localStorage。使えなければ何もしない） */
export function store(k: string, v: string): void {
  try { localStorage.setItem('taku.' + k, v); } catch { /* 使えない端末 */ }
}
export function load(k: string): string {
  try { return localStorage.getItem('taku.' + k) || ''; } catch { return ''; }
}

export function reducedMotion(): boolean {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
