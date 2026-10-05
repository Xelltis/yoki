// Google カレンダーとの連携の設定。本番は Client ID（vars）・secret・トークンを暗号化する鍵（secret）の 3 つがそろったときだけ使う。
// 開発サーバーで Client ID が空なら、開発用の偽の Google（dev.ts）を使う（Discord の値が空なら開発用ログインで動くのと同じ）。
// 偽物を選ぶ道は import.meta.env.DEV のときだけで、本番の組み立てには入らない
import type { Bindings } from '../env';
import { importKey } from '../lib/secretbox';
import { type GoogleApi, realGoogle } from './api';
import { fakeGoogle } from './dev';

/** 開発用の偽の Google の鍵（開発サーバーだけ。32 バイト） */
const DEV_KEY = 'ZGV2LW9ubHkta2V5LWZvci1mYWtlLWdvb2dsZS0wMDE=';

export function googleConfigured(env: Bindings): boolean {
  if (import.meta.env?.DEV && !env.GOOGLE_CLIENT_ID) return true;
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_TOKEN_KEY);
}

/** 連携に使う一式。api は Google の API、key は refresh token を暗号化する鍵、appBase はアプリのアドレス（末尾の / なし） */
export type GoogleDeps = { api: GoogleApi; key: CryptoKey; appBase: string };

/** 連携に使う一式を作る。設定が無ければ null。origin は届いた要求のアドレス（APP_URL が無いときに使う） */
export async function googleDeps(env: Bindings, origin: string): Promise<GoogleDeps | null> {
  if (!googleConfigured(env)) return null;
  const appBase = (env.APP_URL || origin).replace(/\/$/, '');
  if (import.meta.env?.DEV && !env.GOOGLE_CLIENT_ID) return { api: fakeGoogle(env.DB, appBase), key: await importKey(DEV_KEY), appBase };
  // ここに来るのは 3 つがそろっているとき（googleConfigured）
  return { api: realGoogle(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET!), key: await importKey(env.GOOGLE_TOKEN_KEY!), appBase };
}
