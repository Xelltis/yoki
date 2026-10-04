// 管理画面の「知らせ」の「シリーズごとの上書き」。シリーズ専用のチャンネルと、開催前の知らせの日時
import type { SeriesNotifyView } from '../../shared/api';
import { api, discordSend, failToast, refetch, useData } from './api';
import { channelLabel, fillChannelSelect, markDirty } from './channels';
import { $, esc, hit, toast } from './dom';
import { askConfirm } from './modal';
import { me, seriesNames } from './model';
import { baseDays, baseHour, hasVal, snEntry, whenText } from './notify';
import { stCall } from './settings';
import { D } from './state';

/** 書きかけ。読み込み直しても上書きしない */
let snDraft = false;

/** 「何日前」と「何時台」の欄を読む。空や範囲外なら err に理由 */
export function readWhen(dId: string, hId: string): { days: number; hour: number; err: string } {
  const dv = $(dId).value.trim(), hv = $(hId).value.trim(), out = { days: +dv, hour: +hv, err: '' };
  const dOk = /^\d{1,2}$/.test(dv) && out.days <= 30, hOk = /^\d{1,2}$/.test(hv) && out.hour <= 23;
  $(dId).classList.toggle('bad', !dOk); $(hId).classList.toggle('bad', !hOk);
  if (!dOk) out.err = '何日前かは 0〜30 の数で入れてください（0 は当日、1 は前日）。';
  else if (!hOk) out.err = '時刻は 0〜23 の数で入れてください。';
  return out;
}
function snWhere(e: SeriesNotifyView | null, withName?: boolean): string {
  if (!e || !e.channelId) return D.channelSet ? '基本のチャンネル' : '送り先なし（基本のチャンネルが未設定）';
  return '専用のチャンネル' + (withName ? '（' + channelLabel(e.channelId) + '）' : '') + (e.alsoBase && D.channelSet ? ' ＋ 基本のチャンネル' : '');
}
function snWhenText(e: SeriesNotifyView | null): string {
  if (!e || (!hasVal(e.days) && !hasVal(e.hour))) return '基本と同じ（' + whenText(baseDays(), baseHour()) + '）';
  return whenText(hasVal(e.days) ? e.days : baseDays(), hasVal(e.hour) ? e.hour : baseHour());
}
export function renderSeriesNotify(): void {
  const list = D.seriesNotify || [], names = seriesNames().slice();
  list.forEach((x) => { if (names.indexOf(x.series) < 0) names.push(x.series); });
  const sel = $('snSeries'), keep = sel.value;
  sel.innerHTML = '';
  const o0 = document.createElement('option');
  o0.value = ''; o0.textContent = names.length ? '（シリーズを選ぶ）' : '（シリーズの卓がまだありません）';
  sel.appendChild(o0);
  names.forEach((n) => { const o = document.createElement('option'); o.value = n; o.textContent = n + (snEntry(n) ? '（設定あり）' : ''); sel.appendChild(o); });
  sel.value = names.indexOf(keep) >= 0 ? keep : '';
  sel.disabled = !names.length;
  $('snSameLbl').textContent = '開催前の知らせは基本と同じ日時（' + whenText(baseDays(), baseHour()) + '）';
  let h = '';
  if (list.length) {
    h = '<tr><th>シリーズ</th><th>送り先</th><th>開催前の知らせ</th></tr>';
    list.forEach((x) => { h += '<tr data-sn="' + esc(x.series) + '" tabindex="0"><td>' + esc(x.series) + '</td><td>' + esc(snWhere(x)) + '</td><td class="nw">' + esc(snWhenText(x)) + '</td></tr>'; });
  }
  $('snList').innerHTML = h; $('snListWrap').hidden = !list.length;
  if (!snDraft || !sel.value) { snDraft = false; fillSeriesNotify(); } else syncSnButtons();
}
function fillSeriesNotify(): void {
  const name = $('snSeries').value, e = snEntry(name);
  $('snFields').hidden = !name;
  if (!name) return;
  $('snNow').textContent = 'いま: ' + snWhere(e, true) + '、開催前の知らせは' + snWhenText(e);
  markDirty('snChannel', false);
  fillSeriesChannel();
  $('snAlsoBase').checked = e ? !!e.alsoBase : true;
  $('snSame').checked = !(e && (hasVal(e.days) || hasVal(e.hour)));
  $('snDays').value = String(e && hasVal(e.days) ? e.days : baseDays());
  $('snHour').value = String(e && hasVal(e.hour) ? e.hour : baseHour());
  $('snDays').classList.remove('bad'); $('snHour').classList.remove('bad'); $('snMsg').classList.remove('bad');
  syncSnButtons();
}
/** 選んでいるシリーズの、チャンネルの選択を作り直す（一覧を読んだときにも呼ばれる） */
export function fillSeriesChannel(): void {
  const name = $('snSeries').value; if (!name) return;
  const e = snEntry(name);
  fillChannelSelect('snChannel', e ? e.channelId : '', '専用にしない（基本のチャンネルへ）');
  syncSnButtons();
}
function syncSnButtons(): void {
  const e = snEntry($('snSeries').value);
  $('snAlsoBase').disabled = !$('snChannel').value;   // 専用のチャンネルが無ければ、もともと基本のチャンネルへ送る
  $('snTest').disabled = !(e && e.channelId);
  $('snRemove').disabled = !e;
  $('snWhen').hidden = $('snSame').checked;   // 基本と同じなら、日時の欄は出さない
}
function pickSeriesNotify(name: string): void { $('snSeries').value = name; snDraft = false; $('snMsg').textContent = ''; fillSeriesNotify(); }

