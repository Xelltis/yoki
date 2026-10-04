// Discord でログイン・ログアウト
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../app';
import { authorizeUrl, fetchDiscordProfile, saveProfile } from '../auth/oauth';
import { isOperator } from '../auth/operator';
import { appOrigin } from '../auth/origin';
import { mayLogIn } from '../domain/registration';
import { endSession, isBanned, isLocalHttp, startSession } from '../auth/session';
import { randomToken, safeEqual } from '../lib/ids';
import { noticePage } from './html';

/** ログインのあとに戻ってよい場所（入口・グループのページ・グループの管理画面・運営者の管理画面） */
export const RETURN_TO = /^\/(g\/[a-z0-9-]{1,40}\/(admin\/)?|admin\/)?$/;
const STATE_COOKIE = 'yoki_oauth';

export const authRoutes = new Hono<AppEnv>();

/** Discord から戻ってくる先。公開のアドレスで作る（Discord アプリの Redirects に書いたものと同じにする） */
const callbackUrl = (env: { APP_URL?: string }, reqUrl: string) => appOrigin(env, reqUrl) + '/auth/callback';

authRoutes.get('/auth/login', (c) => {
  if (!c.env.DISCORD_CLIENT_ID) {
    return c.html(noticePage('Discord ログインの設定がありません', 'DISCORD_CLIENT_ID が設定されていません（手元では .dev.vars、本番では wrangler.jsonc）。', { href: '/', label: '入口へ戻る' }), 500);
  }
  const url = new URL(c.req.url);
  const want = c.req.query('return_to') ?? '/';
  const returnTo = RETURN_TO.test(want) ? want : '/';
  // 初めは prompt=none（許可済みなら画面を出さずに戻る）。Discord が断ったら一度だけ consent でやり直す
  const consent = c.req.query('consent') === '1';
  const state = randomToken();
  setCookie(c, STATE_COOKIE, [state, consent ? 'c' : 'n', returnTo].join('|'), {
    httpOnly: true,
    secure: !isLocalHttp(url),
    sameSite: 'Lax',
    path: '/auth',
    maxAge: 600,
  });
  return c.redirect(authorizeUrl(c.env, callbackUrl(c.env, c.req.url), state, consent ? 'consent' : 'none'));
});

authRoutes.get('/auth/callback', async (c) => {
  const url = new URL(c.req.url);
  const saved = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: '/auth', secure: !isLocalHttp(url) });
  const retry = { href: '/auth/login', label: 'ログインをやり直す' };
  if (!saved) return c.html(noticePage('ログインをやり直してください', 'ログインの途中の情報が見つかりませんでした（時間が経ちすぎたか、別のタブで開いた可能性があります）。', retry), 400);
  // split は少なくとも 1 つを返す。途中の情報が欠けていたら、戻り先は入口
  const [state, mode, returnTo = '/'] = saved.split('|') as [string, string?, string?];
  const error = c.req.query('error');
  if (error) {
    if (mode === 'n' && error !== 'access_denied') return c.redirect('/auth/login?consent=1&return_to=' + encodeURIComponent(returnTo));
    return c.redirect('/?login=cancelled');
  }
  const code = c.req.query('code');
  if (!code || !safeEqual(c.req.query('state') ?? '', state)) {
    return c.html(noticePage('ログインをやり直してください', 'ログインの確認ができませんでした。', retry), 400);
  }
  const { user, guilds } = await fetchDiscordProfile(c.env, code, callbackUrl(c.env, c.req.url));
  // 締め出された人と、受付を止めているときの初めての人は、ログインの記録も残さずに入口へ戻す
  if (await isBanned(c.env.DB, user.id)) return c.redirect('/?login=banned');
  if (!(await mayLogIn(c.env.DB, user.id, isOperator(c.env, user.id, url)))) return c.redirect('/?login=closed');
  await saveProfile(c.env.DB, user, guilds);
  await startSession(c, user.id);
  return c.redirect(RETURN_TO.test(returnTo) ? returnTo : '/');
});

authRoutes.post('/auth/logout', async (c) => {
  await endSession(c);
  return c.redirect('/', 303);
});
