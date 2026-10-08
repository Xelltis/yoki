// 入口の「あなたの予定」: 入っているグループをまたいで、あなたの番（日程調整・キャラシ）とこれからの卓を並べる（GET /api/me/agenda）
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { AgendaItem, AgendaResponse } from '../../../shared/api';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/icons';
import { daysBetween, fmtJa, timeRange } from '../console/model/dates';
import { card, h2, hint } from './styles';

/** React Queryの鍵 */
export const AGENDA_KEY = ['agenda'] as const;

async function fetchAgenda(): Promise<AgendaResponse> {
  const res = await fetch('/api/me/agenda');
  if (!res.ok) throw new Error('読み込めませんでした。');
  return (await res.json()) as AgendaResponse;
}

/** 種類ごとのアイコンと、1行目の文 */
const KIND: Record<AgendaItem['kind'], [IconName, (it: AgendaItem) => string]> = {
  vote: ['how_to_vote', () => '日程調整に答えてください'],
  decide: ['event_available', () => '回答がそろいました。開催日を選んでください'],
  sheet: ['checklist', (it) => 'キャラシの締め切り ' + fmtJa(it.date)],
  session: ['event', (it) => fmtJa(it.date) + ' ' + timeRange(it)],
};
/** はじめに出す行の数（多いときは「ほかN件を見る」で開く。グループの一覧が下に押しやられないように） */
const SHOWN = 8;
/** 行（押すと、そのグループの画面へ。日程調整は「募集・調整」のタブへ） */
const rowCls = 'flex items-center gap-12 rounded-md border border-line bg-card px-14 py-10 text-inherit no-underline transition-[border-color,background-color] duration-(--dur-fast) hover:border-accent-line hover:bg-hover';

export function Agenda() {
  const q = useQuery({ queryKey: AGENDA_KEY, queryFn: fetchAgenda });
  const [all, setAll] = useState(false);
  if (!q.data || !q.data.items.length) return null;
  const { today } = q.data, items = all ? q.data.items : q.data.items.slice(0, SHOWN), more = q.data.items.length - items.length;
  return (
    <section className={card} id="agenda">
      <h2 className={h2}><Icon name="today" />あなたの予定</h2>
      <p className={hint + ' mt-0'}>入っているグループをまたいで、あなたの番と、これからの卓（60日まで）を並べています。</p>
      <ul className="m-0 grid list-none gap-8 p-0">
        {items.map((it) => {
          const [icon, head] = KIND[it.kind], turn = it.kind !== 'session';
          const n = it.date ? daysBetween(today, it.date) : -1;
          const body = (
            <>
              <Icon name={icon} className={turn ? 'text-soon-text' : 'text-accent-text'} />
              <span className="min-w-0 flex-1">
                <b className={'block text-14 ' + (turn ? 'text-soon-text' : '')}>{head(it)}{it.kind === 'session' && (n === 0 ? '（今日）' : n === 1 ? '（明日）' : '')}</b>
                <span className="block truncate text-13">{it.name}<span className="text-muted">{'　' + it.groupTitle}</span></span>
              </span>
              <Icon name="chevron_right" className="text-muted" />
            </>
          );
          return (
            <li key={it.kind + it.groupId + it.id} data-agenda={it.kind}>
              {it.kind === 'vote' || it.kind === 'decide'
                ? <Link className={rowCls} to="/g/$groupId/recruit/" params={{ groupId: it.groupId }}>{body}</Link>
                : <Link className={rowCls} to="/g/$groupId/" params={{ groupId: it.groupId }}>{body}</Link>}
            </li>
          );
        })}
      </ul>
      {more > 0 && <button type="button" className="mt-10 cursor-pointer border-0 bg-transparent p-0 font-inherit text-13 font-semibold text-accent-text" id="agendaMore" onClick={() => setAll(true)}>{'ほか' + more + '件を見る'}</button>}
    </section>
  );
}
