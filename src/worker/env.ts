// Workerが受け取る値。Envはwrangler typesがwrangler.jsoncから作る（worker-configuration.d.ts。D1と画面のファイルだけ）。
// 公開するCloudflareごとの値は、Workerのsecret（手元では .dev.vars）に置き、wrangler.jsoncに書かないので、ここで足す。
// varsにしないのは、Cloudflareの組み立て（Workers Builds）が公開するたびに、設定に無いvarsを消すため
export type Bindings = Env & {
  /** 公開のアドレス（https://…）。無ければ届いた要求のアドレス（auth/origin.ts）。CDNを前に置くときだけ要る */
  APP_URL?: string;
  /** DiscordアプリのClient ID。無ければDiscordでログインできない（手元では開発用ログインだけで動く） */
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  /** 知らせを送るBot（卓予定のDiscordアプリ）のトークン。無ければDiscordに送れない */
  DISCORD_BOT_TOKEN?: string;
  /** 運営者のDiscordユーザーID（カンマか空白で区切る）。公開のActionsのログに出さないように、varsではなくsecretにする */
  OPERATOR_IDS?: string;
  /** Googleでのログインと、Googleカレンダーとの連携（OAuthのクライアント）。3つ（ID・シークレット・鍵）がそろったときだけ使う */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Googleのrefresh tokenをD1に置くときに暗号化する鍵（32バイトをbase64にしたもの）。無ければGoogle連携は使えない */
  GOOGLE_TOKEN_KEY?: string;
  /**
   * 運営の管理画面の「更新」のボタンで、公開しているリポジトリの更新のワークフローを動かすトークン（GitHubのfine-grained token。
   * そのリポジトリのActionsを読み書きする権限だけ）。無ければ、GitHubのActionsの画面から動かす。画面・ログ・APIには出さない
   */
  UPDATE_DISPATCH_TOKEN?: string;
  /** 公開しているリポジトリ（owner/name）。組み立てのときに入る（vite.config.ts）。運営の管理画面の「更新」が、更新のワークフローを呼ぶ先 */
  APP_REPOSITORY?: string;
  /** 新しい版を見に行く元のリポジトリ（owner/name）。組み立てのときに入る。無ければ本家（update/config.ts） */
  UPSTREAM_REPOSITORY?: string;
};
