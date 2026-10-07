// Viteの設定。画面（src/client）とWorker（src/worker）を、Cloudflareのプラグインで一緒に動かす。
//   npm run dev     開発サーバー。WorkerとD1（ローカル）ごと動く
//   npm run build   dist/ に組み立てる（Cloudflareの組み立て（Workers Builds）とGitHub Actionsのdeploy.ymlが使う）。開発用ログインが残っていたら止まる
// 組み立てると、プラグインがwrangler deployの行き先（.wrangler/deploy/config.json）をroot（src/client）の下に書く。
// リポジトリの直下で動かすwrangler deploy（Workers Buildsの公開）からは見えないので、直下にも同じ行き先を書く（deployRedirect）
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cloudflare, type WorkerConfig } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import Icons from 'unplugin-icons/vite';
import { defineConfig, type Plugin } from 'vite';
import { reactIconCompiler } from './tools/icons.ts';

/**
 * 公開しているリポジトリ（owner/name）。deploy.ymlはYOKI_REPOSITORYで渡す。Workers Buildsは渡さないので、Gitのoriginから読む。
 * 分からなければ空（運営の管理画面の「更新」が、GitHubの画面での更新を案内する）
 */
export function appRepository(): string {
  if (process.env.YOKI_REPOSITORY) return process.env.YOKI_REPOSITORY;
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: import.meta.dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    // https://github.com/owner/name(.git)・git@github.com:owner/name(.git)。トークンが入っていても、owner/nameだけを取る
    return /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1] ?? '';
  } catch {
    return '';
  }
}

/**
 * 組み立てのときに、公開するCloudflareごとの値を設定（dist/yoki/wrangler.json）に入れる。
 * D1のID: 「Deploy to Cloudflare」のボタンで設置したリポジトリでは、wrangler.jsoncにCloudflareが書き込んである。
 * GitHub Actionsで公開するときは、deploy.ymlがYOKI_D1_DATABASE_IDで渡す（YOKI_DEPLOY=1のときに無ければ、IDの無いまま公開しないように止める）。
 * リポジトリ（運営の管理画面の「更新」）は、毎回組み立てのときに決まるのでvarsに入れる。空なら入れない。
 * プラグインは返した値を元の設定に混ぜる（配列は足し合わせる）ので、受け取った設定をその場で書き換えて何も返さない
 */
function deployValues(config: WorkerConfig): void {
  const env = process.env;
  if (env.YOKI_DEPLOY === '1' && !env.YOKI_D1_DATABASE_ID) throw new Error('公開に要る値がありません: YOKI_D1_DATABASE_ID（GitHubのenvironment「production」の変数に入れる）');
  const db = config.d1_databases.find((d) => d.binding === 'DB');
  if (db && env.YOKI_D1_DATABASE_ID) db.database_id = env.YOKI_D1_DATABASE_ID;
  const vars: Record<string, string> = {};
  const repo = appRepository();
  if (repo) vars.APP_REPOSITORY = repo;
  // 新しい版を見に行く元のリポジトリ（無ければsrc/worker/update/config.tsの既定）。フォークのフォークで使う
  if (env.YOKI_UPSTREAM) vars.UPSTREAM_REPOSITORY = env.YOKI_UPSTREAM;
  config.vars = { ...config.vars, ...vars };
}

/**
 * 組み立てたあと、リポジトリの直下にもwrangler deployの行き先（.wrangler/deploy/config.json）を書く。
 * Workers Buildsが直下で動かすwrangler deploy・wrangler versions uploadが、組み立てたWorker（dist/yoki/wrangler.json）を公開するように
 */
function deployRedirect(): Plugin {
  return {
    name: 'yoki:deploy-redirect',
    apply: 'build',
    closeBundle() {
      const dir = path.join(import.meta.dirname, '.wrangler/deploy');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ configPath: '../../dist/yoki/wrangler.json', auxiliaryWorkers: [] }));
    },
  };
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
 * Yokiの版。package.jsonのversionから読む（元のリポジトリでは、semantic-releaseが版を出すときに書き換えてコミットする。
 * tools/release/commit-version.mjs）。Gitのタグには頼らない（ボタンで設置したリポジトリには、元の履歴とタグが無いため）。
 * Workerに __APP_VERSION__ として入れ、運営の管理画面の「更新」で新しい版と比べる
 */
export function appVersion(): string {
  return (JSON.parse(readFileSync(path.join(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }).version;
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
    deployRedirect(),
  ],
  build: {
    outDir: path.join(import.meta.dirname, 'dist'),
    emptyOutDir: true,
  },
}));
