// Worker が受け取る値。Env は wrangler types が wrangler.jsonc から作る（worker-configuration.d.ts）。
// 秘密の値（Worker の secret。手元では .dev.vars）は wrangler.jsonc に書かないので、ここで足す
export type Bindings = Env & {
  DISCORD_CLIENT_SECRET?: string;
  /** 運営者の Discord ユーザー ID（カンマか空白で区切る）。公開の Actions のログに出さないように、vars ではなく secret にする */
  OPERATOR_IDS?: string;
};
