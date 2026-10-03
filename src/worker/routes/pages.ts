// グループのページ（/g/:id/）。入れる人には画面の骨組み（console）を返す。データは画面が API で読む
import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { groupAccess } from '../auth/guard';
import { currentViewer } from '../auth/session';
import { noticePage } from './html';

export const pageRoutes = new Hono<AppEnv>();

pageRoutes.get('/g/:id', (c) => c.redirect('/g/' + c.req.param('id') + '/', 301));

pageRoutes.get('/g/:id/', async (c) => {
  const path = '/g/' + c.req.param('id') + '/';
  const access = await groupAccess(c.env.DB, await currentViewer(c), c.req.param('id'));
  if (access.ok) return c.env.ASSETS.fetch(new URL('/console/', c.req.url));
  switch (access.reason) {
    case 'notfound':
      return c.html(noticePage('グループが見つかりません', 'URL が違うか、グループが無くなっています。', { href: '/', label: '入口へ' }), 404);
    case 'forbidden':
      return c.html(noticePage('このグループには入れません', 'このグループの Discord サーバーのメンバーではありません。サーバーに入ってから、もう一度開いてください。', { href: '/', label: '入口へ' }), 403);
    default:
      // ログインしていない・参加しているサーバーの控えが古い。Discord に聞いて戻ってくる（Discord の設定が無い手元では入口へ）
      return c.redirect(c.env.DISCORD_CLIENT_ID ? '/auth/login?return_to=' + encodeURIComponent(path) : '/?return_to=' + encodeURIComponent(path));
  }
});
