# Yoki（卓予定）

TRPG の卓の予定を、Discord サーバーの仲間と管理する Web アプリ。卓の登録、メンバーの予定（△×）、募集、日程調整を画面で行い、知らせを Discord の Webhook に送る。

- サーバーは Cloudflare Workers、データは D1（SQLite）、ログインは Discord
- 1 つの Cloudflare に、Discord サーバーごとのグループを何個でも作れる。グループに入れるのは、そのサーバーにいる人だけ
- 使う人向けの説明はサイト（https://xelltis.github.io/yoki/ 。中身は `website/`）、作りの説明は [docs/architecture.md](docs/architecture.md)

## 手元で動かす

Node.js（22.12 以降か 24 以降。`.node-version` は 24）が要る。

```
npm install
npm run dev
```

`http://localhost:5173/` を開き、「開発用ログイン」でサンプルのグループに入る。Discord も Cloudflare のアカウントも要らない。データは手元の D1（`.wrangler/state/`）に入る。

- ひよりは管理者、ほかの人はただのメンバーとして入れる（権限の違いを確かめられる）
- サンプルのグループは、初めて入ったときに作られる。作り直すときは `curl -X POST http://localhost:5173/dev/reset -H 'Origin: http://localhost:5173'`
- 本物の Discord でログインを試すときは、`.dev.vars.example` を `.dev.vars` に写して、Discord アプリの値を入れる（下の「公開」の 1）
- サーバー側（`src/worker`）と画面（`src/client`）のどちらを直しても、開いている画面に反映される

## フォルダ構成

```
src/worker/        サーバー（TypeScript、Hono）
  routes/          道。auth（ログイン）・me（入口の API）・pages（グループのページ）・rpc（画面からの呼び出し）
  auth/            Discord の OAuth・ログインの続き・グループに入れるかの確認・CSRF・開発用ログイン
  domain/          卓・メンバー・予定・日程調整・設定・知らせの見回り（GAS 版の Sessions.js などを移したもの）
  discord/         送り先の選び方・文面・送信と送り直し
  lib/             日本時間の日付・文字・エラー・ID
  seed/            サンプルデータ
src/client/        画面（Vite の root）
  index.html       入口（ログイン・グループの一覧・グループを作る）
  console/         グループのアプリ（/g/:id/ で開く）
migrations/        D1 の表の定義（wrangler d1 migrations）
test/worker/       サーバーのテスト（Workers の実行環境と本物の D1 で動かす）
test/client/       画面のテスト（構文と、サーバーとの約束）
test/e2e/          ブラウザで通しで確かめる（npm run e2e）。開発サーバーを立てる小道具も
website/           サイト（VitePress。GitHub Pages に公開する）。紹介と使い方
  guide/           使い方のページ（Markdown）
  .vitepress/      サイトの設定と見た目・試せる例の部品
  public/          アイコン・SNS 用の画像（og.png）・アプリのスクリーンショット
  tools/           スクリーンショットと SNS 用の画像を作る道具
.github/workflows/ サイトを GitHub Pages に公開する
docs/              作りの説明（architecture.md）
wrangler.jsonc     Worker の設定（D1・cron・公開する値）
vite.config.ts     開発サーバーと組み立て
vitest.config.ts   テスト
lefthook.yml       Git のフック（コミットの前の確認）
commitlint.config.js コミットの説明の決まり（Conventional Commits）
CLAUDE.md          Claude Code で作業するときの決まり（コミットの書き方など）
```

## テスト

```
npm test             サーバーと画面のテスト
npm run typecheck    型の確認
npm run e2e          ブラウザで通しで確かめる（開発サーバーをその場で立てる。初回は npx playwright install chromium）
```

サーバーのテストは、Workers の実行環境（`@cloudflare/vitest-pool-workers`）でローカルの D1 にマイグレーションを当てて動かす。Discord への送信は差し替えて記録する。

コミットのときは、Git のフック（lefthook。`lefthook.yml`）が次を確かめる。フックは `npm install` のときに入る（入っていなければ `npx lefthook install`）。

- コミットの前: 型の確認（TypeScript・Vue・tsconfig を変えたとき）とテスト（`src/`・`test/`・`migrations/`・`website/`・設定を変えたとき）
- コミットの説明: [Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/) の形か（commitlint。`commitlint.config.js`。書き方は [CLAUDE.md](CLAUDE.md) の「コミット」）

## 公開（Cloudflare）

