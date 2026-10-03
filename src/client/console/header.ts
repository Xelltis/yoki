// 上の帯（「あなた」・代理の札・ログアウト）
import { afLoadMine, renderAvail } from './avail';
import { renderDayDetail } from './day';
import { $ } from './dom';
import { clearCache } from './load';
import { askConfirm } from './modal';
import { me } from './model';
import { renderNotices } from './notices';
import { renderRecruit } from './recruit';
import { D } from './state';

/** ログアウト。サーバーのログインを消して、入口へ戻る */
function logout(): void {
  askConfirm({ title: 'ログアウトしますか？', message: 'このブラウザのログインを消します。次に開くときは、また Discord でログインします。', ok: 'ログアウト', danger: true }, () => {
    clearCache();
    const f = document.createElement('form');
    f.method = 'post'; f.action = '/auth/logout';
    document.body.appendChild(f); f.submit();
  });
}
/** 「代理で入力中」の札。管理者が、ほかの人を選んでいるとき */
export function updateProxy(): void { $('proxyBadge').hidden = !(D && D.me && me() && me() !== D.me.name); }

export function init(): void {
  $('logoutBtn').onclick = logout;
  $('stLogout').onclick = logout;
  const sel = $('me');
  sel.addEventListener('change', () => {
    setTimeout(() => { afLoadMine(); renderAvail(); }, 0);
    updateProxy();
    sel.classList.toggle('need', !sel.value); sel.classList.remove('attn');
    renderAvail(); renderDayDetail(); renderRecruit(); renderNotices();
  });
  // popover に対応していないブラウザでは、ボタンで開け閉めする
  if (!Object.prototype.hasOwnProperty.call(HTMLElement.prototype, 'popover')) {
    document.querySelectorAll<HTMLElement>('[popovertarget]').forEach((b) => {
      b.addEventListener('click', () => {
        const p = document.getElementById(b.getAttribute('popovertarget') || ''); if (!p) return;
        p.classList.toggle('pop-open', b.getAttribute('popovertargetaction') !== 'hide' && !p.classList.contains('pop-open'));
      });
    });
  }
}
