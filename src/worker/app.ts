// Workerの道（Hono）。画面の静的ファイルはWorkers Static Assetsが返し、ここはwrangler.jsoncのrun_worker_firstの道だけを受ける
import { type ErrorHandler, Hono, type NotFoundHandler } from 'hono';
import { csrf } from './auth/csrf';
import { registerDevRoutes } from './auth/dev';
import { registerGoogleDevRoutes } from './google/dev';
import type { Bindings } from './env';
import { AppError } from './lib/errors';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { calendarRoutes } from './routes/calendar';
import { googleRoutes } from './routes/google';
import { noticePage } from './routes/html';
import { meRoutes } from './routes/me';
import { pageRoutes } from './routes/pages';
import { rpcRoutes } from './routes/rpc';

export type AppEnv = { Bindings: Bindings };

export const app = new Hono<AppEnv>();

app.use('*', csrf);

app.get('/api/health', async (c) => {
  const n = await c.env.DB.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").first<number>('n');
  return c.json({ ok: true, tables: n });
});

app.route('/', authRoutes);
app.route('/', meRoutes);
app.route('/', pageRoutes);
app.route('/', rpcRoutes);
app.route('/', adminRoutes);
app.route('/', calendarRoutes);
app.route('/', googleRoutes);
/* istanbul ignore else -- @preserve 本番の組み立てではDEVが偽になり、開発用ログインごと消える（テストは開発の形で動く） */
if (import.meta.env?.DEV) {
  registerDevRoutes(app);
  registerGoogleDevRoutes(app);
}

const isApi = (url: string) => new URL(url).pathname.startsWith('/api/');

/** 道が無いとき。/apiはJSON、ほかはお知らせのページ */
export const handleNotFound: NotFoundHandler = (c) =>
  isApi(c.req.url) ? c.json({ error: '見つかりません。' }, 404) : c.html(noticePage('見つかりません', 'URLを確かめてください。', { href: '/', label: '入口へ' }), 404);

/** エラーのとき。AppErrorはその文と状態で返す。ほかは中身をlogに出し、500で決まった文を返す */
export const handleError: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    return isApi(c.req.url) ? c.json({ error: err.message }, err.status) : c.html(noticePage('うまくいきませんでした', err.message, { href: '/', label: '入口へ' }), err.status);
  }
  console.error(err);
  const message = 'サーバーでエラーが起きました。少し待ってから、もう一度お試しください。';
  return isApi(c.req.url) ? c.json({ error: message }, 500) : c.html(noticePage('エラー', message, { href: '/', label: '入口へ' }), 500);
};

app.notFound(handleNotFound);
app.onError(handleError);