1. **Discord アプリを作る**。[Discord Developer Portal](https://discord.com/developers/applications) で New Application → OAuth2 で、Redirects に `https://<公開するアドレス>/auth/callback` と `http://localhost:5173/auth/callback` を足す。Client ID と Client Secret を控える（Bot は要らない）
2. **Cloudflare にログインし、D1 を作る**
   ```
   npx wrangler login
   npx wrangler d1 create yoki
   ```
   出てきた `database_id` を `wrangler.jsonc` の `d1_databases` に書く
3. **値を入れる**。`wrangler.jsonc` の `vars` に `APP_URL`（公開するアドレス）と `DISCORD_CLIENT_ID` を書き、シークレットを入れる
   ```
   npx wrangler secret put DISCORD_CLIENT_SECRET
   ```
4. **公開する**
   ```
   npm run deploy
   ```
   テスト → 組み立て（開発用ログインが残っていたら止まる）→ 本番の D1 にマイグレーション → 公開、の順に進む。公開には、組み立てた設定（`dist/yoki/wrangler.json`）を使う

最初は `https://yoki.<アカウント>.workers.dev` で公開される。独自のドメインはあとから Cloudflare の画面で足せる（そのときは APP_URL と Discord の Redirects も直す）。

Cloudflare は無料のプランで動く。グループが増えて、知らせの見回りで送る数が多くなったら、有料のプラン（Workers Paid）にする。

## サイト（GitHub Pages）

紹介と使い方のページは `website/` にあり、VitePress で組み立てて GitHub Pages（https://xelltis.github.io/yoki/）に公開する。

```
npm run site         手元で開く（http://localhost:5174/yoki/。直すとすぐ反映される）
npm run site:build   組み立てる（website/.vitepress/dist/）
```

- 使い方のページは `website/guide/` の Markdown。試せる例・スクリーンショット・ボタンの名前は、`website/.vitepress/theme/components/` の部品を本文から使う（`<AvailDemo />`、`<Shot name="pc-calendar" themed alt="…" />`、`<Ui icon="settings">設定</Ui>` など）
- 本文や部品にアイコンを足したら、`website/.vitepress/config.ts` の `ICONS` にも足す（テストが確かめる）
- アプリの見た目を変えたら、`npm run screenshots` で撮り直してコミットする（サイトの組み立てでは撮らない）
- アプリを公開したら、`config.ts` の `APP_URL` に書く。上のナビに「アプリを開く」が出る
- アプリの「使い方」のボタンは、サイト（`config.ts` の `SITE_URL`）を指す。サイトのアドレスを変えたら、アプリの側も直す（テストが確かめる）
- 公開は GitHub Actions（`.github/workflows/pages.yml`）が、main に `website/` の変更が入ったときに行う。初めてのときは、リポジトリの Settings → Pages の Source を「GitHub Actions」にする。非公開のリポジトリから Pages を公開するには、GitHub の有料のプランが要る

## ほかのコマンド

| コマンド | すること |
|---|---|
| `npm run build` | 公開する形に組み立てる（`dist/`） |
| `npm run preview` | 組み立てたものを手元で動かす |
| `npm run db:migrate:local` / `db:migrate:remote` | 手元・本番の D1 にマイグレーションを当てる |
| `npm run types` | `wrangler.jsonc` から型（`worker-configuration.d.ts`）を作り直す |
| `npm run site` / `site:build` / `site:preview` | サイトを手元で開く・組み立てる・組み立てたものを開く（下の「サイト」） |
| `npm run screenshots` | サイトに載せるアプリのスクリーンショットを `website/public/screenshots/` に撮る（開発サーバーをその場で立てる） |
| `npm run og-image` | SNS に貼ったときに出る画像を `website/public/og.png` に書き出す |

## 書くときの決まり

- **日付は日本時間で扱う。** Workers は UTC で動く。日付と時刻は `src/worker/lib/jst.ts` を使い、`new Date(y, m, d)` や `getHours()` は使わない
- **画面から呼べる関数は `src/worker/routes/rpc.ts` の一覧だけ。** 足すときは一覧と、画面の `API_FUNCS`（`src/client/console/app.js`）の両方に書く。管理者だけの関数は `admin` を付ける
- **D1 の問い合わせの数を増やしすぎない。** 1 回の呼び出しで使える数に上限がある（無料のプランで 50）。卓の数だけ文を作らず、JSON（`json_each`）で 1 文にまとめる
- **表を変えるときは、マイグレーションを足す。** `migrations/` に番号の続くファイルを足し、すでにあるファイルは書き換えない
- **画面にアイコンを足したら**、そのページの先頭の読み込みの `icon_names` にも名前をアルファベット順で足す（テストが確かめる）
- メンバーは中では ID で持ち、画面とのやり取りでは名前を使う（`src/worker/domain/people.ts`）
