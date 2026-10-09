// メンバーの予定の「いつもの予定」。曜日ごとに △ か × を決めておくと、予定表の印の無い日と、これから予定表に入る日に入る（サーバーのsetWeekly）
import { useState } from 'react';
import type { RpcResult } from '../../../../shared/api';
import { toast } from '../../../ui/toast';
import { useConsole, useData } from '../context';
import { WD } from '../model/dates';
import { me } from '../model/model';

/** 並べる曜日（月曜から） */
const DAYS = [1, 2, 3, 4, 5, 6, 0];

export function WeeklyCard({ hidden }: { hidden: boolean }) {
  const d = useData();
  const { sync } = useConsole();
  const mine = me(d);
  /** 書きかけ（保存するまで、読み直しても上書きしない） */
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [st, setSt] = useState({ busy: false, msg: '' });
  const cur = draft ?? d.me.weekly;
  const save = (weekly: Record<string, string>) => {
    setSt({ busy: true, msg: '保存しています…' });
    sync.write<RpcResult>('setWeekly', { name: mine, weekly }).then(
      (r) => { setDraft(null); setSt({ busy: false, msg: r.message }); toast(r.message); },
      (e: Error) => { setSt({ busy: false, msg: e.message }); toast(e.message); },
    );
  };
  return (
    <div className="card" id="availWeekly" hidden={hidden}>
      <h3>いつもの予定（曜日ごと）</h3>
      <p className="hint">毎週決まって都合の悪い曜日を決めておくと、予定表の印の無い日に入り、これから予定表に入る日にも毎日入ります。入った印は、ふだんの印と同じく1日ずつ直せます。卓のある日には入りません。</p>
      <div className="flex flex-wrap gap-8" id="wkDays">
        {DAYS.map((k) => (
          <label className="m-0 flex flex-col items-center gap-2 text-12 font-semibold" key={k}>
            <span className={k === 0 ? 'text-sun' : k === 6 ? 'text-sat' : ''}>{WD[k]}</span>
            <select className="w-auto" id={'wk' + k} value={cur[String(k)] ?? ''} onChange={(ev) => {
              const next = { ...cur };
              if (ev.target.value) next[String(k)] = ev.target.value; else delete next[String(k)];
              setDraft(next);
            }}>
              <option value="">空欄</option><option value="△">△</option><option value="×">×</option>
            </select>
          </label>
        ))}
      </div>
      <div className="btns mt-14 border-t border-line pt-12">
        <button type="button" className="btn primary" id="wkSave" disabled={st.busy || !draft} onClick={() => save(cur)}>いつもの予定を保存</button>
        {Object.keys(d.me.weekly).length > 0 && <button type="button" className="btn" id="wkClear" disabled={st.busy} onClick={() => save({})}>止める</button>}
        <span className="hint" id="wkMsg">{st.msg}</span>
      </div>
    </div>
  );
}
