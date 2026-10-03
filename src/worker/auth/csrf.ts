// 別のサイトからの書き込み（CSRF）を断る。cookie は SameSite=Lax で、そのうえで
// GET 以外は Origin / Sec-Fetch-Site が自分のときだけ受け、/api には JSON だけを受ける
import { createMiddleware } from 'hono/factory';

export const csrf = createMiddleware(async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') return next();
  const url = new URL(c.req.url);
  const origin = c.req.header('Origin');
  const site = c.req.header('Sec-Fetch-Site');
  if ((origin && origin !== url.origin) || (site && site !== 'same-origin' && site !== 'none')) {
    return c.json({ error: '別のサイトからの送信は受け付けません。' }, 403);
  }
  if (url.pathname.startsWith('/api/') && !(c.req.header('Content-Type') ?? '').startsWith('application/json')) {
    return c.json({ error: 'JSON で送ってください。' }, 415);
  }
  return next();
});
