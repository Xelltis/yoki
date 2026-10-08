// 月のカレンダー。マスの色はみんなの都合、札は卓、アイコンは調整中の卓。スマホでは左右になぞると月を送る
import { useRef } from 'react';
import type { ConsoleData, ConsoleSession } from '../../../../shared/api';
import { Icon } from '../../../ui/Icon';
import { WD, fmtJa, holidayName, ymdOf } from '../model/dates';
import { STATUS_ICON, active, availMap, hasPoll, isActive, isAdjusting, notesOn, pollCount, sortSessions, windowByDay } from '../model/model';

type Props = {
  d: ConsoleData;
  view: { y: number; m: number };
  target: string;
  selDay: string;
  /** 日を押した（選んでいた日をもう一度押したら外す） */
  onPick: (key: string) => void;
  /** 月を送る（nは +1か -1） */
  onShift: (n: number) => void;
};

/** マス（日）。中身は折り返して上から並べる（dayはe2eが探す印） */
const dayBase = 'day relative m-0 flex min-h-108 w-full min-w-0 appearance-none flex-wrap content-start items-center overflow-hidden rounded-none border-0 p-6 text-left font-inherit text-12 text-inherit '
  + 'max-sm:min-h-68 max-sm:p-3 max-sm:text-11 ';
/**
 * 卓の札。左の線の色で状態を示す。広い画面では2行まで折り返して名前を読めるようにし、
 * スマホでは1行で、… を付けずに入るだけ見せる（狭いマスでは … が字の場所を取るため）
 */
const chipBase = 'mt-3 block min-w-0 flex-[0_0_100%] overflow-hidden whitespace-nowrap text-clip rounded-sm py-2 pr-6 pl-8 text-[11.5px] leading-[1.4] '
  + 'sm:line-clamp-2 sm:whitespace-normal sm:wrap-anywhere max-sm:mt-2 max-sm:py-1 max-sm:pr-2 max-sm:pl-4 max-sm:text-10 ';
const chipIcon = 'mr-2 align-[-3px] max-sm:hidden ';
/** みんなの都合の印（◎・△）。マスの右上 */
const avMark = 'absolute top-6 right-6 text-11 font-bold text-ok-text max-sm:hidden';
/** マスに並べる卓の札の数。多い日は残りを「ほかN件」にまとめる（その行だけ縦に伸びないように。全部は日の内訳に出る） */
const MAX_CHIPS = 3;
const CHIP: Record<string, [string, string]> = {
  '': ['bg-card font-semibold text-fg shadow-[inset_3px_0_0_var(--accent),0_0_0_1px_var(--line)]', 'text-accent-text'],
  held: ['bg-card font-semibold text-fg shadow-[inset_3px_0_0_var(--ok-text),0_0_0_1px_var(--line)]', 'text-ok-text'],
  adj: ['bg-card font-semibold text-fg shadow-[inset_3px_0_0_var(--soon-text),0_0_0_1px_var(--line)]', 'text-soon-text'],
  done: ['bg-card font-medium text-muted shadow-[inset_3px_0_0_var(--line-strong),0_0_0_1px_var(--line)]', 'text-muted'],
  cancel: ['bg-card font-medium text-muted line-through shadow-[inset_3px_0_0_var(--line-strong),0_0_0_1px_var(--line)]', 'text-muted'],
  note: ['bg-soon font-medium text-fg shadow-none', 'text-soon-text'],
};

