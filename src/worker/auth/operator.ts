// 運営者（卓予定を公開している人）。wrangler.jsoncのvarsのOPERATOR_IDSに、DiscordのユーザーIDを書く
import type { Context } from 'hono';
import type { AppEnv } from '../app';
import { AppError, authError } from '../lib/errors';
import { DEV_USERS } from './dev-users';
import { currentViewer, isLocalHttp, type Viewer } from './session';

/** OPERATOR_IDSを読む。カンマか空白で区切る */
export function parseOperatorIds(s: string | undefined): string[] {
  return String(s || '').split(/[\s,]+/).filter(Boolean);
}

/** 開発用ログインを出してよいか（開発サーバーで、手元から開いたときだけ） */
export function devAvailable(url: URL): boolean {
  return !!import.meta.env?.DEV && isLocalHttp(url);
}

/** 運営者か。開発サーバーを手元から開いたときは、開発用の管理者（ひより）も運営者にする（npm run devだけで管理画面を試せるように） */
export function isOperator(env: { OPERATOR_IDS?: string }, userId: string, url: URL): boolean {
  if (parseOperatorIds(env.OPERATOR_IDS).includes(userId)) return true;
  return devAvailable(url) && DEV_USERS.some((u) => u.manager && u.id === userId);
}

/** 運営者のAPIの入口。ログインしていなければAUTH:、運営者でなければ403 */
export async function requireOperator(c: Context<AppEnv>): Promise<Viewer> {
  const viewer = await currentViewer(c);
  if (!viewer) throw authError('ログインしてください。');
  if (!isOperator(c.env, viewer.id, new URL(c.req.url))) throw new AppError(403, '運営者だけが使えます。');
  return viewer;
}
