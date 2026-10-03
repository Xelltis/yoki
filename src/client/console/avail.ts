// メンバーの予定のタブ。表（狭い画面では日ごとのリスト）・絞り込み・自分の印
import type { ConsoleSession } from '../../shared/api';
import { api } from './api';
import { openMemo } from './avail-input';
import { renderCal } from './calendar';
import { WD, fmtJa, holidayName, parseYmd } from './dates';
import { $, esc, hit, load, mi, store, toast } from './dom';
import { active, candidatesOf, hasPoll, isRecruit, me, memberOrder, needMe, sortSessions, targetPeople, isAdjusting, windowByDay } from './model';
import { D } from './state';

/** 絞り込み。members・wds は「絞り込み」の中、hol・free・mineOnly は表の上のチップ */
const af = { members: null as string[] | null, wds: [0, 1, 2, 3, 4, 5, 6], hol: false, free: false, mineOnly: false };

/* 「卓で絞る」と「参加者だけ」は、あなたごとに覚える（端末の中だけ） */
function afKey(k: string): string { return 'av' + k + ':' + (me() || '-'); }
export function afLoadMine(): void {
  const t = load(afKey('Target')), sel = $('afTarget');
  sel.value = Array.prototype.some.call(sel.options, (o: HTMLOptionElement) => o.value === t) ? t : '（なし）';
  $('afOnly').checked = load(afKey('Only')) === '1';
  syncAfOnly();
}
function afSaveMine(): void { store(afKey('Target'), $('afTarget').value); store(afKey('Only'), $('afOnly').checked ? '1' : ''); }
function syncAfOnly(): void { /* 「参加者だけ」に合わせて変えるものは、いまは無い */ }
/** 卓を選んだら、その卓の GM と参加者（募集なら参加希望も）だけにする。「（なし）」「全員」なら絞らない */
function afTargetNames(): string[] | null {
  const v = $('afTarget').value;
  if (!v || v === '（なし）' || v === '全員') return null;
  const people = targetPeople(v);
  return people.length ? people : null;
}
/** チェックを付けると、どれかの卓（募集・調整中・開催のどれでも）に入っている人だけにする */
function afActiveNames(): string[] | null {
  if (!$('afOnly').checked) return null;
  const out: string[] = [];
  active().forEach((s) => { candidatesOf(s).forEach((n) => { if (out.indexOf(n) < 0) out.push(n); }); });
  return out;
}
function afVisibleNames(): string[] {
  const mine = me();
  if (af.mineOnly && mine) return [mine];
  let all = memberOrder(D.members.map((m) => m.name));
  [afTargetNames(), afActiveNames()].forEach((only) => { if (only) all = all.filter((n) => only.indexOf(n) >= 0); });
  if (!af.members) return all;
  const members = af.members;
  return all.filter((n) => members.indexOf(n) >= 0);
}

type Mark = '' | '△' | '×';
/** 印の言い方（読み上げと日ごとのリスト）と、押したときの次の印 */
const MARK_WORD: Record<Mark, string> = { '': '参加できる', '△': '調整すれば行ける', '×': '行けない' };
const MARK_NEXT: Record<Mark, Mark> = { '': '△', '△': '×', '×': '' };
/** その人の印（△ か ×）。旧い印（○・参・GM）は空欄とみなす。卓に入っている日は D.booked を見る */
function markIn(marks: Record<string, string>, n: string): Mark { const v = marks[n] || ''; return v === '△' || v === '×' ? v : ''; }

/** 表とリストの 1 日分 */
type Row = {
  key: string; d: Date; dow: number; hol: string; wk: boolean;
  marks: Record<string, string>; bk: Record<string, string>; list: ConsoleSession[]; wins: ConsoleSession[];
  free: boolean; notes: Record<string, { text: string; at: string }>;
};

