// ログインの続き（セッション）。cookieにはランダムな値を入れ、D1にはそのハッシュだけを置く
import type { Context as HonoContext } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Bindings } from '../env';
import { randomToken, sha256Hex } from '../lib/ids';

type Context = HonoContext<{ Bindings: Bindings }>;

export const SESSION_DAYS = 30;

/** 手元（http://localhost）ではSecureのcookieが使えないブラウザもあるので、名前と属性を変える */
export function isLocalHttp(url: URL): boolean {
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

function cookieName(url: URL): string {
  return isLocalHttp(url) ? 'yoki_sid' : '__Host-yoki_sid';
}

export type Viewer = {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  guildsCheckedAt: string;
};

export async function startSession(c: Context, userId: string, now = new Date()): Promise<void> {
  const token = randomToken();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400_000);
  await c.env.DB.prepare('INSERT INTO auth_sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, now.toISOString(), expires.toISOString())
    .run();
  const url = new URL(c.req.url);
  setCookie(c, cookieName(url), token, {
    httpOnly: true,
    secure: !isLocalHttp(url),
    sameSite: 'Lax',
    path: '/',
    expires,
  });
}

/** cookieからログインしている人を読む。無い・期限切れ・締め出されていればnull */
export async function currentViewer(c: Context, now = new Date()): Promise<Viewer | null> {
  const token = getCookie(c, cookieName(new URL(c.req.url)));
  if (!token) return null;
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.global_name, u.avatar, u.guilds_checked_at
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = ? AND s.expires_at > ? AND u.banned_at IS NULL`,
  )
    .bind(await sha256Hex(token), now.toISOString())
    .first<{ id: string; username: string; global_name: string | null; avatar: string | null; guilds_checked_at: string }>();
  if (!row) return null;
  return { id: row.id, username: row.username, globalName: row.global_name, avatar: row.avatar, guildsCheckedAt: row.guilds_checked_at };
}

/** 締め出されているか（運営者が印を付けた人は、ログインできない） */
export async function isBanned(db: D1Database, userId: string): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 FROM users WHERE id = ? AND banned_at IS NOT NULL').bind(userId).first());
}

export async function endSession(c: Context): Promise<void> {
  const url = new URL(c.req.url);
  const token = getCookie(c, cookieName(url));
  if (token) await c.env.DB.prepare('DELETE FROM auth_sessions WHERE id_hash = ?').bind(await sha256Hex(token)).run();
  deleteCookie(c, cookieName(url), { path: '/', secure: !isLocalHttp(url) });
}
