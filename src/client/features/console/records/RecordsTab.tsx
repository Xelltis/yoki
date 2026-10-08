// 記録のタブ: 終わった卓（ログ・振り返り・参加者のPCと結果）と、メンバーごとのPCの台帳
import { useState } from 'react';
import { Icon } from '../../../ui/Icon';
import { PageHead } from '../../../ui/PageHead';
import { openRecord } from '../actions';
import { useConsole, useData } from '../context';
import { fmtJa } from '../model/dates';
import { me, scenarioOf } from '../model/model';
import { people, personChip } from '../styles';
import { finishedSessions, ledger } from './ledger';

/** はじめに出す、終わった卓の数（多いときは「もっと見る」で開く） */
const SHOWN = 20;

export function RecordsTab() {
  const d = useData();
  const { ui } = useConsole();
  const mine = me(d);
  const [all, setAll] = useState(false);
  const done = finishedSessions(d), list = all ? done : done.slice(0, SHOWN);
  const rows = ledger(d).filter((r) => r.gm || r.pl || r.pcs.length);
  return (
    <section id="tab-records">
      <PageHead title="記録" lead="終わった卓のログと振り返り、メンバーごとのPCです。記録はGMと管理者、PCはその卓の参加者が書きます。" />
      <div className="card" id="doneList">
        <h3><Icon name="task_alt" size="sm" />終わった卓</h3>
        {!done.length && <p className="hint">まだ終わった卓はありません。</p>}
        <ul className="m-0 grid list-none gap-10 p-0">
          {list.map((s) => {
            const sc = scenarioOf(d, s), canRecord = s.gm === mine || d.isAdmin, isPl = s.members.indexOf(mine) >= 0;
            return (
              <li className="rounded-md border border-line bg-card px-14 py-12" key={s.id} data-done={s.id}>
                <div className="flex flex-wrap items-baseline gap-x-10 gap-y-4">
                  <b className="tabular-nums">{fmtJa(s.date)}</b><b className="text-15">{s.name}</b>
                  {sc && <span className="hint">{'シナリオ: ' + sc.name}</span>}
                  {(canRecord || isPl) && (
                    <button type="button" className="btn small ml-auto" data-record={s.id} onClick={() => openRecord(ui, s.id)}><Icon name="edit" size="sm" />{canRecord ? '記録を書く' : '自分のPCを書く'}</button>
                  )}
                </div>
                <div className={people}>
                  {s.gm && <span className={personChip(true, false)}>{'GM ' + s.gm}</span>}
                  {s.members.map((n) => {
                    const sh = s.prep.sheets[n], away = s.absent.some((a) => a.name === n);
                    return <span className={personChip(false, false) + (away ? ' line-through opacity-70' : '')} key={n}>{n + (sh && sh.pc ? '（' + sh.pc + (sh.outcome ? '・' + sh.outcome : '') + '）' : '')}</span>;
                  })}
                </div>
                {s.record.logUrl && <p className="mt-6 mb-0 text-13"><a href={s.record.logUrl} target="_blank" rel="noopener noreferrer"><Icon name="open_in_new" size="sm" />ログ・リプレイ</a></p>}
                {s.record.recap && <p className="mt-6 mb-0 text-13 whitespace-pre-wrap wrap-anywhere">{s.record.recap}</p>}
              </li>
            );
          })}
        </ul>
        {!all && done.length > SHOWN && <button type="button" className="btn small mt-10" id="doneMore" onClick={() => setAll(true)}>{'ほか' + (done.length - SHOWN) + '卓を見る'}</button>}
      </div>
      <div className="card" id="pcLedger">
        <h3><Icon name="badge" size="sm" />PCの台帳</h3>
        <p className="hint">終わった卓で、参加者が書いたPCの名前でまとめています。回数は終わった卓の数です（行けなくなった卓は数えません）。</p>
        {!rows.length && <p className="hint">まだありません。</p>}
        <div className="grid gap-12">
          {rows.map((r) => (
            <div key={r.name} data-ledger={r.name}>
              <div className="flex flex-wrap items-baseline gap-8"><b>{r.name}</b><span className="hint">{'GM ' + r.gm + '回・PL ' + r.pl + '回'}</span></div>
              {r.pcs.length > 0 && (
                <ul className="mt-4 mb-0 grid list-none gap-4 p-0 text-13">
                  {r.pcs.map((pc) => {
                    const last = pc.sessions.at(-1)!;
                    return (
                      <li className="rounded-md bg-head px-10 py-6" key={pc.pc}>
                        <b className="font-semibold">{pc.pc}</b>
                        <span className="hint">{'　' + pc.sessions.length + '回・最後は' + fmtJa(last.date) + ' ' + last.name + (last.outcome ? '（' + last.outcome + '）' : '')}</span>
                        {pc.url && <a className="ml-8" href={pc.url} target="_blank" rel="noopener noreferrer">キャラシ</a>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