export function renderAvail(): void {
  const names = afVisibleNames(), mine = me();
  const byDay: Record<string, ConsoleSession[]> = {};
  active().forEach((s) => { if (s.date) (byDay[s.date] = byDay[s.date] || []).push(s); });
  const wbd = windowByDay();
  const from = $('afFrom').value, to = $('afTo').value, cond = $('afCond').value;
  const rows: Row[] = [];
  D.availDays.forEach((key) => {
    const d = parseYmd(key), dow = d.getDay(), hol = holidayName(key), wk = dow === 0 || dow === 6;
    const marks = D.avail[key] || {}, bk = D.booked[key] || {}, list = byDay[key] || [];
    if (from && key < from) return;
    if (to && key > to) return;
    if (af.wds.indexOf(dow) < 0) return;
    if (cond === 'has' && !list.length) return;
    if (cond === 'free' && list.length) return;
    if (cond === 'soft' && !(names.length && names.every((n) => !bk[n] && markIn(marks, n) !== '×'))) return;
    const free = names.length > 0 && names.every((n) => !bk[n] && !markIn(marks, n));
    if (af.hol && !(wk || hol)) return;
    if (af.free && !free) return;
    rows.push({ key, d, dow, hol, wk, marks, bk, list, wins: wbd[key] || [], free, notes: (D.availNotes || {})[key] || {} });
  });
  $('availTable').innerHTML = availTableHtml(names, mine, rows);
  $('availList').innerHTML = availListHtml(names, mine, rows);
  const on: Record<string, boolean> = { hol: af.hol, free: af.free, mine: af.mineOnly };
  document.querySelectorAll<HTMLElement>('#availChips button[data-chip]').forEach((b) => { b.setAttribute('aria-pressed', on[b.dataset.chip!] ? 'true' : 'false'); });
  renderAvailHot();
  const shown = rows.length;
  const filtering = !!(from || to || af.members || af.wds.length < 7 || cond || afTargetNames() || afActiveNames() || af.hol || af.free || af.mineOnly);
  $('afMsg').textContent = filtering ? shown + ' 日を表示' : '';
  $('afSummary').textContent = filtering ? '絞り込み中: ' + shown + ' 日' + (af.members || afTargetNames() || afActiveNames() || af.mineOnly ? '・' + names.length + ' 人' : '') + (cond ? '・' + $('afCond').options[$('afCond').selectedIndex]!.textContent : '') : '';
}
/** その日の卓（募集は「募集」を付ける）と、調整中の卓の名前 */
function availPlans(r: Row): string[] {
  return r.list.map((s) => (isRecruit(s) ? '募集 ' : '') + esc(s.name))
    .concat(r.wins.map((s) => '<span class="hint">' + (hasPoll(s) ? '候補: ' : '調整: ') + esc(s.name) + '</span>'));
}
/** 表。自分の列のマスはボタン（押すと 空 → △ → ×）。ほかの人の列は見るだけ */
function availTableHtml(names: string[], mine: string, rows: Row[]): string {
  const act = active();
  let html = '<tr><th class="d c1">日付</th><th class="d c2">曜</th><th class="d c3">その日の卓</th>' + names.map((n) => {
    const gmN = act.filter((s) => s.gm === n).length, plN = act.filter((s) => s.gm !== n && s.members.indexOf(n) >= 0).length;
    return '<th class="' + (n === mine ? 'mine' : '') + '">' + esc(n) + '<small title="いま動いている卓で GM をしている数と参加している数">GM ' + gmN + '・PL ' + plN + '</small></th>';
  }).join('') + '</tr>';
  rows.forEach((r) => {
    const key = r.key, plans = availPlans(r);
    const cls = (r.wk ? 'wk ' : '') + (r.dow === 0 ? 'sun ' : r.dow === 6 ? 'sat ' : '') + (r.hol ? 'hol ' : '') + (key === D.today ? 'today ' : '') + (r.list.length ? 'has ' : '') + (r.free ? 'free' : '');
    html += '<tr class="' + cls + '"><td class="d c1">' + (r.d.getMonth() + 1) + '/' + r.d.getDate() + '</td><td class="d c2" title="' + esc(r.hol) + '">' + WD[r.dow] + (r.hol ? '<span class="hol-badge">祝</span>' : '') + '</td>' +
      '<td class="d c3">' + (plans.length ? plans.join('、') : r.free ? '<span class="hint">全員空き</span>' : '') + (r.hol ? '<span class="c3-h">' + esc(r.hol) + '</span>' : '') + '</td>';
    names.forEach((n) => {
      const memo = r.notes[n] ? r.notes[n].text : '';
      const memoHtml = memo ? '<span class="mdot"></span>' : '';
      const memoAttr = memo ? ' data-memo="' + esc(memo) + '"' : '';
      const own = n === mine;
      const pen = own ? '<button type="button" class="pen" data-pen="' + key + '" title="この日のメモを書く" aria-label="' + fmtJa(key) + ' のメモを書く">' + mi('edit', 'xs') + '</button>' : '';
      if (r.bk[n]) { html += '<td class="booked' + (own ? ' own' : '') + (memo ? ' has-memo' : '') + '" data-memo-of="' + esc(n) + '" data-day="' + key + '"' + (memo ? memoAttr : ' title="この日の卓に入っています"') + '><span class="bk-tag">' + esc(r.bk[n]) + '</span>' + memoHtml + pen + '</td>'; return; }
      const v = markIn(r.marks, n), mcls = v === '△' ? 'm-soft' : v === '×' ? 'm-ng' : '';
      if (own) html += '<td class="mine own ' + mcls + '"' + memoAttr + '><button type="button" class="mk" data-day="' + key + '" aria-label="' + esc(fmtJa(key) + ' ' + n + ' ' + MARK_WORD[v] + '。押すと' + MARK_WORD[MARK_NEXT[v]]) + '">' + (v || '·') + '</button>' + memoHtml + pen + '</td>';
      else html += '<td class="other ' + mcls + (memo ? ' has-memo' : '') + '" data-memo-of="' + esc(n) + '" data-day="' + key + '"' + memoAttr + '>' + v + memoHtml + '</td>';
    });
    html += '</tr>';
  });
  if (!D.members.length) html += '<tr><td colspan="3" class="hint">メンバーが登録されていません。</td></tr>';
  else if (!rows.length) html += '<tr><td colspan="' + (3 + names.length) + '" class="hint">条件に合う日がありません。</td></tr>';
  return html;
}
/** 日ごとのリスト（狭い画面）。1 日 1 行で、ほかの人の × と △ を名前で並べ、自分の印は ◯ △ × のボタンで打つ */
function availListHtml(names: string[], mine: string, rows: Row[]): string {
  if (!D.members.length) return '<p class="hint">メンバーが登録されていません。</p>';
  if (!rows.length) return '<p class="hint">条件に合う日がありません。</p>';
  const others = names.filter((n) => n !== mine), withMe = !!mine && names.indexOf(mine) >= 0;
  return rows.map((r) => {
    const key = r.key, plans = availPlans(r);
    const ng = others.filter((n) => !r.bk[n] && markIn(r.marks, n) === '×');
    const sk = others.filter((n) => !r.bk[n] && markIn(r.marks, n) === '△');
    const info = (plans.length ? '<div class="plans">' + plans.join('、') + '</div>' : '') +
      (ng.length || sk.length ? '<div>' + (ng.length ? '<span class="ng">× ' + esc(ng.join('、')) + '</span>' : '') + (sk.length ? '<span class="sk">△ ' + esc(sk.join('、')) + '</span>' : '') + '</div>'
        : r.free ? '<div>全員空き</div>' : '') +
      names.filter((n) => r.notes[n]).map((n) => '<div class="memo">' + esc(n) + ': ' + esc(r.notes[n]!.text) + '</div>').join('');
    let pick = '';
    if (withMe) {
      if (r.bk[mine]) pick = '<span class="bk-tag" title="この日の卓に入っています">' + esc(r.bk[mine]) + '</span>';
      else {
        const v = markIn(r.marks, mine);
        pick = ([['', '◯'], ['△', '△'], ['×', '×']] as [Mark, string][]).map((p) =>
          '<button type="button" class="pk" data-day="' + key + '" data-mark="' + p[0] + '" aria-pressed="' + (v === p[0]) + '" aria-label="' + esc(fmtJa(key) + 'を「' + MARK_WORD[p[0]] + '」にする') + '">' + p[1] + '</button>').join('');
      }
      pick += '<button type="button" class="pen" data-pen="' + key + '" title="この日のメモを書く" aria-label="' + fmtJa(key) + ' のメモを書く">' + mi('edit', 'xs') + '</button>';
    }
    const cls = 'avl-day' + (r.dow === 0 || r.hol ? ' sun' : r.dow === 6 ? ' sat' : '') + (key === D.today ? ' today' : '') + (r.free ? ' free' : '');
    return '<div class="' + cls + '"><div class="d">' + (r.d.getMonth() + 1) + '/' + r.d.getDate() + '<small>' + WD[r.dow] + (r.hol ? ' ' + esc(r.hol) : '') + '</small></div>' +
      '<div class="info">' + info + '</div>' + (pick ? '<div class="pick">' + pick + '</div>' : '') + '</div>';
  }).join('');
}
/** 表の上の帯。日の決まっていない募集中・調整中の卓を出し、押すとその卓の人だけに絞る */
function renderAvailHot(): void {
  const box = $('availHot'), rec = sortSessions(active().filter(isRecruit)), adj = sortSessions(active().filter(isAdjusting));
  if (!rec.length && !adj.length) { box.hidden = true; box.innerHTML = ''; return; }
  const cur = $('afTarget').value;
  const chip = (s: ConsoleSession, label: string) => '<button type="button" class="' + (cur === s.name ? 'on' : '') + '" data-hot="' + esc(s.name) + '">' + esc(s.name) + '<span class="hint"> ' + esc(label) + '</span></button>';
  box.innerHTML = '<span class="hb-l">' + mi('campaign', 'sm') + '日が未定の卓</span>' +
    rec.map((s) => chip(s, '募集 ' + (s.windowLabel || '期間未定'))).join('') +
    adj.map((s) => chip(s, '調整 ' + (s.windowLabel || '期間未定'))).join('') +
    '<span class="hint">押すと、その卓の人だけに絞ります</span>';
  box.hidden = false;
}
/** 「絞り込み」の中の、メンバーと曜日のチェック */
export function buildFilter(): void {
  const box = $('afMembers');
  box.innerHTML = '';
  D.members.forEach((m) => {
    const lab = document.createElement('label'), cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = m.name; cb.className = 'afm';
    cb.checked = !af.members || af.members.indexOf(m.name) >= 0;
    lab.appendChild(cb); lab.appendChild(document.createTextNode(m.name)); box.appendChild(lab);
  });
  if (!$('afWds').children.length) {
    WD.forEach((w, i) => {
      const lab = document.createElement('label'), cb = document.createElement('input');
      lab.className = i === 0 ? 'sun' : i === 6 ? 'sat' : '';
      cb.type = 'checkbox'; cb.value = String(i); cb.checked = true; cb.className = 'afwd';
      lab.appendChild(cb); lab.appendChild(document.createTextNode(w)); $('afWds').appendChild(lab);
    });
  }
}
function readFilter(): void {
  const cbs = document.querySelectorAll<HTMLInputElement>('input.afm'), sel: string[] = [];
  cbs.forEach((cb) => { if (cb.checked) sel.push(cb.value); });
  af.members = sel.length === cbs.length ? null : sel;
  af.wds = [];
  document.querySelectorAll<HTMLInputElement>('input.afwd').forEach((cb) => { if (cb.checked) af.wds.push(+cb.value); });
  renderAvail();
}
/* 折り畳み。開閉はブラウザが覚える */
const FOLD_LABEL: Record<string, string> = { availFilter: '絞り込み', availBulk: 'まとめて入れる' };
function setFold(id: string, open: boolean): void {
  const box = $(id), btn = document.querySelector<HTMLElement>('.fold[data-target="' + id + '"]')!;
  box.hidden = !open;
  btn.className = 'btn small fold' + (open ? ' on' : '');
  btn.innerHTML = mi(open ? 'expand_more' : 'chevron_right', 'sm') + (FOLD_LABEL[id] || id);
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  store('fold.' + id, open ? '1' : '0');
}
/** 自分の印を変える。押した瞬間に画面へ出し、保存できなかったら戻す。focus は描き直したあとに戻すボタン */
function setMyMark(key: string, next: Mark, focus: string): void {
  const name = me(); if (!name) { needMe(); return; }
  const cur = (D.avail[key] || {})[name] || '';
  if (next === markIn(D.avail[key] || {}, name)) return;
  if (!D.avail[key]) D.avail[key] = {};
  const day = D.avail[key];
  if (next) day[name] = next; else delete day[name];
  renderAvail(); renderCal();
  const b = focus ? document.querySelector<HTMLElement>(focus) : null; if (b) b.focus();
  api().withSuccessHandler(() => { toast(fmtJa(key) + ' ' + name + ': ' + (next || '空欄')); })
    .withFailureHandler((e) => { if (cur) day[name] = cur; else delete day[name]; renderAvail(); renderCal(); toast('保存できませんでした: ' + e.message); })
    .setAvailability({ name, ymd: key, mark: next });
}

