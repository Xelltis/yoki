# 開発に参加する

Yokiの開発に参加する人向けの説明。不具合の知らせや、こうしたいという案は、Issueに書く。コードを直すときは、mainに向けてPRを出す。PRは、確かめのワークフロー（`.github/workflows/ci.yml`）が、型・lint・日本語の検査・テストとカバレッジ・e2e・サイトの組み立て・コミットの説明の形を確かめる。マージされると元のリポジトリの版が出て、各地のYokiの「更新」に届く。

セキュリティの問題（ログインを飛ばせる・ほかのグループの中身が読めるなど）は、Issueに書かない。[SECURITY.md](SECURITY.md) のとおり、GitHubの非公開の報告で知らせる。

作りとそう決めた理由は [docs/architecture.md](docs/architecture.md)、公開と更新の仕組みは [docs/deployment.md](docs/deployment.md) にある。Claude Codeで作業するときの決まりは [CLAUDE.md](CLAUDE.md)。

## 手元で動かす

Node.js（22.12以降か24以降。`.node-version` は24）が要る。文書の日本語の検査（`npm run lint:ja`。`npm run lint` も呼ぶ）には、Python 3も要る（`python3`・`python`・`py -3` の順に探す）。無ければ、手元では断って飛ばし、CIでは止まる。

```
npm install
npm run dev
```

`http://localhost:5173/` を開き、「開発用ログイン」でサンプルのグループに入る。DiscordもCloudflareのアカウントも要らない。データは手元のD1（`.wrangler/state/`）に入る。

ひよりは管理者、ほかの人はただのメンバーとして入れる（権限の違いを確かめられる）。

ひよりは、手元（localhost）から開いたときだけ運営者にもなる。入口の「運営の管理画面」か、グループの画面のグループの切り替えから `/admin/` を開ける。

サンプルのグループは、初めて入ったときに作られる。作り直すときは `curl -X POST http://localhost:5173/dev/reset -H 'Origin: http://localhost:5173'`

本物のDiscordでログインを試すときは、`.dev.vars.example` を `.dev.vars` に写して、Discordアプリの値を入れる（Discordアプリの作り方は、[docs/deployment.md](docs/deployment.md) の「GitHub Actionsで公開する」の2）。

GoogleでのログインとGoogleカレンダーとの連携は、Googleの値（`GOOGLE_CLIENT_ID` など）が空なら、開発用の偽のGoogleで試せる。偽のGoogleのアカウントは1つだけで、初めて「Googleでログイン」を押すと、続けて開発用ログインで選んだ人に結びつく。同意の画面は出さずに連携したことにし、書き込んだ予定は `http://localhost:5173/dev/google/state` で見られる。予定ありの時間は `POST /dev/google/busy`（`{ "busy": [{ "start": "…", "end": "…" }] }`）で入れる。`/dev/reset` で、開発用の人の連携・Googleでのログインと、偽のGoogleの中身も消える。

サーバー側（`src/worker`）と画面（`src/client`）のどちらを直しても、開いている画面に反映される。

## フォルダ構成

