// テストだけで使う binding（vitest.config.ts が渡す）。本番では secret の OPERATOR_IDS も、テストでは binding で渡す
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
    OPERATOR_IDS: string;
  }
}
