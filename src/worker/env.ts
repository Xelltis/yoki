// Worker が受け取る値。Env は wrangler types が wrangler.jsonc から作る（worker-configuration.d.ts）。
// 秘密の値（Worker の secret。手元では .dev.vars）は wrangler.jsonc に書かないので、ここで足す
export type Bindings = Env & {
  DISCORD_CLIENT_SECRET?: string;
  /** 知らせを送る Bot（卓予定の Discord アプリ）のトークン。無ければ Discord に送れない */
  DISCORD_BOT_TOKEN?: string;
  /** 運営者の Discord ユーザー ID（カンマか空白で区切る）。公開の Actions のログに出さないように、vars ではなく secret にする */
  OPERATOR_IDS?: string;
  /** Google カレンダーとの連携（OAuth のクライアント）。Client ID は vars、secret は Worker の secret */
  GOOGLE_CLIENT_SECRET?: string;
  /** Google の refresh token を D1 に置くときに暗号化する鍵（32 バイトを base64 にしたもの）。無ければ Google 連携は使えない */
  GOOGLE_TOKEN_KEY?: string;
};
