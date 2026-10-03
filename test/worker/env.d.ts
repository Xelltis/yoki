// テストだけで使う binding（vitest.config.ts が渡す）
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
  }
}
