// 画面の道（TanStack Router。道はコードで書き、生成ファイルは使わない）。末尾はいつも /（Worker の道と同じ形）。
// ページごとの JS は分けて読む（lazyRouteComponent）。入口・グループの画面・運営の管理画面のあいだも、読み直さずに移る
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, lazyRouteComponent, Link, notFound, Outlet, redirect } from '@tanstack/react-router';
import { ADMIN_PANES, type AdminPane, OPERATOR_PANES, type OperatorPane } from '../shared/routes';
import { queryClient } from './app/queryClient';
import { load } from './app/storage';

function NotFound() {
  return (
    <main style={{ padding: 24 }}>
      <h1>見つかりません</h1>
      <p>URL を確かめてください。</p>
      <p><Link to="/">入口へ</Link></p>
    </main>
  );
}

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Outlet,
  notFoundComponent: NotFound,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(() => import('./features/home/Home'), 'Home'),
});

/* グループの画面（/g/:id/ とタブ）。外枠は ConsoleLayout */
/** グループの画面を初めて開いたか。初めてだけ、前に見ていたタブへ移る（前の画面と同じ） */
let firstVisit = true;
const groupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/g/$groupId',
  beforeLoad: () => { const first = firstVisit; firstVisit = false; return { firstVisit: first }; },
  component: lazyRouteComponent(() => import('./features/console/shell/ConsoleLayout'), 'ConsoleLayout'),
});
const calRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: '/',
  beforeLoad: ({ context, params }) => {
    if (!context.firstVisit) return;
    const t = load('tab');
    if (t === 'recruit' || t === 'avail' || t === 'settings') throw redirect({ to: `/g/$groupId/${t}/`, params });
  },
  component: lazyRouteComponent(() => import('./features/console/calendar/CalendarTab'), 'CalendarTab'),
});
const recruitRoute = createRoute({ getParentRoute: () => groupRoute, path: 'recruit', component: lazyRouteComponent(() => import('./features/console/recruit/RecruitTab'), 'RecruitTab') });
const availRoute = createRoute({ getParentRoute: () => groupRoute, path: 'avail', component: lazyRouteComponent(() => import('./features/console/avail/AvailTab'), 'AvailTab') });
const settingsRoute = createRoute({ getParentRoute: () => groupRoute, path: 'settings', component: lazyRouteComponent(() => import('./features/console/settings/SettingsTab'), 'SettingsTab') });

/* グループの管理画面（/g/:id/admin/<区分>/） */
const isPane = (p: string): p is AdminPane => (ADMIN_PANES as readonly string[]).includes(p);
const adminRoute = createRoute({
  getParentRoute: () => groupRoute,
  path: 'admin',
  component: lazyRouteComponent(() => import('./features/console/admin/AdminLayout'), 'AdminLayout'),
});
/** /g/:id/admin/ は区分へ移る。前の画面の #members などの # が付いていればそれ、無ければ前に見ていた区分、それも無ければメンバー */
const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/',
  beforeLoad: ({ location, params }) => {
    const old = (p: string) => (p === 'admin' ? 'admins' : p);   // 前の画面の管理者の区分は admin
    const fromHash = old(location.hash.replace(/^#/, '')), saved = old(load('adminPane'));
    const pane: AdminPane = isPane(fromHash) ? fromHash : isPane(saved) ? saved : 'members';
    throw redirect({ to: '/g/$groupId/admin/$pane/', params: { groupId: params.groupId, pane }, hash: '' });
  },
});
const adminPaneRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '$pane',
  beforeLoad: ({ params }) => { if (!isPane(params.pane)) throw notFound(); },
  component: lazyRouteComponent(() => import('./features/console/admin/AdminPaneView'), 'AdminPaneView'),
});

/* 運営者の管理画面（/admin/<区分>/）。Worker が運営者かを確かめてから、この画面を返す */
const isOpPane = (p: string): p is OperatorPane => (OPERATOR_PANES as readonly string[]).includes(p);
const operatorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: lazyRouteComponent(() => import('./features/operator/OperatorLayout'), 'OperatorLayout'),
});
/** /admin/ は区分へ移る。前の画面の #legal などの # が付いていればそれ、無ければ前に見ていた区分、それも無ければ様子 */
const operatorIndexRoute = createRoute({
  getParentRoute: () => operatorRoute,
  path: '/',
  beforeLoad: ({ location }) => {
    const fromHash = location.hash.replace(/^#/, ''), saved = load('opPane');
    const pane: OperatorPane = isOpPane(fromHash) ? fromHash : isOpPane(saved) ? saved : 'overview';
    throw redirect({ to: '/admin/$pane/', params: { pane }, hash: '' });
  },
});
const operatorPaneRoute = createRoute({
  getParentRoute: () => operatorRoute,
  path: '$pane',
  /** グループの区分で開いているグループ（?open=<id>） */
  validateSearch: (s: Record<string, unknown>): { open?: string } => (typeof s.open === 'string' && s.open ? { open: s.open } : {}),
  beforeLoad: ({ params }) => { if (!isOpPane(params.pane)) throw notFound(); },
  component: lazyRouteComponent(() => import('./features/operator/OperatorPaneView'), 'OperatorPaneView'),
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  groupRoute.addChildren([calRoute, recruitRoute, availRoute, settingsRoute, adminRoute.addChildren([adminIndexRoute, adminPaneRoute])]),
  operatorRoute.addChildren([operatorIndexRoute, operatorPaneRoute]),
]);

/** 検索の文字（?login=… など）は、文字のまま読み書きする（TanStack Router の既定は JSON として読むので、数字や引用符が変わる） */
function parseSearch(search: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(search));
}
function stringifySearch(search: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? '?' + s : '';
}

export const router = createRouter({
  routeTree,
  context: { queryClient },
  trailingSlash: 'always',
  defaultPreload: 'intent',
  parseSearch,
  stringifySearch,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
