// Googleでログインする（Discordのアカウントに結びつけた、もう1つの入り口）。利用者そのものは今までどおりDiscordのアカウント。
//   結びついているGoogleのアカウントなら、そのままログインする
//   初めてのGoogleのアカウントなら、だれのものかを暗号にしたcookieに10分だけ控え、続けてDiscordでログインしてもらって結びつける。
//   結びつけるのは、入口の「Discordでログイン」（?link_google=1）と開発用ログインで、結びつけるために押したときだけ
//   （黙って行う聞き直しのログインでは使わない。共用の端末で、前の人のGoogleが次の人に結びつかないように）
//   ログインしている人は、設定の画面から自分のGoogleのアカウントを結びつけ、外せる
// グループに入れるかは、今までどおりサーバーの一覧の控えで決める（控えが古ければBotかDiscordに聞き直す。auth/guard.ts）
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../app';
import { googleDeps } from '../google/config';
import { open, seal } from '../lib/secretbox';
import { appOrigin } from './origin';
import { isLocalHttp } from './session';

/**
 * 初めてのGoogleのアカウントを控えるcookie（Discordのログインの戻り先と開発用ログインで読むので、道は / ）。
 * セッションのcookieと同じく __Host- を付け、ほかのサブドメインなどから差し込めないようにする（手元のhttpでは付けられない）
 */
export function pendingCookie(url: URL): string {
  return isLocalHttp(url) ? 'yoki_glink' : '__Host-yoki_glink';
}
/** 控えておく長さ */
export const PENDING_MS = 600_000;

type Pending = { sub: string; email: string; at: string };

/** 結びつける。その人の前のGoogleのアカウントは外す。ほかの人に結びついているGoogleのアカウントなら結びつけずにfalse */
export async function linkGoogleLogin(db: D1Database, userId: string, sub: string, email: string, now: Date): Promise<boolean> {
  const owner = await db.prepare('SELECT user_id FROM google_logins WHERE google_sub = ?').bind(sub).first<string>('user_id');
  if (owner && owner !== userId) return false;
  await db.batch([
    db.prepare('DELETE FROM google_logins WHERE user_id = ?').bind(userId),
    db.prepare('INSERT INTO google_logins (google_sub, user_id, email, created_at) VALUES (?, ?, ?, ?)').bind(sub, userId, email, now.toISOString()),
  ]);
  return true;
}

/** 初めてのGoogleのアカウントを控える（暗号にして、書き換えられないようにする） */
export async function rememberGoogle(c: Context<AppEnv>, key: CryptoKey, sub: string, email: string, now: Date): Promise<void> {
  const value = await seal(key, JSON.stringify({ sub, email, at: now.toISOString() } satisfies Pending));
  const url = new URL(c.req.url);
  setCookie(c, pendingCookie(url), value, { httpOnly: true, secure: !isLocalHttp(url), sameSite: 'Lax', path: '/', maxAge: PENDING_MS / 1000 });
}

/** 控えを消す（結びつけたとき・ログアウトのとき） */
export function forgetGoogleLink(c: Context<AppEnv>): void {
  const url = new URL(c.req.url);
  deleteCookie(c, pendingCookie(url), { path: '/', secure: !isLocalHttp(url) });
}

/**
 * 結びつけるためにDiscordでログインしたあとに呼ぶ。控えたGoogleのアカウントがあれば、その人に結びつけて控えを消す。結びつけたらtrue。
 * 控えが無い・読めない・古い・ほかの人のGoogleのアカウント、なら何もしない
 */
export async function consumeGoogleLink(c: Context<AppEnv>, userId: string, now = new Date()): Promise<boolean> {
  const value = getCookie(c, pendingCookie(new URL(c.req.url)));
  if (!value) return false;
  forgetGoogleLink(c);
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