```
src/worker/        サーバー（TypeScript、Hono）
  routes/          道。auth（ログイン）・me（入口の API）・pages（グループと管理画面のページ、利用規約とプライバシーポリシー）・rpc（画面からの呼び出し）・admin（運営者の API）・calendar（購読 URL）・google（Google との連携の OAuth）
  auth/            Discord の OAuth・ログインの続き・グループに入れるかの確認・運営者の確認・CSRF・開発用ログイン
  domain/          卓・メンバー・予定・日程調整・設定・知らせの見回り・グループを消す・運営者の操作・利用規約とプライバシーポリシー（GAS 版の Sessions.js などを移したもの）
  discord/         Bot の API（チャンネル）・送り先の選び方・文面・送信と送り直し
  google/          Google カレンダーの API・開発用の偽の Google・同期（卓を書き込む・予定から印を入れる）
  lib/             日本時間の日付・文字・エラー・ID・規約の本文の書き方
  seed/            サンプルデータ
src/client/        画面（TypeScript・React。Vite の root）。1 つの SPA で、どの道も index.html から開く
  index.html       骨組み。main.tsx が入口、router.tsx が画面の道（TanStack Router）、index.css が見た目の入口（Tailwind CSS）
  styles/          見た目のトークン（theme.css）・要素の既定（base.css）・いくつもの画面で使う部品（components.css）
  app/             共通の道具（TanStack Query・この端末の控え・見た目のテーマ・リンク）
  ui/              共通の部品（アイコン・窓・確かめる窓・吹き出し・見出し・上の帯）
  features/home/   入口のページ（/。ログイン・グループの一覧・グループを作る）
  features/console/  グループの画面（/g/:id/ とタブ、管理の区域 /g/:id/admin/<区分>/）。api（読み書き）・model（卓の読み方）・shell（外枠）と、タブごとのフォルダ
  features/operator/ 運営の管理画面（/admin/<区分>/）
src/shared/        画面とサーバーの約束（画面データの型・呼び出しの名前・卓の状態・運営者の API の型）。両方から読む
migrations/        D1 の表の定義（wrangler d1 migrations）
test/worker/       サーバーのテスト（Workers の実行環境と本物の D1 で動かす）
test/client/       画面とサイトの約束（アイコン・リンク・依存など）と、書くときの決まり
test/e2e/          ブラウザで通しで確かめる（npm run e2e）。開発サーバーを立てる小道具も
brand/             サービスアイコンの元の絵（yoki.png。配らない。ファビコンなどは npm run icons で書き出す）と、配色を選んだときのデザイン案の控え（mocks/）
website/           サイト（VitePress。GitHub Pages に公開する）。紹介と使い方
  guide/           使い方のページ（Markdown）
  .vitepress/      サイトの設定と見た目・試せる例の部品
  public/          アイコン・SNS 用の画像（og.png）・アプリのスクリーンショット
  tools/           スクリーンショット・SNS 用の画像・アイコンを作る道具
.github/workflows/ アプリを Cloudflare に（deploy.yml）、サイトを GitHub Pages に（pages.yml）公開する
docs/              作りの説明（architecture.md）
wrangler.jsonc     Worker の設定（D1・cron）。公開する Cloudflare ごとの値（D1 の ID など）は書かない
vite.config.ts     開発サーバーと組み立て。公開のときに、Cloudflare ごとの値を組み立てた設定に入れる
tools/icons.ts     アイコン（unplugin-icons）の決まり。使ってよい集まりとライセンス、SVG を React の部品にする変換（アプリとサイトで使う）
tools/release/     版を出すときに package.json の版を書き換えてコミットする（semantic-release のプラグイン）
tools/update/      更新のワークフローが、ボタンで設置したリポジトリの wrangler.jsonc の値を引き継ぐ
tools/licenses/    第三者のライセンスの本文（THIRD_PARTY_NOTICES.md に載せる）
tools/third-party.mjs 第三者のライセンスの断り書き（THIRD_PARTY_NOTICES.md）を書き出す（npm run notices）
vitest.config.ts   テスト
lefthook.yml       Git のフック（コミットの前の確認）
commitlint.config.js コミットの説明の決まり（Conventional Commits）
CLAUDE.md          Claude Code で作業するときの決まり（コミットの書き方など）
LICENSE            ライセンス（MIT）
THIRD_PARTY_NOTICES.md 第三者のソフトウェアと素材のライセンス（npm run notices が書き出す）
```

## テスト

```
npm test             サーバーと画面のテスト
npm run test:coverage  テストのカバレッジ（サーバーと共有の型。表に出し、coverage/index.html にも書く。100% を下回ると失敗する）
npm run typecheck    型の確認
npm run lint         lint（oxlint。正しさの決まりと、React の hooks・アクセシビリティの決まり）
npm run e2e          ブラウザで通しで確かめる（開発サーバーをその場で立てる。初回は npx playwright install chromium）
```

サーバーのテストは、Workersの実行環境（`@cloudflare/vitest-pool-workers`）でローカルのD1にマイグレーションを当てて動かす。Discordへの送信は差し替えて記録する。

サーバー（`src/worker`）と共有の型（`src/shared`）のカバレッジは、文・分岐・関数・行のすべてで100% を保つ。通らない道を足したら、テストも足す。テストの環境では動かせない道（本番だけの分かれ道など）だけ、理由を書いて `/* istanbul ignore … -- @preserve 理由 */` で外す（`@preserve` が無いと、組み立てのときにコメントが消えて効かない）。画面（`src/client`）はe2eで確かめる。グループの画面のデータの読み書きの順番（`features/console/api/sync.ts`）だけは、単体テスト（`test/client/console-sync.test.ts`）でも確かめる。

lintはoxlint（`.oxlintrc.json`）。ESLintのTypeScript対応（typescript-eslint）が、このリポジトリのTypeScript 7にまだ対応していないため。警告も止める（`--deny-warnings`）。

