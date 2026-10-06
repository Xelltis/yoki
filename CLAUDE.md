# CLAUDE.md

このリポジトリで作業するときの決まり。動かし方と書くときの決まりは [README.md](README.md)、作りとその理由は [docs/architecture.md](docs/architecture.md) にある。

## 何のリポジトリか

卓予定（Yoki）。TRPG の卓の予定を、Discord サーバーの仲間と管理する Web アプリ。

- アプリ: Cloudflare Workers（TypeScript・Hono）＋ D1 ＋ Discord ログイン。サーバーは `src/worker/`、画面は `src/client/`（React・TanStack Router・TanStack Query の 1 つの SPA）
- サイト: 紹介と使い方。`website/`（VitePress）を GitHub Pages に公開する
- 文書・画面の文・コミットの説明は日本語。短い文で、平易に書く

## コマンド

| コマンド | すること |
|---|---|
| `npm run dev` | アプリを開発サーバーで動かす（http://localhost:5173/ 、「開発用ログイン」でサンプルのグループに入る） |
| `npm test` | サーバーと画面のテスト |
| `npm run test:coverage` | テストのカバレッジ（サーバーと共有の型。`coverage/index.html` にも出る） |
| `npm run typecheck` | 型の確認（アプリ・設定ファイル・サイト） |
| `npm run lint` | lint（oxlint。React の hooks とアクセシビリティの決まりも） |
| `npm run e2e` | ブラウザで通しで確かめる（開発サーバーをその場で立てる） |
| `npm run build` | 組み立てる。開発用ログインが残っていたら止まる |
| `npm run site` / `npm run site:build` | サイトを手元で開く・組み立てる |
| `npm run screenshots` | サイトに載せるアプリのスクリーンショットを撮り直す |
| `npm run icons` | `brand/yoki.png` からファビコンなどのアイコンを書き出す |

アプリの公開は GitHub Actions（`.github/workflows/deploy.yml`）が、main にアプリの変更が push されたときに行う。手元から `wrangler deploy` や本番の D1 へのマイグレーションはしない。main への push は本番への公開になるので、頼まれたときだけ、確かめてから push する。

## 変えたら確かめること

- いつも: `npm test`・`npm run typecheck`・`npm run lint`
- サーバー（`src/worker`）を変えたら: `npm run test:coverage`。カバレッジは 100% を保つ（下回ると失敗する）。外すのは、テストの環境で動かせない道だけ（README の「テスト」）
- 画面（`src/client/`）を変えたら: `npm run e2e`。見た目が変わったら `npm run screenshots` で撮り直し、画像もコミットする
- サイト（`website/`）を変えたら: `npm run site:build`
- サービスアイコン（`brand/yoki.png`）を変えたら: `npm run icons` で書き出し、出したファイルもコミットする。ロゴが写るので `npm run screenshots` も撮り直す
- 表（D1）を変えたら: `migrations/` に番号の続くファイルを足す。すでにあるファイルは書き換えない

## 守ること

README の「書くときの決まり」に加えて、次を守る。

