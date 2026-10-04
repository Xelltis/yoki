// 画面のページ。入れる人には画面の骨組み（静的ファイル）を返す。データは画面が API で読む
//   /g/:id/        グループの予定の画面（console）
//   /g/:id/admin/  グループの管理画面（同じ console の画面を、管理の区域で開く）。グループの管理者だけ
//   /admin/        運営者の管理画面（operator）。運営者（OPERATOR_IDS）だけ
// ここの確かめは道を示すためのもの。データの読み書きの確かめは API の側（routes/rpc.ts・routes/admin.ts）でする
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { groupAccess } from '../auth/guard';
import { isOperator } from '../auth/operator';
import { currentViewer } from '../auth/session';
import { noticePage } from './html';

export const pageRoutes = new Hono<AppEnv>();

/** ログインしに行く（Discord の設定が無い手元では入口へ） */
const toLogin = (c: Context<AppEnv>, path: string) =>
  c.redirect(c.env.DISCORD_CLIENT_ID ? '/auth/login?return_to=' + encodeURIComponent(path) : '/?return_to=' + encodeURIComponent(path));

async function groupPage(c: Context<AppEnv>, id: string, admin: boolean) {
  const path = '/g/' + id + '/' + (admin ? 'admin/' : '');
  const access = await groupAccess(c.env.DB, await currentViewer(c), id);
  if (access.ok) {
    if (admin && !access.actor.isAdmin) {
      return c.html(noticePage('管理者だけが開けます', 'グループの管理画面は、そのグループの管理者だけが開けます。管理者に頼むか、管理者にしてもらってください。', { href: '/g/' + id + '/', label: '予定の画面へ' }), 403);
    }
    return c.env.ASSETS.fetch(new URL('/console/', c.req.url));
  }
  switch (access.reason) {
    case 'notfound':
      return c.html(noticePage('グループが見つかりません', 'URL が違うか、グループが無くなっています。', { href: '/', label: '入口へ' }), 404);
    case 'forbidden':
      return c.html(noticePage('このグループには入れません', 'このグループの Discord サーバーのメンバーではありません。サーバーに入ってから、もう一度開いてください。', { href: '/', label: '入口へ' }), 403);
    default:
      // ログインしていない・参加しているサーバーの控えが古い。Discord に聞いて戻ってくる
      return toLogin(c, path);
  }
}

pageRoutes.get('/g/:id', (c) => c.redirect('/g/' + c.req.param('id') + '/', 301));
pageRoutes.get('/g/:id/', (c) => groupPage(c, c.req.param('id'), false));
pageRoutes.get('/g/:id/admin', (c) => c.redirect('/g/' + c.req.param('id') + '/admin/', 301));
pageRoutes.get('/g/:id/admin/', (c) => groupPage(c, c.req.param('id'), true));

pageRoutes.get('/admin', (c) => c.redirect('/admin/', 301));
pageRoutes.get('/admin/', async (c) => {
  const viewer = await currentViewer(c);
  if (!viewer) return toLogin(c, '/admin/');
  if (!isOperator(c.env, viewer.id, new URL(c.req.url))) {
    return c.html(noticePage('運営者だけが開けます', 'この画面は、卓予定を公開している運営者だけが使えます。', { href: '/', label: '入口へ' }), 403);
  }
  const res = await c.env.ASSETS.fetch(new URL('/operator/', c.req.url));
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'no-store');
  return out;
});
