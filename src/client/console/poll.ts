// 日程調整: 候補日を選ぶ窓。決まったこと・回答がそろったことを Discord で知らせ直す
import type { ConsoleSession } from '../../shared/api';
import { api, discordSend, failToast, takeData } from './api';
import { addDaysYmd, fmtJa, holidayName, parseYmd } from './dates';
import { $, esc, hit, toast } from './dom';
import { byId, hasPoll, me, peopleOf } from './model';
import { hookFor } from './notify';
import { D } from './state';

let pollId = '';
/** 選んでいる候補日 */
let pollSel: Record<string, true> = {};
/** 窓で足した日（候補の期間の外） */
let pollExtra: string[] = [];

/** 選べる日。候補の期間があればその中、無ければ予定表の範囲。足した日と選んでいる日も入れる */
function pollRange(s: ConsoleSession): string[] {
  const out: string[] = [];
  let from = D.today, to = D.availDays[D.availDays.length - 1] || addDaysYmd(D.today, 59);
  if (s.windowFrom && s.windowTo && s.windowTo >= D.today) { from = s.windowFrom < D.today ? D.today : s.windowFrom; to = s.windowTo; }
  for (let d = from, i = 0; d <= to && i < 120; d = addDaysYmd(d, 1), i++) out.push(d);
  Object.keys(pollSel).concat(pollExtra).forEach((k) => { if (k >= D.today && out.indexOf(k) < 0) out.push(k); });
  return out.sort();
}
/** その日の GM・参加者の予定。空欄は参加できる扱い */
function pollDayAvail(s: ConsoleSession, k: string): { free: boolean; html: string } {
  if (D.availDays.indexOf(k) < 0) return { free: false, html: '<span class="na">予定表の範囲外</span>' };
  const marks = D.avail[k] || {}, bk = D.booked[k] || {}, items: { n: string; v: string }[] = [];
  peopleOf(s).forEach((n) => { let v = bk[n] || marks[n] || ''; if (v === '○') v = ''; if (v) items.push({ n, v }); });
  if (!items.length) return { free: true, html: '<span class="ok">全員空き</span>' };
  return {
    free: false,
    html: items.map((x) => {
      const c = x.v === '△' ? 'soft' : x.v === '×' ? 'ng' : 'bk';
      return '<span class="' + c + '">' + (c === 'bk' ? '卓あり' : x.v) + ' ' + esc(x.n) + '</span>';
    }).join(''),
  };
}
function renderPollDays(): void {
  const s = byId(pollId); if (!s) return;
  const okOnly = $('pollOkOnly').checked;
  let html = '', shown = 0;
  pollRange(s).forEach((k) => {
    const a = pollDayAvail(s, k), on = !!pollSel[k];
    if (okOnly && !a.free && !on) return;
    shown++;
    const dow = parseYmd(k).getDay(), hol = holidayName(k);
    html += '<label class="pday' + (on ? ' checked' : '') + '"><input type="checkbox" class="pdc" value="' + k + '"' + (on ? ' checked' : '') + '>' +
      '<span class="pd-date' + (dow === 0 || hol ? ' sun' : dow === 6 ? ' sat' : '') + '">' + fmtJa(k) + (hol ? '<small> ' + esc(hol) + '</small>' : '') + '</span><span class="pd-av">' + a.html + '</span></label>';
  });
  if (!shown) html = '<div class="hint" style="padding:10px">' + (okOnly ? '全員が空いている日はありません。「全員空きの日だけ」を外してください。' : '選べる日がありません。下の欄で日を足してください。') + '</div>';
  $('pollDays').innerHTML = html;
  const n = Object.keys(pollSel).length;
  $('pollCount').textContent = n ? n + ' 日を選んでいます' : '';
  $('pollSend').disabled = !n;
}
export function openPoll(id: string): void {
  const s = byId(id); if (!s) return;
  if (!s.members.length) { toast('「' + s.name + '」にはまだ参加者がいません。「編集」で入れてから調整します'); return; }
  pollId = id; pollSel = {}; pollExtra = [];
  (s.candidates || []).forEach((k) => { if (k >= D.today) pollSel[k] = true; });
  $('pollTitle').textContent = '「' + s.name + '」の日程を調整する';
  $('pollWho').textContent = '候補日を選んでください。各日の右に、' + peopleOf(s).join('、') + ' の予定が出ます。' + '全員が答えると GM に知らせが届き、GM が選んだ日が開催日になります。';
  $('pollStart').value = s.start || ''; $('pollEnd').value = s.end || '';
  $('pollOkOnly').checked = false;
  const canPoll = hookFor(s.series);
  $('pollNotify').disabled = !canPoll; $('pollNotify').checked = canPoll;
  $('pollNotifyHint').textContent = canPoll ? '' : '（チャンネル未設定）';
  $('pollSend').textContent = hasPoll(s) ? 'この候補日に変える' : 'この候補日で聞く';
  $('pollMsg').textContent = '';
  renderPollDays();
  $('pollModal').hidden = false;
  $('pollModal').querySelector('.box')!.scrollTop = 0;
}
/** 決まったことを Discord で知らせる。ふだんはサーバーが送り、失敗したときだけ画面から送り直す */
export function notifyDecided(id: string, msg: string): void {
  const sd = byId(id); if (!hookFor(sd ? sd.series : undefined)) return;
  discordSend({ kind: 'decided', id, me: me() }, () => {}, (ok, r) => { toast(msg + (ok ? '　Discord にも送りました。' : '　' + failToast(r))); });
}
/** 全員の回答がそろったことを GM に知らせる。ふだんはサーバーが送り、失敗したときだけ画面から送り直す */
export function notifyReady(id: string, msg: string): void {
  const sd = byId(id); if (!hookFor(sd ? sd.series : undefined)) return;
  discordSend({ kind: 'pollReady', id, me: me() }, () => {}, (ok, r) => { toast(msg + (ok ? '　GM に Discord で知らせました。' : '　' + failToast(r))); });
}

