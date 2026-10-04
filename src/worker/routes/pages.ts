// 画面のページ。入れる人には画面の骨組み（静的ファイル）を返す。データは画面が API で読む
//   /g/:id/ と /g/:id/<タブ>/                 グループの予定の画面
//   /g/:id/admin/ と /g/:id/admin/<区分>/      グループの管理画面（グループの管理者だけ）
//   /admin/ と /admin/<区分>/                  運営者の管理画面（運営者（OPERATOR_IDS）だけ）
//   /terms /privacy                            利用規約とプライバシーポリシー。だれでも読める。その場で HTML にして返す
// 道の一覧（タブ・区分）は src/shared/routes.ts。末尾の / が無ければ付けた道へ移す。
// ここの確かめは道を示すためのもの。データの読み書きの確かめは API の側（routes/rpc.ts・routes/admin.ts）でする
import type { Context } from 'hono';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { ADMIN_PANES, OPERATOR_PANES, TAB_PATHS } from '../../shared/routes';
import type { AppEnv } from '../app';
import { groupAccess } from '../auth/guard';
import { isOperator } from '../auth/operator';
import { currentViewer } from '../auth/session';
import { readLegal } from '../domain/legal';
import { legalPage, noticePage } from './html';

export const pageRoutes = new Hono<AppEnv>();

/**
 * 画面を React に書き直しているあいだだけ: cookie yoki_ui=next の人には、新しい画面（1 つの SPA。'/' の骨組み）を返す。
 * 手元で新旧の画面を並べて確かめるため。新しい画面に切り替えたら消す
 */
const nextUi = (c: Context<AppEnv>) => getCookie(c, 'yoki_ui') === 'next';
/** 返す骨組み。新しい画面は 1 つの SPA、古い画面はグループの画面と運営者の管理画面で別 */
const shell = (c: Context<AppEnv>, old: '/console/' | '/operator/') => c.env.ASSETS.fetch(new URL(nextUi(c) ? '/' : old, c.req.url));

/** ログインしに行く（Discord の設定が無い手元では入口へ）。戻り先は開こうとした道 */
const toLogin = (c: Context<AppEnv>) => {
  const path = c.req.path;
  return c.redirect(c.env.DISCORD_CLIENT_ID ? '/auth/login?return_to=' + encodeURIComponent(path) : '/?return_to=' + encodeURIComponent(path));
};
/** 末尾の / が無い道は、付けた道へ移す */
const withSlash = (c: Context<AppEnv>) => c.redirect(c.req.path + '/', 301);

async function groupPage(c: Context<AppEnv>, admin: boolean, deep: boolean) {
  const id = c.req.param('id')!;
  const root = '/g/' + id + '/' + (admin ? 'admin/' : '');
  // タブや区分の道は新しい画面だけにある。古い画面では区域の初めへ
  if (deep && !nextUi(c)) return c.redirect(root);
  const access = await groupAccess(c.env.DB, await currentViewer(c), id);
  if (access.ok) {
    if (admin && !access.actor.isAdmin) {
      return c.html(noticePage('管理者だけが開けます', 'グループの管理画面は、そのグループの管理者だけが開けます。管理者に頼むか、管理者にしてもらってください。', { href: '/g/' + id + '/', label: '予定の画面へ' }), 403);
    }
    return shell(c, '/console/');
  }
  switch (access.reason) {
    case 'notfound':
      return c.html(noticePage('グループが見つかりません', 'URL が違うか、グループが無くなっています。', { href: '/', label: '入口へ' }), 404);
    case 'forbidden':
      return c.html(noticePage('このグループには入れません', 'このグループの Discord サーバーのメンバーではありません。サーバーに入ってから、もう一度開いてください。', { href: '/', label: '入口へ' }), 403);
    default:
      // ログインしていない・参加しているサーバーの控えが古い。Discord に聞いて戻ってくる
      return toLogin(c);
  }
}

async function operatorPage(c: Context<AppEnv>, deep: boolean) {
  if (deep && !nextUi(c)) return c.redirect('/admin/');
  const viewer = await currentViewer(c);
  if (!viewer) return toLogin(c);
  if (!isOperator(c.env, viewer.id, new URL(c.req.url))) {
    return c.html(noticePage('運営者だけが開けます', 'この画面は、卓予定を公開している運営者だけが使えます。', { href: '/', label: '入口へ' }), 403);
  }
  const res = await shell(c, '/operator/');
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'no-store');
  return out;
}

/** 道の一部を、一覧のどれかに絞る（「または」は (?:…) で囲まないと、道全体の「または」になる） */
const oneOf = (name: string, xs: readonly string[]) => `:${name}{(?:${xs.join('|')})}`;
const TAB = oneOf('tab', TAB_PATHS);
const PANE = oneOf('pane', ADMIN_PANES);
const OP_PANE = oneOf('pane', OPERATOR_PANES);

for (const p of ['/g/:id', `/g/:id/${TAB}`, '/g/:id/admin', `/g/:id/admin/${PANE}`, '/admin', `/admin/${OP_PANE}`]) pageRoutes.get(p, withSlash);
pageRoutes.get('/g/:id/', (c) => groupPage(c, false, false));
pageRoutes.get(`/g/:id/${TAB}/`, (c) => groupPage(c, false, true));
pageRoutes.get('/g/:id/admin/', (c) => groupPage(c, true, false));
pageRoutes.get(`/g/:id/admin/${PANE}/`, (c) => groupPage(c, true, true));
pageRoutes.get('/admin/', (c) => operatorPage(c, false));
pageRoutes.get(`/admin/${OP_PANE}/`, (c) => operatorPage(c, true));

pageRoutes.get('/terms', async (c) => c.html(legalPage('terms', await readLegal(c.env.DB))));
pageRoutes.get('/privacy', async (c) => c.html(legalPage('privacy', await readLegal(c.env.DB))));