- 日付と時刻は `src/worker/lib/jst.ts` で日本時間として扱う（Workers は UTC で動く）
- 画面とサーバーの約束（呼べる関数の名前・画面データの型・返事の形）は `src/shared/api.ts` に置く。呼べる関数を足すときは、ここの `RPC_FUNCS` とサーバーの一覧（`src/worker/routes/rpc.ts`）の両方に足す
- 画面の道（URL）を足すときは、`src/shared/routes.ts`（タブ・区分の一覧）・`src/worker/routes/pages.ts`・`src/client/router.tsx` にそろえて足す
- グループの画面のデータは `ConsoleSync`（`src/client/features/console/api/sync.ts`）だけで読み書きする。楽観的な書き換えは `model/optimistic.ts` の純粋な関数にし、仮の ID は `'__tmp__'`
- e2e とスクリーンショットの道具が使う要素の ID・`data-*`・`window.yoki`（`D`・`selectDay`・`showTab`）は保つ。変えるなら `test/e2e/smoke.js` と `website/tools/screenshots.js` も直す
- 見た目は Tailwind CSS のクラスで書く。色・寸法・文字の大きさは `src/client/styles/theme.css` のトークンを使い、色を直に書かない。クラスの名前を文字列のつなぎで組み立てない（CSS が出ない）。くり返す形は `ui/` か `features/…/styles.ts` の定数にする
- 配色はサービスアイコンの青（`#2D2AFE`）が主で、オレンジ・ピンク・黄は差し色（アイコンの色は `brand`・`orange` などのトークン）。白い地の字にオレンジを使わず、字は地と組の変数（`accent-text`・`soon-text` など）にする。配色を変えたら、Tailwind を通らない Worker のページ（`src/worker/routes/html.ts`）・サイト（`website/.vitepress/theme/style.css`）・SNS 用の画像（`npm run og-image`）・manifest と theme-color も直す
- 開発用ログイン（`src/worker/auth/dev.ts`）と開発用の偽の Google（`src/worker/google/dev.ts`）は `import.meta.env.DEV` のときだけ登録する。画面の開発用ログインの部品も `import.meta.env.DEV` のときだけ描く（本番の組み立てから消すため）
- 運営者の API（`src/worker/routes/admin.ts`）は、どの道も最初に `requireOperator` を呼ぶ。変える操作は監査の控え（`audit`）を log に出す。運営者にも、グループの中身（卓・予定・Webhook の URL）は返さない
- グループの画面の管理者向けのものは、管理の区域（`/g/:id/admin/<区分>/`。`src/client/features/console/admin/`）に置く。ふだんの区域には、だれでも使うものだけを置く
- ログインした人の Discord のトークン（OAuth）は保存しない。知らせに使う Bot のトークンは Worker の secret（`DISCORD_BOT_TOKEN`）に置き、画面にもログにも出さない。秘密の値（`.dev.vars`）はコミットしない
- Google カレンダーと連携した人の refresh token だけは持つ（本人がいないときにも卓を書き直し、予定を読むため）。`GOOGLE_TOKEN_KEY` で暗号にして `google_links` に置き、画面・ログ・運営者の API には出さない。連携を外すときと利用者を消すときは、書き込んだ予定を消して Google の許可を取り消してから消す（`forgetGoogle`）。Google から受け取る欄は、要るものだけにする（予定の名前や中身は受け取らない）
- 利用者そのものは Discord のアカウント（`users.id`）のままにする。Google でのログインは、結びつけた入り口（`google_logins`）として扱い、Google のアカウントだけではグループに入れない。グループに入れるかの確かめ直しは、Bot がいるサーバーでは Bot で、いなければ Discord で行う（`auth/guard.ts`）
- 版は、main に入ったコミットから semantic-release が決め、タグ `vX.Y.Z` と GitHub の Release を作る（公開のワークフローの中。設定は `.releaserc.json`）。タグを手で付けない。`package.json` の `version` は使わない。コミットの type が版の上げ方と変わったことの一覧を決めるので、type を正しく付ける（`feat`・`fix`・`perf` は各地の運営の管理画面に出る）
- npm audit は 0 件に保つ。出たら、依存の版をそろえる（`overrides`）。直った版が無く、使わない・使い方が狭い部品は、`tools/shims/` に差し替えを置いて `overrides` で替える（今は semantic-release の `micromatch` と `@semantic-release/npm`。README の「版を出す」）
- 各地の卓予定は、版を飛ばして更新する。表の変更（`migrations/`）は、前の版から順に当たれば動くように書く
- 更新のボタンのトークン（`UPDATE_DISPATCH_TOKEN`）は Worker の secret に置き、画面・ログ・運営者の API には出さない。権限は、そのリポジトリの Actions を動かすだけにする（Worker からコードを書き換えられないように）
- 購読 URL（`/cal/<token>.ics`）は、知っていればだれでも読める。token は推測できない長さのランダムにし、作り直しと止めるができるようにする
- 公開する Cloudflare ごとの値（D1 の ID・アプリのアドレス・Discord アプリの値と Bot のトークン・運営者の ID・Google の値・API トークン）は、リポジトリに書かない。GitHub の environment「production」に置き、`wrangler.jsonc` には仮の値だけを置く（README の「公開」）
- アイコンは unplugin-icons で SVG にして入れ、画像やフォント（Google Fonts の Material Symbols）では読まない。集まりは、ライセンスを確かめたもの（`tools/icons.ts` の `ALLOWED_ICON_SETS`。今は Material Symbols の Apache-2.0）だけを使う。足したら一覧にも足す（画面は `src/client/ui/icons.ts` の `ICONS`、サイトは `website/.vitepress/theme/icons.ts` の `ICONS`。型の確認とテストが確かめる）

## コミット

[Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/) を採用する。形は commitlint（`commitlint.config.js`。`@commitlint/config-conventional` に、日本語向けの調整を足したもの）が確かめる。

```
<type>(<scope>): <説明>

<本文>

<フッター>
```

- **type**: 次のどれか

  | type | 使うとき |
  |---|---|
  | `feat` | 機能を足す・変える |
  | `fix` | 不具合を直す |
  | `docs` | 文書だけ（README・docs/・CLAUDE.md・サイトの本文） |
  | `style` | 動きの変わらない見た目の整え（空白・並び） |
  | `refactor` | 動きを変えずにコードを直す |
  | `perf` | 速くする |
  | `test` | テストだけ |
  | `build` | 組み立て・依存・設定（package.json・vite・wrangler） |
  | `ci` | GitHub Actions |
  | `chore` | そのほか（Git の設定など） |
  | `revert` | 前のコミットを取り消す |

- **scope**（なくてもよい）: `worker`・`client`・`site`・`db`・`discord`・`auth`・`e2e`・`deps` など、変えた場所
- **説明**: 日本語で、何をするかを短く書く。「〜する」の形で、句点は付けない
- **本文**（なくてもよい）: 空行のあとに、理由と中身を箇条書きで書く
- **互換を壊す変更**（URL・表・設定の名前が変わるなど）: type のあとに `!` を付け、フッターに `BREAKING CHANGE: 何が変わり、どうすればよいか` を書く
- 1 つのコミットには 1 つの目的だけを入れる
- コミットのときは lefthook（`lefthook.yml`）が、型の確認・テストと、説明の形（commitlint）を確かめる。止まったら直してからコミットし直す。`LEFTHOOK=0` や `--no-verify` で飛ばさない

例:

```
feat(client): 予定表の上に絞り込みのボタンを出す

- 土日祝だけ・全員空きだけ・自分の列だけを、押すたびに入り切りできるようにする
- 細かい条件は今までどおり「絞り込み」の中に残す
```

```
fix(build): 公開のときに組み立てた設定を使う
```

コミットと push は、頼まれたときだけする。push の前には確かめる（`.claude/settings.json` で聞くようにしてある）。
