# CLAUDE.md

このリポジトリで作業するときの決まり。動かし方・テスト・書くときの決まりは [CONTRIBUTING.md](CONTRIBUTING.md)、公開と更新の仕組みは [docs/deployment.md](docs/deployment.md)、作りとその理由は [docs/architecture.md](docs/architecture.md) にある。[README.md](README.md) は、初めて来た人への短い紹介にとどめる。

## 何のリポジトリか

Yoki。TRPGの卓の予定を、Discordサーバーの仲間と管理するWebアプリ。

アプリ: Cloudflare Workers（TypeScript・Hono）＋D1＋Discordログイン。サーバーは `src/worker/`、画面は `src/client/`（React・TanStack Router・TanStack Queryの1つのSPA）。

サイト: 紹介と使い方。`website/`（VitePress）をGitHub Pagesに公開する。

文書・画面の文・コミットの説明は日本語。短い文で、平易に書く。書き方は[yomiyasu](https://github.com/nanaism/yomiyasu)にそろえ、英数字の前後に半角空白を入れない（「Googleでログイン」「1つ」）。Markdownの文書は `npm run lint:ja` が確かめる。

## コマンド

| コマンド | すること |
|---|---|
| `npm run dev` | アプリを開発サーバーで動かす（http://localhost:5173/ 、「開発用ログイン」でサンプルのグループに入る） |
| `npm test` | サーバーと画面のテスト |
| `npm run test:coverage` | テストのカバレッジ（サーバーと共有の型。`coverage/index.html` にも出る） |
| `npm run typecheck` | 型の確認（アプリ・設定ファイル・サイト） |
| `npm run lint` | lint（oxlint。Reactのhooksとアクセシビリティの決まりも）と、日本語の検査 |
| `npm run lint:ja` | Markdownの文書の日本語の検査（yomiyasu。`tools/lint-ja.mjs`） |
| `npm run e2e` | ブラウザで通しで確かめる（開発サーバーをその場で立てる） |
| `npm run build` | 組み立てる。開発用ログインが残っていたら止まる |
| `npm run site` / `npm run site:build` | サイトを手元で開く・組み立てる |
| `npm run screenshots` | サイトに載せるアプリのスクリーンショットを撮り直す |
| `npm run icons` | `brand/yoki.png` からファビコンなどのアイコンを書き出す |
| `npm run notices` | 第三者のライセンスの断り書き（`THIRD_PARTY_NOTICES.md`）を書き出す |

アプリの公開はGitHub Actions（`.github/workflows/deploy.yml`）が、mainにアプリの変更がpushされたときに、テスト（型・lint・カバレッジ・e2e）が全部通ってから行う。PRは `ci.yml` が確かめる。手元から `wrangler deploy` や本番のD1へのマイグレーションはしない。mainへのpushは本番への公開になるので、頼まれたときだけ、確かめてからpushする。

## 変えたら確かめること

いつも: `npm test`・`npm run typecheck`・`npm run lint`。

サーバー（`src/worker`）を変えたら: `npm run test:coverage`。カバレッジは100% を保つ（下回ると失敗する）。外すのは、テストの環境で動かせない道だけ（CONTRIBUTING.mdの「テスト」）。

画面（`src/client/`）を変えたら: `npm run e2e`。見た目が変わったら `npm run screenshots` で撮り直し、画像もコミットする。

サイト（`website/`）を変えたら: `npm run site:build`。

Markdownの文書を変えたら: `npm run lint:ja`。yomiyasuの指摘（比喩の動詞・同じ文末の3つの続き・箇条書きの多すぎ・英単語の前後の空白など）が1件でもあれば止まる。直すときは、意味を変えずに言い回しを変える（文をつなぐ・文末を「です」「ください」にするなど）。

サービスアイコン（`brand/yoki.png`）を変えたら: `npm run icons` で書き出し、出したファイルもコミットする。ロゴが写るので `npm run screenshots` も撮り直す。

依存（`package.json`・`package-lock.json`）・アイコンの集まり・サイトの部品を変えたら: `npm run notices` で `THIRD_PARTY_NOTICES.md` を書き出し直し、コミットする（テストが確かめる）。第三者のライセンスの断り書きは、READMEではなくこのファイルにまとめる。

表（D1）を変えたら: `migrations/` に番号の続くファイルを足す。すでにあるファイルは書き換えない。

## 守ること

CONTRIBUTING.mdの「書くときの決まり」に加えて、次を守る。

日付と時刻は `src/worker/lib/jst.ts` で日本時間として扱う（WorkersはUTCで動く）。

画面とサーバーの約束（呼べる関数の名前・画面データの型・返事の形）は `src/shared/api.ts` に置く。呼べる関数を足すときは、ここの `RPC_FUNCS` とサーバーの一覧（`src/worker/routes/rpc.ts`）の両方に足す。

画面の道（URL）を足すときは、`src/shared/routes.ts`（タブ・区分の一覧）・`src/worker/routes/pages.ts`・`src/client/router.tsx` にそろえて足す。

グループの画面のデータは `ConsoleSync`（`src/client/features/console/api/sync.ts`）だけで読み書きする。楽観的な書き換えは `model/optimistic.ts` の純粋な関数にし、仮のIDは `'__tmp__'`。

e2eとスクリーンショットの道具が使う要素のID・`data-*`・`window.yoki`（`D`・`selectDay`・`showTab`）は保つ。変えるなら `test/e2e/smoke.js` と `website/tools/screenshots.js` も直す。

見た目はTailwind CSSのクラスで書く。色・寸法・文字の大きさは `src/client/styles/theme.css` のトークンを使い、色を直に書かない。クラスの名前を文字列のつなぎで組み立てない（CSSが出ない）。くり返す形は `ui/` か `features/…/styles.ts` の定数にする。

配色はサービスアイコンの青（`#2D2AFE`）が主で、オレンジ・ピンク・黄は差し色（アイコンの色は `brand`・`orange` などのトークン）。白い地の字にオレンジを使わず、字は地と組の変数（`accent-text`・`soon-text` など）にする。配色を変えたら、Tailwindを通らないWorkerのページ（`src/worker/routes/html.ts`）・サイト（`website/.vitepress/theme/style.css`）・SNS用の画像（`npm run og-image`）・manifestとtheme-colorも直す。

開発用ログイン（`src/worker/auth/dev.ts`）と開発用の偽のGoogle（`src/worker/google/dev.ts`）は `import.meta.env.DEV` のときだけ登録する。画面の開発用ログインの部品も `import.meta.env.DEV` のときだけ描く（本番の組み立てから消すため）。

運営者のAPI（`src/worker/routes/admin.ts`）は、どの道も最初に `requireOperator` を呼ぶ。変える操作は監査の控え（`audit`）をlogに出す。運営者にも、グループの中身（卓・予定・WebhookのURL）は返さない。

グループの画面の管理者向けのものは、管理の区域（`/g/:id/admin/<区分>/`。`src/client/features/console/admin/`）に置く。ふだんの区域には、だれでも使うものだけを置く。

秘匿HO（`session_slots.secret`）を読めるのは、その卓のGMと割り当てた本人だけにする（管理者・運営者も読めない）。画面データは本人ごとに作り端末にも控えるので、読み込みのSQL（`domain/load.ts`）で読み込む人ごとに絞り、`Ctx` にもほかの人の分を持たせない。送信の記録・Discordの文・購読URL・Googleの予定・運営者のAPIには出さない。秘匿HOのある卓のGMを替える道は、`checkGmChange` を通す。

Discordのイベントを書くのは見回りだけにする。卓を変える呼び出しは、グループに `events_pending` を付けるだけにする。消すのも書き換えるのも、Yokiが作ったイベント（`discord_events` の控えにあるもの）だけにする。Discordへの呼び出しは、どれも `discordFetch`（`discord/calls.ts`）を通す（外へ出せる数をGoogleと分け合うため）。

ログインした人のDiscordのトークン（OAuth）は保存しない。知らせに使うBotのトークンはWorkerのsecret（`DISCORD_BOT_TOKEN`）に置き、画面にもログにも出さない。秘密の値（`.dev.vars`）はコミットしない。

Googleカレンダーと連携した人のrefresh tokenだけは持つ（本人がいないときにも卓を書き直し、予定を読むため）。`GOOGLE_TOKEN_KEY` で暗号にして `google_links` に置き、画面・ログ・運営者のAPIには出さない。連携を外すときと利用者を消すときは、書き込んだ予定を消してGoogleの許可を取り消してから消す（`forgetGoogle`）。Googleから受け取る欄は、要るものだけにする（予定の名前や中身は受け取らない）。

利用者そのものはDiscordのアカウント（`users.id`）のままにする。Googleでのログインは、結びつけた入り口（`google_logins`）として扱い、Googleのアカウントだけではグループに入れない。グループに入れるかの確かめ直しは、BotがいるサーバーではBotで、いなければDiscordで行う（`auth/guard.ts`）。

バージョンは、mainに入ったコミットからsemantic-releaseが決め、`package.json` の `version` を書き換えたコミットと、タグ `vX.Y.Z`・GitHubのReleaseを作り、`release` のブランチをそこに合わせる（公開のワークフローの中。設定は `.releaserc.json`）。`version` とタグを手で書き換えない。アプリのバージョンは `package.json` から読む（ボタンで設置したリポジトリにはタグが無いため）。コミットのtypeがバージョンの上げ方と変わったことの一覧を決めるので、typeを正しく付ける（`feat`・`fix`・`perf` は各地の運営の管理画面に出る）。

npm auditは0件に保つ。出たら、依存のバージョンをそろえる（`overrides`）。直ったバージョンが無く、使わない・使い方が狭い部品は、`tools/shims/` に差し替えを置いて `overrides` で替える（今はsemantic-releaseの `micromatch` と `@semantic-release/npm`。CONTRIBUTING.mdの「バージョンを出す」）。

バージョンが出たら、サイトのリリースノートに、そのバージョンのページ（`website/releases/vX.Y.Z.md`）を足し、一覧（`website/releases/index.md`）のいちばん上にも足す。サイドバーはページから自動で作る。使う人と運営者に関わることだけを画面の言葉で書き、作りの変更・テスト・リポジトリの扱いは書かない（CONTRIBUTING.mdの「バージョンを出す」）。

各地のYokiは、バージョンを飛ばして更新する。表の変更（`migrations/`）は、前のバージョンから順に当たれば動くように書く。

更新のボタンのトークン（`UPDATE_DISPATCH_TOKEN`）はWorkerのsecretに置き、画面・ログ・運営者のAPIには出さない。権限は、そのリポジトリのActionsを動かすだけにする（Workerからコードを書き換えられないように）。

購読URL（`/cal/<token>.ics`）は、知っていればだれでも読める。tokenは推測できない長さのランダムにし、作り直しと止めるができるようにする。

公開するCloudflareごとの値（D1のID・アプリのアドレス・Discordアプリの値とBotのトークン・運営者のID・Googleの値・APIトークン）は、リポジトリに書かない。設置の主な道は「Deploy to Cloudflare」のボタンで、CloudflareがD1のIDを設置した人のリポジトリの `wrangler.jsonc` に書き、ほかはWorkerのsecretに置く。GitHub Actionsで公開するときは、GitHubのenvironment「production」に置く（docs/deployment.md）。Workerの値はvarsにしない（Workers Buildsが公開のたびに消すため。`src/worker/env.ts`）。ボタンが聞く値を変えたら、`.dev.vars.example` と `package.json` の `"cloudflare"` も直す。

公開と更新の仕組み（docs/deployment.md）と、サイトの運営者向けの手順書（`website/setup/`）は、同じ中身をそろえて直す。公開に要る値・ワークフロー・運営の管理画面を変えたら、両方を見直す。

アイコンはunplugin-iconsでSVGにして入れ、画像やフォント（Google FontsのMaterial Symbols）では読まない。集まりは、ライセンスを確かめたもの（`tools/icons.ts` の `ALLOWED_ICON_SETS`。今はMaterial SymbolsのApache-2.0）だけを使う。足したら一覧にも足す（画面は `src/client/ui/icons.ts` の `ICONS`、サイトは `website/.vitepress/theme/icons.ts` の `ICONS`。型の確認とテストが確かめる）。

## コミット

[Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/) を採用する。形はcommitlint（`commitlint.config.js`。`@commitlint/config-conventional` に、日本語向けの調整を足したもの）が確かめる。

```
<type>(<scope>): <説明>

<本文>

<フッター>
```

**type**: 次のどれか。

| type | 使うとき |
|---|---|
| `feat` | 機能を足す・変える |
| `fix` | 不具合を直す |
| `docs` | 文書だけ（README・CONTRIBUTING・docs/・CLAUDE.md・サイトの本文） |
| `style` | 動きの変わらない見た目の整え（空白・並び） |
| `refactor` | 動きを変えずにコードを直す |
| `perf` | 速くする |
| `test` | テストだけ |
| `build` | 組み立て・依存・設定（package.json・vite・wrangler） |
| `ci` | GitHub Actions |
| `chore` | そのほか（Gitの設定など） |
| `revert` | 前のコミットを取り消す |

**scope**（なくてもよい）: `worker`・`client`・`site`・`db`・`discord`・`auth`・`e2e`・`deps` など、変えた場所。

**説明**: 日本語で、何をするかを短く書く。「〜する」の形で、句点は付けない。

**本文**（なくてもよい）: 空行のあとに、理由と中身を箇条書きで書く。

**互換を壊す変更**（URL・表・設定の名前が変わるなど）: typeのあとに `!` を付け、フッターに `BREAKING CHANGE: 何が変わり、どうすればよいか` を書く。

1つのコミットには1つの目的だけを入れる。

コミットのときはlefthook（`lefthook.yml`）が、型の確認・テストと、説明の形（commitlint）を確かめる。止まったら直してからコミットし直す。`LEFTHOOK=0` や `--no-verify` で飛ばさない。

次は例。

```
feat(client): 予定表の上に絞り込みのボタンを出す

- 土日祝だけ・全員空きだけ・自分の列だけを、押すたびに入り切りできるようにする
- 細かい条件は今までどおり「絞り込み」の中に残す
```

```
fix(build): 公開のときに組み立てた設定を使う
```

コミットとpushは、頼まれたときだけする。pushの前には確かめる（`.claude/settings.json` で聞くようにしてある）。
