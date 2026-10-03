// Vitest の設定。
//   worker … src/worker を Workers の実行環境（ローカルの D1 つき）で確かめる
//   client … 画面の JS（src/client）を Node で確かめる
import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    test: {
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
