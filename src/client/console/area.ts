// 区域。/g/:id/ はふだんの画面（カレンダー・募集・調整・メンバーの予定・設定）、/g/:id/admin/ はグループの管理画面。
// 同じ画面（console）を使い、body[data-area] で出し分ける。管理画面の区分は URL の #members などで指せる

export type Area = 'main' | 'admin';
export const AREA: Area = /^\/g\/[^/]+\/admin\/$/.test(location.pathname) ? 'admin' : 'main';

/** 管理画面の区分 */
export const ADMIN_PANES = ['members', 'ops', 'notify', 'table', 'admin', 'log', 'danger'];

/** 管理画面の URL。pane を渡すと、その区分を開く */
export function adminUrl(pane?: string): string {
  return location.pathname.replace(/admin\/$/, '') + 'admin/' + (pane ? '#' + pane : '');
}
/** URL の # で指した区分（無ければ空） */
export function paneFromHash(): string {
  const h = location.hash.slice(1);
  return ADMIN_PANES.indexOf(h) >= 0 ? h : '';
}

export function initArea(): void {
  document.body.setAttribute('data-area', AREA);
}
