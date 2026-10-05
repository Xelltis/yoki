// Google でログインする（Discord のアカウントに結びつけた、もう 1 つの入り口）。利用者そのものは今までどおり Discord のアカウント。
//   結びついている Google のアカウントなら、そのままログインする
//   初めての Google のアカウントなら、だれのものかを暗号にした cookie に 10 分だけ控え、続けて Discord でログインしてもらって結びつける
//   ログインしている人は、設定の画面から自分の Google のアカウントを結びつけ、外せる
// グループに入れるかは、今までどおりサーバーの一覧の控えで決める（控えが古ければ Bot か Discord に聞き直す。auth/guard.ts）
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../app';
import { googleDeps } from '../google/config';
import { open, seal } from '../lib/secretbox';
import { appOrigin } from './origin';
import { isLocalHttp } from './session';

/** 初めての Google のアカウントを控える cookie（Discord のログインの戻り先と開発用ログインで読むので、道は / ） */
export const PENDING_COOKIE = 'yoki_glink';
/** 控えておく長さ */
export const PENDING_MS = 600_000;

type Pending = { sub: string; email: string; at: string };

/** 結びつける。その人の前の Google のアカウントは外す。ほかの人に結びついている Google のアカウントなら結びつけずに false */
export async function linkGoogleLogin(db: D1Database, userId: string, sub: string, email: string, now: Date): Promise<boolean> {
  const owner = await db.prepare('SELECT user_id FROM google_logins WHERE google_sub = ?').bind(sub).first<string>('user_id');
  if (owner && owner !== userId) return false;
  await db.batch([
    db.prepare('DELETE FROM google_logins WHERE user_id = ?').bind(userId),
    db.prepare('INSERT INTO google_logins (google_sub, user_id, email, created_at) VALUES (?, ?, ?, ?)').bind(sub, userId, email, now.toISOString()),
  ]);
  return true;
}

/** 初めての Google のアカウントを控える（暗号にして、書き換えられないようにする） */
export async function rememberGoogle(c: Context<AppEnv>, key: CryptoKey, sub: string, email: string, now: Date): Promise<void> {
  const value = await seal(key, JSON.stringify({ sub, email, at: now.toISOString() } satisfies Pending));
  setCookie(c, PENDING_COOKIE, value, { httpOnly: true, secure: !isLocalHttp(new URL(c.req.url)), sameSite: 'Lax', path: '/', maxAge: PENDING_MS / 1000 });
}

/**
 * Discord でログインしたあとに呼ぶ。控えた Google のアカウントがあれば、その人に結びつけて控えを消す。結びつけたら true。
 * 控えが無い・読めない・古い・ほかの人の Google のアカウント、なら何もしない
 */
export async function consumeGoogleLink(c: Context<AppEnv>, userId: string, now = new Date()): Promise<boolean> {
  const value = getCookie(c, PENDING_COOKIE);
  if (!value) return false;
  deleteCookie(c, PENDING_COOKIE, { path: '/', secure: !isLocalHttp(new URL(c.req.url)) });
  const deps = await googleDeps(c.env, appOrigin(c.env, c.req.url));
  if (!deps) return false;
  let p: Pending;
  try {
    p = JSON.parse(await open(deps.key, value)) as Pending;
  } catch {
    return false;
  }
  if (!p.sub || !(now.getTime() - Date.parse(p.at) < PENDING_MS)) return false;
  return linkGoogleLogin(c.env.DB, userId, p.sub, p.email, now);
}
