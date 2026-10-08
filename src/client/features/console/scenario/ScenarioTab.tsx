// シナリオのタブ（ふだんの画面）: グループで遊ぶシナリオの一覧と、選んだシナリオの通過（だれが遊んだ・GMできるか）と遊べる日。
// 通過は、本人が付けた印と「終了」の卓から出すものを合わせる（src/shared/scenario.ts）。遊べる日から、その日の卓を立てられる
import { useState } from 'react';
import { type ConsoleData, type ConsoleScenario, type RpcResult, SCENARIO_MAX, type ScenarioMark } from '../../../../shared/api';
import { type Pass, passesOf, plannedOf, playableDays } from '../../../../shared/scenario';
import { askConfirm } from '../../../ui/confirm';
import { field, fieldLabel, fieldNote } from '../../../ui/fields';
import { Icon } from '../../../ui/Icon';
import { Modal } from '../../../ui/Modal';
import { formActions, wideBar, wideBarTitle } from '../../../ui/modalParts';
import { PageHead } from '../../../ui/PageHead';
import { toast } from '../../../ui/toast';
import { openForm } from '../actions';
import { useConsole, useData } from '../context';
import { fmtJa } from '../model/dates';
import { me } from '../model/model';
import { withScenarioMark } from '../model/optimistic';
import { checkPill, checkPills, personChip } from '../styles';

/** 遊べる日を出す数 */
const DAYS_SHOWN = 8;

/** 人数・時間の短い説明（「PL 3〜5人・8時間」） */
function specText(s: ConsoleScenario): string {
  const p = s.playersMin && s.playersMax ? (s.playersMin === s.playersMax ? s.playersMin + '人' : s.playersMin + '〜' + s.playersMax + '人')
    : s.playersMin ? s.playersMin + '人から' : s.playersMax ? s.playersMax + '人まで' : '';
  return [s.system, p && 'PL ' + p, s.hours].filter(Boolean).join('・');
}

/** その人の状態の札の文字 */
function stateText(pass: Pass | undefined, planned: string | undefined): string {
  if (pass) return (pass.kind === 'gm' ? 'GMできる' : '通過') + (pass.from ? '（' + pass.from + '）' : '');
  return planned ? '予定（' + planned + '）' : '未通過';
}

