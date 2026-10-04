// 月のカレンダー。マスの色はみんなの都合、札は卓、アイコンは調整中の卓。スマホでは左右になぞると月を送る
import { useRef } from 'react';
import type { ConsoleData, ConsoleSession } from '../../../../shared/api';
import { Icon } from '../../../ui/Icon';
import { WD, holidayName, ymdOf } from '../model/dates';
import { STATUS_ICON, active, availMap, hasPoll, isActive, isAdjusting, pollOk, pollVoters, sortSessions, windowByDay } from '../model/model';

type Props = {
  d: ConsoleData;
  view: { y: number; m: number };
  target: string;
  selDay: string;
  /** 日を押した（選んでいた日をもう一度押したら外す） */
  onPick: (key: string) => void;
  /** 月を送る（n は +1 か -1） */
  onShift: (n: number) => void;
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
    if (day < 1 || day > dim) { cells.push(<div className="day out" key={i} />); continue; }
    const key = ymdOf(y, m, day), list = sortSessions(byDay[key] || []);
    const live = list.filter(isActive).length;
    let cls = 'day';
    if (av[key] === 'ok') cls += ' ok'; else if (av[key] === 'soft') cls += ' soft'; else if (live) cls += ' has'; else if (list.length) cls += ' past'; else if (c === 0 || c === 6) cls += ' weekend';
    const wins = wbd[key] || [];
    if (tsel && isAdjusting(tsel) && wins.indexOf(tsel) >= 0) cls += ' win';
    if (key === d.today) cls += ' today';
    if (key === selDay) cls += ' sel';
    const hol = holidayName(key);
    if (hol && !av[key] && !list.length) cls += ' weekend';
    const note = (d.notes || {})[key];
    const aria = (m + 1) + '月' + day + '日（' + WD[c] + '）' + (hol ? ' ' + hol : '') + (key === d.today ? '、今日' : '') + (list.length ? '、卓 ' + list.length + ' 件' : '') +
      (wins.length ? '、調整中 ' + wins.length + ' 件' : '') + (av[key] === 'ok' ? '、全員空き' : av[key] === 'soft' ? '、△あり' : '') + (note ? '、メモあり' : '');
    const icos = list.filter((s) => isAdjusting(s) && wins.indexOf(s) < 0).concat(wins);
    cells.push(
      <button type="button" key={i} className={cls} data-day={key} aria-label={aria} aria-pressed={key === selDay} aria-current={key === d.today ? 'date' : undefined}
        onClick={() => { if (!swiped.current) onPick(key); }}>
        <span className={'n' + (c === 0 ? ' sun' : c === 6 ? ' sat' : '') + (hol ? ' hol' : '')} title={hol}>{day}</span>
        {hol && <span className="hn">{hol}</span>}
        {av[key] === 'ok' ? <span className="av">◎</span> : av[key] === 'soft' ? <span className="av">△</span> : null}
        {list.filter((s) => !isAdjusting(s)).map((s) => {
          // 調整中はアイコンだけ（下で並べる）
          const today = s.status === '開催' && s.date === d.today;
          const k = s.status === '募集' ? ' adj' : today ? ' held' : s.status === '終了' ? ' done' : s.status === '中止' ? ' cancel' : '';
          return (
            <span className={'chip' + k} key={s.id} title={s.name + '（' + s.status + (today ? '・今日' : '') + '）'}>
              <Icon name={today ? 'play_circle' : (STATUS_ICON[s.status] || 'event')} size="xs" />
              {s.start && <span className="t">{s.start} </span>}
              {s.name}
            </span>
          );
        })}
        {icos.length > 0 && (
          <span className="cal-icos">
            {icos.map((s, j) => {
              const poll = hasPoll(s);
              const label = s.name + (poll ? '（日程調整の候補日　◯ ' + pollOk(d, s, key).length + '/' + pollVoters(d, s).length + '）' : '（調整中' + (s.windowLabel ? '　' + s.windowLabel + ' のどこか' : '') + '）');
              return <span className={'cal-ico ' + (poll ? 'cand' : 'win')} key={s.id + ':' + j} role="img" aria-label={label} title={label}><Icon name={poll ? 'how_to_vote' : 'edit_calendar'} size="xs" /></span>;
            })}
          </span>
        )}
        {note && <span className="chip note" title={note.text}><Icon name="sticky_note_2" size="xs" />{' ' + note.text.split('\n')[0]}</span>}
      </button>,
    );
  }
  return (
    <div id="calendar" className="cal"
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
      {WD.map((w, i) => <div className={'wd' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '')} key={'w' + i}>{w}</div>)}
      {cells}
    </div>
  );
}
