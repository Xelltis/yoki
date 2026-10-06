// テストだけで使うbinding（vitest.config.tsが渡す）。本番ではsecretのOPERATOR_IDSとDISCORD_BOT_TOKENも、テストではbindingで渡す
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
    OPERATOR_IDS: string;
    DISCORD_BOT_TOKEN: string;
  }
}
