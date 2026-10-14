// Vitestの設定。
//   worker … src/workerをWorkersの実行環境（ローカルのD1つき）で確かめる
//   client … 画面のJS（src/client）をNodeで確かめる
// カバレッジ（npm run test:coverage）はIstanbulで測る（Workersの実行環境ではV8のカバレッジが使えない）。
// 測るのはサーバーと共有の型だけ。画面のテストはファイルを文字として読むだけで動かさないので、画面はe2eが受け持つ
import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig, type ViteUserConfig } from 'vitest/config';
import { appVersion } from './vite.config';

export default defineConfig(async (): Promise<ViteUserConfig> => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    test: {
      // 同時に流すのは2つまで。Workerのテストは、1つにつきWorkersの実行環境（workerdとローカルのD1。300MBほど）を1つ立てるので、
      // 数を決めておかないと、CPUの数に合わせて立ち、メモリを食う（16コアの手元で、CPUの半分の8つでは3GB余り。2つなら2GBに収まり、全部で30秒ほど）。
      // プロジェクトごとに変えると、Vitestがsequence.groupOrderを分けるよう求めるので、ここでそろえる
      maxWorkers: 2,
      coverage: {
        provider: 'istanbul',
        include: ['src/worker/**/*.ts', 'src/shared/**/*.ts'],
        // textは100% のファイルも並べる。htmlはcoverage/index.htmlに出る
        reporter: [['text', { skipFull: false }], 'html', 'json-summary'],
        reportsDirectory: 'coverage',
        // どれか1つでも100% を下回ったら失敗にする。通らない道を足したら、テストも足す
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
                // 画面の静的ファイルの代わり（テストでは組み立てない）。画面の骨組み（1つのSPA）だけ返す
                serviceBindings: {
                  ASSETS: (request: Request) => new URL(request.url).pathname === '/'
                    ? new Response('<!doctype html><html><head><title>Yoki</title><meta name="description" content="x"><meta property="og:title" content="Yoki">'
                      + '<meta property="og:image" content="/og.png"><meta name="twitter:card" content="summary_large_image"></head><body><div id="root"></div></body></html>', { headers: { 'Content-Type': 'text/html' } })
                    : new Response('not found', { status: 404 }),
                },
              },
            }),
          ],
          // Workerが使う、組み立てのときに入れる値（vite.config.ts）
          define: { __APP_VERSION__: JSON.stringify(appVersion()) },
          test: {
            name: 'worker',
            include: ['test/worker/**/*.test.ts'],
            setupFiles: ['test/worker/setup.ts'],
            // 立てた実行環境を、次のファイルでも使い回す（ファイルごとに立て直さない）。D1はsetup.tsがテストごとに空にし、
            // 差し替えた関数（vi.spyOn）はテストのたびに戻すので、ファイルどうしは混ざらない
            isolate: false,
            // 上限に余裕を持たせる（ふだんはいちばん遅いテストで2秒ほど。既定はテスト5秒・前後の準備10秒）
            testTimeout: 30_000,
            hookTimeout: 30_000,
          },
        },
        {
          // 画面のJSが使う、組み立てのときに入れる値（vite.config.ts）
          define: { __API_SHAPE__: JSON.stringify('test') },
          // 画面のテストも、ファイルごとにNodeのプロセスを立て直さない（差し替えたものは、テストのたびに戻す）
          test: { name: 'client', include: ['test/client/**/*.test.{js,ts}'], environment: 'node', isolate: false },
        },
      ],
    },
  };
});
