// Google カレンダーと連携する（OAuth2 の認可コードの流れ）。卓予定にログインしている人だけが始められ、連携はその人に結びつく。
// state は HttpOnly の cookie（/auth/google だけ、10 分）に、ログインしている人の ID と戻り先と一緒に入れて照合する。
// 受け取った refresh token は、暗号化して google_links に置く（画面・ログ・運営者の API には出さない）
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { isReturnPath } from '../../shared/routes';
import type { AppEnv } from '../app';
import { appOrigin } from '../auth/origin';
import { currentViewer, isLocalHttp } from '../auth/session';
import { googleDeps } from '../google/config';
import { CALL_BUDGET, removeEvents, syncUser, tryAccessToken } from '../google/sync';
import { randomToken, safeEqual } from '../lib/ids';
import { seal } from '../lib/secretbox';
import { noticePage } from './html';

const STATE_COOKIE = 'yoki_google';
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

googleRoutes.get('/auth/google/callback', async (c) => {
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
