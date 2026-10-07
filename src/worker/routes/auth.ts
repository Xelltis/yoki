// Discordでログイン・ログアウト。初めてのGoogleのアカウントで来た人は、ここでログインしたあとに結びつける（auth/google-login.ts）
import { Hono } from 'hono';
import { isReturnPath } from '../../shared/routes';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../app';
import { consumeGoogleLink, forgetGoogleLink } from '../auth/google-login';
import { authorizeUrl, fetchDiscordProfile, saveProfile } from '../auth/oauth';
import { isOperator } from '../auth/operator';
import { appOrigin, rememberOrigin } from '../auth/origin';
import { mayLogIn } from '../domain/registration';
import { endSession, isBanned, isLocalHttp, startSession } from '../auth/session';
import { randomToken, safeEqual } from '../lib/ids';
import { noticePage } from './html';

const STATE_COOKIE = 'yoki_oauth';

export const authRoutes = new Hono<AppEnv>();

/** Discordから戻ってくる先。公開のアドレスで作る（DiscordアプリのRedirectsに書いたものと同じにする） */
const callbackUrl = (env: { APP_URL?: string }, reqUrl: string) => appOrigin(env, reqUrl) + '/auth/callback';

authRoutes.get('/auth/login', (c) => {
  if (!c.env.DISCORD_CLIENT_ID) {
    return c.html(noticePage('Discordログインの設定がありません', 'DISCORD_CLIENT_IDが設定されていません（手元では .dev.vars、設置したYokiではWorkerのsecret）。', { href: '/', label: '入口へ戻る' }), 500);
  }
  const url = new URL(c.req.url);
  const want = c.req.query('return_to') ?? '/';
  // 戻ってよいのは、画面の道の一覧（src/shared/routes.ts）にある道だけ
  const returnTo = isReturnPath(want) ? want : '/';
  // 初めはprompt=none（許可済みなら画面を出さずに戻る）。Discordが断ったら一度だけconsentでやり直す
  const consent = c.req.query('consent') === '1';
  // 初めてのGoogleのアカウントを結びつけるために押したか（入口の「Discordでログイン」が付ける）。modeの後ろにgを付けて控える
  const linkGoogle = c.req.query('link_google') === '1';
  const state = randomToken();
  setCookie(c, STATE_COOKIE, [state, (consent ? 'c' : 'n') + (linkGoogle ? 'g' : ''), returnTo].join('|'), {
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
  // splitは少なくとも1つを返す。途中の情報が欠けていたら、戻り先は入口
  const [state, mode = '', returnTo = '/'] = saved.split('|') as [string, string?, string?];
  const linkGoogle = mode.endsWith('g');
  const error = c.req.query('error');
  if (error) {
    if (mode.startsWith('n') && error !== 'access_denied') return c.redirect('/auth/login?consent=1' + (linkGoogle ? '&link_google=1' : '') + '&return_to=' + encodeURIComponent(returnTo));
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
  // 見回り（cron）が知らせのリンクに使うアドレスを控える
  await rememberOrigin(c.env.DB, appOrigin(c.env, c.req.url));
  const back = isReturnPath(returnTo) ? returnTo : '/';
  // 初めてのGoogleのアカウントを結びつけるために来ていたら、この人に結びつける（入口へ戻るなら、そのことを知らせる）
  if (linkGoogle && (await consumeGoogleLink(c, user.id)) && back === '/') return c.redirect('/?login=google-linked');
  return c.redirect(back);
});

authRoutes.post('/auth/logout', async (c) => {
  await endSession(c);
  // 結びつけを待っているGoogleのアカウントの控えも消す（共用の端末で、次の人に結びつかないように）
  forgetGoogleLink(c);
  return c.redirect('/', 303);
});
