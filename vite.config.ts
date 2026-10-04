// Vite の設定。画面（src/client）と Worker（src/worker）を、Cloudflare のプラグインで一緒に動かす。
//   npm run dev     開発サーバー。Worker と D1（ローカル）ごと動く
//   npm run build   dist/ に組み立てる（GitHub Actions の deploy.yml が使う）。開発用ログインが残っていたら止まる
// 組み立てると、プラグインが wrangler deploy の行き先（.wrangler/deploy/config.json）を root（src/client）の下に書く。
// リポジトリの直下で動かす wrangler からは見えないので、deploy.yml は組み立てた dist/yoki/wrangler.json を直接渡す
import path from 'node:path';
import { cloudflare, type WorkerConfig } from '@cloudflare/vite-plugin';
import { defineConfig, type Plugin } from 'vite';

/** 公開する Cloudflare ごとに違う値（環境変数の名前 → 入れる先）。リポジトリの wrangler.jsonc には仮の値だけを置く */
const DEPLOY_VALUES = ['YOKI_D1_DATABASE_ID', 'YOKI_APP_URL', 'YOKI_DISCORD_CLIENT_ID'] as const;

/**
 * 組み立てのときに、公開する Cloudflare ごとの値を設定（dist/yoki/wrangler.json）に入れる。値は環境変数から読む
 * （deploy.yml が GitHub の environment「production」から渡す）。YOKI_DEPLOY=1 のときに欠けていたら、仮の値のまま公開しないように止める。
 * プラグインは返した値を元の設定に混ぜる（配列は足し合わせる）ので、受け取った設定をその場で書き換えて何も返さない
 */
function deployValues(config: WorkerConfig): void {
  const env = process.env;
  const missing = DEPLOY_VALUES.filter((k) => !env[k]);
  if (env.YOKI_DEPLOY === '1' && missing.length) throw new Error('公開に要る値がありません: ' + missing.join('、') + '（GitHub の environment「production」の変数に入れる）');
  const db = config.d1_databases.find((d) => d.binding === 'DB');
  if (db && env.YOKI_D1_DATABASE_ID) db.database_id = env.YOKI_D1_DATABASE_ID;
  if (env.YOKI_APP_URL) config.vars.APP_URL = env.YOKI_APP_URL;
  if (env.YOKI_DISCORD_CLIENT_ID) config.vars.DISCORD_CLIENT_ID = env.YOKI_DISCORD_CLIENT_ID;
}

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

export default defineConfig(({ command }) => ({
  root,
  plugins: [
    cloudflare({
      configPath: path.join(import.meta.dirname, 'wrangler.jsonc'),
      // ローカルの D1 などを、wrangler のコマンド（npm run db:migrate:local）と同じ場所に置く
      persistState: { path: path.join(import.meta.dirname, '.wrangler/state') },
      // 公開する Cloudflare ごとの値は、組み立てのときだけ入れる（開発サーバーは wrangler.jsonc と .dev.vars のまま）
      config: command === 'build' ? deployValues : undefined,
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
            operator: path.join(root, 'operator/index.html'),
          },
        },
      },
    },
  },
}));
