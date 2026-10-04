// 予定表（広い画面）と、日ごとのリスト（狭い画面）。自分の列のマスはボタン（押すと 空 → △ → ×）、ほかの人の列は見るだけ
import type { ReactNode } from 'react';
import type { ConsoleData } from '../../../../shared/api';
import { Icon } from '../../../ui/Icon';
import { WD, fmtJa } from '../model/dates';
import { active, hasPoll, isRecruit } from '../model/model';
import { MARK_NEXT, MARK_WORD, type Mark, markIn, type Row } from './rows';

/** その日の卓（募集は「募集」を付ける）と、調整中の卓の名前。「、」でつなぐ */
function Plans({ r }: { r: Row }): ReactNode {
  const head = r.list.map((s) => (isRecruit(s) ? '募集 ' : '') + s.name).join('、');
  const out: ReactNode[] = [];
  if (head) out.push(head + (r.wins.length ? '、' : ''));
  r.wins.forEach((s, i) => {
    out.push(<span className="hint" key={s.id + ':' + i}>{(hasPoll(s) ? '候補: ' : '調整: ') + s.name}</span>);
    if (i < r.wins.length - 1) out.push('、');
  });
  return out;
}
const hasPlans = (r: Row) => r.list.length > 0 || r.wins.length > 0;

function Pen({ day, onPen }: { day: string; onPen: (day: string) => void }) {
  return <button type="button" className="pen" data-pen={day} title="この日のメモを書く" aria-label={fmtJa(day) + ' のメモを書く'} onClick={() => onPen(day)}><Icon name="edit" size="xs" /></button>;
}

type Props = { d: ConsoleData; names: string[]; mine: string; rows: Row[]; onMark: (day: string, next: Mark) => void; onPen: (day: string) => void };

export function AvailTable({ d, names, mine, rows, onMark, onPen }: Props) {
  const act = active(d);
  return (
    <table id="availTable">
      <tbody>
        <tr>
          <th className="d c1">日付</th><th className="d c2">曜</th><th className="d c3">その日の卓</th>
          {names.map((n) => {
            const gmN = act.filter((s) => s.gm === n).length, plN = act.filter((s) => s.gm !== n && s.members.indexOf(n) >= 0).length;
            return <th className={n === mine ? 'mine' : ''} key={n}>{n}<small title="いま動いている卓で GM をしている数と参加している数">{'GM ' + gmN + '・PL ' + plN}</small></th>;
          })}
        </tr>
        {rows.map((r) => {
          const key = r.key;
          const cls = (r.wk ? 'wk ' : '') + (r.dow === 0 ? 'sun ' : r.dow === 6 ? 'sat ' : '') + (r.hol ? 'hol ' : '') + (key === d.today ? 'today ' : '') + (r.list.length ? 'has ' : '') + (r.free ? 'free' : '');
          return (
            <tr className={cls} key={key}>
              <td className="d c1">{(r.date.getMonth() + 1) + '/' + r.date.getDate()}</td>
              <td className="d c2" title={r.hol}>{WD[r.dow]}{r.hol && <span className="hol-badge">祝</span>}</td>
              <td className="d c3">{hasPlans(r) ? <Plans r={r} /> : r.free ? <span className="hint">全員空き</span> : null}{r.hol && <span className="c3-h">{r.hol}</span>}</td>
              {names.map((n) => {
                const memo = r.notes[n] ? r.notes[n].text : '', own = n === mine;
                const dot = memo ? <span className="mdot" /> : null, pen = own ? <Pen day={key} onPen={onPen} /> : null;
                if (r.bk[n]) {
                  return (
                    <td className={'booked' + (own ? ' own' : '') + (memo ? ' has-memo' : '')} key={n} data-memo-of={n} data-day={key} data-memo={memo || undefined} title={memo ? undefined : 'この日の卓に入っています'}>
                      <span className="bk-tag">{r.bk[n]}</span>{dot}{pen}
                    </td>
                  );
                }
                const v = markIn(r.marks, n), mcls = v === '△' ? 'm-soft' : v === '×' ? 'm-ng' : '';
                if (own) {
                  return (
                    <td className={'mine own ' + mcls} key={n} data-memo={memo || undefined}>
                      <button type="button" className="mk" data-day={key} aria-label={fmtJa(key) + ' ' + n + ' ' + MARK_WORD[v] + '。押すと' + MARK_WORD[MARK_NEXT[v]]} onClick={() => onMark(key, MARK_NEXT[v])}>{v || '·'}</button>
                      {dot}{pen}
                    </td>
                  );
                }
                return <td className={'other ' + mcls + (memo ? ' has-memo' : '')} key={n} data-memo-of={n} data-day={key} data-memo={memo || undefined}>{v}{dot}</td>;
              })}
            </tr>
          );
        })}
        {!d.members.length ? <tr><td colSpan={3} className="hint">メンバーが登録されていません。</td></tr>
          : !rows.length ? <tr><td colSpan={3 + names.length} className="hint">条件に合う日がありません。</td></tr> : null}
      </tbody>
    </table>
  );
}

/** 日ごとのリスト（狭い画面）。1 日 1 行で、ほかの人の × と △ を名前で並べ、自分の印は ◯ △ × のボタンで打つ */
export function AvailList({ d, names, mine, rows, onMark, onPen }: Props) {
  if (!d.members.length) return <div className="avail-list" id="availList"><p className="hint">メンバーが登録されていません。</p></div>;
  if (!rows.length) return <div className="avail-list" id="availList"><p className="hint">条件に合う日がありません。</p></div>;
  const others = names.filter((n) => n !== mine), withMe = !!mine && names.indexOf(mine) >= 0;
  return (
    <div className="avail-list" id="availList">
      {rows.map((r) => {
        const key = r.key;
        const ng = others.filter((n) => !r.bk[n] && markIn(r.marks, n) === '×');
        const sk = others.filter((n) => !r.bk[n] && markIn(r.marks, n) === '△');
        const v = markIn(r.marks, mine);
        const cls = 'avl-day' + (r.dow === 0 || r.hol ? ' sun' : r.dow === 6 ? ' sat' : '') + (key === d.today ? ' today' : '') + (r.free ? ' free' : '');
        return (
          <div className={cls} key={key}>
            <div className="d">{(r.date.getMonth() + 1) + '/' + r.date.getDate()}<small>{WD[r.dow] + (r.hol ? ' ' + r.hol : '')}</small></div>
            <div className="info">
              {hasPlans(r) && <div className="plans"><Plans r={r} /></div>}
              {ng.length || sk.length
                ? <div>{ng.length > 0 && <span className="ng">{'× ' + ng.join('、')}</span>}{sk.length > 0 && <span className="sk">{'△ ' + sk.join('、')}</span>}</div>
                : r.free ? <div>全員空き</div> : null}
              {names.filter((n) => r.notes[n]).map((n) => <div className="memo" key={n}>{n + ': ' + r.notes[n]!.text}</div>)}
            </div>
            {withMe && (
              <div className="pick">
                {r.bk[mine] ? <span className="bk-tag" title="この日の卓に入っています">{r.bk[mine]}</span>
                  : ([['', '◯'], ['△', '△'], ['×', '×']] as [Mark, string][]).map(([m, label]) => (
                    <button type="button" className="pk" key={label} data-day={key} data-mark={m} aria-pressed={v === m} aria-label={fmtJa(key) + 'を「' + MARK_WORD[m] + '」にする'} onClick={() => onMark(key, m)}>{label}</button>
                  ))}
                <Pen day={key} onPen={onPen} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
