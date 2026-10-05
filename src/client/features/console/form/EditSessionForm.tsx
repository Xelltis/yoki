// 卓の変更の窓の中身。どの卓を変えているかを題に出し、状態を変えたらその状態の説明を出す。
// 続きの登録（翌日の卓を登録の窓で開く）と、削除もここから
import { useState } from 'react';
import { askConfirm } from '../../../ui/confirm';
import { Icon } from '../../../ui/Icon';
import { formActions, wideBar, wideBarTitle } from '../../../ui/modalParts';
import { openForm } from '../actions';
import { type FormReq, useConsole, useData } from '../context';
import { byId, hasPoll, isRecruit, STATUS_PROMOTE } from '../model/model';
import { checkForm, collect, conflictText, type Fields, fieldsOf, FLOW, type Msg, patchFields } from './model';
import { ConflictWarn, DateRow, FormMsg, NameRow, NotifyCheck, PeopleFields, PlaceMemo, SeriesRow, WindowRow } from './parts';
import { type PromoteAsk, PromoteModal } from './PromoteModal';
import { useSessionSave } from './save';

export function EditSessionForm({ req, onClose, reopen }: { req: FormReq; onClose: () => void; reopen: () => void }) {
  const d = useData();
  const { ui } = useConsole();
  // 「開催にする」などから開いたときは、状態を変えた形から始める
  const [init] = useState(() => { const f0 = fieldsOf(d, byId(d, req.id || '')); return req.status ? patchFields(d, f0, { status: req.status }) : f0; });
  const [f, setF] = useState(init);
  const [msg, setMsg] = useState<Msg>(null);
  const [promote, setPromote] = useState<PromoteAsk | null>(null);
  const { save, remove, needsPromote } = useSessionSave();
  const set = (patch: Partial<Fields>) => setF((cur) => patchFields(d, cur, patch));
  const s = byId(d, f.id);
  const st = f.status, noDate = st === '募集' || st === '調整中';
  const changed = !!s && s.status !== st && FLOW[st];
  const conflict = conflictText(d, collect(d, f, ''));
  const wantInfo = s && isRecruit(s) && (s.want.length || s.interest.length)
    ? { text: '参加希望: ' + (s.want.length ? s.want.join('、') : 'なし') + '　／　興味あり: ' + (s.interest.length ? s.interest.join('、') : 'なし'), promote: STATUS_PROMOTE.indexOf(st) >= 0 && s.want.length > 0 }
    : null;
  const pollNext = st === '調整中' && !(s && hasPoll(s));
  const fail = (m: string) => { reopen(); setMsg({ text: m, cls: 'err' }); };

  const submit = (promoted: string[] | null) => {
    const form = collect(d, f, '');
    const err = checkForm(form);
    if (err) { setMsg({ text: err, cls: 'err' }); return; }
    // 募集から開催・調整中に移すとき、興味ありの人がいれば先に確かめる
    const prev = promoted ? null : needsPromote(form);
    if (prev) { setPromote({ s: prev, status: form.status }); return; }
    setMsg(null);
    save(form, promoted, fail);
  };
  /** 続きの登録に移る。変えた内容があれば、保存しないことを確かめる */
  const goContinue = () => {
    const go = () => openForm(ui, { cont: f.id });
    if (JSON.stringify(f) === JSON.stringify(init)) go();
    else askConfirm({ title: '変更を保存していません', message: 'この窓で変えた内容は保存されません。続きの登録に移りますか？', ok: '続きの登録に移る' }, go);
  };

  return (
    <>
      <div className={wideBar}>
        <h2 className={wideBarTitle} id="formTitle">{s ? '「' + s.name + '」を変更' : '卓を変更'}</h2>
        <button type="button" className="btn small ml-auto" id="formClose" onClick={onClose}><Icon name="close" size="sm" />閉じる</button>
      </div>
      <form id="f" onSubmit={(ev) => { ev.preventDefault(); submit(null); }}>
        {!s && <p className="hint mt-14 text-err-text" id="goneNote">この卓は見つかりません。ほかの人が消したかもしれません。窓を閉じてください。</p>}
        <NameRow f={f} set={set}>
          <div className="narrow"><label htmlFor="status">状態</label>
            <select id="status" value={st} onChange={(ev) => set({ status: ev.target.value })}>
              {d.statuses.map((x) => <option value={x} key={x}>{x}</option>)}
            </select>
          </div>
        </NameRow>
        {/* 状態を変えたときだけ、その状態の説明を出す */}
        <div id="statusNote" className="mt-10 flex items-start gap-8 rounded-md border border-accent-line bg-accent-soft px-12 py-8 text-13 leading-[1.6] text-fg" aria-live="polite" hidden={!changed}>
          {changed && (
            <>
              <Icon name={FLOW[st]!.icon} size="sm" className="mt-2 text-accent-text" />
              <span>{'「' + s.status + '」から「' + st + '」にします（' + FLOW[st]!.lead + '）。' + (pollNext ? '保存すると、候補日を選ぶ窓が開きます。' : '')}</span>
            </>
          )}
        </div>
        <SeriesRow f={f} set={set} hint="何日かに分けて開く卓の名前" />
        {noDate ? <WindowRow f={f} set={set} /> : <><DateRow f={f} set={set} /><ConflictWarn text={conflict} /></>}
        <PeopleFields f={f} set={set} />
        <div className="mt-12 rounded-md bg-soon px-12 py-8 text-13" id="wantInfo" hidden={!wantInfo}>{wantInfo && <>{wantInfo.text}{wantInfo.promote && <><br />{'状態を「' + st + '」にして保存すると、参加希望の人が参加者に加わります。'}</>}</>}</div>
        <PlaceMemo f={f} set={set} />
        <NotifyCheck f={f} set={set} label="Discord に知らせる" />
        <div className={formActions}>
          <div className="btns mt-0">
            <button type="submit" className="btn primary" id="save" disabled={!s}>{pollNext ? '保存して候補日を選ぶ' : '保存'}</button>
            <button type="button" className="btn" id="cont" hidden={!s || !s.date} title="GM・参加者・時間・場所を引き継いで、翌日の卓を新しく登録する" onClick={goContinue}>続きを登録</button>
            <button type="button" className="btn danger" id="del" disabled={!s} onClick={() => remove(collect(d, f, ''), fail)}>この卓を削除</button>
          </div>
          <FormMsg msg={msg} />
        </div>
      </form>
      <PromoteModal ask={promote} onDone={(picked) => { setPromote(null); if (picked) submit(picked); }} />
    </>
  );
}
