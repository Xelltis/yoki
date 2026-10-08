// 予定表（広い画面）と、日ごとのリスト（狭い画面）。自分の列のマスはボタン（押すと 空 → △ → ×）、ほかの人の列は見るだけ
import type { ReactNode } from 'react';
import type { ConsoleData } from '../../../../shared/api';
import { Icon } from '../../../ui/Icon';
import { WD, fmtJa } from '../model/dates';
import type { Part } from '../../../../shared/parts';
import { active, bookedOn, hasPoll, isRecruit } from '../model/model';
import { mdot } from '../styles';
import { freeText, MARK_NEXT, MARK_WORD, type Mark, markAtRow, markIn, type Row } from './rows';

/** 予定表のマスの共通（右に線。下の線は行ごとに決める）。色の無いマスは、線の下に色を塗らない（clip） */
const cell = 'border-0 border-r border-line ';
const clip = 'bg-clip-padding ';
/** 下の線。土曜の行は太い線で週を区切る。最後の行には引かない */
const bottom = (sat: boolean, last: boolean) => (sat ? 'border-b-2 border-b-week-line ' : last ? '' : 'border-b ');
/** 左に固定する3列（日付・曜・その日の卓）。leftと幅は決め打ちにする（ずれると、横に送ったときに重なる） */
const COL = {
  c1: 'left-0 w-62 min-w-62 ',
  c2: 'left-62 w-52 min-w-52 text-center ',
  c3: 'left-114 w-220 min-w-220 max-w-220 max-sm:w-140 max-sm:min-w-140 max-sm:max-w-140 ',
};
/** その日の卓に入っている札（参・GM）。押せないことを形で示す */
export const bkTag = 'inline-block min-w-[2.4em] whitespace-nowrap rounded-full border border-current px-6 text-center text-12 leading-[20px] font-bold text-booked-text';
/** 自分のマスの △ × の色 */
const MARK_BG: Record<string, string> = { '△': 'bg-soft ', '×': 'bg-warn ' };

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

/**
 * メモを書く鉛筆。表ではマスの右上に小さく、リストでは四角いボタンにする。
 * 表の鉛筆は、マウスで使う端末ではマスに載せたときだけ出す（どの行にも出ていると、うるさいため）。キーボードで来たときも出す
 */
function Pen({ day, onPen, list }: { day: string; onPen: (day: string) => void; list?: boolean }) {
  const cls = list
    ? 'grid h-38 w-34 cursor-pointer place-items-center rounded-sm border border-line bg-card p-0 text-muted focus-visible:outline-offset-1'
    : 'absolute top-1 right-1 cursor-pointer rounded-[4px] border-0 bg-transparent p-2 leading-none text-muted opacity-60 hover:bg-hover hover:text-fg '
      + 'pointer-fine:opacity-0 pointer-fine:group-hover/cell:opacity-100 focus-visible:opacity-100';
  return <button type="button" className={cls} data-pen={day} title="この日のメモを書く" aria-label={fmtJa(day) + 'のメモを書く'} onClick={() => onPen(day)}><Icon name="edit" size="xs" /></button>;
}

type Props = { d: ConsoleData; names: string[]; mine: string; rows: Row[]; onMark: (day: string, next: Mark, part: Part | '') => void; onPen: (day: string) => void };

