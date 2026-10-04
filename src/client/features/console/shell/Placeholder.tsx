// まだ React に移していない管理の区分の仮の中身（作り直しのあいだだけ）
import { getRouteApi } from '@tanstack/react-router';

const paneRoute = getRouteApi('/g/$groupId/admin/$pane');
export function AdminPane() {
  const { pane } = paneRoute.useParams();
  return <div className="set-pane" data-pane={pane}><div className="card"><p className="hint">この区分は、まだ新しい画面に移していません。</p></div></div>;
}
