// 右上の「卓予定」。今日・明日の卓、募集中・調整中、期間や開催日を過ぎた卓を並べる。押すとその日・タブ・卓へ
import type { ReactNode } from 'react';
import type { ConsoleData, ConsoleSession } from '../../../../shared/api';
import { store } from '../../../app/storage';
import { Icon } from '../../../ui/Icon';
import { daysBetween, fmtJa, timeRange } from '../model/dates';
import { active, hasPoll, isAdjusting, isDated, isRecruit, me, pollPending, sortedActive, sortSessions } from '../model/model';
import { notifyState } from '../model/notify';
import { notice, noticeSub } from '../styles';

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
    <>{head}<b>{s.name}</b><span className={noticeSub}>{timeRange(s) + '　GM: ' + (s.gm || '未定') + '　参加: ' + (s.members.join('、') || '未定')}</span></>
  );
  // 見落としやすい募集中・調整中を先に出す（色は hot）
  const rec = sortSessions(active(d).filter(isRecruit));
  if (rec.length) {
    // 卓ごとに 1 行。参加希望はタブで出す
    add('adjust hot', (
      <>
        <Icon name="campaign" />{'募集中 ' + rec.length + ' 件'}
        {rec.slice(0, rec.length > 3 ? 2 : 3).map((s) => (
          <span className="block" key={s.id}>
            <b>{s.name}</b><span className="ml-6 text-12 font-normal text-muted">{(s.windowLabel || '期間未定') + (s.want.length ? '　希望 ' + s.want.length + ' 人' : '')}</span>
          </span>
        ))}
        {/* 多いときは 2 件だけ出し、残りの数を出す（全部は「募集・調整」タブにある） */}
        {rec.length > 3 && <span className="block text-12 font-semibold text-muted">{'ほか ' + (rec.length - 2) + ' 件'}</span>}
        <span className={noticeSub}>参加希望は「募集・調整」タブで出せます</span>
      </>
    ), '', 'recruit');
  }
  const adj = sortSessions(active(d).filter(isAdjusting));
  adj.forEach((s) => {
    if (hasPoll(s)) {
      const pend = pollPending(d, s), who = me(d), waitMe = !!who && pend.indexOf(who) >= 0, gmTurn = !pend.length && !!who && who === s.gm;
      add('adjust hot' + (waitMe || gmTurn ? ' mine' : ''), (
        <>
          <Icon name="how_to_vote" />{pend.length ? '日程調整の回答待ち: ' : '日程調整の回答がそろいました: '}<b>{s.name}</b>
          <span className={noticeSub}>{'候補 ' + s.candidates.length + ' 日　' + (pend.length ? '未回答: ' + pend.join('、') : '全員が回答済み。GM が開催日を選びます')}</span>
          {(waitMe || gmTurn) && <span className="block text-12 font-semibold text-soon-text">{waitMe ? 'あなたの回答を待っています' : '開催日を選んでください'}</span>}
        </>
      ), '', 'recruit');
      return;
    }
    add('adjust hot', (
      <>
        <Icon name="edit_calendar" />日程調整中: <b>{s.name}</b>
        <span className={noticeSub}>{(s.windowLabel ? s.windowLabel + ' のどこか' : '期間未定') + '　GM: ' + (s.gm || '未定') + '　参加: ' + (s.members.join('、') || '未定')}</span>
        <span className={noticeSub}>押すと、この卓の人の都合をカレンダーに出し、候補の期間に枠を付けます</span>
      </>
    ), s.windowFrom || '', undefined, s.name);
  });
  const t = planned.filter((s) => daysBetween(d.today, s.date) === 0);
  const tm = planned.filter((s) => daysBetween(d.today, s.date) === 1);
  t.forEach((s) => { add('today', line(s, <><Icon name="today" />今日 </>), s.date); });
  tm.forEach((s) => { add('tomorrow', <>{line(s, <><Icon name="event" />明日 </>)}<span className={noticeSub}>{notifyState(d, s)}</span></>, s.date); });
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
    <div id="notices" className="flex flex-col gap-8 tabular-nums">
      {items.map((it, i) => {
        // 募集中・調整中（hot）のあとは、少し離す
        const gap = i > 0 && items[i - 1]!.cls.indexOf('hot') >= 0 && it.cls.indexOf('hot') < 0 ? ' mt-10' : '';
        // 押せる行は、右に印を付ける（日を選ぶ・タブへ移る・都合を見る卓を変える）
        return it.day || it.tab || it.target
          ? (
            <button type="button" key={i} className={notice(it.cls, true) + gap} data-day={it.day || undefined} data-tab={it.tab} data-target={it.target} onClick={() => press(it)}>
              {it.body}<Icon name="chevron_right" size="sm" className="absolute top-1/2 right-6 -translate-y-1/2 text-muted" />
            </button>
          )
          : <div key={i} className={notice(it.cls, false) + gap}>{it.body}</div>;
      })}
    </div>
  );
}
