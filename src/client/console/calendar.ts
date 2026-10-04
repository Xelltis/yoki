// 左: カレンダー。マスの色はみんなの都合、札は卓、アイコンは調整中の卓
import type { ConsoleSession } from '../../shared/api';
import { WD, holidayName, parseYmd, ymdOf } from './dates';
import { renderDayDetail } from './day';
import { $, esc, hit, mi, reducedMotion, store } from './dom';
import { STATUS_ICON, active, availMap, hasPoll, isActive, isAdjusting, peopleOf, pollOk, pollVoters, sortSessions, windowByDay } from './model';
import { D, selDay, setSelDay, view } from './state';

/** カレンダーの下のアイコンの読み方。[アイコン, 名前, 付ける印] */
const CAL_LEGEND = [['event', '開催'], ['play_circle', '今日'], ['campaign', '募集'], ['edit_calendar', '調整期間'], ['how_to_vote', '候補日', 'cand'], ['task_alt', '終了'], ['block', '中止'], ['sticky_note_2', 'メモ']];
export function renderIconLegend(): void {
  $('iconLegend').innerHTML = CAL_LEGEND.map((x) => '<span class="li' + (x[2] ? ' ' + x[2] : '') + '">' + mi(x[0]!, 'xs') + x[1] + '</span>').join('');
}

export function renderCal(): void {
  const y = view.y, m = view.m;
  $('monthLabel').textContent = y + '年' + (m + 1) + '月';
  // 終了・中止もカレンダーには残す
  const byDay: Record<string, ConsoleSession[]> = {};
  D.sessions.forEach((s) => { if (s.date) (byDay[s.date] = byDay[s.date] || []).push(s); });
  const av = availMap($('target').value);
  const wbd = windowByDay(), tsel = active().filter((x) => x.name === $('target').value)[0];
  let html = '';
  WD.forEach((w, i) => { html += '<div class="wd' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '">' + w + '</div>'; });
  const first = new Date(y, m, 1).getDay(), dim = new Date(y, m + 1, 0).getDate();
  const total = Math.ceil((first + dim) / 7) * 7;
  for (let i = 0; i < total; i++) {
    const d = i - first + 1, c = i % 7;
    if (d < 1 || d > dim) { html += '<div class="day out"></div>'; continue; }
    const key = ymdOf(y, m, d), list = sortSessions(byDay[key] || []);
    const live = list.filter(isActive).length;
    let cls = 'day';
    if (av[key] === 'ok') cls += ' ok'; else if (av[key] === 'soft') cls += ' soft'; else if (live) cls += ' has'; else if (list.length) cls += ' past'; else if (c === 0 || c === 6) cls += ' weekend';
    const wins = wbd[key] || [];
    if (tsel && isAdjusting(tsel) && wins.indexOf(tsel) >= 0) cls += ' win';
    if (key === D.today) cls += ' today';
    if (key === selDay) cls += ' sel';
    const hol = holidayName(key);
    if (hol && !av[key] && !list.length) cls += ' weekend';
    const aria = (m + 1) + '月' + d + '日（' + WD[c] + '）' + (hol ? ' ' + hol : '') + (key === D.today ? '、今日' : '') + (list.length ? '、卓 ' + list.length + ' 件' : '') +
      (wins.length ? '、調整中 ' + wins.length + ' 件' : '') + (av[key] === 'ok' ? '、全員空き' : av[key] === 'soft' ? '、△あり' : '') + ((D.notes || {})[key] ? '、メモあり' : '');
    html += '<button type="button" class="' + cls + '" data-day="' + key + '" aria-label="' + esc(aria) + '" aria-pressed="' + (key === selDay) + '"' + (key === D.today ? ' aria-current="date"' : '') + '><span class="n' + (c === 0 ? ' sun' : c === 6 ? ' sat' : '') + (hol ? ' hol' : '') + '" title="' + esc(hol) + '">' + d + '</span>' + (hol ? '<span class="hn">' + esc(hol) + '</span>' : '');
    if (av[key] === 'ok') html += '<span class="av">◎</span>'; else if (av[key] === 'soft') html += '<span class="av">△</span>';
    list.forEach((s) => {
      if (isAdjusting(s)) return;   // 調整中はアイコンだけ（下で並べる）
      const today = s.status === '開催' && s.date === D.today;
      const k = s.status === '募集' ? ' adj' : today ? ' held' : s.status === '終了' ? ' done' : s.status === '中止' ? ' cancel' : '';
      html += '<span class="chip' + k + '" title="' + esc(s.name) + '（' + esc(s.status) + (today ? '・今日' : '') + '）">' + mi(today ? 'play_circle' : (STATUS_ICON[s.status] || 'event'), 'xs') + (s.start ? '<span class="t">' + esc(s.start) + ' </span>' : '') + esc(s.name) + '</span>';
    });
    const icos = list.filter((s) => isAdjusting(s) && wins.indexOf(s) < 0).concat(wins).map((s) => {
      const poll = hasPoll(s);
      const label = s.name + (poll ? '（日程調整の候補日　◯ ' + pollOk(s, key).length + '/' + pollVoters(s).length + '）' : '（調整中' + (s.windowLabel ? '　' + s.windowLabel + ' のどこか' : '') + '）');
      return '<span class="cal-ico ' + (poll ? 'cand' : 'win') + '" role="img" aria-label="' + esc(label) + '" title="' + esc(label) + '">' + mi(poll ? 'how_to_vote' : 'edit_calendar', 'xs') + '</span>';
    }).join('');
    if (icos) html += '<span class="cal-icos">' + icos + '</span>';
    const note = (D.notes || {})[key];
    if (note) html += '<span class="chip note" title="' + esc(note.text) + '">' + mi('sticky_note_2', 'xs') + ' ' + esc(note.text.split('\n')[0]) + '</span>';
    html += '</button>';
  }
  $('calendar').innerHTML = html;
  renderDayDetail();
}
export function selectDay(key: string): void {
  const d = parseYmd(key);
  view.y = d.getFullYear(); view.m = d.getMonth(); setSelDay(key); renderCal();
}
function shiftMonth(n: number): void {
  view.m += n;
  while (view.m < 0) { view.m += 12; view.y--; }
  while (view.m > 11) { view.m -= 12; view.y++; }
  renderCal();
}
/** 狭い画面では内訳がカレンダーの下に出る。画面の下のほうに隠れていたら、見える位置まで送る */
export function revealDay(): void {
  if (!selDay || !window.matchMedia || !window.matchMedia('(max-width: 900px)').matches) return;
  const el = $('dayDetail'), top = el.getBoundingClientRect().top;
  if (top >= 0 && top < window.innerHeight * 0.55) return;
  el.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
}

