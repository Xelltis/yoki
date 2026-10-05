// 管理画面の「卓をまとめて変える」。卓の一覧から選び、状態・参加者・開催日などをまとめて変える
import { useState } from 'react';
import type { RpcResult } from '../../../../shared/api';
import { askConfirm } from '../../../ui/confirm';
import { toast } from '../../../ui/toast';
import { openForm } from '../actions';
import { discordSend, failToast } from '../api/discord';
import { useConsole, useData } from '../context';
import { daysBetween, fmtJa } from '../model/dates';
import { byId, isActive, isAdjusting, isRecruit, me, sortSessions, sortedActive } from '../model/model';

const ACTIONS = [
  ['status', '状態を変更'], ['addMember', '参加者を追加'], ['removeMember', '参加者から外す'], ['setGm', 'GM を変更'],
  ['shiftDays', '開催日をずらす'], ['setSeries', 'シリーズを変更'], ['delete', '削除'],
] as const;
type Action = (typeof ACTIONS)[number][0];
/** 広い画面だけに出す列 */
const wide = 'max-sm:hidden';
/** まとめて変えるときの選ぶ欄 */
const bulkField = 'w-auto max-w-full';

export function OpsPane() {
  const d = useData();
  const { sync, ui } = useConsole();
  /** 選んでいる卓（id） */
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [showAll, setShowAll] = useState(false);
  const [action, setAction] = useState<Action>('status');
  const [status, setStatus] = useState('');
  const [member, setMember] = useState('');
  const [days, setDays] = useState('');
  const [series, setSeries] = useState('');
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const rows = showAll ? sortedActive(d).concat(sortSessions(d.sessions.filter((s) => !isActive(s)))) : sortedActive(d);
  // 一覧に出ていない卓は、選んでいないことにする
  const ids = rows.filter((s) => selected[s.id]).map((s) => s.id);
  const all = rows.length > 0 && ids.length === rows.length;
  const statusV = d.statuses.filter((x) => x === status)[0] || d.statuses[0] || '';
  const names = d.members.map((m) => m.name);
  const memberV = names.indexOf(member) >= 0 ? member : names[0] || '';
  const pick = (list: string[], on: boolean) => setSelected((cur) => {
    const next = { ...cur };
    list.forEach((id) => { if (on) next[id] = true; else delete next[id]; });
    return next;
  });
  const run = () => {
    if (!ids.length) return;
    const value = action === 'status' ? statusV : action === 'shiftDays' ? days.trim() : action === 'setSeries' ? series.trim() : memberV;
    const label = ACTIONS.filter((x) => x[0] === action)[0]![1];
    const what = label + (action === 'delete' ? '' : '（' + (value || (action === 'setSeries' ? '外す' : '')) + '）');
    if (action !== 'delete' && action !== 'setSeries' && !value) { setMsg('値を選んでください。'); return; }
    const sel = ids.slice(), selNames = sel.map((id) => { const s = byId(d, id); return s ? s.name : id; });
    askConfirm({ title: sel.length + ' 件の卓で「' + what + '」を実行しますか？', message: selNames.join('、'), ok: action === 'delete' ? '削除する' : '実行する', danger: action === 'delete' }, () => {
      setBusy(true); setMsg('保存しています…');
      const wantNotify = notify;
      sync.write<RpcResult>('bulkUpdateSessions', { ids: sel, action, value, notify: false, me: me(d) }).then((res) => {
        setBusy(false); setMsg(res.message); toast(res.message); setSelected({});
        if (!wantNotify) return;
        void discordSend(sync, { kind: 'bulk', names: res.names || selNames, ids: res.ids || sel, label: res.label || what }, (t) => setMsg(res.message + '　' + t))
          .then(({ ok, r }) => toast(ok ? 'Discord に送りました' : failToast(r)));
      }, (e: Error) => { setBusy(false); setMsg(e.message); toast(e.message); });
    });
  };
  return (
    <div data-pane="ops">
      <p className="hint">卓の一覧から選び、参加者の出入り・開催日のずらし・状態の変更・削除をまとめてできます。</p>
      <div className="card" id="availOps">
        <div className="mb-10 flex flex-wrap items-center gap-8">
          <span className="min-w-[5em] font-bold" id="bulkCount">{'選択 ' + ids.length + ' 件'}</span>
          <button type="button" className="btn small" id="bulkPast" onClick={() => pick(rows.filter((s) => s.date && daysBetween(d.today, s.date) < 0 && isActive(s)).map((s) => s.id), true)}>過ぎた卓を選ぶ</button>
          <button type="button" className="btn small" id="bulkNone" onClick={() => setSelected({})}>選択解除</button>
          <label className="chk"><input type="checkbox" id="showAll" checked={showAll} onChange={(ev) => {
            const on = ev.target.checked;
            setShowAll(on);
            // 隠した卓の選択は外す
            if (!on) pick(d.sessions.filter((s) => !isActive(s)).map((s) => s.id), false);
          }} /> 終了・中止も表示</label>
        </div>
        <div className="wrap">
          <table id="matrix" className="[&_td]:align-middle">
            <tbody>
              <tr>
                <th className="sel"><input type="checkbox" id="selAll" aria-label="一覧の卓をすべて選ぶ" checked={all} onChange={(ev) => pick(rows.map((s) => s.id), ev.target.checked)} /></th>
                {/* スマホでは列を減らし、シリーズ・状態・開催日・GM・参加者は名前の下に出す（横に送らなくても読めるように） */}
                <th>卓の名前</th><th className={'c ' + wide}>シリーズ</th><th className={'c ' + wide}>状態</th><th className={'c ' + wide}>開催日</th><th className={'c ' + wide}>GM</th><th className={wide}>参加者</th><th aria-label="編集"></th>
              </tr>
              {rows.map((s) => {
                const on = !!selected[s.id];
                const when = s.date ? fmtJa(s.date) : isRecruit(s) || isAdjusting(s) ? s.windowLabel || '期間未定' : '未定';
                return (
                  // 行のどこを押しても選べる（チェック欄と編集のボタンは、それぞれで受ける）
                  <tr className={(isActive(s) ? '' : 'done') + (on ? ' checked' : '')} data-id={s.id} key={s.id}
                    onClick={(ev) => { if (!(ev.target instanceof Element && ev.target.closest('input,button'))) pick([s.id], !on); }}>
                    <td className="sel"><input type="checkbox" className="rowsel" data-id={s.id} aria-label={s.name + ' を選ぶ'} checked={on} onChange={(ev) => pick([s.id], ev.target.checked)} /></td>
                    <td className="min-w-[14em] max-sm:min-w-0">
                      <b>{s.name}</b>
                      <small className="hidden text-12 leading-[1.5] text-muted max-sm:block">
                        {[s.status, when, s.series && 'シリーズ: ' + s.series, s.gm && 'GM: ' + s.gm, s.members.length ? '参加: ' + s.members.join('、') : ''].filter(Boolean).join('　')}
                      </small>
                    </td>
                    <td className={'c nw ' + wide}>{s.series}</td><td className={'c nw ' + wide}>{s.status}</td><td className={'c nw ' + wide}>{when}</td><td className={'c min-w-[5em] ' + wide}>{s.gm}</td>
                    <td className={'min-w-[10em] ' + wide}>{s.members.join('、')}</td>
                    <td className="nw"><button type="button" className="btn small" data-edit={s.id} onClick={() => openForm(ui, { id: s.id })}>編集</button></td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={8} className="hint">稼働中の卓はありません。カレンダーの「卓を登録」から。</td></tr>}
            </tbody>
          </table>
        </div>
        {/* 選んだ卓にすること。欄は中身の幅にして 1 行に並べる */}
        <div className="mt-12 flex flex-wrap items-center gap-8 border-t border-line pt-12" id="bulkBar" hidden={!rows.length}>
          <span className="text-13 font-semibold text-muted">選んだ卓を</span>
          <select className={bulkField} id="bulkAction" value={action} onChange={(ev) => setAction(ev.target.value as Action)}>
            {ACTIONS.map((x) => <option value={x[0]} key={x[0]}>{x[1]}</option>)}
          </select>
          <select className={bulkField} id="bulkStatus" hidden={action !== 'status'} value={statusV} onChange={(ev) => setStatus(ev.target.value)}>
            {d.statuses.map((s) => <option value={s} key={s}>{s}</option>)}
          </select>
          <select className={bulkField} id="bulkMember" hidden={!(action === 'addMember' || action === 'removeMember' || action === 'setGm')} value={memberV} onChange={(ev) => setMember(ev.target.value)}>
            {names.map((n) => <option value={n} key={n}>{n}</option>)}
          </select>
          <input type="text" className="w-[9em] max-w-640" id="bulkDays" inputMode="numeric" placeholder="日数（7 や -1）" hidden={action !== 'shiftDays'} value={days} onChange={(ev) => setDays(ev.target.value)} />
          <input type="text" className="w-[14em] max-w-640" id="bulkSeries" list="seriesList" placeholder="シリーズ名（空で外す）" hidden={action !== 'setSeries'} value={series} onChange={(ev) => setSeries(ev.target.value)} />
          <label className="chk"><input type="checkbox" id="bulkNotify" disabled={!d.channelSet} checked={notify} onChange={(ev) => setNotify(ev.target.checked)} /> Discord に知らせる</label>
          <button type="button" className={'btn ' + (action === 'delete' ? 'danger' : 'primary')} id="bulkRun" disabled={busy || !ids.length} onClick={run}>実行</button>
          <span id="bulkMsg" className="hint">{msg}</span>
        </div>
      </div>
    </div>
  );
}
