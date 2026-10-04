// メンバーの予定の入力: 予定のメモ（自分のマスの鉛筆から）と、まとめて入れる
import { api, refetch, useData } from './api';
import { renderAvail } from './avail';
import { WD, fmtJa } from './dates';
import { renderDayDetail } from './day';
import { $, toast } from './dom';
import { askConfirm } from './modal';
import { me } from './model';
import { D } from './state';

/* 予定のメモ。押した瞬間に画面へ出し、返事で確定する */
let memoDay = '';
export function openMemo(key: string): void {
  const name = me(); if (!name) return;
  memoDay = key;
  const cur = ((D.availNotes || {})[key] || {})[name];
  $('memoTitle').textContent = fmtJa(key) + '　' + name + ' のメモ';
  $('memoText').value = cur ? cur.text : '';
  $('memoClear').hidden = !cur;
  $('memoModal').hidden = false;
  $('memoText').focus();
}
function saveMemo(text: string): void {
  const name = me(), key = memoDay; if (!name || !key) return;
  $('memoModal').hidden = true;
  D.availNotes = D.availNotes || {};
  if (!D.availNotes[key]) D.availNotes[key] = {};
  if (text.trim()) D.availNotes[key][name] = { text: text.trim(), at: 'いま' }; else delete D.availNotes[key][name];
  renderAvail(); renderDayDetail();
  api().withSuccessHandler((res) => { toast(res.message); useData(res); })
    .withFailureHandler((e) => { toast(e.message); refetch(); })
    .setAvailNote({ name, ymd: key, text });
}

/* まとめて入れる */
function setWds(pred: (d: number) => boolean): void { document.querySelectorAll<HTMLInputElement>('input.wd').forEach((cb) => { cb.checked = pred(+cb.value); }); }
/** 期間の欄が空なら、今日から予定表の最後の日まで */
export function initBulkRange(): void {
  if (!$('abFrom').value) $('abFrom').value = D.today;
  if (!$('abTo').value) $('abTo').value = D.availDays[D.availDays.length - 1] || '';
}

export function init(): void {
  $('memoForm').addEventListener('submit', (ev) => { ev.preventDefault(); saveMemo($('memoText').value); });
  $('memoClear').onclick = () => { saveMemo(''); };
  $('memoCancel').onclick = () => { $('memoModal').hidden = true; };

  const box = $('abWds');
  WD.forEach((w, i) => {
    const lab = document.createElement('label'), cb = document.createElement('input');
    lab.className = i === 0 ? 'sun' : i === 6 ? 'sat' : '';
    cb.type = 'checkbox'; cb.value = String(i); cb.checked = true; cb.className = 'wd';
    lab.appendChild(cb); lab.appendChild(document.createTextNode(w)); box.appendChild(lab);
  });
  $('abWeekday').onclick = () => { setWds((d) => d >= 1 && d <= 5); };
  $('abWeekend').onclick = () => { setWds((d) => d === 0 || d === 6); };
  $('abAll').onclick = () => { setWds(() => true); };
  $('abRun').onclick = () => {
    const name = me(); if (!name) return;
    const wds: number[] = [];
    document.querySelectorAll<HTMLInputElement>('input.wd').forEach((cb) => { if (cb.checked) wds.push(+cb.value); });
    const form = { name, from: $('abFrom').value, to: $('abTo').value, weekdays: wds, mark: $('abMark').value, keep: $('abKeep').checked };
    if (!form.from || !form.to) { $('abMsg').textContent = '期間を入れてください。'; return; }
    if (!wds.length) { $('abMsg').textContent = '曜日を選んでください。'; return; }
    const markText = $('abMark').options[$('abMark').selectedIndex]!.textContent;
    askConfirm({ title: '自分の列にまとめて入れますか？', message: name + ' の ' + fmtJa(form.from) + '〜' + fmtJa(form.to) + '（' + wds.map((d) => WD[d]).join('') + '）に「' + markText + '」を入れます。' + (form.keep ? '\n入力済みのマスは残します。' : '\n入力済みのマスも上書きします。'), ok: '入れる' }, () => {
      $('abRun').disabled = true; $('abMsg').textContent = '保存しています…';
      api().withSuccessHandler((res) => { $('abRun').disabled = false; $('abMsg').textContent = res.message; toast(res.message); useData(res); })
        .withFailureHandler((e) => { $('abRun').disabled = false; $('abMsg').textContent = e.message; toast(e.message); })
        .setAvailabilityBulk(form);
    });
  };
}