export function init(): void {
  let calSwiped = false;
  $('calendar').addEventListener('click', (ev) => {
    if (calSwiped) return;
    const cell = hit(ev, '.day'); if (!cell || !cell.dataset.day) return;
    const key = cell.dataset.day, byKeyboard = (ev as MouseEvent).detail === 0;
    setSelDay(selDay === key ? '' : key); renderCal();
    if (byKeyboard) { const nb = document.querySelector<HTMLElement>('.cal .day[data-day="' + key + '"]'); if (nb) nb.focus(); }
    if (selDay) revealDay();
  });
  $('prev').onclick = () => { shiftMonth(-1); };
  $('next').onclick = () => { shiftMonth(1); };
  /* スマホ: カレンダーを左右になぞると月を送る。縦のスクロールはそのまま */
  const cal = $('calendar');
  let start: { x: number; y: number; t: number } | null = null;
  cal.addEventListener('pointerdown', (e) => { start = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY, t: Date.now() } : null; });
  cal.addEventListener('pointercancel', () => { start = null; });
  cal.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y, quick = Date.now() - start.t < 800;
    start = null;
    if (!quick || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    calSwiped = true; setTimeout(() => { calSwiped = false; }, 400);
    shiftMonth(dx < 0 ? 1 : -1);
  });
  $('todayBtn').onclick = () => { const t = parseYmd(D.today); view.y = t.getFullYear(); view.m = t.getMonth(); renderCal(); };
  const target = $('target');
  target.addEventListener('change', () => { store('target', target.value); renderCal(); });
}
