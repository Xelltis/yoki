// Vite の設定。画面（src/client）と Worker（src/worker）を、Cloudflare のプラグインで一緒に動かす。
//   npm run dev     開発サーバー。Worker と D1（ローカル）ごと動く
//   npm run build   dist/ に組み立てる（npm run deploy が使う）。開発用ログインが残っていたら止まる
// 組み立てると、プラグインが wrangler deploy の行き先（.wrangler/deploy/config.json）を root（src/client）の下に書く。
// リポジトリの直下で動かす wrangler からは見えないので、npm run deploy は組み立てた dist/yoki/wrangler.json を直接渡す
import path from 'node:path';
import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig, type Plugin } from 'vite';

const root = path.join(import.meta.dirname, 'src/client');

/**
 * 組み立てた JS に開発用ログイン（/dev/login・/dev/reset）が残っていたら、組み立てを止める。
 * 開発用ログイン（src/worker/auth/dev.ts）は import.meta.env.DEV のときだけ登録するので、組み立てでは消えるはず
 */
function noDevLogin(): Plugin {
  return {
    name: 'yoki:no-dev-login',
    apply: 'build',
    generateBundle(_, bundle) {
      const bad = Object.values(bundle).filter((f) => f.type === 'chunk' && /\/dev\/(login|reset)/.test(f.code)).map((f) => f.fileName);
      if (bad.length) this.error('組み立てた JS に開発用ログインが残っています: ' + bad.join(', '));
    },
  };
}

export default defineConfig({
  root,
  plugins: [
    cloudflare({
      configPath: path.join(import.meta.dirname, 'wrangler.jsonc'),
      // ローカルの D1 などを、wrangler のコマンド（npm run db:migrate:local）と同じ場所に置く
      persistState: { path: path.join(import.meta.dirname, '.wrangler/state') },
    }),
    noDevLogin(),
  ],
  build: {
    outDir: path.join(import.meta.dirname, 'dist'),
    emptyOutDir: true,
  },
  environments: {
    // 画面のページ（Worker 側の組み立てには関係しない）
    client: {
      build: {
        rollupOptions: {
          input: {
            index: path.join(root, 'index.html'),
            console: path.join(root, 'console/index.html'),
          },
        },
      },
    },
  },
});
