// 運営者の管理画面（/admin/<区分>/）の外枠。上の帯・左の区分（e2e は #opNav の data-set を押す）・区分の中身・窓・吹き出し。
// すべてのグループと利用者を見渡し、困ったときに手を入れる。グループの中身（卓・予定）は見ない
import '../../ui/app.css';
import './operator.css';
import { useQueryClient } from '@tanstack/react-query';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { OPERATOR_PANES, type OperatorPane } from '../../../shared/routes';
import { store } from '../../app/storage';
import { actions, appbar, areaBadge, brand, btxt, hbtn, hbtnIcon, logo, mainArea } from '../../ui/chrome';
import { ConfirmDialog } from '../../ui/confirm';
import { Icon } from '../../ui/Icon';
import { ModalManager } from '../../ui/Modal';
import { Toast, toast } from '../../ui/toast';
import { ADMIN_READS, adminQuery } from './api';

const PANES: [OperatorPane, string][] = [['overview', '様子'], ['groups', 'グループ'], ['users', '利用者'], ['legal', '規約']];

export function OperatorLayout() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const pane = OPERATOR_PANES.find((p) => pathname === '/admin/' + p + '/');
  useEffect(() => {
    document.body.setAttribute('data-area', 'operator');
    document.title = '運営の管理画面 - 卓予定';
    // 開いたら、どの区分のデータも先に読んでおく（区分を移ってもすぐ出る）
    Object.values(ADMIN_READS).forEach((r) => { void qc.prefetchQuery(adminQuery(r.queryKey, r.path)); });
    return () => document.body.removeAttribute('data-area');
  }, [qc]);
  // 次に開いたときは、この区分から
  useEffect(() => { if (pane) store('opPane', pane); }, [pane]);
  // 開いている区分は読み直し、ほかの区分は次に開いたときに読み直す（消したグループなど、もう無いものは読みにいかない）
  const reload = () => { void qc.invalidateQueries({ queryKey: ['admin'] }).then(() => toast('読み直しました')); };
  return (
    <>
      <header className={appbar}>
        <a className={brand} href="/" title="入口へ"><img className={logo} src="/icon-192.png" alt="" width="32" height="32" /><span>卓予定</span><span className={areaBadge + ' inline-block'}>運営</span></a>
        <div className={actions}>
          <a className={hbtn()} href="/" title="入口（グループの一覧）へ"><Icon name="arrow_back" size="sm" className={hbtnIcon} /><span className={btxt}>入口へ</span></a>
          <button type="button" id="reload" className={hbtn() + ' max-sm:w-(--h-control) max-sm:p-0'} title="読み直す" onClick={reload}><Icon name="refresh" size="sm" className={hbtnIcon} /><span className={btxt}>更新</span></button>
        </div>
      </header>
      <main className={mainArea()}>
        <section className="settings op">
          <div className="page-head">
            <h1>運営の管理画面</h1>
            <p className="lead">すべてのグループと利用者を見渡し、困ったときに手を入れます。グループの中身（卓・予定）は見ません。</p>
          </div>
          <div className="set2">
            <nav className="set-nav" id="opNav" aria-label="管理の区分">
              {PANES.map(([p, label]) => (
                <button type="button" key={p} data-set={p} aria-current={pane === p ? 'true' : undefined} onClick={() => { void navigate({ to: '/admin/$pane/', params: { pane: p } }); }}>{label}</button>
              ))}
            </nav>
            <div><Outlet /></div>
          </div>
        </section>
      </main>
      <ConfirmDialog />
      <ModalManager />
      <Toast />
    </>
  );
}
