// 右上の「卓予定」。今日・明日の卓、募集中・調整中、期間や開催日を過ぎた卓を並べる。押すとその日・タブ・卓へ
import type { ReactNode } from 'react';
import type { ConsoleData, ConsoleSession } from '../../../../shared/api';
import { store } from '../../../app/storage';
import { Icon } from '../../../ui/Icon';
import { daysBetween, fmtJa, timeRange } from '../model/dates';
import { active, hasPoll, isAdjusting, isDated, isRecruit, me, pollPending, sortedActive, sortSessions } from '../model/model';
import { notifyState } from '../model/notify';

type Item = { cls: string; body: ReactNode; day?: string; tab?: 'recruit'; target?: string };

export function Notices({ d, onDay, onTab, onTarget }: {
  d: ConsoleData;
  /** その日を選ぶ */
  onDay: (day: string) => void;
  onTab: (tab: 'recruit') => void;
  /** 都合を見る卓を変える */
  onTarget: (name: string) => void;
}) {
  const items: Item[] = [];
  const add = (cls: string, body: ReactNode, day?: string, tab?: 'recruit', target?: string) => { items.push({ cls, body, day, tab, target }); };
  const planned = sortedActive(d).filter((s) => isDated(s) && s.date);
  const line = (s: ConsoleSession, head: ReactNode) => (
    <>{head}<b>{s.name}</b><span className="sub">{timeRange(s) + '　GM: ' + (s.gm || '未定') + '　参加: ' + (s.members.join('、') || '未定')}</span></>
  );
  // 見落としやすい募集中・調整中を先に出す（色は hot）
  const rec = sortSessions(active(d).filter(isRecruit));
  if (rec.length) {
    add('adjust hot', <><Icon name="campaign" />{'募集中: ' + rec.map((s) => s.name + '（' + (s.windowLabel || '期間未定') + (s.want.length ? '、希望 ' + s.want.length + ' 人' : '') + '）').join('　')}<span className="sub">タップすると「募集・調整」タブへ。参加希望はそこで出せます</span></>, '', 'recruit');
  }
  const adj = sortSessions(active(d).filter(isAdjusting));
  adj.forEach((s) => {
    if (hasPoll(s)) {
      const pend = pollPending(d, s), who = me(d), waitMe = !!who && pend.indexOf(who) >= 0, gmTurn = !pend.length && !!who && who === s.gm;
      add('adjust hot' + (waitMe || gmTurn ? ' mine' : ''), (
        <>
          <Icon name="how_to_vote" />{pend.length ? '日程調整の回答待ち: ' : '日程調整の回答がそろいました: '}<b>{s.name}</b>
          <span className="sub">{'候補 ' + s.candidates.length + ' 日　' + (pend.length ? '未回答: ' + pend.join('、') : '全員が回答済み。GM が開催日を選びます')}</span>
          <span className="sub">{waitMe ? <b>あなたの回答を待っています。</b> : gmTurn ? <b>開催日を選んでください。</b> : null}タップすると「募集・調整」タブへ。</span>
        </>
      ), '', 'recruit');
      return;
    }
    add('adjust hot', (
      <>
        <Icon name="edit_calendar" />日程調整中: <b>{s.name}</b>
        <span className="sub">{(s.windowLabel ? s.windowLabel + ' のどこか' : '期間未定') + '　GM: ' + (s.gm || '未定') + '　参加: ' + (s.members.join('、') || '未定')}</span>
        <span className="sub">タップすると「都合を見る卓」がこの卓になり、候補の期間に枠が付きます。</span>
      </>
    ), s.windowFrom || '', undefined, s.name);
  });
  const t = planned.filter((s) => daysBetween(d.today, s.date) === 0);
  const tm = planned.filter((s) => daysBetween(d.today, s.date) === 1);
  t.forEach((s) => { add('today', line(s, <><Icon name="today" />今日 </>), s.date); });
  tm.forEach((s) => { add('tomorrow', <>{line(s, <><Icon name="event" />明日 </>)}<span className="sub">{notifyState(d, s)}</span></>, s.date); });
  if (!t.length && !tm.length) add('info', '今日・明日の卓はありません。');
  planned.filter((s) => { const n = daysBetween(d.today, s.date); return n >= 2 && n <= 14; }).forEach((s) => { add('week', line(s, <><Icon name="date_range" />{fmtJa(s.date) + ' '}</>), s.date); });
  const later = planned.filter((s) => daysBetween(d.today, s.date) > 14);
  if (later.length) add('info', '15 日以降: ' + later.map((s) => fmtJa(s.date) + ' ' + s.name).join('、'));
  adj.filter((s) => s.windowTo && s.windowTo < d.today).forEach((s) => {
    add('overdue', <><Icon name="history" />{'候補の期間を過ぎています: ' + s.name + '（' + s.windowLabel + '）→ 開催日を決めて「開催」にするか、期間を延ばしてください。'}</>, s.windowFrom, undefined, s.name);
  });
  planned.filter((s) => daysBetween(d.today, s.date) < 0).forEach((s) => {
    add('overdue', <><Icon name="history" />{'開催日を過ぎています: ' + s.name + '（' + fmtJa(s.date) + '）→ 状態を「終了」か「中止」に。'}</>, s.date);
  });

  const press = (it: Item) => {
    if (it.tab) { onTab(it.tab); return; }
    if (it.target) { store('target', it.target); onTarget(it.target); }
    if (it.day) onDay(it.day);
  };
  return (
    <div id="notices" className="notices">
      {items.map((it, i) => (it.day || it.tab || it.target
        ? <button type="button" key={i} className={'notice ' + it.cls + ' click'} data-day={it.day || undefined} data-tab={it.tab} data-target={it.target} onClick={() => press(it)}>{it.body}</button>
        : <div key={i} className={'notice ' + it.cls}>{it.body}</div>))}
    </div>
  );
}
