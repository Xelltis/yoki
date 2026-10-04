// 画面の下の吹き出し（知らせ）。toast(文) でどこからでも出せる。長い文は長めに出す
import { createStore, useStore } from './store';

const toastStore = createStore({ text: '', show: false });
let timer = 0;

export function toast(text: string): void {
  clearTimeout(timer);
  toastStore.set({ text, show: true });
  timer = window.setTimeout(() => { toastStore.set((s) => ({ ...s, show: false })); }, text && text.length > 40 ? 5000 : 2500);
}

export function Toast() {
  const s = useStore(toastStore);
  return (
    <div id="toast" role="status" aria-live="polite" aria-atomic="true" className={s.show ? 'show' : ''}>
      {s.text}
    </div>
  );
}