コミットのときは、Gitのフック（lefthook。`lefthook.yml`）が次を確かめる。フックは `npm install` のときに入る（入っていなければ `npx lefthook install`）。

コミットの前: 型の確認（TypeScript・TSX・Vue・tsconfigを変えたとき）、lint（TypeScript・TSX・JavaScript・`.oxlintrc.json` を変えたとき）とテスト（`src/`・`test/`・`migrations/`・`website/`・設定を変えたとき）。

コミットの説明: [Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/) の形か（commitlint。`commitlint.config.js`。書き方は [CLAUDE.md](CLAUDE.md) の「コミット」）。

依存のインストールスクリプトは、`package.json` の `allowScripts` で信頼したもの（workerd・esbuild・lefthook）だけを動かす。足すときは中身を確かめてから `npm approve-scripts --no-allow-scripts-pin <パッケージ>` で足す。

Workersのテスト用の道具（`@cloudflare/vitest-pool-workers`）は、古いwranglerとminiflareを固定して抱えている（npm auditに出る）。`package.json` の `overrides` で、アプリと同じ版にそろえている。wranglerを上げたら、`overrides` のminiflareもwranglerが使う版に合わせる（テストが確かめる）。

miniflareが固定している `sharp`（画像の部品）は、npm auditに指摘が出た版なので、`overrides` で直った版に上げている。miniflareが直った版を使うようになったら、外す。

## ほかのコマンド

| コマンド | すること |
|---|---|
| `npm run build` | 公開する形に組み立てる（`dist/`）。公開はCloudflareの組み立てかGitHub Actionsが行う（[docs/deployment.md](docs/deployment.md)） |
| `npm run preview` | 組み立てたものを手元で動かす |
| `npm run db:migrate:local` | 手元のD1にマイグレーションを当てる（本番は公開のときに当たる） |
| `npm run types` | `wrangler.jsonc` から型（`worker-configuration.d.ts`）を作り直す |
| `npm run site` / `site:build` / `site:preview` | サイトを手元で開く・組み立てる・組み立てたものを開く（下の「使い方のサイト」） |
| `npm run screenshots` | サイトに載せるアプリのスクリーンショットを `website/public/screenshots/` に撮る（開発サーバーをその場で立てる） |
| `npm run og-image` | SNSやDiscordにリンクを貼ったときに出る画像を、`website/public/og.png` とアプリの `src/client/public/og.png` に書き出す（同じもの） |
| `npm run icons` | `brand/yoki.png` から、ファビコン（`favicon.ico`）・ホーム画面と上の帯のロゴ（`icon-192.png`）・iPhoneとAndroidのアイコンを、`src/client/public/` と `website/public/` に書き出す。元の絵を変えたら回して、出したファイルをコミットする |
| `npm run notices` | 第三者のライセンスの断り書き（`THIRD_PARTY_NOTICES.md`）を、今の依存から書き出す。実行時の依存・アイコンの集まり・サイトの部品を変えたら回して、コミットする（テストが確かめる） |

## 使い方のサイト

紹介と使い方のページは `website/` にあり、VitePressで組み立ててGitHub Pages（https://xelltis.github.io/yoki/）に公開する（公開のしかたは [docs/deployment.md](docs/deployment.md) の「使い方のサイト」）。

```
npm run site         手元で開く（http://localhost:5174/yoki/。直すとすぐ反映される）
npm run site:build   組み立てる（website/.vitepress/dist/）
```

使い方のページは `website/guide/` のMarkdown。試せる例・スクリーンショット・ボタンの名前は、`website/.vitepress/theme/components/` の部品を本文から使う（`<AvailDemo />`、`<Shot name="pc-calendar" themed alt="…" />`、`<Ui icon="settings">設定</Ui>` など）。

本文や部品のアイコンは `<Ms name="event" />`（ボタンの名前なら `<Ui icon="event">`）。足したら、`website/.vitepress/theme/icons.ts` の `ICONS` にも足す（テストが確かめる）。トップのページの特長のアイコンは `index.md` の `points` と `theme/components/HomeFeatures.vue`。

アプリの見た目を変えたら、`npm run screenshots` で撮り直してコミットする（サイトの組み立てでは撮らない）。

アプリを公開したら、`config.ts` の `APP_URL` に書く。上のナビに「アプリを開く」が出る。

