// 卓の登録の窓の中身。どんな卓か（開催・募集・調整中）を札で選ぶと、その進め方が出る。
// シリーズを選ぶと直前の回から引き継ぐ。開催の卓は、何日分かをまとめて登録できる
import { useRef, useState } from 'react';
import { type ConsoleData, SESSION_DATES_MAX } from '../../../../shared/api';
import { Icon } from '../../../ui/Icon';
import { formActions, wideBar, wideBarTitle } from '../../../ui/modalParts';
import { type FormReq, useData } from '../context';
import { fmtJa } from '../model/dates';
import { byId } from '../model/model';
import { canNotify, checkForm, collect, conflictText, continueFrom, type Fields, fieldsOf, FLOW, inheritSeries, KINDS, type Msg, passWarnText, patchFields, type Repeat, repeatDates, REPEATS } from './model';
import { ConflictWarn, DateRow, FormMsg, NameRow, NotifyCheck, PeopleFields, PlaceMemo, RecruitRow, ScenarioRow, SeriesRow, WindowRow } from './parts';
import { useSessionSave } from './save';

/** 開く頼みから、初めの入力を作る（続きの登録・日・状態・シリーズ） */
function initial(d: ConsoleData, req: FormReq): { f: Fields; seriesFrom: string; msg: Msg } {
  const src = req.cont ? byId(d, req.cont) : null;
  let f = fieldsOf(d, null), seriesFrom = '', msg: Msg = null;
  if (src) {
    const c = continueFrom(d, src);
    f = c.f; seriesFrom = c.seriesFrom; msg = { text: c.msg, cls: 'ok' };
  } else {
    if (req.status) f = { ...f, status: req.status };
    if (req.date) f = { ...f, date: req.date };
    // シナリオのタブの「この日で卓を立てる」から開いたとき
    if (req.scenarioId) f = { ...f, scenarioId: req.scenarioId, name: d.scenarios.find((x) => x.id === req.scenarioId)?.name ?? '' };
    if (req.gm) f = { ...f, gm: req.gm };
    if (req.series) {
      f = { ...f, series: req.series };
      const r = inheritSeries(d, f, req.series);
      if (r) { f = r.f; msg = { text: r.msg, cls: 'ok' }; }
    }
  }
  // 登録の窓で選べるのは、開催・募集・調整中だけ
  if (!KINDS.some((k) => k.status === f.status)) f = { ...f, status: '開催' };
  f.notify = canNotify(d, f) && !!d.notifyDefault;
  return { f, seriesFrom, msg };
}

/** どんな卓かの札。選ぶと青く縁取る。狭い画面では短い説明を省く（下の進め方に出る） */
const kindCard = 'm-0 flex cursor-pointer items-center gap-10 rounded-md border border-line-strong bg-card px-12 py-10 text-13 font-normal text-fg '
  + 'transition-[background-color,border-color] duration-(--dur-fast) hover:bg-hover '
  + 'has-checked:border-accent has-checked:bg-accent-soft has-checked:shadow-[inset_0_0_0_1px_var(--accent)] '
  + 'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent '
  + 'max-sm:justify-center max-sm:gap-6 max-sm:px-8';

