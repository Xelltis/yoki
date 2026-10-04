// 管理画面の区分（/g/:id/admin/<区分>/）の中身。道の区分の名前で選ぶ
import { getRouteApi } from '@tanstack/react-router';
import { MembersPane } from './MembersPane';
import { NotifyPane } from './NotifyPane';
import { OpsPane } from './OpsPane';
import { AdminsPane, DangerPane, LogPane, TablePane } from './SimplePanes';

const paneRoute = getRouteApi('/g/$groupId/admin/$pane');

export function AdminPaneView() {
  const { pane } = paneRoute.useParams();
  switch (pane) {
    case 'members': return <MembersPane />;
    case 'ops': return <OpsPane />;
    case 'notify': return <NotifyPane />;
    case 'table': return <TablePane />;
    case 'admins': return <AdminsPane />;
    case 'log': return <LogPane />;
    case 'danger': return <DangerPane />;
    // 知らない区分は、道（router.tsx）で「見つかりません」にしている
    default: return null;
  }
}
