// Vitest の設定。
//   worker … src/worker を Workers の実行環境（ローカルの D1 つき）で確かめる
//   client … 画面の JS（src/client）を Node で確かめる
// カバレッジ（npm run test:coverage）は Istanbul で測る（Workers の実行環境では V8 のカバレッジが使えない）。
// 測るのはサーバーと共有の型だけ。画面のテストはファイルを文字として読むだけで動かさないので、画面は e2e が受け持つ
import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig, type ViteUserConfig } from 'vitest/config';

export default defineConfig(async (): Promise<ViteUserConfig> => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    test: {
      coverage: {
        provider: 'istanbul',
        include: ['src/worker/**/*.ts', 'src/shared/**/*.ts'],
        // text は 100% のファイルも並べる。html は coverage/index.html に出る
        reporter: [['text', { skipFull: false }], 'html', 'json-summary'],
        reportsDirectory: 'coverage',
        // どれか 1 つでも 100% を下回ったら失敗にする。通らない道を足したら、テストも足す
        thresholds: { 100: true },
      },
      projects: [
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: './wrangler.jsonc' },
              miniflare: {
                bindings: {
                  TEST_MIGRATIONS: migrations,
                  DISCORD_CLIENT_ID: 'test-client',
                  DISCORD_CLIENT_SECRET: 'test-secret',
                  DISCORD_BOT_TOKEN: 'test-bot-token',
                  APP_URL: 'https://yoki.test',
                  // 区切りの読み方（カンマと空白）も確かめる
                  OPERATOR_IDS: '400000000000000098, 400000000000000099',
                },
                // 画面の静的ファイルの代わり（テストでは組み立てない）。グループの画面と運営者の管理画面の骨組みだけ返す
                serviceBindings: {
                  ASSETS: (request: Request) => {
                    const page: Record<string, string> = { '/console/': '卓予定', '/operator/': '運営の管理画面' };
                    const title = page[new URL(request.url).pathname];
                    return title ? new Response('<!doctype html><title>' + title + '</title>', { headers: { 'Content-Type': 'text/html' } }) : new Response('not found', { status: 404 });
                  },
                },
              },
            }),
          ],
          test: { name: 'worker', include: ['test/worker/**/*.test.ts'], setupFiles: ['test/worker/setup.ts'] },
        },
        {
          test: { name: 'client', include: ['test/client/**/*.test.js'], environment: 'node' },
        },
      ],
    },
  };
});