export function AvailTable({ d, names, mine, rows, onMark, onPen }: Props) {
  const act = active(d), split = !!d.settings.dayParts;
  return (
    <table id="availTable" className="w-auto">
      <tbody>
        <tr>
          <th className={cell + 'sticky top-0 z-(--z-cell-corner) border-b bg-head px-8 py-6 text-fg ' + COL.c1}>日付</th>
          <th className={cell + 'sticky top-0 z-(--z-cell-corner) border-b bg-head px-8 py-6 text-fg ' + COL.c2}>曜</th>
          <th className={cell + 'sticky top-0 z-(--z-cell-corner) border-b bg-head px-8 py-6 text-fg ' + COL.c3}>その日の卓</th>
          {names.map((n) => {
            const gmN = act.filter((s) => s.gm === n).length, plN = act.filter((s) => s.gm !== n && s.members.indexOf(n) >= 0).length, mineCol = n === mine;
            return (
              <th className={cell + 'sticky top-0 z-(--z-cell-head) min-w-84 max-w-136 border-b px-8 py-6 whitespace-normal wrap-anywhere ' + (mineCol ? 'bg-accent-strong text-accent-ink' : clip + 'text-fg')} key={n}>
                {n}<small className={'block text-10 leading-[1.2] font-normal ' + (mineCol ? 'text-inherit opacity-85' : 'text-muted')} title="いま動いている卓でGMをしている数と参加している数">{'GM ' + gmN + '・PL ' + plN}</small>
                {split && <span className={'mt-2 grid grid-cols-2 text-center text-10 font-semibold ' + (mineCol ? 'opacity-85' : 'text-muted')}><span>昼</span><span>夜</span></span>}
              </th>
            );
          })}
        </tr>
        {rows.map((r, ri) => {
          const key = r.key, sat = r.dow === 6, last = ri === rows.length - 1 && !!d.members.length;
          const line = bottom(sat, last);
          // 左の3列の色。今日・土日と祝日の順。その日の卓の列は、卓のある日・全員空きの日にも色を付ける
          const dBg = key === d.today ? 'bg-today ' : r.wk || r.hol ? 'bg-weekend ' : '';
          const c3Bg = dBg || (r.list.length ? 'bg-session ' : r.free ? 'bg-soft ' : '');
          const dCell = cell + line + 'sticky z-(--z-cell) px-8 py-6 ' + (r.dow === 0 || r.hol ? 'text-sun ' : sat ? 'text-sat ' : '');
          return (
            <tr key={key}>
              <td className={dCell + COL.c1 + (dBg || 'bg-card')}>{(r.date.getMonth() + 1) + '/' + r.date.getDate()}</td>
              <td className={dCell + COL.c2 + (dBg || 'bg-card')} title={r.hol}>{WD[r.dow]}{r.hol && <span className="ml-3 inline-block rounded-[4px] bg-sun px-4 align-[1px] text-10 text-card">祝</span>}</td>
              <td className={dCell + COL.c3 + 'whitespace-normal leading-[1.45] wrap-anywhere ' + (c3Bg || 'bg-card')}>
                {hasPlans(r) ? <Plans r={r} /> : r.free ? <span className="hint">{freeText(r)}</span> : null}{r.hol && <span className="block text-11 text-muted">{r.hol}</span>}
              </td>
              {names.map((n) => {
                const memo = r.notes[n] ? r.notes[n].text : '', own = n === mine;
                const dot = memo ? <span className={mdot} /> : null, pen = own ? <Pen day={key} onPen={onPen} /> : null;
                if (split) return <SplitCell d={d} r={r} n={n} own={own} line={line} memo={memo} dot={dot} pen={pen} onMark={onMark} key={n} />;
                if (r.bk[n]) {
                  return (
                    <td className={cell + line + 'group/cell bg-session py-6 pl-8 text-center font-bold text-booked-text ' + (own ? 'relative pr-18 ' : 'pr-8 ') + (memo ? 'relative cursor-pointer' : 'cursor-default')}
                      key={n} data-memo-of={n} data-day={key} data-memo={memo || undefined} title={memo ? undefined : 'この日の卓に入っています'}>
                      <span className={bkTag}>{r.bk[n]}</span>{dot}{pen}
                    </td>
                  );
                }
                const v = markIn(r.marks, n);
                const g = !!v && fromGoogle(d, key, n);
                const gTag = g ? <sup className={gSup} title={G_TITLE} data-google>G</sup> : null;
                if (own) {
                  return (
                    <td className={cell + line + 'group/cell relative select-none py-0 pr-18 pl-0 text-center text-16 hover:shadow-[inset_0_0_0_2px_var(--accent)] ' + (MARK_BG[v] || clip)} key={n} data-memo={memo || undefined}>
                      <button type="button" className="mk block min-h-34 w-full cursor-pointer rounded-sm border-0 bg-transparent py-0 pr-0 pl-18 font-inherit text-inherit focus-visible:outline-offset-[-2px]" data-day={key} aria-label={fmtJa(key) + ' ' + n + ' ' + MARK_WORD[v] + (g ? '（' + G_TITLE + '）' : '') + '。押すと' + MARK_WORD[MARK_NEXT[v]]} onClick={() => onMark(key, MARK_NEXT[v], '')}>{v || '·'}{gTag}</button>
                      {dot}{pen}
                    </td>
                  );
                }
                return (
                  <td className={cell + line + 'px-8 py-6 text-center text-muted ' + (MARK_BG[v] || clip) + (memo ? 'relative cursor-pointer' : '')} key={n} data-memo-of={n} data-day={key} data-memo={memo || undefined}>
                    {v}{gTag}{dot}
                  </td>
                );
              })}
            </tr>
          );
        })}
        {!d.members.length ? <tr><td colSpan={3} className={cell + clip + 'hint px-8 py-6'}>メンバーが登録されていません。</td></tr>
          : !rows.length ? <tr><td colSpan={3 + names.length} className={cell + clip + 'hint px-8 py-6'}>条件に合う日がありません。</td></tr> : null}
      </tbody>
    </table>
  );
}

