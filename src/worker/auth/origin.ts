// アプリのアドレス。前に CDN（AWS CloudFront など）を置くと、Worker に届く要求のアドレスは workers.dev のままになる
// （CDN は Host を workers.dev にして渡す）。なので、自分のアドレス（Discord ログインの戻り先・知らせのリンク・CSRF の確かめ）は APP_URL を正とする

/** アプリのアドレス（https://…）。APP_URL があればそれ、無ければ届いた要求のアドレス */
export function appOrigin(env: { APP_URL?: string }, reqUrl: string): string {
  return new URL(env.APP_URL || reqUrl).origin;
}
