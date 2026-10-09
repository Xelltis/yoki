// 設定の「DMの知らせ」。自分がGMか参加者の卓の知らせを、チャンネルに加えてBotのDMでも受け取る（種類は本人が選ぶ。どのグループにも効く）
import { useState } from 'react';
import { DM_KINDS, type DmKind, type RpcResult } from '../../../../shared/api';
import { Icon } from '../../../ui/Icon';
import { toast } from '../../../ui/toast';
import { useConsole, useData } from '../context';

const KINDS = Object.keys(DM_KINDS) as DmKind[];

export function DmCard() {
  const d = useData();
  const { sync } = useConsole();
  const [busy, setBusy] = useState(false);
  const { kinds, error } = d.me.dm;
  const run = (fn: 'setDmNotices' | 'testDm', form: object) => {
    setBusy(true);
    sync.write<RpcResult>(fn, form).then((r) => { setBusy(false); toast(r.message); }, (e: Error) => { setBusy(false); toast(e.message); });
  };
  const toggle = (k: DmKind, on: boolean) => run('setDmNotices', { kinds: KINDS.filter((x) => (x === k ? on : kinds.includes(x))) });
  return (
    <div className="card" id="dmCard">
      <h3><Icon name="notifications" size="sm" />DMの知らせ</h3>
      <p className="hint">自分がGMか参加者の卓の知らせを、チャンネルに加えて、YokiのBotからのDMでも受け取れます。選んだものだけが届き、あなたが入っているどのグループにも効きます。届くのは、Botと同じサーバーにいて、サーバーのメンバーからのDMを許しているときだけです。</p>
      {KINDS.map((k) => (
        <label className="chk" key={k}><input type="checkbox" id={'dm_' + k} data-dm-kind={k} checked={kinds.includes(k)} disabled={busy} onChange={(ev) => toggle(k, ev.target.checked)} /> {DM_KINDS[k]}</label>
      ))}
      {error && <p className="mt-6 text-13 text-err-text" id="dmError" role="alert">{'最後のDMは届きませんでした: ' + error}</p>}
      <div className="btns mt-8">
        <button type="button" className="btn small" id="dmTest" disabled={busy} onClick={() => run('testDm', {})}>試しにDMを送る</button>
      </div>
    </div>
  );
}
