// 画面の道（URL）の一覧。Worker（入れるかを確かめてから画面を返す・ログインのあとの戻り先）と、画面の道（src/client/router.tsx）の両方から読む。
// 末尾はいつも /。グループの画面は /g/:id/（カレンダー）と /g/:id/<タブ>/、グループの管理の区域は /g/:id/admin/<区分>/、運営の管理画面は /admin/<区分>/

/** グループの画面のタブ（カレンダーは /g/:id/ そのもの） */
export const TAB_PATHS = ['recruit', 'scenario', 'avail', 'settings'] as const;
/** グループの管理の区域の区分（/g/:id/admin/ は、前に開いていた区分かmembersへ移る） */
export const ADMIN_PANES = ['members', 'ops', 'notify', 'table', 'admins', 'log', 'danger'] as const;
/** 運営の管理画面の区分（/admin/ は、前に開いていた区分かoverviewへ移る） */
export const OPERATOR_PANES = ['overview', 'groups', 'users', 'legal', 'update'] as const;

export type TabPath = (typeof TAB_PATHS)[number];
export type AdminPane = (typeof ADMIN_PANES)[number];
export type OperatorPane = (typeof OPERATOR_PANES)[number];

const alt = (xs: readonly string[]) => xs.join('|');
const RETURN_PATH = new RegExp(
  `^/(?:g/[a-z0-9-]{1,40}/(?:(?:${alt(TAB_PATHS)})/|admin/(?:(?:${alt(ADMIN_PANES)})/)?)?|admin/(?:(?:${alt(OPERATOR_PANES)})/)?)?$`,
);

/** ログインのあとに戻ってよい道か。この一覧にある画面の道だけ（ほかのサイトや、知らない道へは戻さない） */
export function isReturnPath(path: string): boolean {
  return RETURN_PATH.test(path);
}
