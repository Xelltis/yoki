// まだ React に移していないタブと区分の仮の中身（作り直しのあいだだけ）
import { getRouteApi } from '@tanstack/react-router';

function Placeholder({ id }: { id: string }) {
  return (
    <section id={id}>
      <div className="card"><p className="hint">この画面は、まだ新しい画面に移していません。</p></div>
    </section>
  );
}

export const RecruitTab = () => <Placeholder id="tab-recruit" />;
export const AvailTab = () => <Placeholder id="tab-avail" />;
export const SettingsTab = () => <Placeholder id="tab-settings" />;

const paneRoute = getRouteApi('/g/$groupId/admin/$pane');
export function AdminPane() {
  const { pane } = paneRoute.useParams();
  return <div className="set-pane" data-pane={pane}><div className="card"><p className="hint">この区分は、まだ新しい画面に移していません。</p></div></div>;
}