/** 昼と夜に分けたマスの、片方（昼か夜）。tdの中に2つ並べる */
const half = 'flex min-h-34 items-center justify-center border-0 text-15 ';

/**
 * 昼と夜に分けるグループのマス。左が昼、右が夜。自分の列は時間帯ごとに押すと 空 → △ → × と変わる。
 * 卓のある時間帯は「参」「GM」の札で、押せない
 */
function SplitCell({ d, r, n, own, line, memo, dot, pen, onMark }: {
  d: ConsoleData; r: Row; n: string; own: boolean; line: string; memo: string; dot: ReactNode; pen: ReactNode; onMark: Props['onMark'];
}) {
  const g = fromGoogle(d, r.key, n);
  return (
    <td className={cell + line + 'group/cell relative p-0 ' + (own ? 'pr-18 ' : '') + (memo ? 'cursor-pointer ' : '') + clip}
      data-memo-of={own ? undefined : n} data-day={r.key} data-memo={memo || undefined}>
      <div className="grid grid-cols-2">
        {(r.parts as Part[]).map((p) => {
          if (bookedOn(d, r.key, n, p)) return <span className={half + 'bg-session'} key={p} title={p + 'は卓に入っています'}><span className={bkTag + ' min-w-0 px-3'}>{r.bk[n] || '参'}</span></span>;
          const v = markAtRow(d, r, n, p), gTag = v && g ? <sup className={gSup} title={G_TITLE} data-google>G</sup> : null;
          if (!own) return <span className={half + 'text-muted ' + (MARK_BG[v] || '')} key={p}>{v}{gTag}</span>;
          return (
            <button type="button" className={'mk cursor-pointer rounded-sm bg-transparent p-0 font-inherit text-inherit hover:shadow-[inset_0_0_0_2px_var(--accent)] focus-visible:outline-offset-[-2px] ' + half + (MARK_BG[v] || '')}
              key={p} data-day={r.key} data-part={p} aria-label={fmtJa(r.key) + 'の' + p + ' ' + n + ' ' + MARK_WORD[v] + '。押すと' + MARK_WORD[MARK_NEXT[v]]} onClick={() => onMark(r.key, MARK_NEXT[v], p)}>
              {v || '·'}{gTag}
            </button>
          );
        })}
      </div>
      {dot}{pen}
    </td>
  );
}

/** Googleカレンダーの予定から入った印の札（印の右肩の小さなG） */
const gSup = 'ml-1 align-super text-[9px] leading-none font-bold text-muted';
const G_TITLE = 'Googleカレンダーの予定から入った印';
/** その日のその人の印が、Googleカレンダーの予定から入ったものか */
const fromGoogle = (d: Props['d'], key: string, name: string) => (d.availGoogle[key] || []).includes(name);

/** 日ごとのリストは、狭い画面だけに出す（pkはe2eが探す印） */
const list = 'hidden max-tab:block';
const pick = 'pk h-38 w-38 cursor-pointer rounded-sm border font-inherit text-14 font-bold focus-visible:outline-offset-1 ';

