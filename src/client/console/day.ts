// 右下: 選んだ日の内訳（その日の卓・メンバーの予定・日付のメモ）
import { api, discordSend, failToast, refetch, useData } from './api';
import { renderCal } from './calendar';
import { daysBetween, fmtJa, timeRange } from './dates';
import { $, esc, hit, mi, toast } from './dom';
import { applySeries, continueFrom, fillForm, openForm, syncNewSessionLabel, syncStatusUi } from './form';
import { askConfirm } from './modal';
import { byId, hasPoll, isActive, isAdjusting, isDated, me, peopleOf, pollOk, pollVoters, seriesNames, sortSessions, targetPeople, windowByDay } from './model';
import { hookFor, kindOf, notifyState } from './notify';
import { openPoll } from './poll';
import { D, selDay } from './state';
import { showTab } from './tabs';

/** Discord に通知したときの進み具合（卓ごと）。描き直しても消えないように */
const notifyRes: Record<string, string> = {};
/** 日付メモの書きかけ（日ごと）。描き直しても消えないように */
const dayNoteDraft: Record<string, string> = {};

export function renderDayDetail(): void {
  $('dayDetail').classList.toggle('nosel', !selDay);
  syncNewSessionLabel();
  if (!selDay) {
    $('dayTitle').textContent = '日を選んでください';
    $('dayBody').className = 'hint';
    $('dayBody').innerHTML = 'カレンダーの日をタップすると、その日の卓の内訳がここに出ます。';
    return;
  }
  const list = sortSessions(D.sessions.filter((s) => s.date === selDay)).concat(windowByDay()[selDay] || []);
  const n = daysBetween(D.today, selDay);
  $('dayTitle').textContent = fmtJa(selDay) + (n === 0 ? '　今日' : n === 1 ? '　明日' : n > 1 ? '　' + n + ' 日後' : '　' + (-n) + ' 日前');
  const marks = D.avail[selDay] || {}, bk = D.booked[selDay] || {};
  let html = '';
  if (!list.length) html += '<div class="hint">この日の卓はありません。</div>';
  list.forEach((s) => {
    const cand = isAdjusting(s) && s.date !== selDay, pollDay = cand && hasPoll(s);
    html += '<div class="sess' + (s.status === '募集' || isAdjusting(s) ? ' adj' : s.status === '終了' ? ' done' : s.status === '中止' ? ' cancel' : '') + '" data-id="' + esc(s.id) + '">';
    html += '<div class="sess-h"><b>' + esc(s.name) + '</b><span>' + (pollDay ? '日程調整の候補日　◯ ' + pollOk(s, selDay).length + '/' + pollVoters(s).length : cand ? '候補の期間 ' + esc(s.windowLabel) + ' のどこか' : esc(timeRange(s))) + '</span><span class="st">' + esc(s.status) + (s.status === '募集' ? '（仮の日）' : cand ? '（候補日）' : '') + '</span></div>';
    html += '<div class="people">' + peopleOf(s).map((p) => {
      const isGm = p === s.gm, known = D.members.some((m) => m.name === p);
      return '<span class="' + (isGm ? 'gm' : '') + (known ? '' : ' no') + '" title="' + (known ? '' : 'メンバーに未登録') + '">' + (isGm ? 'GM ' : '') + esc(p) + '</span>';
    }).join('') + (peopleOf(s).length ? '' : '<span class="no">参加者 未定</span>') + '</div>';
    if (s.place) html += '<div class="row2">場所: ' + esc(s.place) + '</div>';
    if (s.memo) html += '<div class="row2 hint">' + esc(s.memo) + '</div>';
    if (s.notified) html += '<div class="row2 hint">開催前の知らせ 送信済み ' + esc(s.notified) + '</div>';
    else if (isDated(s) && s.date && s.date >= D.today && D.notifySetter) html += '<div class="row2 hint">' + esc(notifyState(s)) + '</div>';
    html += '<div class="btns">' +
      (isActive(s) ? '<button type="button" class="btn small primary" data-notify="' + esc(s.id) + '"' + (hookFor(s.series, kindOf(s)) ? '' : ' disabled title="チャンネル未設定"') + '>Discord に通知</button>' : '') +
      (isAdjusting(s) ? (hasPoll(s) ? '<button type="button" class="btn small" data-goto-recruit>' + mi('how_to_vote', 'sm') + '回答する</button>' : '<button type="button" class="btn small" data-poll="' + esc(s.id) + '">' + mi('how_to_vote', 'sm') + '日程を調整する</button>') : '') +
      '<button type="button" class="btn small" data-edit="' + esc(s.id) + '">編集</button>' +
      '<button type="button" class="btn small" data-cont="' + esc(s.id) + '" title="設定を引き継いで翌日の卓を登録">続きを登録</button>' +
      '<span class="res" data-res="' + esc(s.id) + '">' + esc(notifyRes[s.id] || '') + '</span></div>';
    html += '</div>';
  });
  const people = targetPeople($('target').value);
  if (people.length) {
    html += '<div class="hint" style="margin-top:10px">メンバーの予定（' + esc($('target').value) + '）</div><div class="marks">' + people.map((p) => {
      const v = bk[p] || marks[p] || '可';
      const cls = v === '可' ? 'm-ok' : v === '△' ? 'm-soft' : v === '×' ? 'm-ng' : (v === '参' || v === 'GM') ? 'm-bk' : '';
      const mm = ((D.availNotes || {})[selDay] || {})[p];
      return '<span class="' + cls + (mm ? ' has-memo' : '') + '"' + (mm ? ' data-memo="' + esc(mm.text) + '" data-memo-of="' + esc(p) + '" data-day="' + selDay + '"' : '') + '>' + (mm ? '<span class="mdot"></span>' : '') + esc(p) + ' ' + v + '</span>';
    }).join('') + '</div>';
  }
  const sn = seriesNames();
  html += '<div class="btns" style="margin-top:10px"><button type="button" class="btn small" id="newOnDay">この日に卓を登録</button>' +
    (sn.length ? '<select id="dayCont" class="small" title="シリーズを選ぶと、直前の回の GM・参加者を引き継いでこの日に登録する"><option value="">この日に続きを登録…</option>' + sn.map((x) => '<option value="' + esc(x) + '">' + esc(x) + '</option>').join('') + '</select>' : '') + '</div>';
  const note = (D.notes || {})[selDay];
  html += '<div class="note-box"><div class="hint">この日のメモ' + (note && note.by ? '　' + esc(note.by) + ' が ' + esc(note.at) : '') + '</div>';
  html += '<textarea id="dayNote" aria-label="この日のメモ" placeholder="卓と関係のない予定も書けます（合宿、イベント、忙しい週など）">' + esc(dayNoteDraft[selDay] !== undefined ? dayNoteDraft[selDay] : note ? note.text : '') + '</textarea>' +
    '<div class="btns"><button type="button" class="btn small primary" id="dayNoteSave">メモを保存</button><span class="hint" id="dayNoteMsg"></span></div>';
  html += '</div>';
  $('dayBody').className = '';
  $('dayBody').innerHTML = html;
  $('newOnDay').onclick = () => { fillForm(''); $('date').value = selDay; openForm(); };
  const cont = document.getElementById('dayCont') as HTMLSelectElement | null;
  if (cont) cont.onchange = () => {
    const name = cont.value; if (!name) return;
    fillForm(''); $('series').value = name; applySeries(name); $('date').value = selDay; $('status').value = '開催'; syncStatusUi(); openForm();
  };
  if (document.getElementById('dayNote')) {
    $('dayNoteSave').onclick = () => {
      const day = selDay, text = $('dayNote').value;
      delete dayNoteDraft[day];
      $('dayNoteSave').disabled = true; $('dayNoteMsg').textContent = '保存しています…';
      // 押した瞬間に仮反映
      if (text.trim()) D.notes[day] = { text: text.trim(), by: me(), at: 'いま' }; else delete D.notes[day];
      renderCal();
      api().withSuccessHandler((res) => { toast(res.message); useData(res); })
        .withFailureHandler((e) => { dayNoteDraft[day] = text; $('dayNoteSave').disabled = false; $('dayNoteMsg').textContent = e.message; toast(e.message); refetch(); })
        .setDayNote({ ymd: day, text, me: me() });
    };
  }
}