アプリの「使い方」のボタンは、サイト（`config.ts` の `SITE_URL`）を指す。サイトのアドレスを変えたら、アプリの側も直す（テストが確かめる）。

## 書くときの決まり

**日本語は[yomiyasu](https://github.com/nanaism/yomiyasu)の書き方にそろえる。** 英数字の前後に半角空白を入れない（「Googleでログイン」「1つ」）。画面の文・文書・コミットの説明のどれも同じ。ただし、日付と時刻・IDと名前のような区切りの空白と、絵文字のあとの空白は残す。Markdownの文書は `npm run lint:ja`（`tools/lint-ja.mjs`）が、`tools/yomiyasu/` に置いたyomiyasuの検査（`yomiyasu_lint.py`。Python 3の標準ライブラリだけで動く）で確かめ、指摘があれば止まる。lefthookはコミットするMarkdownを、`npm run lint` とCIは全部を確かめる。検査を新しい版にするときは、本家の `scripts/yomiyasu_lint.py` と `LICENSE` をそのまま置き換える。Claude Codeには、yomiyasuのプラグイン（`.claude/settings.json`）が入る。

**日付は日本時間で扱う。** WorkersはUTCで動く。日付と時刻は `src/worker/lib/jst.ts` を使い、`new Date(y, m, d)` や `getHours()` は使わない。

**画面から呼べる関数は、`src/shared/api.ts` の `RPC_FUNCS` とサーバーの一覧（`src/worker/routes/rpc.ts`）だけ。** 足すときは両方に書く（片方だけだと型の確認で止まる）。管理者だけの関数は、サーバーの一覧で `admin` を付ける。

**画面とサーバーで形を合わせるものは `src/shared/` に置く。** 画面データ（`ConsoleData`）や返事の型を変えるときは、ここを直す。サーバーは返す値を、画面は使う値を、型の確認で合わせる。

**画面の道（URL）を足すときは、3か所にそろえる。** タブ・区分の一覧（`src/shared/routes.ts`）、Workerのページ（`src/worker/routes/pages.ts`）、画面の道（`src/client/router.tsx`）。

**グループの画面のデータは、`ConsoleSync`（`src/client/features/console/api/sync.ts`）だけで読み書きする。** 部品は `useData()` で読み、書くのは `sync.write()`。押してすぐ画面へ出すときは、`model/optimistic.ts` の、データを受けて新しいデータを返す関数を渡す（仮のIDは `__tmp__`）。

**D1の問い合わせの数を増やしすぎない。** 1回の呼び出しで使える数に上限がある（無料のプランで50）。卓の数だけ文を作らず、JSON（`json_each`）で1文にまとめる。外への呼び出し（DiscordとGoogle）も、1回の要求で50まで。数が入力で決まるものには上限を付ける（まとめて登録する日は20日分まで、など）。

**表を変えるときは、マイグレーションを足す。** `migrations/` に番号の続くファイルを足し、すでにあるファイルは書き換えない。

**画面にアイコンを足したら**（`<Icon name>`）、`src/client/ui/icons.ts` に `~icons/material-symbols/<名前>-outline-rounded` のimportと `ICONS` の行を、名前のアルファベット順で足す（無い名前は型の確認で止まる。使っていない名前が残っていたらテストが止まる）。アイコンは [unplugin-icons](https://github.com/unplugin/unplugin-icons) が組み立てのときにSVGにしてJSに入れる。画像やフォント（Google FontsのMaterial Symbols）では読まない。

**アイコンの集まりは、ライセンスを確かめたものだけを使う。** 今はMaterial Symbols（Google。Apache License 2.0。`@iconify-json/material-symbols`）だけ。ほかの集まりを使うときは、ライセンスを確かめてから `tools/icons.ts` の `ALLOWED_ICON_SETS` に足す（テストが、集まりのライセンスと一覧を突き合わせる）。

**見た目はTailwind CSSのクラスで書く。** 色・寸法・文字の大きさは `src/client/styles/theme.css` のトークンを使い、色を直に書かない（`bg-card`・`text-muted`・`p-10` など。寸法はpxで数える: `p-10` は10px）。いくつもの画面でくり返す形は、`ui/` や `features/…/styles.ts` にTailwindのクラスの組み合わせとして置く。クラスの名前を文字列のつなぎで組み立てない（Tailwindが見つけられず、CSSが出ない）。配色を変えるときは、Tailwindを通らないところ（Workerの知らせと規約のページ・サイト・SNS用の画像・manifestとtheme-color）も一緒に直す（[docs/architecture.md](docs/architecture.md) の「見た目」）。

**e2eとスクリーンショットの道具が使う形を保つ。** 要素のID・`data-*`・`window.yoki`（`D`・`selectDay`・`showTab`）を変えるときは、`test/e2e/smoke.js` と `website/tools/screenshots.js` も直す。

メンバーは中ではIDで持ち、画面とのやり取りでは名前を使う（`src/worker/domain/people.ts`）。

## コミット

[Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/) の形で、説明は日本語で書く（`feat(client): 予定表の上に絞り込みのボタンを出す` など）。typeの一覧・書き方・例は、[CLAUDE.md](CLAUDE.md) の「コミット」にある。人もClaude Codeも、同じ決まりで書く。

typeは、版の上げ方と、各地のYokiの「更新」に出る変わったことの一覧を決める（下の「版を出す」）。正しく付ける。

コミットのときは、lefthook（`lefthook.yml`）が型の確認・lint・テスト・日本語の検査と、説明の形（commitlint）を確かめる。止まったら直してからコミットし直す（`LEFTHOOK=0` や `--no-verify` で飛ばさない）。

## 版を出す

版は [semantic-release](https://github.com/semantic-release/semantic-release)（設定は `.releaserc.json`）が、mainにアプリの変更が入ったときに、公開のワークフロー（`.github/workflows/deploy.yml`）の中で出す。PRは使わない。コミットをmainに入れる（PRをマージする）だけで、版を出すところまで進む。フォークでは動かない。

公開のワークフローは、確かめる（型・lint・テストとカバレッジ・e2e）→ 版を出す → 公開する、の順に進む。テストが1つでも通らなければ、版も出さず、公開もしない。e2eは、まっさらな手元のD1に表を作ってから動かす（`npm run db:migrate:local`）。公開するのは、版を出したならそのコミット、出さなければ確かめたコミット（確かめているあいだにmainに入った、まだ確かめていないコミットは公開しない）。

前の版のタグから後のコミット（Conventional Commits）を見て、`feat` は小さい版（1.1.0 → 1.2.0）、`fix`・`perf`・`revert` はいちばん小さい版（1.1.0 → 1.1.1）、`!` 付き（互換を壊す変更）は大きい版（2.0.0）を上げる。`docs`・`ci` などだけなら、版は出さない。

版を出すときは、`package.json` と `package-lock.json` の `version` を新しい版にしてコミットし（`chore(release): vX.Y.Z [skip ci]`）、mainにpushする（`tools/release/commit-version.mjs`）。そのコミットにタグ `vX.Y.Z` が付き、GitHubのRelease（変わったことの一覧。`feat`・`fix`・`perf`・`revert` だけ）ができる。各地のYokiの「更新」に、変わったこととして出る。最後に `release` のブランチをそのコミットに合わせる（ボタンが指す先）。mainに保護（PRを必須にするなど）を付けると、このpushが止まるので付けない。

アプリに入れる版は、`package.json` の `version` から読む（`vite.config.ts`）。ボタンで作ったリポジトリには、元の履歴とタグが無いため。`version` は手で書き換えない。変わったことの一覧は、ファイルに書かずGitHubのReleasesに置く。

コミットのtypeが版の上げ方を決めるので、typeを正しく付ける。各地のYokiは、版を飛ばして上げることがある。表の変更（`migrations/`）は、前の版から順に当たれば動くように書く。

`semantic-release` と、見出しを日本語にする `conventional-changelog-conventionalcommits` は開発用の依存に入れる。手元で `GITHUB_TOKEN=$(gh auth token) npx semantic-release --dry-run --no-ci` とすると、次の版と変わったことの一覧を、何も作らずに確かめられる。`conventional-changelog-conventionalcommits` は、semantic-releaseが使う書き出しの部品と同じ世代（今は9）にそろえる（10はsemantic-release 25では動かない）。

npm auditは0件に保つ。semantic-releaseが抱える2つは、`tools/shims/` の差し替えに替えている（`package.json` の `overrides`）。`micromatch` は直った版の無い `braces` に頼るので、同じ呼び方を `picomatch` で動かすものに替える。`@semantic-release/npm` はnpm本体を同梱し、その中の部品が指摘されるので、何もしないものに替える（npmには公開しない。`.releaserc.json` でプラグインを決めているので、ふだんは読み込まれない）。semantic-releaseを上げたら、`npm audit` と `--dry-run` で確かめる。