/** 日ごとのリスト（狭い画面）。1日1行で、ほかの人の × と △ を名前で並べ、自分の印は ◯ △ × のボタンで打つ */
export function AvailList({ d, names, mine, rows, onMark, onPen }: Props) {
  if (!d.members.length) return <div className={list} id="availList"><p className="hint">メンバーが登録されていません。</p></div>;
  if (!rows.length) return <div className={list} id="availList"><p className="hint">条件に合う日がありません。</p></div>;
  const others = names.filter((n) => n !== mine), withMe = !!mine && names.indexOf(mine) >= 0;
  /** その印の人。昼と夜に分けるグループで、片方の時間帯だけなら「ソラ（昼）」 */
  const who = (r: Row, n: string, m: Mark) => {
    const ps = r.parts.filter((p) => !bookedOn(d, r.key, n, p) && markAtRow(d, r, n, p) === m);
    return !ps.length ? '' : ps.length === r.parts.length ? n : n + '（' + ps.join('・') + '）';
  };
  return (
    <div className={list} id="availList">
      {rows.map((r, ri) => {
        const key = r.key;
        const ng = others.map((n) => who(r, n, '×')).filter(Boolean);
        const sk = others.map((n) => who(r, n, '△')).filter(Boolean);
        const today = key === d.today;
        // 狭いとき（文字を大きくしたときなど）は、印のボタンを次の行へ回して、予定の欄を残す
        const cls = 'flex flex-wrap items-center gap-x-10 gap-y-8 rounded-md border px-12 py-10 ' + (ri > 0 ? 'mt-8 ' : '') + (today ? 'border-accent-line shadow-[inset_3px_0_0_var(--accent)] ' : 'border-line ') + (r.free ? 'bg-soft' : 'bg-card');
        return (
          <div className={cls} key={key}>
            <div className={'w-58 flex-none text-14 leading-[1.3] font-bold tabular-nums ' + (r.dow === 0 || r.hol ? 'text-sun' : r.dow === 6 ? 'text-sat' : '')}>
              {(r.date.getMonth() + 1) + '/' + r.date.getDate()}<small className="block text-11 font-normal text-muted">{WD[r.dow] + (r.hol ? ' ' + r.hol : '')}</small>
            </div>
            <div className="min-w-[6em] flex-1 text-[12.5px] leading-[1.5] text-muted wrap-anywhere">
              {hasPlans(r) && <div className="font-semibold text-fg"><Plans r={r} /></div>}
              {ng.length || sk.length
                ? <div>{ng.length > 0 && <span className="mr-8 text-err-text">{'× ' + ng.join('、')}</span>}{sk.length > 0 && <span className="text-ok-text">{'△ ' + sk.join('、')}</span>}</div>
                : r.free ? <div>{freeText(r)}</div> : null}
              {names.filter((n) => r.notes[n]).map((n) => <div className="text-[11.5px]" key={n}>{n + ': ' + r.notes[n]!.text}</div>)}
            </div>
            {withMe && (
              <div className="ml-auto flex flex-none flex-wrap items-center justify-end gap-4">
                {r.parts.map((p) => {
                  const v = markAtRow(d, r, mine, p), booked = p ? bookedOn(d, key, mine, p) : !!r.bk[mine];
                  return (
                    <span className="flex items-center gap-4" key={p} data-part-of={p || undefined}>
                      {p && <span className="text-11 font-semibold text-muted">{p}</span>}
                      {!booked && !!v && fromGoogle(d, key, mine) && <span className={gSup + ' align-baseline'} title={G_TITLE} data-google>G</span>}
                      {booked ? <span className={bkTag} title={(p ? p + 'は' : 'この日の') + '卓に入っています'}>{r.bk[mine] || '参'}</span>
                        : ([['', '◯'], ['△', '△'], ['×', '×']] as [Mark, string][]).map(([m, label]) => (
                          <button type="button" className={pick + (v !== m ? 'border-line bg-card text-muted' : m === '△' ? 'border-ok-text bg-soft text-ok-text' : m === '×' ? 'border-err-text bg-warn text-err-text' : 'border-accent-line bg-accent-soft text-accent-text')}
                            key={label} data-day={key} data-part={p || undefined} data-mark={m} aria-pressed={v === m} aria-label={fmtJa(key) + (p ? 'の' + p : '') + 'を「' + MARK_WORD[m] + '」にする'} onClick={() => onMark(key, m, p)}>{label}</button>
                        ))}
                    </span>
                  );
                })}
                <Pen day={key} onPen={onPen} list />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
