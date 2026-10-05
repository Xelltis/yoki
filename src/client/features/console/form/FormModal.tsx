// 卓の登録の窓と変更の窓。開く頼みに変える卓（id）があれば変更の窓、無ければ登録の窓（cont は続きの登録）。
// 頼みの通し番号ごとに中身を作り直す。閉じても中身は残し、保存に失敗したら同じ番号で開き直して入力を戻す
import { useLayoutEffect, useRef, useState } from 'react';
import { Modal } from '../../../ui/Modal';
import { useStore } from '../../../ui/store';
import { type FormReq, useConsole } from '../context';
import { EditSessionForm } from './EditSessionForm';
import { NewSessionForm } from './NewSessionForm';

export function FormModal() {
  const { ui } = useConsole();
  const { form: req } = useStore(ui);
  const [cur, setCur] = useState<{ seq: number; req: FormReq } | null>(null);
  const shown = req && req.seq !== cur?.seq ? req : cur;
  if (shown !== cur) setCur(shown);
  const boxRef = useRef<HTMLDivElement>(null);
  // 開いたら、窓の先頭から見せて、卓の名前（頼みによっては開催日）に入る
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!req || !box) return;
    box.scrollTop = 0;
    box.querySelector<HTMLElement>(req.req.focus === 'date' ? '#date' : '#name')?.focus();
  }, [req]);
  const close = () => ui.set((st) => ({ ...st, form: null }));
  // ほかの窓を開いていなければ、同じ頼みで開き直す（中身はそのまま）
  const reopen = (c: { seq: number; req: FormReq }) => ui.set((st) => (st.form ? st : { ...st, form: c }));
  return (
    <Modal id="formModal" open={!!req} onClose={close}>
      <div className="box wide" role="dialog" aria-modal="true" aria-labelledby="formTitle" tabIndex={-1} ref={boxRef}>
        {shown && (shown.req.id
          ? <EditSessionForm key={shown.seq} req={shown.req} onClose={close} reopen={() => reopen(shown)} />
          : <NewSessionForm key={shown.seq} req={shown.req} onClose={close} reopen={() => reopen(shown)} />)}
      </div>
    </Modal>
  );
}