export function MonthGrid({ d, view, target, selDay, onPick, onShift }: Props) {
  const { y, m } = view;
  // 終了・中止もカレンダーには残す
  const byDay: Record<string, ConsoleSession[]> = {};
  d.sessions.forEach((s) => { if (s.date) (byDay[s.date] = byDay[s.date] || []).push(s); });
  const av = availMap(d, target), wbd = windowByDay(d), tsel = active(d).filter((x) => x.name === target)[0];
  const first = new Date(y, m, 1).getDay(), dim = new Date(y, m + 1, 0).getDate();
  const total = Math.ceil((first + dim) / 7) * 7;
  /* スマホ: 左右になぞると月を送る。縦のスクロールはそのまま。なぞったすぐあとの「押した」は無視する */
  const start = useRef<{ x: number; y: number; t: number } | null>(null), swiped = useRef(false);
  const cells = [];
  for (let i = 0; i < total; i++) {
    const day = i - first + 1, c = i % 7;
    if (day < 1 || day > dim) { cells.push(<div className={dayBase + 'cursor-default bg-out'} key={i} />); continue; }
    const key = ymdOf(y, m, day), list = sortSessions(byDay[key] || []);
    const live = list.filter(isActive).length;
    const hol = holidayName(key);
    // マスの色: 全員空き・△あり・卓あり・終わった卓・土日と祝日の順
    const bg = av[key] === 'ok' ? 'bg-ok' : av[key] === 'soft' ? 'bg-soft' : live ? 'bg-session' : list.length ? 'bg-past' : c === 0 || c === 6 || hol ? 'bg-weekend' : 'bg-card';
    const wins = wbd[key] || [];
    let cls = dayBase + 'cursor-pointer focus-visible:z-(--z-cell) focus-visible:outline-offset-[-2px] ' + bg;
    // 都合を見る卓の候補の期間は枠、選んでいる日は太い枠
    if (tsel && isAdjusting(tsel) && wins.indexOf(tsel) >= 0) cls += ' shadow-[inset_0_0_0_2px_var(--accent-line)]';
    if (key === selDay) cls += ' z-(--z-cell) outline-2 outline-offset-[-2px] outline-accent';
    // その日にかかる日付のメモ（前の日から続く期間のメモも）
    const notes = notesOn(d, key);
    const aria = (m + 1) + '月' + day + '日（' + WD[c] + '）' + (hol ? ' ' + hol : '') + (key === d.today ? '、今日' : '') + (list.length ? '、卓' + list.length + '件' : '') +
      (wins.length ? '、調整中' + wins.length + '件' : '') + (av[key] === 'ok' ? '、全員空き' : av[key] === 'soft' ? '、△あり' : '') + (notes.length ? '、メモあり' : '');
    const icos = list.filter((s) => isAdjusting(s) && wins.indexOf(s) < 0).concat(wins);
    // 調整中はアイコンだけ（下で並べる）。ほかは札にする
    const chips = list.filter((s) => !isAdjusting(s));
    cells.push(
      <button type="button" key={i} className={cls} data-day={key} aria-label={aria} aria-pressed={key === selDay} aria-current={key === d.today ? 'date' : undefined}
        onClick={() => { if (!swiped.current) onPick(key); }}>
        {/* 過ぎた日は、日付を薄くする */}
        <span className={'inline-flex h-24 min-w-24 items-center justify-center rounded-[12px] px-5 text-13 font-semibold max-sm:h-22 max-sm:min-w-22 max-sm:px-3 max-sm:text-12 '
          + (key === d.today ? 'bg-accent-strong text-accent-ink' : (c === 0 || hol ? 'text-sun' : c === 6 ? 'text-sat' : '') + (key < d.today ? ' opacity-50' : ''))} title={hol}>{day}</span>
        {hol && <span className="ml-2 text-10 text-sun max-sm:hidden">{hol}</span>}
        {av[key] === 'ok' ? <span className={avMark}>◎</span> : av[key] === 'soft' ? <span className={avMark}>△</span> : null}
        {chips.slice(0, chips.length > MAX_CHIPS ? MAX_CHIPS - 1 : MAX_CHIPS).map((s) => {
          const today = s.status === '開催' && s.date === d.today;
          const k = s.status === '募集' ? 'adj' : today ? 'held' : s.status === '終了' ? 'done' : s.status === '中止' ? 'cancel' : '';
          return (
            <span className={chipBase + CHIP[k]![0]} key={s.id} title={s.name + '（' + s.status + (today ? '・今日' : '') + '）'}>
              {/* ふつうの開催の卓は、左の線だけで分かるのでアイコンを省く（名前の場所を空ける） */}
              {k !== '' && <Icon name={today ? 'play_circle' : (STATUS_ICON[s.status] || 'event')} size="xs" className={chipIcon + CHIP[k]![1]} />}
              {s.start && <span className="font-medium opacity-70 max-sm:hidden">{s.start + ' '}</span>}
              {s.name}
            </span>
          );
        })}
        {chips.length > MAX_CHIPS && <span className="mt-3 block flex-[0_0_100%] pl-8 text-11 font-semibold text-muted max-sm:mt-2 max-sm:pl-4 max-sm:text-10">{'ほか' + (chips.length - MAX_CHIPS + 1) + '件'}</span>}
        {icos.length > 0 && (
          <span className="mt-3 flex flex-[0_0_100%] flex-wrap gap-3">
            {icos.map((s, j) => {
              const poll = hasPoll(s);
              const label = s.name + (poll ? '（日程調整の候補日　' + pollCount(d, s, key) + '）' : '（調整中' + (s.windowLabel ? '　' + s.windowLabel + 'のどこか' : '') + '）');
              return (
                <span className={'inline-flex h-20 w-20 items-center justify-center rounded-sm bg-card max-sm:h-16 max-sm:w-16 ' + (poll ? 'text-accent-text shadow-[0_0_0_1px_var(--accent-line)]' : 'text-muted shadow-[0_0_0_1px_var(--line)]')}
                  key={s.id + ':' + j} role="img" aria-label={label} title={label}>
                  <Icon name={poll ? 'how_to_vote' : 'edit_calendar'} size="xs" className="max-sm:text-12" />
                </span>
              );
            })}
          </span>
        )}
        {notes.map((n) => (
          <span className={chipBase + CHIP.note![0]} key={n.from} title={(n.to ? fmtJa(n.from) + '〜' + fmtJa(n.to) + '　' : '') + n.text} data-note-from={n.from}>
            <Icon name="sticky_note_2" size="xs" className={chipIcon + CHIP.note![1]} />{' ' + n.text.split('\n')[0]}
          </span>
        ))}
      </button>,
    );
  }
  return (
    <div id="calendar" className="cal grid touch-pan-y grid-cols-7 gap-1 overflow-hidden rounded-lg border border-line bg-line tabular-nums shadow-card"
      onPointerDown={(e) => { start.current = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY, t: Date.now() } : null; }}
      onPointerCancel={() => { start.current = null; }}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = null;
        if (!s) return;
        const dx = e.clientX - s.x, dy = e.clientY - s.y, quick = Date.now() - s.t < 800;
        if (!quick || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        swiped.current = true; setTimeout(() => { swiped.current = false; }, 400);
        onShift(dx < 0 ? 1 : -1);
      }}>
      {WD.map((w, i) => <div className={'bg-card py-8 text-center text-12 font-semibold ' + (i === 0 ? 'text-sun' : i === 6 ? 'text-sat' : 'text-muted')} key={'w' + i}>{w}</div>)}
      {cells}
    </div>
  );
}
