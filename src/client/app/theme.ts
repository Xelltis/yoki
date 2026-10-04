// この端末だけの見た目（ライト・ダークと文字の大きさ）。描く前の決め方は index.html の小さなスクリプト
import { createStore } from '../ui/store';
import { store } from './storage';

/** 見た目を変えたら進める（上の帯のボタンと設定の選ぶ欄を描き直す） */
export const themeStore = createStore(0);

export function currentTheme(): 'light' | 'dark' {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark' || t === 'light') return t;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
/** 選んでいる見た目。'light' か 'dark'、選んでいなければ空（端末の設定に合わせる） */
export function chosenTheme(): '' | 'light' | 'dark' {
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'dark' || t === 'light' ? t : '';
}
/** t は 'light' か 'dark'。空なら端末の設定に合わせる */
export function setTheme(t: string): void {
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
  store('theme', t || '');
  themeStore.set((n) => n + 1);
}
/** 文字サイズ。画面全体を拡げる（'m' 中・'l' 大。空なら小） */
export function setFont(v: string): void {
  const el = document.documentElement;
  if (v === 'm' || v === 'l') { el.setAttribute('data-font', v); el.style.setProperty('--zoom', v === 'l' ? '1.25' : '1.12'); } else { el.removeAttribute('data-font'); el.style.removeProperty('--zoom'); }
  store('font', v);
  themeStore.set((n) => n + 1);
}
/** 端末の設定（ライト／ダーク）が変わったら、ボタンを描き直す */
export function watchSystemTheme(): () => void {
  if (!window.matchMedia) return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const f = () => themeStore.set((n) => n + 1);
  mq.addEventListener('change', f);
  return () => mq.removeEventListener('change', f);
}
