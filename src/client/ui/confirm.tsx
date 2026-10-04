// 確かめる窓（ブラウザの confirm の代わり。見た目と言葉をアプリにそろえるため）。askConfirm でどこからでも開ける
import { useLayoutEffect, useRef } from 'react';
import { Modal } from './Modal';
import { createStore, useStore } from './store';

export type ConfirmOptions = {
  title?: string;
  message?: string;
  /** 進むボタンの名前 */
  ok?: string;
  /** 消す・止めるなど戻しにくい操作なら true（やめるボタンにフォーカスを置く） */
  danger?: boolean;
};

const confirmStore = createStore<{ open: boolean; o: ConfirmOptions; yes: (() => void) | null; n: number }>({ open: false, o: {}, yes: null, n: 0 });

/** 確かめる窓を開く。進むを押したら yes() を呼ぶ */
export function askConfirm(o: ConfirmOptions, yes: () => void): void {
  confirmStore.set((s) => ({ open: true, o, yes, n: s.n + 1 }));
}

export function ConfirmDialog() {
  const { open, o, yes, n } = useStore(confirmStore);
  const okRef = useRef<HTMLButtonElement>(null), cancelRef = useRef<HTMLButtonElement>(null);
  // 開いたら、戻しにくい操作ならやめるに、そうでなければ進むにフォーカスを置く
  useLayoutEffect(() => { if (open) (o.danger ? cancelRef : okRef).current?.focus(); }, [open, o, n]);
  const close = (go: boolean) => {
    confirmStore.set((s) => ({ ...s, open: false, yes: null }));
    if (go && yes) yes();
  };
  return (
    <Modal id="confirmModal" open={open} onClose={() => close(false)} backdropClose>
      <form className="box confirm" id="confirmForm" role="alertdialog" aria-modal="true" aria-labelledby="confirmTitle" aria-describedby="confirmText" tabIndex={-1}
        onSubmit={(ev) => { ev.preventDefault(); close(true); }}>
        <h3 id="confirmTitle">{o.title || '確認'}</h3>
        <p id="confirmText" hidden={!o.message}>{o.message || ''}</p>
        <div className="btns">
          <button type="button" className="btn" id="confirmCancel" ref={cancelRef} onClick={() => close(false)}>やめる</button>
          <button type="submit" className={'btn ' + (o.danger ? 'danger-fill' : 'primary')} id="confirmOk" ref={okRef}>{o.ok || 'OK'}</button>
        </div>
      </form>
    </Modal>
  );
}
