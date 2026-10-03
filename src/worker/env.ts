// Worker が受け取る値。Env は wrangler types が wrangler.jsonc から作る（worker-configuration.d.ts）。
// 秘密の値（wrangler secret put / .dev.vars）は wrangler.jsonc に書かないので、ここで足す
export type Bindings = Env & {
  DISCORD_CLIENT_SECRET?: string;
};
