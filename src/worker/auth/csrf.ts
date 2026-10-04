// 別のサイトからの書き込み（CSRF）を断る。cookie は SameSite=Lax で、そのうえで
// GET 以外は Origin / Sec-Fetch-Site が自分のときだけ受け、/api には JSON だけを受ける。
// 「自分」は、届いた要求のアドレスと、公開のアドレス（APP_URL。CDN を前に置くと、届く要求のアドレスとは違う）
import { createMiddleware } from 'hono/factory';
import type { Bindings } from '../env';
import { appOrigin } from './origin';

export const csrf = createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') return next();
  const url = new URL(c.req.url);
  const origin = c.req.header('Origin');
  const site = c.req.header('Sec-Fetch-Site');
  if ((origin && origin !== url.origin && origin !== appOrigin(c.env, c.req.url)) || (site && site !== 'same-origin' && site !== 'none')) {
    return c.json({ error: '別のサイトからの送信は受け付けません。' }, 403);
  }
  if (url.pathname.startsWith('/api/') && !(c.req.header('Content-Type') ?? '').startsWith('application/json')) {
    return c.json({ error: 'JSON で送ってください。' }, 415);
  }
  return next();
});
