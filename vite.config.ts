// Viteの設定。画面（src/client）とWorker（src/worker）を、Cloudflareのプラグインで一緒に動かす。
//   npm run dev     開発サーバー。WorkerとD1（ローカル）ごと動く
//   npm run build   dist/ に組み立てる（GitHub Actionsのdeploy.ymlが使う）。開発用ログインが残っていたら止まる
// 組み立てると、プラグインがwrangler deployの行き先（.wrangler/deploy/config.json）をroot（src/client）の下に書く。
// リポジトリの直下で動かすwranglerからは見えないので、deploy.ymlは組み立てたdist/yoki/wrangler.jsonを直接渡す
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cloudflare, type WorkerConfig } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import Icons from 'unplugin-icons/vite';
import { defineConfig, type Plugin } from 'vite';
import { reactIconCompiler } from './tools/icons.ts';

/** 公開するCloudflareごとに違う値（環境変数の名前 → 入れる先）。リポジトリのwrangler.jsoncには仮の値だけを置く */
const DEPLOY_VALUES = ['YOKI_D1_DATABASE_ID', 'YOKI_APP_URL', 'YOKI_DISCORD_CLIENT_ID'] as const;

/**
 * 組み立てのときに、公開するCloudflareごとの値を設定（dist/yoki/wrangler.json）に入れる。値は環境変数から読む
 * （deploy.ymlがGitHubのenvironment「production」から渡す）。YOKI_DEPLOY=1のときに欠けていたら、仮の値のまま公開しないように止める。
 * プラグインは返した値を元の設定に混ぜる（配列は足し合わせる）ので、受け取った設定をその場で書き換えて何も返さない
 */
function deployValues(config: WorkerConfig): void {
  const env = process.env;
  const missing = DEPLOY_VALUES.filter((k) => !env[k]);
  if (env.YOKI_DEPLOY === '1' && missing.length) throw new Error('公開に要る値がありません: ' + missing.join('、') + '（GitHubのenvironment「production」の変数に入れる）');
  const db = config.d1_databases.find((d) => d.binding === 'DB');
  if (db && env.YOKI_D1_DATABASE_ID) db.database_id = env.YOKI_D1_DATABASE_ID;
  if (env.YOKI_APP_URL) config.vars.APP_URL = env.YOKI_APP_URL;
  if (env.YOKI_DISCORD_CLIENT_ID) config.vars.DISCORD_CLIENT_ID = env.YOKI_DISCORD_CLIENT_ID;
  // Googleカレンダーとの連携は、無くても動くのでDEPLOY_VALUES（欠けたら止まる一覧）には入れない
  if (env.YOKI_GOOGLE_CLIENT_ID) config.vars.GOOGLE_CLIENT_ID = env.YOKI_GOOGLE_CLIENT_ID;
  // 公開しているリポジトリ（owner/name。deploy.ymlがgithub.repositoryを渡す）。運営の管理画面の「更新」が、更新のワークフローを呼ぶ先
  if (env.YOKI_REPOSITORY) config.vars.APP_REPOSITORY = env.YOKI_REPOSITORY;
  // 新しい版を見に行く元のリポジトリ（無ければsrc/worker/update/config.tsの既定）。フォークのフォークで使う
  if (env.YOKI_UPSTREAM) config.vars.UPSTREAM_REPOSITORY = env.YOKI_UPSTREAM;
}

const root = path.join(import.meta.dirname, 'src/client');

/**
 * 画面とサーバーの約束（src/shared/api.ts）の形の印。画面のJSに __API_SHAPE__ として入れる。
 * 端末に控えたグループのデータ（features/console/api/sync.ts）は、印が違えば使わない（公開で欄が増えたあと、古い形のデータで描いて画面が落ちないように）
 */
function apiShape(): string {
  return createHash('sha256').update(readFileSync(path.join(import.meta.dirname, 'src/shared/api.ts'))).digest('hex').slice(0, 12);
}

/**
 * 卓予定の版。いちばん近い版のタグ（vX.Y.Z。元のリポジトリではsemantic-releaseが作り、フォークでは更新のワークフローが取り込む）から読む。
 * Workerに __APP_VERSION__ として入れ、運営の管理画面の「更新」で新しい版と比べる。タグが無ければ（履歴を浅く取ったときなど）0.0.0。
 * package.jsonのversionは使わない（0.0.0-developmentのまま）
 */
export function appVersion(): string {
  try {
    const tag = execFileSync('git', ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*'], { cwd: import.meta.dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return tag.trim().replace(/^v/, '');
  } catch {
    return '0.0.0';
  }
}

/**
 * 組み立てたJSに開発用の道（/dev/login・/dev/reset・/dev/google）が残っていたら、組み立てを止める。
 * 開発用ログイン（src/worker/auth/dev.ts）と開発用の偽のGoogle（src/worker/google/dev.ts）はimport.meta.env.DEVのときだけ使うので、組み立てでは消えるはず
 */
function noDevLogin(): Plugin {
  return {
    name: 'yoki:no-dev-login',
    apply: 'build',
    generateBundle(_, bundle) {
      const bad = Object.values(bundle).filter((f) => f.type === 'chunk' && /\/dev\/(login|reset|google)/.test(f.code)).map((f) => f.fileName);
      if (bad.length) this.error('組み立てたJSに開発用ログインが残っています: ' + bad.join(', '));
    },
  };
}

export default defineConfig(({ command }) => ({
  root,
  define: { __API_SHAPE__: JSON.stringify(apiShape()), __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [
    // 画面のReact（JSXと、開発サーバーで直すとすぐ反映されるFast Refresh）
    react(),
    // 見た目（Tailwind CSS。src/client/index.cssが入口）
    tailwindcss(),
    // アイコン（~icons/<集まり>/<名前> をimportすると、組み立てのときにSVGのReactの部品になる。使う名前はsrc/client/ui/icons.ts）。
    // 大きさは1em（文字の大きさに合わせる）
    Icons({ compiler: reactIconCompiler, scale: 1 }),
    cloudflare({
      configPath: path.join(import.meta.dirname, 'wrangler.jsonc'),
      // ローカルのD1などを、wranglerのコマンド（npm run db:migrate:local）と同じ場所に置く
      persistState: { path: path.join(import.meta.dirname, '.wrangler/state') },
      // 公開するCloudflareごとの値は、組み立てのときだけ入れる（開発サーバーはwrangler.jsoncと .dev.varsのまま）
      config: command === 'build' ? deployValues : undefined,
    }),
    noDevLogin(),
  ],
  build: {
    outDir: path.join(import.meta.dirname, 'dist'),
    emptyOutDir: true,
  },
}));
