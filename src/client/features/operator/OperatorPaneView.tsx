// 運営者の管理画面の区分（/admin/<区分>/）の中身。道の区分の名前で選ぶ
import { getRouteApi } from '@tanstack/react-router';
import { GroupsPane } from './GroupsPane';
import { LegalPane } from './LegalPane';
import { OverviewPane } from './OverviewPane';
import { UpdatePane } from './UpdatePane';
import { UsersPane } from './UsersPane';

const paneRoute = getRouteApi('/admin/$pane');

export function OperatorPaneView() {
  const { pane } = paneRoute.useParams();
  switch (pane) {
    case 'overview': return <OverviewPane />;
    case 'groups': return <GroupsPane />;
    case 'users': return <UsersPane />;
    case 'legal': return <LegalPane />;
    case 'update': return <UpdatePane />;
    // 知らない区分は、道（router.tsx）で「見つかりません」にしている
    default: return null;
  }
}
