// 設定の画面の「ログインの方法」。Discord（いつも）と、結びつけた Google アカウント（もう 1 つの入り口）。
// 運営者が Google の値を設定していなければ、出さない
import { useState } from 'react';
import type { RpcResult } from '../../../../shared/api';
import { askConfirm } from '../../../ui/confirm';
import { Icon } from '../../../ui/Icon';
import { toast } from '../../../ui/toast';
import { useConsole, useData } from '../context';

const row = 'flex flex-wrap items-center gap-x-12 gap-y-8 border-t border-line py-12 first-of-type:border-t-0';

export function LoginCard() {
  const d = useData();
  const { sync, groupId } = useConsole();
  const [busy, setBusy] = useState(false);
  const g = d.googleLogin;
  if (!g.ready) return null;
  const unlink = () => askConfirm(
    { title: 'Google でのログインを外しますか？', message: 'Google（' + g.email + '）ではログインできなくなります。Discord では、今までどおりログインできます。', ok: '外す', danger: true },
    () => {
      setBusy(true);
      sync.write<RpcResult>('unlinkGoogleLogin').then((res) => { setBusy(false); toast(res.message); }, (e: Error) => { setBusy(false); toast(e.message); });
    },
  );
  return (
    <div className="card" id="loginCard">
      <h3><Icon name="login" size="sm" />ログインの方法</h3>
      <p className="hint">卓予定の利用者は、Discord のアカウントで決まります。Google のアカウントを結びつけると、Google でもログインできます。</p>
      <div>
        <div className={row}>
          <b className="min-w-[6em]">Discord</b>
          <span className="flex-1 text-13 text-muted">{d.me.name + ' のアカウント（いつも使えます）'}</span>
        </div>
        <div className={row}>
          <b className="min-w-[6em]">Google</b>
          {g.email ? (
            <>
              <span className="flex-1 text-13 text-muted" id="googleLoginEmail">{g.email}</span>
              <button type="button" className="btn small danger" id="googleLoginUnlink" disabled={busy} onClick={unlink}><Icon name="link_off" size="sm" />外す</button>
            </>
          ) : (
            <>
              <span className="flex-1 text-13 text-muted">結びつけていません</span>
              <a className="btn small primary" id="googleLoginLink" href={'/auth/google/login?link=1&return_to=' + encodeURIComponent('/g/' + groupId + '/settings/')}>
                <Icon name="add" size="sm" />Google でもログインできるようにする
              </a>
            </>
          )}
        </div>
      </div>
      <p className="hint">カレンダー連携の Google アカウントとは別に決められます（同じアカウントでもかまいません）。</p>
    </div>
  );
}
