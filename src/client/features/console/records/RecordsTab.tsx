// 記録のタブ: あなたの記録（回数・システム・よく一緒に遊んだ人・PC）、終わった卓（ログ・振り返り・参加者のPCと結果）と、メンバーごとのPCの台帳
import { useState } from 'react';
import { Icon } from '../../../ui/Icon';
import { PageHead } from '../../../ui/PageHead';
import { openRecord } from '../actions';
import { useConsole, useData } from '../context';
import { fmtJa } from '../model/dates';
import { me, scenarioOf } from '../model/model';
import { people, personChip } from '../styles';
import { finishedSessions, ledger, myStats } from './ledger';
import { gmsOf, isGm } from '../../../../shared/gm';

/** はじめに出す、終わった卓の数（多いときは「もっと見る」で開く） */
const SHOWN = 20;

export function RecordsTab() {
  const d = useData();
  const { ui } = useConsole();
  const mine = me(d);
  const [all, setAll] = useState(false);
  const done = finishedSessions(d), list = all ? done : done.slice(0, SHOWN);
  const rows = ledger(d).filter((r) => r.gm || r.pl || r.pcs.length);
  const my = myStats(d, mine), myPcs = rows.find((r) => r.name === mine)?.pcs ?? [];
  return (
    <section id="tab-records">
      <PageHead title="記録" lead="終わった卓のログと振り返り、メンバーごとのPCです。記録はGMと管理者、PCはその卓の参加者が書きます。" />
      {my.gm + my.pl > 0 && (
        <div className="card" id="myRecord">
          <h3><Icon name="history_edu" size="sm" />あなたの記録</h3>
          <p className="m-0 text-15"><b>{'GM ' + my.gm + '回・PL ' + my.pl + '回'}</b><span className="hint">{'　' + fmtJa(my.first) + (my.first !== my.last ? '〜' + fmtJa(my.last) : '') + '（このグループの、終わった卓）'}</span></p>
          <dl className="mt-8 mb-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-12 gap-y-4 text-13">
            <dt className="font-semibold text-muted">システム</dt>
            <dd className="m-0" id="mySystems">{my.systems.map((x) => x.system + ' ' + (x.gm + x.pl) + '回' + (x.gm && x.pl ? '（GM ' + x.gm + '・PL ' + x.pl + '）' : x.gm ? '（GM）' : '')).join('、')}</dd>
            {my.partners.length > 0 && <><dt className="font-semibold text-muted">よく一緒に</dt><dd className="m-0" id="myPartners">{my.partners.map((x) => x.name + ' ' + x.n + '回').join('、')}</dd></>}
            {myPcs.length > 0 && <><dt className="font-semibold text-muted">PC</dt><dd className="m-0" id="myPcs">{myPcs.map((pc) => pc.pc + '（' + pc.sessions.length + '回' + (pc.sessions.at(-1)!.outcome ? '・' + pc.sessions.at(-1)!.outcome : '') + '）').join('、')}</dd></>}
          </dl>
        </div>
      )}
      <div className="card" id="doneList">
        <h3><Icon name="task_alt" size="sm" />終わった卓</h3>
        {!done.length && <p className="hint">まだ終わった卓はありません。</p>}
        <ul className="m-0 grid list-none gap-10 p-0">
          {list.map((s) => {
            const sc = scenarioOf(d, s), canRecord = isGm(s, mine) || d.isAdmin, isPl = s.members.indexOf(mine) >= 0;
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
                  {gmsOf(s).map((n) => <span className={personChip(true, false)} key={n}>{(n === s.gm ? 'GM ' : '共同GM ') + n}</span>)}
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