export function init(): void {
  $('dayBody').addEventListener('input', (ev) => { const t = ev.target; if (t instanceof HTMLTextAreaElement && t.id === 'dayNote') dayNoteDraft[selDay] = t.value; });
  $('dayBody').addEventListener('click', (ev) => {
    const ed = hit(ev, 'button[data-edit]');
    if (ed) { fillForm(ed.dataset.edit!); openForm(); return; }
    if (hit(ev, 'button[data-goto-recruit]')) { showTab('recruit'); return; }
    const pb = hit(ev, 'button[data-poll]');
    if (pb) { openPoll(pb.dataset.poll!); return; }
    const ct = hit(ev, 'button[data-cont]');
    if (ct) { continueFrom(ct.dataset.cont!); return; }
    const mk = hit(ev, '.marks span[data-memo]');
    if (mk) { toast(fmtJa(mk.dataset.day!) + ' ' + mk.dataset.memoOf + ': ' + mk.dataset.memo); return; }
    const nb = hit<HTMLButtonElement>(ev, 'button[data-notify]');
    if (!nb) return;
    const s = byId(nb.dataset.notify); if (!s) return;
    askConfirm({ title: 'Discord に送りますか？', message: '「' + s.name + '」の案内を Discord に送ります。', ok: '送る' }, () => {
      nb.disabled = true;
      discordSend({ kind: 'announce', id: s.id, me: me() },
        (t) => { notifyRes[s.id] = t; const el = document.querySelector('.res[data-res="' + s.id + '"]'); if (el) el.textContent = t; },
        (ok, r) => {
          nb.disabled = false;
          if (r.notified) notifyRes[s.id] += '（今日が開催前の知らせの日なので、開催前の知らせ済みにしました）';
          toast(ok ? 'Discord に送りました: ' + s.name : failToast(r));
          if (r.data) useData(r); else renderDayDetail();
        });
    });
  });
}
