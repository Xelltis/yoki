// 右上の「卓予定」。今日・明日の卓、募集中・調整中、期間や開催日を過ぎた卓を並べる
import type { ConsoleSession } from '../../shared/api';
import { renderCal, revealDay, selectDay } from './calendar';
import { daysBetween, fmtJa, timeRange } from './dates';
import { $, esc, hit, mi, store } from './dom';
import { active, hasPoll, isAdjusting, isDated, isRecruit, me, pollPending, sortedActive, sortSessions } from './model';
import { notifyState } from './notify';
import { D } from './state';
import { showTab } from './tabs';

export function renderNotices(): void {
  const box = $('notices');
  box.innerHTML = '';
  const planned = sortedActive().filter((s) => isDated(s) && s.date);
  const add = (cls: string, html: string, day?: string, tab?: string, target?: string) => {
    const click = !!(day || tab || target);
    const d = document.createElement(click ? 'button' : 'div');
    if (d instanceof HTMLButtonElement) d.type = 'button';
    d.className = 'notice ' + cls + (click ? ' click' : ''); d.innerHTML = html;
    if (day) d.dataset.day = day;
    if (tab) d.dataset.tab = tab;
    if (target) d.dataset.target = target;
    box.appendChild(d);
  };
  const line = (s: ConsoleSession, head: string) =>
    head + '<b>' + esc(s.name) + '</b><span class="sub">' + esc(timeRange(s)) + '　GM: ' + esc(s.gm || '未定') + '　参加: ' + esc(s.members.join('、') || '未定') + '</span>';
  // 見落としやすい募集中・調整中を先に出す（色は hot）
  const rec = sortSessions(active().filter(isRecruit));
  if (rec.length) add('adjust hot', mi('campaign') + '募集中: ' + rec.map((s) => esc(s.name) + '（' + esc(s.windowLabel || '期間未定') + (s.want.length ? '、希望 ' + s.want.length + ' 人' : '') + '）').join('　') + '<span class="sub">タップすると「募集・調整」タブへ。参加希望はそこで出せます</span>', '', 'recruit');
  const adj = sortSessions(active().filter(isAdjusting));
  adj.forEach((s) => {
    if (hasPoll(s)) {
      const pend = pollPending(s), who = me(), waitMe = !!who && pend.indexOf(who) >= 0;
      add('adjust hot' + (waitMe || (!pend.length && who && who === s.gm) ? ' mine' : ''), mi('how_to_vote') + (pend.length ? '日程調整の回答待ち: <b>' : '日程調整の回答がそろいました: <b>') + esc(s.name) + '</b><span class="sub">候補 ' + s.candidates.length + ' 日　' + (pend.length ? '未回答: ' + esc(pend.join('、')) : '全員が回答済み。GM が開催日を選びます') + '</span><span class="sub">' + (waitMe ? '<b>あなたの回答を待っています。</b>' : !pend.length && who && who === s.gm ? '<b>開催日を選んでください。</b>' : '') + 'タップすると「募集・調整」タブへ。</span>', '', 'recruit');
      return;
    }
    add('adjust hot', mi('edit_calendar') + '日程調整中: <b>' + esc(s.name) + '</b><span class="sub">' + esc(s.windowLabel ? s.windowLabel + ' のどこか' : '期間未定') + '　GM: ' + esc(s.gm || '未定') + '　参加: ' + esc(s.members.join('、') || '未定') + '</span><span class="sub">タップすると「都合を見る卓」がこの卓になり、候補の期間に枠が付きます。</span>', s.windowFrom || '', '', s.name);
  });
  const t = planned.filter((s) => daysBetween(D.today, s.date) === 0);
  const tm = planned.filter((s) => daysBetween(D.today, s.date) === 1);
  t.forEach((s) => { add('today', line(s, mi('today') + '今日 '), s.date); });
  tm.forEach((s) => { add('tomorrow', line(s, mi('event') + '明日 ') + '<span class="sub">' + esc(notifyState(s)) + '</span>', s.date); });
  if (!t.length && !tm.length) add('info', '今日・明日の卓はありません。');
  planned.filter((s) => { const n = daysBetween(D.today, s.date); return n >= 2 && n <= 14; }).forEach((s) => { add('week', line(s, mi('date_range') + fmtJa(s.date) + ' '), s.date); });
  const later = planned.filter((s) => daysBetween(D.today, s.date) > 14);
  if (later.length) add('info', '15 日以降: ' + later.map((s) => fmtJa(s.date) + ' ' + esc(s.name)).join('、'));
  adj.filter((s) => s.windowTo && s.windowTo < D.today).forEach((s) => { add('overdue', mi('history') + '候補の期間を過ぎています: ' + esc(s.name) + '（' + esc(s.windowLabel) + '）→ 開催日を決めて「開催」にするか、期間を延ばしてください。', s.windowFrom, '', s.name); });
  planned.filter((s) => daysBetween(D.today, s.date) < 0).forEach((s) => { add('overdue', mi('history') + '開催日を過ぎています: ' + esc(s.name) + '（' + fmtJa(s.date) + '）→ 状態を「終了」か「中止」に。', s.date); });
}

export function init(): void {
  $('notices').addEventListener('click', (ev) => {
    const t = hit(ev, '.notice[data-tab]'); if (t) { showTab(t.dataset.tab!); return; }
    const n = hit(ev, '.notice[data-day], .notice[data-target]'); if (!n) return;
    if (n.dataset.target) { $('target').value = n.dataset.target; store('target', n.dataset.target); }
    if (n.dataset.day) { selectDay(n.dataset.day); revealDay(); } else renderCal();
  });
}
