// 画面のページ。入れる人には画面の骨組み（静的ファイル。1つのSPAで、どの道でも同じ）を返す。データは画面がAPIで読む
//   /                                          入口。OGPのタグに公開のアドレスを入れる
//   /g/:id/ と /g/:id/<タブ>/                 グループの予定の画面
//   /g/:id/admin/ と /g/:id/admin/<区分>/      グループの管理画面（グループの管理者だけ）
//   /admin/ と /admin/<区分>/                  運営者の管理画面（運営者（OPERATOR_IDS）だけ）
//   /terms /privacy                            利用規約とプライバシーポリシー。だれでも読める。その場でHTMLにして返す
// 道の一覧（タブ・区分）はsrc/shared/routes.ts。末尾の / が無ければ付けた道へ移す。
// ここの確かめは道を示すためのもの。データの読み書きの確かめはAPIの側（routes/rpc.ts・routes/admin.ts）でする
import type { Context } from 'hono';
import { Hono } from 'hono';
import { ADMIN_PANES, OPERATOR_PANES, TAB_PATHS } from '../../shared/routes';
import type { AppEnv } from '../app';
import { groupAccess } from '../auth/guard';
import { isOperator } from '../auth/operator';
import { appOrigin } from '../auth/origin';
import { currentViewer } from '../auth/session';
import { readLegal } from '../domain/legal';
import { legalPage, noticePage } from './html';
import { isPreviewBot, type OgPage, SITE_DESCRIPTION, withOg } from './og';

export const pageRoutes = new Hono<AppEnv>();

/** 画面の骨組み（'/' のindex.html）。どの道も、画面の中の道（src/client/router.tsx）が中身を決める */
const shell = (c: Context<AppEnv>) => c.env.ASSETS.fetch(new URL('/', c.req.url));

/**
 * リンクの中身を読みに来たもの（Discordなど。routes/og.ts）に返す、画面の骨組み。OGPをこの道の文にする。
 * 骨組みにはグループの中身が入っていない（中身は、ログインした人がAPIで読む）ので、ログインしていなくても返してよい
 */
async function previewShell(c: Context<AppEnv>, page: Omit<OgPage, 'url'>) {
  const origin = appOrigin(c.env, c.req.url);
  const html = await (await shell(c)).text();
  return c.html(withOg(html, origin, { ...page, url: origin + c.req.path }));
}

/** ログインしに行く（Discordの設定が無い手元では入口へ）。戻り先は開こうとした道。リンクの中身を読みに来たものには、Yokiの見た目を返す */
const toLogin = (c: Context<AppEnv>, preview: Omit<OgPage, 'url'>) => {
  if (isPreviewBot(c.req.header('User-Agent'))) return previewShell(c, preview);
  const path = c.req.path;
  return c.redirect(c.env.DISCORD_CLIENT_ID ? '/auth/login?return_to=' + encodeURIComponent(path) : '/?return_to=' + encodeURIComponent(path));
};
/** グループの画面のリンクの見た目。グループの名前は出さない（ログインしていない人には、グループのことを見せない） */
const GROUP_PREVIEW = { title: 'Yokiのグループ', description: 'Discordでログインすると、このグループの卓の予定・メンバーの都合・募集・日程調整を見られます。' };
/** 末尾の / が無い道は、付けた道へ移す */
const withSlash = (c: Context<AppEnv>) => c.redirect(c.req.path + '/', 301);

async function groupPage(c: Context<AppEnv>, admin: boolean) {
  const id = c.req.param('id')!;
  const access = await groupAccess(c.env.DB, await currentViewer(c), id, c.env.DISCORD_BOT_TOKEN);
  if (access.ok) {
    if (admin && !access.actor.isAdmin) {
      return c.html(noticePage('管理者だけが開けます', 'グループの管理画面は、そのグループの管理者だけが開けます。管理者に頼むか、管理者にしてもらってください。', { href: '/g/' + id + '/', label: '予定の画面へ' }), 403);
    }
    return shell(c);
  }
  switch (access.reason) {
    case 'notfound':
      return c.html(noticePage('グループが見つかりません', 'URLが違うか、グループが無くなっています。', { href: '/', label: '入口へ' }), 404);
    case 'forbidden':
      return c.html(noticePage('このグループには入れません', 'このグループのDiscordサーバーのメンバーではありません。サーバーに入ってから、もう一度開いてください。', { href: '/', label: '入口へ' }), 403);
    default:
      // ログインしていない・参加しているサーバーの控えが古い。Discordに聞いて戻ってくる
      return toLogin(c, GROUP_PREVIEW);
  }
}

async function operatorPage(c: Context<AppEnv>) {
  const viewer = await currentViewer(c);
  if (!viewer) return toLogin(c, { title: 'Yoki', description: SITE_DESCRIPTION });
  if (!isOperator(c.env, viewer.id, new URL(c.req.url))) {
    return c.html(noticePage('運営者だけが開けます', 'この画面は、このYokiを設置した運営者だけが使えます。', { href: '/', label: '入口へ' }), 403);
  }
  const res = await shell(c);
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'no-store');
  return out;
}

/** 道の一部を、一覧のどれかに絞る（「または」は (?:…) で囲まないと、道全体の「または」になる） */
const oneOf = (name: string, xs: readonly string[]) => `:${name}{(?:${xs.join('|')})}`;
const TAB = oneOf('tab', TAB_PATHS);
const PANE = oneOf('pane', ADMIN_PANES);
const OP_PANE = oneOf('pane', OPERATOR_PANES);

// 入口。画面の骨組みのOGPのタグはアドレスを持たない（組み立てのときには、公開のアドレスが分からない）ので、ここで入れて返す
pageRoutes.get('/', (c) => previewShell(c, { title: 'Yoki', description: SITE_DESCRIPTION }));
for (const p of ['/g/:id', `/g/:id/${TAB}`, '/g/:id/admin', `/g/:id/admin/${PANE}`, '/admin', `/admin/${OP_PANE}`]) pageRoutes.get(p, withSlash);
for (const p of ['/g/:id/', `/g/:id/${TAB}/`]) pageRoutes.get(p, (c) => groupPage(c, false));
for (const p of ['/g/:id/admin/', `/g/:id/admin/${PANE}/`]) pageRoutes.get(p, (c) => groupPage(c, true));
for (const p of ['/admin/', `/admin/${OP_PANE}/`]) pageRoutes.get(p, (c) => operatorPage(c));

pageRoutes.get('/terms', async (c) => c.html(legalPage('terms', await readLegal(c.env.DB), appOrigin(c.env, c.req.url))));
pageRoutes.get('/privacy', async (c) => c.html(legalPage('privacy', await readLegal(c.env.DB), appOrigin(c.env, c.req.url))));
