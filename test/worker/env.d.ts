// テストだけで使うbinding（vitest.config.tsが渡す）。本番ではsecretのDISCORD_CLIENT_ID・OPERATOR_IDS・DISCORD_BOT_TOKENも、テストではbindingで渡す
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
    DISCORD_CLIENT_ID: string;
    OPERATOR_IDS: string;
    DISCORD_BOT_TOKEN: string;
  }
}
