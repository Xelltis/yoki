// 上の帯（ログアウト）。「あなた」の名前は render.ts が出す
import { $ } from './dom';
import { clearCache } from './load';
import { askConfirm } from './modal';

/** ログアウト。サーバーのログインを消して、入口へ戻る */
function logout(): void {
  askConfirm({ title: 'ログアウトしますか？', message: 'このブラウザのログインを消します。次に開くときは、また Discord でログインします。', ok: 'ログアウト', danger: true }, () => {
    clearCache();
    const f = document.createElement('form');
    f.method = 'post'; f.action = '/auth/logout';
    document.body.appendChild(f); f.submit();
  });
}
export function init(): void {
  $('logoutBtn').onclick = logout;
  $('stLogout').onclick = logout;
}
