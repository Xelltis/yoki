// Workerが受け取る値。Envはwrangler typesがwrangler.jsoncから作る（worker-configuration.d.ts）。
// 秘密の値（Workerのsecret。手元では .dev.vars）はwrangler.jsoncに書かないので、ここで足す
export type Bindings = Env & {
  DISCORD_CLIENT_SECRET?: string;
  /** 知らせを送るBot（卓予定のDiscordアプリ）のトークン。無ければDiscordに送れない */
  DISCORD_BOT_TOKEN?: string;
  /** 運営者のDiscordユーザーID（カンマか空白で区切る）。公開のActionsのログに出さないように、varsではなくsecretにする */
  OPERATOR_IDS?: string;
  /** Googleカレンダーとの連携（OAuthのクライアント）。Client IDはvars、secretはWorkerのsecret */
  GOOGLE_CLIENT_SECRET?: string;
  /** Googleのrefresh tokenをD1に置くときに暗号化する鍵（32バイトをbase64にしたもの）。無ければGoogle連携は使えない */
  GOOGLE_TOKEN_KEY?: string;
  /**
   * 運営の管理画面の「更新」のボタンで、公開しているリポジトリの更新のワークフローを動かすトークン（GitHubのfine-grained token。
   * そのリポジトリのActionsを読み書きする権限だけ）。無ければ、GitHubのActionsの画面から動かす。画面・ログ・APIには出さない
   */
  UPDATE_DISPATCH_TOKEN?: string;
};
