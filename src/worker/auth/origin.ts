// アプリのアドレス。前にCDN（AWS CloudFrontなど）を置くと、Workerに届く要求のアドレスはworkers.devのままになる
// （CDNはHostをworkers.devにして渡す）。なので、自分のアドレス（Discordログインの戻り先・知らせのリンク・CSRFの確かめ）はAPP_URLを正とする。
// APP_URLは無くてもよい（workers.devのまま公開するとき）。そのときは届いた要求のアドレスを使い、要求の無い見回り（cron）のために、
// ログインのたびにmetaのapp_originに控える

const KEY = 'app_origin';

/** アプリのアドレス（https://…）。APP_URLがあればそれ、無ければ届いた要求のアドレス */
export function appOrigin(env: { APP_URL?: string }, reqUrl: string): string {
  return new URL(env.APP_URL || reqUrl).origin;
}

/** アドレスを控える（変わったときだけ書く） */
export async function rememberOrigin(db: D1Database, origin: string): Promise<void> {
  await db
    .prepare('INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE meta.value <> excluded.value')
    .bind(KEY, origin)
    .run();
}

/** 要求の無いところ（見回り）で使うアドレス。APP_URLがあればそれ、無ければ控えたもの。どちらも無ければ空 */
export async function savedOrigin(env: { APP_URL?: string; DB: D1Database }): Promise<string> {
  if (env.APP_URL) return new URL(env.APP_URL).origin;
  return (await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind(KEY).first<string>('value')) ?? '';
}
