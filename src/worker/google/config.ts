// Googleカレンダーとの連携の設定。本番はClient ID・secret・トークンを暗号化する鍵の3つ（どれもWorkerのsecret）がそろったときだけ使う。
// 開発サーバーでClient IDが空なら、開発用の偽のGoogle（dev.ts）を使う（Discordの値が空なら開発用ログインで動くのと同じ）。
// 偽物を選ぶ道はimport.meta.env.DEVのときだけで、本番の組み立てには入らない
import type { Bindings } from '../env';
import { importKey, isKey } from '../lib/secretbox';
import { type GoogleApi, realGoogle } from './api';
import { fakeGoogle } from './dev';

/** 開発用の偽のGoogleの鍵（開発サーバーだけ。32バイト） */
const DEV_KEY = 'ZGV2LW9ubHkta2V5LWZvci1mYWtlLWdvb2dsZS0wMDE=';

/**
 * Googleとの連携を使えるか。3つがそろい、鍵が正しい形（32バイト）のときだけ。
 * 鍵の形が違うときも「使えない」として扱う（鍵を読むところで投げると、卓の保存などGoogleに関わらない操作まで止まるため）
 */
export function googleConfigured(env: Bindings): boolean {
  if (import.meta.env?.DEV && !env.GOOGLE_CLIENT_ID) return true;
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_TOKEN_KEY && isKey(env.GOOGLE_TOKEN_KEY));
}

/** 連携に使う一式。apiはGoogleのAPI、keyはrefresh tokenを暗号化する鍵、appBaseはアプリのアドレス（末尾の / なし） */
export type GoogleDeps = { api: GoogleApi; key: CryptoKey; appBase: string };

/** 連携に使う一式を作る。設定が無ければnull。originは届いた要求のアドレス（APP_URLが無いときに使う） */
export async function googleDeps(env: Bindings, origin: string): Promise<GoogleDeps | null> {
  if (!googleConfigured(env)) return null;
  const appBase = (env.APP_URL || origin).replace(/\/$/, '');
  if (import.meta.env?.DEV && !env.GOOGLE_CLIENT_ID) return { api: fakeGoogle(env.DB, appBase), key: await importKey(DEV_KEY), appBase };
  // ここに来るのは3つがそろい、鍵が正しい形のとき（googleConfigured）
  return { api: realGoogle(env.GOOGLE_CLIENT_ID!, env.GOOGLE_CLIENT_SECRET!), key: await importKey(env.GOOGLE_TOKEN_KEY!), appBase };
}