export function init(): void {
  $('snSeries').addEventListener('change', () => { pickSeriesNotify($('snSeries').value); });
  $('snList').addEventListener('click', (ev) => { const tr = hit(ev, 'tr[data-sn]'); if (tr) pickSeriesNotify(tr.dataset.sn!); });
  $('snList').addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const tr = hit(ev, 'tr[data-sn]'); if (!tr) return;
    ev.preventDefault(); pickSeriesNotify(tr.dataset.sn!);
  });
  ['snChannel', 'snAlsoBase', 'snSame', 'snDays', 'snHour'].forEach((id) => {
    ['input', 'change'].forEach((t) => { $(id).addEventListener(t, () => { snDraft = true; syncSnButtons(); }); });
  });
  $('snChannel').addEventListener('change', () => { markDirty('snChannel', true); });
  $('snSave').onclick = () => {
    const name = $('snSeries').value; if (!name) return;
    const form: Record<string, unknown> = { series: name, alsoBase: $('snAlsoBase').checked, days: '', hour: '', me: me() };
    if (!$('snSame').checked) {
      const wn = readWhen('snDays', 'snHour');
      if (wn.err) { $('snMsg').textContent = wn.err; $('snMsg').classList.add('bad'); return; }
      form.days = String(wn.days); form.hour = String(wn.hour);
    }
    $('snMsg').classList.remove('bad');
    // チャンネルは変えたときだけ送る（変えなければサーバーは今のまま。'' なら外す）
    const e = snEntry(name), ch = $('snChannel').value;
    if (ch !== (e ? e.channelId : '')) form.channelId = ch;
    markDirty('snChannel', false);
    const btn = $('snSave'); btn.disabled = true; $('snMsg').textContent = '保存しています…';
    api().withSuccessHandler((res) => {
      btn.disabled = false; snDraft = false; toast(res.message);
      useData(res, () => { $('snMsg').textContent = res.message; });
      $('snMsg').textContent = res.message;
    }).withFailureHandler((e) => { btn.disabled = false; $('snMsg').textContent = e.message; $('snMsg').classList.add('bad'); toast(e.message); }).saveSeriesNotify(form);
  };
  $('snTest').onclick = () => {
    const name = $('snSeries').value; if (!name) return;
    $('snTest').disabled = true;
    discordSend({ kind: 'test', series: name },
      (t) => { $('snMsg').textContent = t; },
      (ok, r) => { syncSnButtons(); toast(ok ? '「' + name + '」のチャンネルに届きました' : failToast(r)); refetch(() => {}); });
  };
  $('snRemove').onclick = () => {
    const name = $('snSeries').value; if (!name || !snEntry(name)) return;
    askConfirm({ title: '「' + name + '」の通知の設定を消しますか？', message: 'このシリーズの卓は、基本のチャンネルへ基本の時刻に送るようになります。', ok: '消す', danger: true },
      () => { snDraft = false; stCall('snRemove', 'snMsg', 'saveSeriesNotify', { series: name, remove: true }); });
  };
}
