// 募集をやめるとき（開催・調整中にするとき）の確認。興味ありの人を参加者にするか、取り下げるかを GM が決める
import type { ConsoleSession } from '../../shared/api';
import { $, esc } from './dom';

/** 参加者にすると決めた興味ありの人。保存し直すときに一度だけ使う */
let promoteAdd: string[] | null = null;
let promoteCb: (() => void) | null = null;

/** 窓を出す。決めたら cb() を呼ぶ（呼んだ側で保存し直す） */
export function askPromote(s: ConsoleSession, st: string, cb: () => void): void {
  $('promoteLead').textContent = '「' + s.name + '」を「' + st + '」にします。' +
    (s.want.length ? '参加希望の ' + s.want.join('、') + ' は参加者に入ります。' : '') +
    '興味ありの人は、参加者にする人だけチェックしてください。チェックしない人は一覧から外れます。';
  $('promoteList').innerHTML = s.interest.map((n) => '<label><input type="checkbox" class="pm" value="' + esc(n) + '">' + esc(n) + '</label>').join('');
  promoteCb = cb;
  $('promoteModal').hidden = false;
  $('promoteModal').querySelector<HTMLElement>('.box')!.focus();
}
/** 決めた人を受け取る（受け取ったら空にする）。まだ決めていなければ null */
export function takePromoteAdd(): string[] | null { const p = promoteAdd; promoteAdd = null; return p; }
function closePromote(picked: string[] | null): void {
  const cb = promoteCb;
  promoteCb = null; $('promoteModal').hidden = true;
  if (picked && cb) { promoteAdd = picked; cb(); }
}
function promotePicked(): string[] {
  const out: string[] = [];
  document.querySelectorAll<HTMLInputElement>('#promoteList input.pm').forEach((cb) => { if (cb.checked) out.push(cb.value); });
  return out;
}
function promoteSetAll(on: boolean): void { document.querySelectorAll<HTMLInputElement>('#promoteList input.pm').forEach((cb) => { cb.checked = on; }); }

export function init(): void {
  $('promoteAll').onclick = () => { promoteSetAll(true); };
  $('promoteNone').onclick = () => { promoteSetAll(false); };
  $('promoteOk').onclick = () => { closePromote(promotePicked()); };
  $('promoteCancel').onclick = () => { closePromote(null); };
  const modal = $('promoteModal');
  modal.addEventListener('click', (ev) => { if (ev.target === modal) closePromote(null); });
}
