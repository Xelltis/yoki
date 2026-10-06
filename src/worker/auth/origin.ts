// アプリのアドレス。前にCDN（AWS CloudFrontなど）を置くと、Workerに届く要求のアドレスはworkers.devのままになる
// （CDNはHostをworkers.devにして渡す）。なので、自分のアドレス（Discordログインの戻り先・知らせのリンク・CSRFの確かめ）はAPP_URLを正とする

/** アプリのアドレス（https://…）。APP_URLがあればそれ、無ければ届いた要求のアドレス */
export function appOrigin(env: { APP_URL?: string }, reqUrl: string): string {
  return new URL(env.APP_URL || reqUrl).origin;
}