export function NewSessionForm({ req, onClose, reopen }: { req: FormReq; onClose: () => void; reopen: () => void }) {
  const d = useData();
  const [init] = useState(() => initial(d, req));
  const [f, setF] = useState(init.f);
  const [msg, setMsg] = useState<Msg>(init.msg);
  const keyRef = useRef(0);
  const { save } = useSessionSave();
  const set = (patch: Partial<Fields>) => setF((cur) => patchFields(d, cur, patch));
  const st = f.status, dated = st === '開催', flow = FLOW[st]!;
  const conflict = conflictText(d, collect(d, f, init.seriesFrom)), passWarn = passWarnText(d, collect(d, f, init.seriesFrom));
  const nDates = new Set([f.date].concat(f.more.map((x) => x.v)).filter(Boolean)).size;
  /** くり返しで足す（開催日から、決まりで続きの日を足す） */
  const [rep, setRep] = useState<{ open: boolean; rule: Repeat; count: number }>({ open: false, rule: 'week', count: 3 });
  const addRepeat = () => {
    if (!f.date) { setMsg({ text: '先に開催日を入れてください。くり返しは開催日から数えます。', cls: 'err' }); return; }
    const have = new Set([f.date].concat(f.more.map((x) => x.v)).filter(Boolean));
    const add = repeatDates(f.date, rep.rule, rep.count).filter((k) => !have.has(k)).slice(0, Math.max(0, SESSION_DATES_MAX - have.size));
    if (!add.length) { setMsg({ text: 'まとめて登録できるのは' + SESSION_DATES_MAX + '日分までです。', cls: 'err' }); return; }
    // 空の欄は詰めて、足した日を後ろに並べる
    set({ more: f.more.filter((x) => x.v).concat(add.map((v) => ({ key: ++keyRef.current, v }))) });
    setMsg({ text: add.length + '日を足しました（' + add.map(fmtJa).join('、') + '）。名前と日付を確かめてください。', cls: 'ok' });
    setRep((r) => ({ ...r, open: false }));
  };
  const submit = () => {
    const form = collect(d, f, init.seriesFrom);
    const err = checkForm(form);
    if (err) { setMsg({ text: err, cls: 'err' }); return; }
    setMsg(null);
    save(form, null, (m) => { reopen(); setMsg({ text: m, cls: 'err' }); });
  };
  return (
    <>
      <div className={wideBar}>
        <h2 className={wideBarTitle} id="formTitle">卓を登録</h2>
        <button type="button" className="btn small ml-auto" id="formClose" onClick={onClose}><Icon name="close" size="sm" />閉じる</button>
      </div>
      <form id="f" onSubmit={(ev) => { ev.preventDefault(); submit(); }}>
        <p className="mt-14 mb-6 text-13 font-semibold" id="statusLbl">どんな卓ですか</p>
        <div className="grid grid-cols-3 gap-8" id="status" role="radiogroup" aria-labelledby="statusLbl">
          {KINDS.map((k) => (
            <label className={kindCard} key={k.status}>
              <input type="radio" name="status" value={k.status} className="sr-only" checked={st === k.status}
                onChange={() => set({ status: k.status, ...(k.status === '開催' ? {} : { more: [] }) })} />
              <Icon name={FLOW[k.status]!.icon} className="text-accent-text" />
              <span><b className="block text-14">{k.status}</b><span className="block text-12 leading-[1.5] text-muted max-sm:hidden">{k.label}</span></span>
            </label>
          ))}
        </div>
        {/* 選んだ状態の進め方 */}
        <div id="flowGuide" className="mt-8 rounded-lg border border-accent-line bg-accent-soft px-14 py-10" aria-live="polite">
          <p className="m-0 text-13 font-semibold text-fg">{'「' + st + '」は、' + flow.lead + '。この順で進めます'}</p>
          <ol className="mt-8 mb-0 grid list-none gap-4 p-0">
            {flow.steps.map((t, i) => (
              <li className="grid grid-cols-[22px_minmax(0,1fr)] items-start gap-8 text-13 leading-[1.6] text-pretty text-fg" key={i}>
                <span className="mt-1 inline-flex h-22 w-22 items-center justify-center rounded-[50%] border border-line-strong bg-card text-12 font-bold text-muted">{i + 1}</span>
                <div>{t}</div>
              </li>
            ))}
          </ol>
        </div>
        <NameRow f={f} set={set} />
        <ScenarioRow f={f} set={set} />
        <SeriesRow f={f} set={set} hint="何日かに分けて開く卓の名前。選ぶと直前の回の内容を引き継ぎます"
          onPick={(name) => { const r = inheritSeries(d, f, name); if (r) { setF(r.f); setMsg({ text: r.msg, cls: 'ok' }); } }} />
        {dated ? (
          <>
            <DateRow f={f} set={set} />
            <ConflictWarn text={conflict} />
            <div className="mt-8" id="moreDatesWrap">
              <div id="moreDates">
                {f.more.map((x) => (
                  <div className="mt-6 flex items-center gap-6" key={x.key}>
                    <input type="date" className="xdate max-w-200" aria-label="まとめて登録する日" value={x.v} onChange={(ev) => set({ more: f.more.map((y) => (y.key === x.key ? { ...y, v: ev.target.value } : y)) })} />
                    <button type="button" className="btn small xdel" title="この日を外す" onClick={() => set({ more: f.more.filter((y) => y.key !== x.key) })}>×</button>
                  </div>
                ))}
              </div>
              <div className="btns mt-6 justify-start gap-6">
                <button type="button" className="btn small" id="addDate" onClick={() => set({ more: f.more.concat({ key: ++keyRef.current, v: '' }) })}><Icon name="add" size="sm" />日を足す（何日かまとめて登録）</button>
                <button type="button" className="btn small" id="repeatOpen" aria-expanded={rep.open} onClick={() => setRep((r) => ({ ...r, open: !r.open }))}><Icon name="event_repeat" size="sm" />くり返しで足す</button>
              </div>
              {rep.open && (
                <div className="mt-8 flex flex-wrap items-center gap-8 rounded-md border border-line bg-head px-12 py-10 text-13" id="repeatBox">
                  <span>{f.date ? fmtJa(f.date) + 'から' : '開催日から'}</span>
                  <select id="repeatRule" aria-label="くり返し方" className="w-auto" value={rep.rule} onChange={(ev) => setRep((r) => ({ ...r, rule: ev.target.value as Repeat }))}>
                    {REPEATS.map((x) => <option value={x.v} key={x.v}>{x.label}</option>)}
                  </select>
                  <span>あと</span>
                  <input type="number" id="repeatCount" aria-label="足す回数" className="w-64" min={1} max={SESSION_DATES_MAX - 1} value={rep.count}
                    onChange={(ev) => setRep((r) => ({ ...r, count: Math.min(Math.max(Math.trunc(+ev.target.value) || 1, 1), SESSION_DATES_MAX - 1) }))} />
                  <span>回</span>
                  <button type="button" className="btn small primary" id="repeatAdd" onClick={addRepeat}>足す</button>
                </div>
              )}
              <span className="hint" id="moreDatesHint">{nDates > 1 ? nDates + '日分をまとめて登録します。名前は末尾の数字を進めます（「#1」→「#2」）。数字が無ければ「名前 #1」「名前 #2」' : ''}</span>
            </div>
          </>
        ) : <><WindowRow f={f} set={set} /><RecruitRow f={f} set={set} /></>}
        <PeopleFields f={f} set={set} />
        <ConflictWarn text={passWarn} id="passWarn" />
        <PlaceMemo f={f} set={set} />
        <NotifyCheck f={f} set={set} label="Discordに知らせる" />
        <div className={formActions}>
          <div className="btns mt-0">
            <button type="submit" className="btn primary" id="save">{st === '調整中' ? '登録して候補日を選ぶ' : nDates > 1 ? nDates + '日分を登録' : '登録'}</button>
          </div>
          <FormMsg msg={msg} />
        </div>
      </form>
    </>
  );
}