export function ScenarioTab() {
  const d = useData();
  const { ui, sync } = useConsole();
  const [pick, setPick] = useState('');
  const [edit, setEdit] = useState<{ seq: number; id: string } | null>(null);
  const sc = d.scenarios.find((s) => s.id === pick) ?? d.scenarios[0];
  const names = new Set(d.members.map((m) => m.name));
  const mine = me(d);

  const mark = (name: string, kind: ScenarioMark | '') => {
    if (!sc) return;
    sync.write<RpcResult>('setScenarioMark', { id: sc.id, name, kind }, { optimistic: (cur) => withScenarioMark(cur, sc.id, name, kind) })
      .then((res) => toast(res.message), (e: Error) => { toast(e.message); void sync.refresh('quiet'); });
  };

  return (
    <section id="tab-scenario" className="max-w-1120">
      <PageHead title="シナリオ" lead="グループで遊ぶシナリオと、だれが通過したかをまとめます。シナリオを付けた卓が「終了」になると、GMと参加者は自動で通過になります。未通過で空いている人がそろう日も分かります。" />
      <div className="mb-12 flex flex-wrap items-center gap-8">
        <button type="button" className="btn primary" id="newScenario" onClick={() => setEdit({ seq: Date.now(), id: '' })}><Icon name="add" size="sm" />シナリオを登録</button>
        <span className="hint">{d.scenarios.length ? d.scenarios.length + '件' : ''}</span>
      </div>
      {!d.scenarios.length ? (
        <div className="card" id="scenarioEmpty">
          <h3><Icon name="auto_stories" size="sm" />まだシナリオがありません</h3>
          <p className="hint">遊びたいシナリオを登録すると、メンバーごとの通過と、遊べる日が出ます。卓の登録の窓でも、シナリオを選べるようになります。</p>
        </div>
      ) : (
        <div className="grid items-start gap-16 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          <ul className="card m-0 grid list-none gap-4 p-8" id="scenarioList">
            {d.scenarios.map((s) => {
              const passes = passesOf(s, d.sessions, names);
              const on = s.id === sc!.id;
              return (
                <li key={s.id}>
                  <button type="button" data-scenario={s.id} aria-current={on ? 'true' : undefined}
                    className={'block w-full cursor-pointer rounded-md border px-12 py-8 text-left font-inherit ' + (on ? 'border-accent-line bg-accent-soft' : 'border-transparent bg-transparent hover:bg-hover')}
                    onClick={() => setPick(s.id)}>
                    <b className="block text-14 text-fg">{s.name}</b>
                    <span className="block text-12 text-muted">
                      {specText(s) && <span className="mr-8">{specText(s)}</span>}<span className="whitespace-nowrap">{'通過 ' + Object.keys(passes).length + '人'}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <ScenarioDetail d={d} sc={sc!} mine={mine} onEdit={() => setEdit({ seq: Date.now(), id: sc!.id })} onMark={mark}
            onStart={(date, gm) => openForm(ui, { status: '開催', date, scenarioId: sc!.id, gm })} />
        </div>
      )}
      <ScenarioModal req={edit} onClose={() => setEdit(null)} onSaved={(id) => setPick(id)} />
    </section>
  );
}

/** 選んだシナリオの中身・メンバーの通過・遊べる日 */
function ScenarioDetail({ d, sc, mine, onEdit, onMark, onStart }: {
  d: ConsoleData; sc: ConsoleScenario; mine: string; onEdit: () => void; onMark: (name: string, kind: ScenarioMark | '') => void; onStart: (date: string, gm: string) => void;
}) {
  const names = new Set(d.members.map((m) => m.name));
  const passes = passesOf(sc, d.sessions, names);
  const planned = plannedOf(sc.id, d.sessions);
  const days = playableDays({ days: d.availDays, members: d.members.map((m) => m.name), passes, planned, avail: d.avail, booked: d.booked, min: sc.playersMin });
  const ok = days.filter((x) => x.ok);
  const gmKnown = Object.values(passes).some((p) => p.kind === 'gm');
  return (
    <div className="grid gap-16" id="scenarioDetail" data-id={sc.id}>
      <div className="card">
        <h3 className="flex-wrap"><Icon name="auto_stories" size="sm" /><span id="scenarioTitle">{sc.name}</span>
          <button type="button" className="btn small ml-auto" id="scenarioEdit" onClick={onEdit}><Icon name="edit" size="sm" />編集</button>
        </h3>
        {specText(sc) && <p className="hint mt-0">{specText(sc)}</p>}
        {sc.url && <p className="mt-4 mb-0 text-13"><a href={sc.url} target="_blank" rel="noopener noreferrer"><Icon name="open_in_new" size="sm" />シナリオのページ</a></p>}
        {sc.memo && <p className="mt-8 mb-0 text-13 whitespace-pre-wrap">{sc.memo}</p>}
        {sc.createdBy && <p className="hint mb-0">{sc.createdBy + 'が登録'}</p>}
      </div>

      <div className="card" id="scenarioPeople">
        <h3><Icon name="group" size="sm" />メンバーの通過</h3>
        <p className="hint">自分の分は、押して変えられます{d.isAdmin ? '（管理者は、だれの分でも）' : ''}。「GMできる」は、中身を知っている人です。「終了」の卓から付いた通過は、未通過に戻せません。</p>
        <ul className="m-0 grid list-none gap-6 p-0">
          {d.members.map((m) => {
            const pass = passes[m.name], plan = planned[m.name];
            const canEdit = m.name === mine || d.isAdmin;
            return (
              <li className="flex flex-wrap items-center gap-x-10 gap-y-4" key={m.name} data-person={m.name}>
                <span className="min-w-[8em] text-13 font-semibold">{m.name}</span>
                {canEdit ? (
                  <span className={checkPills + ' mb-0'} role="radiogroup" aria-label={m.name + 'の通過'}>
                    {([['', '未通過'], ['played', '通過'], ['gm', 'GMできる']] as [ScenarioMark | '', string][]).map(([k, label]) => (
                      <label className={checkPill} key={k} title={k === '' && pass?.from ? '卓（' + pass.from + '）で通過しているので、未通過にはできません' : ''}>
                        <input type="radio" name={'mark-' + m.name} value={k} data-mark={m.name} data-kind={k || 'none'}
                          disabled={k === '' && !!pass?.from} checked={(pass?.kind ?? '') === k}
                          onChange={() => onMark(m.name, k)} />
                        {label}
                      </label>
                    ))}
                  </span>
                ) : null}
                {/* 切り替えられる行では、卓から付いた通過と予定だけを札で足す（印そのものは切り替えに出ている） */}
                {(!canEdit || pass?.from || (!pass && plan)) && <span className={personChip(pass?.kind === 'gm', !pass && !plan)}>{stateText(pass, plan)}</span>}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="card" id="playDays">
        <h3><Icon name="event_available" size="sm" />遊べる日</h3>
        <p className="hint">
          {'未通過で、その日に × もほかの卓も無い人を数えます（△ の人は「たぶん」）。'
            + (sc.playersMin ? 'PLが' + sc.playersMin + '人以上' : 'PLが1人以上')
            + (gmKnown ? 'で、GMできる人が空いている日です。' : 'の日です。GMできる人を付けると、GMが空いているかも見ます。')}
        </p>
        {!ok.length && <p className="hint mb-0" id="playDaysNone">{'予定表の' + d.availDays.length + '日のうちに、そろう日はありません。'}</p>}
        <ul className="m-0 grid list-none gap-8 p-0">
          {ok.slice(0, DAYS_SHOWN).map((x) => (
            <li className="rounded-md border border-line px-12 py-8" key={x.date} data-day={x.date}>
              <div className="flex flex-wrap items-center gap-8">
                <b className="text-14 tabular-nums">{fmtJa(x.date)}</b>
                <span className="text-13">{'PL ' + x.players.length + '人'}</span>
                {x.gms.length > 0 && <span className="text-13">{'GM: ' + x.gms.join('、')}</span>}
                <button type="button" className="btn small primary ml-auto" data-start-day={x.date}
                  onClick={() => onStart(x.date, x.gms.indexOf(mine) >= 0 ? mine : (x.gms[0] ?? ''))}><Icon name="add" size="sm" />この日で卓を立てる</button>
              </div>
              <div className="hint mt-4">{'PLにできる人: ' + x.players.join('、') + (x.maybe.length ? '　たぶん（△）: ' + x.maybe.join('、') : '')}</div>
            </li>
          ))}
        </ul>
        {ok.length > DAYS_SHOWN && <p className="hint mb-0">{'ほかに' + (ok.length - DAYS_SHOWN) + '日あります。'}</p>}
      </div>
    </div>
  );
}

type Draft = { name: string; system: string; playersMin: string; playersMax: string; hours: string; url: string; memo: string };
const empty: Draft = { name: '', system: '', playersMin: '', playersMax: '', hours: '', url: '', memo: '' };

/** シナリオの登録・変更の窓。reqのidが空なら新しく登録する */
function ScenarioModal({ req, onClose, onSaved }: { req: { seq: number; id: string } | null; onClose: () => void; onSaved: (id: string) => void }) {
  const d = useData();
  const { sync } = useConsole();
  const [handled, setHandled] = useState(0);
  const [f, setF] = useState<Draft>(empty);
  const [st, setSt] = useState({ busy: false, msg: '' });
  const sc = req?.id ? d.scenarios.find((s) => s.id === req.id) : undefined;
  if (req && req.seq !== handled) {
    setHandled(req.seq);
    setF(sc ? { name: sc.name, system: sc.system, playersMin: sc.playersMin ? String(sc.playersMin) : '', playersMax: sc.playersMax ? String(sc.playersMax) : '', hours: sc.hours, url: sc.url, memo: sc.memo } : empty);
    setSt({ busy: false, msg: '' });
  }
  const set = (patch: Partial<Draft>) => setF((cur) => ({ ...cur, ...patch }));
  const canDelete = !!sc && (d.isAdmin || sc.createdBy === me(d));
  const save = () => {
    if (!f.name.trim()) { setSt({ busy: false, msg: 'シナリオの名前を入れてください。' }); return; }
    setSt({ busy: true, msg: '保存しています…' });
    sync.write<RpcResult>('saveScenario', { id: sc?.id ?? '', ...f }).then((res) => { toast(res.message); onSaved(res.id!); onClose(); },
      (e: Error) => setSt({ busy: false, msg: e.message }));
  };
  const remove = () => {
    if (!sc) return;
    askConfirm({ title: '「' + sc.name + '」を消しますか？', message: 'このシナリオを付けた卓からは外れます（卓は残ります）。メンバーの通過の印も消えます。', ok: '削除', danger: true }, () => {
      sync.write<RpcResult>('deleteScenario', { id: sc.id }).then((res) => { toast(res.message); onClose(); }, (e: Error) => setSt({ busy: false, msg: e.message }));
    });
  };
  const num = (k: 'playersMin' | 'playersMax', id: string, label: string) => (
    <div className="narrow">
      <label className={fieldLabel} htmlFor={id}>{label}</label>
      <input type="number" min={1} max={SCENARIO_MAX.players} className={field} id={id} value={f[k]} onChange={(ev) => set({ [k]: ev.target.value })} />
    </div>
  );
  return (
    <Modal id="scenarioModal" open={!!req} onClose={onClose}>
      <form className="box wide" id="scenarioForm" role="dialog" aria-modal="true" aria-labelledby="scenarioFormTitle" tabIndex={-1} onSubmit={(ev) => { ev.preventDefault(); save(); }}>
        <div className={wideBar}>
          <h2 className={wideBarTitle} id="scenarioFormTitle">{sc ? 'シナリオを変える' : 'シナリオを登録'}</h2>
          <button type="button" className="btn small ml-auto" id="scenarioClose" onClick={onClose}><Icon name="close" size="sm" />閉じる</button>
        </div>
        <label className={fieldLabel} htmlFor="scName">シナリオの名前 <small className={fieldNote}>必須</small></label>
        <input type="text" className={field} id="scName" required maxLength={SCENARIO_MAX.name} value={f.name} onChange={(ev) => set({ name: ev.target.value })} />
        <label className={fieldLabel} htmlFor="scSystem">システム <small className={fieldNote}>クトゥルフ神話TRPG・エモクロアTRPGなど</small></label>
        <input type="text" className={field} id="scSystem" maxLength={SCENARIO_MAX.system} list="scenarioSystems" value={f.system} onChange={(ev) => set({ system: ev.target.value })} />
        <datalist id="scenarioSystems">{[...new Set(d.scenarios.map((s) => s.system).filter(Boolean))].map((x) => <option value={x} key={x}>{x}</option>)}</datalist>
        <div className="row">
          {num('playersMin', 'scMin', 'PLの人数（下限）')}
          {num('playersMax', 'scMax', 'PLの人数（上限）')}
          <div className="narrow">
            <label className={fieldLabel} htmlFor="scHours">時間の目安</label>
            <input type="text" className={field} id="scHours" placeholder="4時間" maxLength={SCENARIO_MAX.hours} value={f.hours} onChange={(ev) => set({ hours: ev.target.value })} />
          </div>
        </div>
        <label className={fieldLabel} htmlFor="scUrl">URL <small className={fieldNote}>配布や販売のページ（https://…）</small></label>
        <input type="url" className={field} id="scUrl" maxLength={SCENARIO_MAX.url} value={f.url} onChange={(ev) => set({ url: ev.target.value })} />
        <label className={fieldLabel} htmlFor="scMemo">メモ <small className={fieldNote}>推奨技能・注意すること（ネタバレは書かない）</small></label>
        <textarea className={field} id="scMemo" maxLength={SCENARIO_MAX.memo} value={f.memo} onChange={(ev) => set({ memo: ev.target.value })} />
        <div className={formActions}>
          <div className="btns mt-0">
            <button type="submit" className="btn primary" id="scSave" disabled={st.busy}>{sc ? '保存' : '登録'}</button>
            {canDelete && <button type="button" className="btn danger ml-auto" id="scDelete" disabled={st.busy} onClick={remove}><Icon name="delete" size="sm" />削除</button>}
          </div>
          <div className="mt-6 text-err-text empty:hidden" id="scMsg" role="status">{st.msg}</div>
        </div>
      </form>
    </Modal>
  );
}
