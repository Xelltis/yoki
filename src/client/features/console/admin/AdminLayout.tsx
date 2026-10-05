// グループの管理画面（/g/:id/admin/<区分>/）の外枠。左の区分（e2e は #setNav の data-set を押す）と、区分の中身
import { Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { ADMIN_PANES, type AdminPane } from '../../../../shared/routes';
import { store } from '../../../app/storage';
import { PageHead } from '../../../ui/PageHead';
import { SetLayout, setNavBtn, setNavDanger } from '../../../ui/SetNav';
import { useData } from '../context';
import { useGoPane } from '../shell/nav';

/** 区分の名前。data-set は前の画面と同じ（管理者の区分は admin。道は /admin/admin/ を避けて admins） */
const PANES: [AdminPane, string, string][] = [
  ['members', 'members', 'メンバー'],
  ['ops', 'ops', '卓をまとめて変える'],
  ['notify', 'notify', '知らせ'],
  ['table', 'table', 'このグループ'],
  ['admins', 'admin', '管理者'],
  ['log', 'log', '送信の記録'],
  ['danger', 'danger', 'グループを消す'],
];

export function AdminLayout() {
  const d = useData();
  const goPane = useGoPane();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const pane = ADMIN_PANES.find((p) => pathname.endsWith('/admin/' + p + '/'));
  // 次に管理画面を開いたときは、この区分から
  useEffect(() => { if (pane) store('adminPane', pane); }, [pane]);
  if (!d.isAdmin) {
    return (
      <section id="tab-admin" className="max-w-1120">
        <div className="card"><h3>管理者だけが開けます</h3><p className="hint">グループの管理画面は、そのグループの管理者だけが開けます。管理者に頼むか、管理者にしてもらってください。</p></div>
      </section>
    );
  }
  return (
    <section id="tab-admin" className="max-w-1120">
      <PageHead title="グループの管理" lead="ここで変えたことは、グループの全員に効きます。管理者だけが開けます。" />
      <SetLayout id="setNav" label="管理の区分" nav={PANES.map(([p, set, label]) => (
        <button type="button" className={p === 'danger' ? setNavDanger : setNavBtn} key={p} data-set={set} aria-current={pane === p ? 'true' : undefined} onClick={() => goPane(p)}>{label}</button>
      ))}>
        <Outlet />
      </SetLayout>
    </section>
  );
}
