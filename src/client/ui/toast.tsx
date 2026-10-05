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
    <div id="toast" role="status" aria-live="polite" aria-atomic="true" className={
      'pointer-events-none fixed left-1/2 bottom-[calc(24px+env(safe-area-inset-bottom))] z-(--z-toast) w-max max-w-[min(92vw,560px)] rounded-md bg-toast px-16 py-10 text-13 leading-[1.5] text-toast-text tabular-nums shadow-pop '
      + 'transition-[opacity,transform] duration-(--dur) ease-out '
      // スマホでは下のタブの上に出す。カレンダーでは「卓を登録」の丸いボタンの上
      + 'max-sm:bottom-[calc(var(--nav-h)+16px+env(safe-area-inset-bottom))] max-sm:[body[data-tab=cal]_&]:bottom-[calc(var(--nav-h)+88px+env(safe-area-inset-bottom))] '
      // 窓を開いているあいだは、画面の上に出す（下から出る窓のボタンや文に重ならないように）
      + '[html.modal-open_&]:top-[calc(16px+env(safe-area-inset-top))]! [html.modal-open_&]:bottom-auto! '
      + (s.show ? 'opacity-100 [transform:translate(-50%,0)]' : 'opacity-0 [transform:translate(-50%,8px)]')}>
      {s.text}
    </div>
  );
}
