// 募集をやめるとき（開催・調整中にするとき）の確認。興味ありの人を参加者にするか、取り下げるかを GM が決める
import { useState } from 'react';
import type { ConsoleSession } from '../../../../shared/api';
import { Modal } from '../../../ui/Modal';

export type PromoteAsk = { s: ConsoleSession; status: string };

/** 決めたら onDone(参加者にする人) を呼ぶ。やめたら onDone(null) */
export function PromoteModal({ ask, onDone }: { ask: PromoteAsk | null; onDone: (picked: string[] | null) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [seen, setSeen] = useState<PromoteAsk | null>(null);
  // 開くたびに、チェックを外した状態から始める
  if (ask !== seen) { setSeen(ask); setPicked([]); }
  const s = ask?.s;
  const lead = s ? '「' + s.name + '」を「' + ask!.status + '」にします。' + (s.want.length ? '参加希望の ' + s.want.join('、') + ' は参加者に入ります。' : '') +
    '興味ありの人は、参加者にする人だけチェックしてください。チェックしない人は一覧から外れます。' : '';
  return (
    <Modal id="promoteModal" open={!!ask} onClose={() => onDone(null)} backdropClose>
      <div className="box" role="dialog" aria-modal="true" aria-labelledby="promoteTitle" tabIndex={-1}>
        <div className="bar"><h2 id="promoteTitle">興味ありの人はどうしますか？</h2></div>
        <p className="hint" id="promoteLead">{lead}</p>
        <div className="members" id="promoteList">
          {(s ? s.interest : []).map((n) => (
            <label key={n}>
              <input type="checkbox" className="pm" value={n} checked={picked.indexOf(n) >= 0}
                onChange={(ev) => setPicked((p) => (ev.target.checked ? p.concat(n) : p.filter((x) => x !== n)))} />
              {n}
            </label>
          ))}
        </div>
        <div className="btns">
          <button type="button" className="btn small" id="promoteAll" onClick={() => setPicked(s ? s.interest.slice() : [])}>全員を参加者に</button>
          <button type="button" className="btn small" id="promoteNone" onClick={() => setPicked([])}>全員を取り下げ</button>
        </div>
        <div className="form-actions"><div className="btns">
          <button type="button" className="btn primary" id="promoteOk" onClick={() => onDone(picked)}>この内容で進む</button>
          <button type="button" className="btn" id="promoteCancel" onClick={() => onDone(null)}>やめる</button>
        </div></div>
      </div>
    </Modal>
  );
}