export function init(): void {
  $('afTarget').addEventListener('change', () => { syncAfOnly(); afSaveMine(); renderAvail(); });
  $('afOnly').addEventListener('change', () => { afSaveMine(); renderAvail(); });
  $('availHot').addEventListener('click', (ev) => {
    const b = hit(ev, 'button[data-hot]'); if (!b) return;
    $('afTarget').value = $('afTarget').value === b.dataset.hot ? '（なし）' : b.dataset.hot!;
    afSaveMine(); renderAvail();
  });
  $('availFilter').addEventListener('change', readFilter);
  document.querySelector('.fold-bar')!.addEventListener('click', (ev) => {
    const b = hit(ev, '.fold'); if (!b) return;
    setFold(b.dataset.target!, !!$<HTMLElement>(b.dataset.target!).hidden);
  });
  setFold('availFilter', load('fold.availFilter') === '1');
  setFold('availBulk', load('fold.availBulk') === '1');
  $('afMe').onclick = () => {
    const n = me(); if (!n) { needMe(); return; }
    document.querySelectorAll<HTMLInputElement>('input.afm').forEach((cb) => { cb.checked = cb.value === n; });
    readFilter();
  };
  $('afAllMembers').onclick = () => { document.querySelectorAll<HTMLInputElement>('input.afm').forEach((cb) => { cb.checked = true; }); readFilter(); };
  $('afReset').onclick = () => {
    $('afFrom').value = ''; $('afTo').value = ''; $('afCond').value = '';
    $('afTarget').value = '（なし）'; $('afOnly').checked = false; syncAfOnly(); afSaveMine();
    af.hol = false; af.free = false; af.mineOnly = false;
    document.querySelectorAll<HTMLInputElement>('input.afm, input.afwd').forEach((cb) => { cb.checked = true; });
    readFilter();
  };
  /* ドラッグで表をスクロール（マウス）。少し動かしたらクリック扱いにしない */
  let suppressClick = false;
  const w = document.querySelector<HTMLElement>('#tab-avail .wrap.avail')!;
  let drag: { x: number; y: number; l: number; t: number; moved: boolean } | null = null;
  w.addEventListener('mousedown', (e) => { if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, l: w.scrollLeft, t: w.scrollTop, moved: false }; });
  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
    drag.moved = true; w.classList.add('dragging');
    w.scrollLeft = drag.l - dx; w.scrollTop = drag.t - dy; e.preventDefault();
  });
  window.addEventListener('mouseup', () => {
    if (drag && drag.moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
    drag = null; w.classList.remove('dragging');
  });
  $('availTable').addEventListener('click', (ev) => {
    if (suppressClick) return;
    const pen = hit(ev, 'button[data-pen]');
    if (pen) { openMemo(pen.dataset.pen!); return; }
    const b = hit(ev, 'button.mk');
    if (b) { const key = b.dataset.day!; setMyMark(key, MARK_NEXT[markIn(D.avail[key] || {}, me())], '#availTable button.mk[data-day="' + key + '"]'); return; }
    const o = hit(ev, 'td[data-memo-of]');
    if (o && o.dataset.memo) toast(fmtJa(o.dataset.day!) + ' ' + o.dataset.memoOf + ': ' + o.dataset.memo);
  });
  $('availList').addEventListener('click', (ev) => {
    const pen = hit(ev, 'button[data-pen]');
    if (pen) { openMemo(pen.dataset.pen!); return; }
    const b = hit(ev, 'button[data-mark]'); if (!b) return;
    setMyMark(b.dataset.day!, b.dataset.mark as Mark, '#availList button[data-day="' + b.dataset.day + '"][data-mark="' + b.dataset.mark + '"]');
  });
  /* 表の上のチップ。押すたびに入り切り */
  $('availChips').addEventListener('click', (ev) => {
    const b = hit(ev, 'button[data-chip]'); if (!b) return;
    const k = ({ hol: 'hol', free: 'free', mine: 'mineOnly' } as const)[b.dataset.chip as 'hol' | 'free' | 'mine'];
    af[k] = !af[k];
    renderAvail();
  });
}
