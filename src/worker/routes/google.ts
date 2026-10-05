// Google の OAuth2（認可コードの流れ）。2 つの使い道があり、戻ってくる先（/auth/google/callback）は同じ。
//   カレンダーとの連携（/auth/google/start）: ログインしている人だけが始められる。受け取った refresh token は、暗号化して google_links に置く
//     （画面・ログ・運営者の API には出さない）
//   Google でログイン（/auth/google/login）: 結びついた Discord のアカウントでログインする（auth/google-login.ts）。
//     ?link=1 なら、ログインしている人に Google のアカウントを結びつける（設定の画面から）
// state は HttpOnly の cookie（/auth/google だけ、10 分）に、ログインしている人の ID と戻り先と一緒に入れて照合する。使い道ごとに cookie を分ける
import { type Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { isReturnPath } from '../../shared/routes';
import type { AppEnv } from '../app';
import { appOrigin } from '../auth/origin';
import { linkGoogleLogin, rememberGoogle } from '../auth/google-login';
import { currentViewer, isBanned, isLocalHttp, startSession } from '../auth/session';
import { googleDeps } from '../google/config';
import { CALL_BUDGET, removeEvents, syncUser, tryAccessToken } from '../google/sync';
import { randomToken, safeEqual } from '../lib/ids';
import { seal } from '../lib/secretbox';
import { noticePage } from './html';

const STATE_COOKIE = 'yoki_google';
/** Google でログインするときの state（state|login か link|ログインしている人の ID|戻り先） */
const LOGIN_COOKIE = 'yoki_glogin';
const COOKIE_PATH = '/auth/google';

export const googleRoutes = new Hono<AppEnv>();

const callbackUrl = (env: { APP_URL?: string }, reqUrl: string) => appOrigin(env, reqUrl) + '/auth/google/callback';
/** 戻り先（画面の道。? は付いていない）に、連携の結果を付ける（画面が吹き出しを出す） */
const withResult = (path: string, result: string) => path + '?google=' + result;

googleRoutes.get('/auth/google/start', async (c) => {
  const want = c.req.query('return_to') ?? '/';
  const returnTo = isReturnPath(want) ? want : '/';
  const viewer = await currentViewer(c);
  if (!viewer) return c.redirect('/auth/login?return_to=' + encodeURIComponent(returnTo));
  const deps = await googleDeps(c.env, appOrigin(c.env, c.req.url));
  if (!deps) {
    return c.html(noticePage('Google 連携の設定がありません', '運営者が Google カレンダーとの連携を設定していないので、使えません。', { href: returnTo, label: '戻る' }), 500);
  }
  const url = new URL(c.req.url);
  const state = randomToken();
  setCookie(c, STATE_COOKIE, [state, viewer.id, returnTo].join('|'), { httpOnly: true, secure: !isLocalHttp(url), sameSite: 'Lax', path: COOKIE_PATH, maxAge: 600 });
  return c.redirect(deps.api.authorizeUrl(callbackUrl(c.env, c.req.url), state));
});

/** Google でログインする（?link=1 なら、ログインしている人に結びつける）。戻り先は画面の道だけ */
googleRoutes.get('/auth/google/login', async (c) => {
  const want = c.req.query('return_to') ?? '/';
  const returnTo = isReturnPath(want) ? want : '/';
  const link = c.req.query('link') === '1';
  const viewer = await currentViewer(c);
  if (link && !viewer) return c.redirect('/auth/login?return_to=' + encodeURIComponent(returnTo));
  const deps = await googleDeps(c.env, appOrigin(c.env, c.req.url));
  if (!deps) return c.html(noticePage('Google のログインの設定がありません', '運営者が Google の設定をしていないので、Google ではログインできません。', { href: '/', label: '入口へ' }), 500);
  const state = randomToken();
  setCookie(c, LOGIN_COOKIE, [state, link ? 'link' : 'login', link ? viewer!.id : '', returnTo].join('|'), {
    httpOnly: true, secure: !isLocalHttp(new URL(c.req.url)), sameSite: 'Lax', path: COOKIE_PATH, maxAge: 600,
  });
  return c.redirect(deps.api.loginUrl(callbackUrl(c.env, c.req.url), state));
});

/** Google でログインして戻ってきた（login・link）。state はログインの cookie と照合済み */
async function loginCallback(c: Context<AppEnv>, saved: string) {
  deleteCookie(c, LOGIN_COOKIE, { path: COOKIE_PATH, secure: !isLocalHttp(new URL(c.req.url)) });
  const [, mode, userId, returnTo] = saved.split('|') as [string, string, string, string];
  const back = isReturnPath(returnTo) ? returnTo : '/';
  if (c.req.query('error')) return c.redirect(mode === 'link' ? withResult(back, 'login-cancelled') : '/?login=cancelled');
  const code = c.req.query('code');
  if (!code) return c.html(noticePage('ログインをやり直してください', 'Google のログインの確認ができませんでした。', { href: '/', label: '入口へ' }), 400);
  const deps = (await googleDeps(c.env, appOrigin(c.env, c.req.url)))!;
  const { sub, email } = await deps.api.exchangeLogin(code, callbackUrl(c.env, c.req.url));
  const db = c.env.DB, now = new Date();
  if (mode === 'link') {
    const viewer = await currentViewer(c);
    // 始めた人と、戻ってきた人が同じでなければ結びつけない
    if (!viewer || viewer.id !== userId) return c.html(noticePage('やり直してください', '連携の途中の情報が見つかりませんでした。', { href: back, label: '戻る' }), 400);
    if (!(await linkGoogleLogin(db, viewer.id, sub, email, now))) {
      return c.html(noticePage('この Google アカウントは使えません', 'この Google アカウントは、ほかの Discord アカウントに結びついています。そちらで外してから、もう一度結びつけてください。', { href: back, label: '戻る' }), 409);
    }
    return c.redirect(withResult(back, 'login-linked'));
  }
  const owner = await db.prepare('SELECT user_id FROM google_logins WHERE google_sub = ?').bind(sub).first<string>('user_id');
  if (!owner) {
    // 初めての Google のアカウント。控えて、続けて Discord でログインしてもらう（ログインのあとに結びつける）
    await rememberGoogle(c, deps.key, sub, email, now);
    return c.redirect('/?login=google-new' + (back === '/' ? '' : '&return_to=' + encodeURIComponent(back)));
  }
  if (await isBanned(db, owner)) return c.redirect('/?login=banned');
  await db.prepare('UPDATE google_logins SET email = ?, last_login_at = ? WHERE google_sub = ?').bind(email, now.toISOString(), sub).run();
  await startSession(c, owner, now);
  return c.redirect(back);
}

googleRoutes.get('/auth/google/callback', async (c) => {
  // Google でログインしに行ったのなら、そちら（state で見分ける）
  const login = getCookie(c, LOGIN_COOKIE);
  if (login && safeEqual(login.split('|')[0]!, c.req.query('state') ?? '')) return loginCallback(c, login);
  const url = new URL(c.req.url);
  const saved = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: COOKIE_PATH, secure: !isLocalHttp(url) });
  // split は少なくとも 1 つを返す。途中の情報が欠けていたら、戻り先は入口
  const [state, userId = '', returnTo = '/'] = (saved ?? '').split('|') as [string, string?, string?];
  const back = { href: isReturnPath(returnTo) ? returnTo : '/', label: '戻る' };
  const viewer = await currentViewer(c);
  // 始めた人と、戻ってきた人が同じでなければ受け取らない（ほかの人の Google を結びつけないように）
  if (!saved || !viewer || viewer.id !== userId) {
    return c.html(noticePage('連携をやり直してください', '連携の途中の情報が見つかりませんでした（時間が経ちすぎたか、別のタブで開いた可能性があります）。', back), 400);
  }
  if (c.req.query('error')) return c.redirect(withResult(back.href, 'cancelled'));
  const code = c.req.query('code');
  if (!code || !safeEqual(c.req.query('state') ?? '', state)) {
    return c.html(noticePage('連携をやり直してください', '連携の確認ができませんでした。', back), 400);
  }
  const deps = (await googleDeps(c.env, appOrigin(c.env, c.req.url)))!;
  const { refreshToken, email } = await deps.api.exchangeCode(code, callbackUrl(c.env, c.req.url));
  const db = c.env.DB;
  const now = new Date();
  // 別の Google アカウントで連携し直したら、前のアカウントに書いた予定を消しておく（新しいアカウントに書き直す）
  const prev = await db.prepare('SELECT email, refresh_token FROM google_links WHERE user_id = ?').bind(viewer.id).first<{ email: string; refresh_token: string }>();
  if (prev && prev.email !== email) {
    await removeEvents(db, deps, await tryAccessToken(db, deps, viewer.id, prev.refresh_token, now), viewer.id, { left: CALL_BUDGET });
  }
  await db
    .prepare(
      `INSERT INTO google_links (user_id, email, refresh_token, created_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (user_id) DO UPDATE SET email = excluded.email, refresh_token = excluded.refresh_token, error = '', busy_at = NULL`,
    )
    .bind(viewer.id, email, await seal(deps.key, refreshToken), now.toISOString())
    .run();
  c.executionCtx.waitUntil(syncUser(db, deps, viewer.id, now, { write: true, busy: true }));
  return c.redirect(withResult(back.href, 'linked'));
});
