// 画面の道（TanStack Router。道はコードで書き、生成ファイルは使わない）。末尾はいつも /（Worker の道と同じ形）。
// ページごとの JS は分けて読む（lazyRouteComponent）。入口・グループの画面・運営の管理画面をまたぐ移りは、
// 見た目（CSS）がぶつからないように、ページを読み直す（ふつうの <a href>）
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, lazyRouteComponent, Outlet } from '@tanstack/react-router';
import { queryClient } from './app/queryClient';

function NotFound() {
  return (
    <main style={{ padding: 24 }}>
      <h1>見つかりません</h1>
      <p>URL を確かめてください。</p>
      <p><a href="/">入口へ</a></p>
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

const routeTree = rootRoute.addChildren([homeRoute]);

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