export function init(): void {
  $('pollDays').addEventListener('change', (ev) => {
    const c = hit<HTMLInputElement>(ev, 'input.pdc'); if (!c) return;
    if (c.checked) pollSel[c.value] = true; else delete pollSel[c.value];
    renderPollDays();
  });
  $('pollOkOnly').addEventListener('change', renderPollDays);
  $('pollAddBtn').onclick = () => {
    const k = $('pollAddDate').value; if (!k) return;
    if (k < D.today) { $('pollMsg').textContent = '過ぎた日は候補にできません。'; return; }
    $('pollMsg').textContent = '';
    pollExtra.push(k); pollSel[k] = true; $('pollAddDate').value = '';
    renderPollDays();
  };
  $('pollClose').onclick = () => { $('pollModal').hidden = true; };
  $('pollForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const s = byId(pollId); if (!s) return;
    const dates = Object.keys(pollSel).sort();
    if (!dates.length) { $('pollMsg').textContent = '候補日を 1 日以上選んでください。'; return; }
    const wantNotify = $('pollNotify').checked && hookFor(s.series);
    $('pollSend').disabled = true; $('pollMsg').textContent = '';
    api().withSuccessHandler((res) => {
      $('pollSend').disabled = false; $('pollModal').hidden = true;
      toast(res.message); takeData(res);
      if (!wantNotify) return;
      discordSend({ kind: 'poll', id: res.id, me: me() }, () => {}, (ok, r) => { toast(res.message + (ok ? '　Discord に送りました。' : '　' + failToast(r))); });
    }).withFailureHandler((e) => { $('pollSend').disabled = false; $('pollMsg').textContent = e.message; })
      .startPoll({ id: pollId, dates, start: $('pollStart').value, end: $('pollEnd').value, me: me() });
  });
}
