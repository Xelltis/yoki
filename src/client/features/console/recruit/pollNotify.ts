// 日程調整の知らせの送り直し。ふだんはサーバーが送り、届かなかったときだけ画面から送り直す
import { toast } from '../../../ui/toast';
import { discordSend, failToast } from '../api/discord';
import type { ConsoleSync } from '../api/sync';
import { byId, me } from '../model/model';
import { hookFor } from '../model/notify';

/** 開催日が決まったことを Discord で知らせる */
export function notifyDecided(sync: ConsoleSync, id: string, msg: string): void {
  const d = sync.data()!, s = byId(d, id);
  if (!hookFor(d, s ? s.series : undefined)) return;
  void discordSend(sync, { kind: 'decided', id, me: me(d) }, () => {}).then(({ ok, r }) => { toast(msg + (ok ? '　Discord にも送りました。' : '　' + failToast(r))); });
}

/** 全員の回答がそろったことを GM に知らせる */
export function notifyReady(sync: ConsoleSync, id: string, msg: string): void {
  const d = sync.data()!, s = byId(d, id);
  if (!hookFor(d, s ? s.series : undefined)) return;
  void discordSend(sync, { kind: 'pollReady', id, me: me(d) }, () => {}).then(({ ok, r }) => { toast(msg + (ok ? '　GM に Discord で知らせました。' : '　' + failToast(r))); });
}
