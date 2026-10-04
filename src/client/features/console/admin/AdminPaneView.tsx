// 管理画面の区分（/g/:id/admin/<区分>/）の中身。道の区分の名前で選ぶ
import { getRouteApi } from '@tanstack/react-router';
import { MembersPane } from './MembersPane';
import { AdminsPane, DangerPane, LogPane, TablePane } from './SimplePanes';

const paneRoute = getRouteApi('/g/$groupId/admin/$pane');

export function AdminPaneView() {
  const { pane } = paneRoute.useParams();
  switch (pane) {
    case 'members': return <MembersPane />;
    case 'table': return <TablePane />;
    case 'admins': return <AdminsPane />;
    case 'log': return <LogPane />;
    case 'danger': return <DangerPane />;
    default:
      // まだ新しい画面に移していない区分（作り直しのあいだだけ）
      return <div className="set-pane" data-pane={pane}><div className="card"><p className="hint">この区分は、まだ新しい画面に移していません。</p></div></div>;
  }
}
