// この端末だけの見た目（ライト・ダークと文字の大きさ）
import { $, mi, store } from './dom';

function currentTheme(): 'light' | 'dark' {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark' || t === 'light') return t;
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
function applyThemeButton(): void {
  const dark = currentTheme() === 'dark', t = document.documentElement.getAttribute('data-theme');
  $('theme').innerHTML = mi(dark ? 'light_mode' : 'dark_mode', 'sm');
  $('theme').setAttribute('aria-label', dark ? 'ライトに切り替える' : 'ダークに切り替える');
  $('stTheme').value = t === 'dark' || t === 'light' ? t : '';
}
/** t は 'light' か 'dark'。空なら端末の設定に合わせる */
export function setTheme(t: string): void {
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
  store('theme', t || '');
  applyThemeButton();
}
/** 文字サイズ。画面全体を拡げる（'m' 中・'l' 大。空なら小） */
export function setFont(v: string): void {
  const el = document.documentElement;
  if (v === 'm' || v === 'l') { el.setAttribute('data-font', v); el.style.setProperty('--zoom', v === 'l' ? '1.25' : '1.12'); } else { el.removeAttribute('data-font'); el.style.removeProperty('--zoom'); }
  store('font', v);
}

export function init(): void {
  $('theme').onclick = () => { setTheme(currentTheme() === 'dark' ? 'light' : 'dark'); };
  if (window.matchMedia) { const darkMq = window.matchMedia('(prefers-color-scheme: dark)'); if (darkMq.addEventListener) darkMq.addEventListener('change', applyThemeButton); }
  applyThemeButton();
}
