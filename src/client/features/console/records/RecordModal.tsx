// 卓の記録の窓。GMと管理者はログ（リプレイ）のURLと振り返り、参加者は自分のPCの名前と結果を書く
import { useState } from 'react';
import { RECORD_MAX, PREP_MAX, type RpcResult } from '../../../../shared/api';
import { Icon } from '../../../ui/Icon';
import { Modal } from '../../../ui/Modal';
import { formActions } from '../../../ui/modalParts';
import { useStore } from '../../../ui/store';
import { toast } from '../../../ui/toast';
import { useConsole, useData } from '../context';
import { fmtJa } from '../model/dates';
import { byId, me } from '../model/model';
import { isGm } from '../../../../shared/gm';

/** 結果の候補（自由に書いてもよい） */
const OUTCOMES = ['生還', 'ロスト', '継続', '死亡', '発狂'];

export function RecordModal() {
  const d = useData();
  const { ui, sync } = useConsole();
  const { record: req } = useStore(ui);
  const [st, setSt] = useState({ seq: 0, logUrl: '', recap: '', pc: '', outcome: '', busy: false, msg: '' });
  const s = req ? byId(d, req.id) : null, mine = me(d);
  // 開く頼みが来たら、いまの記録と自分のPCから始める
  if (req && req.seq !== st.seq) {
    const sh = s ? s.prep.sheets[mine] : undefined;
    setSt({ seq: req.seq, logUrl: s ? s.record.logUrl : '', recap: s ? s.record.recap : '', pc: sh ? sh.pc : '', outcome: sh ? sh.outcome : '', busy: false, msg: '' });
  }
  const close = () => ui.set((x) => ({ ...x, record: null }));
  const canRecord = !!s && (isGm(s, mine) || d.isAdmin), isPl = !!s && s.members.indexOf(mine) >= 0;
  const run = (fn: 'saveRecord' | 'setPcRecord', form: object) => {
    setSt((x) => ({ ...x, busy: true, msg: '保存しています…' }));
    sync.write<RpcResult>(fn, form).then((r) => { setSt((x) => ({ ...x, busy: false, msg: r.message })); toast(r.message); }, (e: Error) => setSt((x) => ({ ...x, busy: false, msg: e.message })));
  };
  return (
    <Modal id="recordModal" open={!!req && !!s} onClose={close}>
      <div className="box" role="dialog" aria-modal="true" aria-labelledby="recordTitle" tabIndex={-1}>
        <h3 id="recordTitle">{s ? fmtJa(s.date) + '　「' + s.name + '」の記録' : '卓の記録'}</h3>
        {canRecord && (
          <form className="mt-8" id="recordForm" onSubmit={(ev) => { ev.preventDefault(); if (s) run('saveRecord', { id: s.id, logUrl: st.logUrl, recap: st.recap }); }}>
            <label htmlFor="recordLog">ログ・リプレイのURL <small>任意</small></label>
            <input type="url" id="recordLog" maxLength={RECORD_MAX.url} placeholder="https://" value={st.logUrl} onChange={(ev) => setSt((x) => ({ ...x, logUrl: ev.target.value }))} />
            <label htmlFor="recordRecap">振り返り <small>{RECORD_MAX.recap + '文字まで。グループのみんなに見えます'}</small></label>
            <textarea id="recordRecap" maxLength={RECORD_MAX.recap} value={st.recap} onChange={(ev) => setSt((x) => ({ ...x, recap: ev.target.value }))} />
            <div className="btns"><button type="submit" className="btn primary" id="recordSave" disabled={st.busy}>記録を保存</button></div>
          </form>
        )}
        {isPl && (
          <form className="mt-14 border-t border-line pt-12" id="pcForm" onSubmit={(ev) => { ev.preventDefault(); if (s) run('setPcRecord', { id: s.id, name: mine, pc: st.pc, outcome: st.outcome }); }}>
            <p className="m-0 font-semibold">{mine + 'のPC'}</p>
            <div className="row">
              <div><label htmlFor="pcName">PCの名前</label><input type="text" id="pcName" maxLength={PREP_MAX.pc} value={st.pc} onChange={(ev) => setSt((x) => ({ ...x, pc: ev.target.value }))} /></div>
              <div className="narrow"><label htmlFor="pcOutcome">結果</label><input type="text" id="pcOutcome" list="outcomeList" maxLength={RECORD_MAX.outcome} value={st.outcome} onChange={(ev) => setSt((x) => ({ ...x, outcome: ev.target.value }))} /></div>
            </div>
            {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label */}
            <datalist id="outcomeList">{OUTCOMES.map((o) => <option key={o} value={o} />)}</datalist>
            <div className="btns"><button type="submit" className="btn primary" id="pcSave" disabled={st.busy}>PCを保存</button></div>
          </form>
        )}
        <div className={formActions}>
          <div className="btns mt-0">
            <span className="hint mr-auto" id="recordMsg">{st.msg}</span>
            <button type="button" className="btn" id="recordClose" onClick={close}><Icon name="close" size="sm" />閉じる</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
