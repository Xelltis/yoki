# Yoki（卓予定）

TRPGの卓の予定を、Discordサーバーの仲間と管理するWebアプリ。卓の登録、メンバーの予定（△×）、募集、日程調整を画面で行い、知らせは卓予定のBotがDiscordのチャンネルに送る。卓はカレンダーのアプリにも出せる（購読URL・Googleカレンダーとの連携）。

サーバーはCloudflare Workers、データはD1（SQLite）、ログインはDiscord。

1つのCloudflareに、Discordサーバーごとのグループを何個でも作れる。グループに入れるのは、そのサーバーにいる人だけ。

使う人向けの説明はサイト（https://xelltis.github.io/yoki/ 。中身は `website/`）、作りの説明は [docs/architecture.md](docs/architecture.md)。

## 手元で動かす

Node.js（22.12以降か24以降。`.node-version` は24）が要る。

```
npm install
npm run dev
```

`http://localhost:5173/` を開き、「開発用ログイン」でサンプルのグループに入る。DiscordもCloudflareのアカウントも要らない。データは手元のD1（`.wrangler/state/`）に入る。

ひよりは管理者、ほかの人はただのメンバーとして入れる（権限の違いを確かめられる）。

ひよりは、手元（localhost）から開いたときだけ運営者にもなる。入口の「運営の管理画面」か、グループの画面のグループの切り替えから `/admin/` を開ける。

サンプルのグループは、初めて入ったときに作られる。作り直すときは `curl -X POST http://localhost:5173/dev/reset -H 'Origin: http://localhost:5173'`

本物のDiscordでログインを試すときは、`.dev.vars.example` を `.dev.vars` に写して、Discordアプリの値を入れる（Discordアプリの作り方は、下の「公開」の2）。

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
wrangler.jsonc     Worker の設定（D1・cron）。公開する Cloudflare ごとの値は仮の値だけ
vite.config.ts     開発サーバーと組み立て。公開のときに、Cloudflare ごとの値を組み立てた設定に入れる
tools/icons.ts     アイコン（unplugin-icons）の決まり。使ってよい集まりとライセンス、SVG を React の部品にする変換（アプリとサイトで使う）
vitest.config.ts   テスト
lefthook.yml       Git のフック（コミットの前の確認）
commitlint.config.js コミットの説明の決まり（Conventional Commits）
CLAUDE.md          Claude Code で作業するときの決まり（コミットの書き方など）
LICENSE            ライセンス（MIT）
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

## 公開（Cloudflare）

アプリの公開はGitHub Actions（`.github/workflows/deploy.yml`）が行う。手元から `wrangler deploy` はしない。

公開するCloudflareごとに違う値（D1のID・アプリのアドレス・Discordアプリの値・運営者のID）は、リポジトリに置かない。GitHubのenvironment「production」に置き、公開のときに組み立てた設定（`dist/yoki/wrangler.json`）に入れる（`vite.config.ts`）。リポジトリの `wrangler.jsonc` には仮の値だけがある。フォークして自分のCloudflareに公開するときも、同じ手順で進める。

### 1. 公開するアドレスを決める

Cloudflareだけなら `https://yoki.<アカウントのサブドメイン>.workers.dev` になる（サブドメインは、Cloudflareの画面のWorkersで分かる）。Route 53などのドメインで公開するなら、下の「独自のドメインで公開する」のCloudFrontのアドレス（`https://yoki.example.com` など）。

### 2. Discordアプリを作る

[Discord Developer Portal](https://discord.com/developers/applications) でNew Application。ログインと知らせ（Bot）の両方に、この1つのアプリを使う。

OAuth2: Redirectsに `https://<公開するアドレス>/auth/callback` と `http://localhost:5173/auth/callback` を足す。Client IDとClient Secretを控える。

Bot: 「Reset Token」でトークンを作って控える。「Public Bot」はON（グループの管理者が、卓予定の画面から自分のサーバーに招く）。Privileged Gateway Intentsは全部OFFのまま（Gatewayには繋がない）。

Installation: Install Linkは「None」（Botを招くURLは卓予定が作る。求める権限は「チャンネルを見る」「メッセージを送信」「埋め込みリンク」）。

### 3. CloudflareでD1とAPIトークンを作る

D1: `npx wrangler login` のあと `npx wrangler d1 create yoki`（Cloudflareの画面のD1で作ってもよい）。出てきたdatabase IDを控える。

APIトークン: アカウントのAPIトークンを作る（Cloudflareの画面の「アカウントの管理」→「アカウントAPIトークン」）。権限は2つ。「Workers」（新しいほう。「Workers Scripts」は古い形）の「Admin」と、「D1」の「Edit」。初めての公開でWorkerを作るにはWorkersのAdminが要る（まだ無いWorkerだけに絞った権限は付けられない）。公開できたら、Workersは `yoki` のWorkerだけの「Editor」に下げてよい（公開と秘密の値はそれで足りる）。Workersの権限はD1を含まないので、本番のD1への表の変更のためにD1のEditが別に要る。テンプレートの「Edit Cloudflare Workers」はD1を含まず、要らない権限も多いので使わない。ユーザーのAPIトークンと違い、作った人に結びつかないので、その人がいなくなっても公開が止まらない（wranglerにはアカウントIDが要るが、deploy.ymlが `CLOUDFLARE_ACCOUNT_ID` を渡す）。

アカウントID: Cloudflareの画面のWorkersの右側に出る。

### 4. GitHubに値を入れる

リポジトリのSettings → Environmentsで「production」を作り、次を入れる。

| 種類 | 名前 | 中身 |
|---|---|---|
| 変数（Variables） | `CLOUDFLARE_ACCOUNT_ID` | CloudflareのアカウントID |
| 変数 | `YOKI_D1_DATABASE_ID` | 3で作ったD1のdatabase ID |
| 変数 | `YOKI_APP_URL` | 公開するアドレス（`https://…`）。Discordの知らせに付くリンクになる |
| 変数 | `YOKI_DISCORD_CLIENT_ID` | DiscordアプリのClient ID |
| 秘密（Secrets） | `CLOUDFLARE_API_TOKEN` | 3で作ったアカウントのAPIトークン |
| 秘密 | `DISCORD_CLIENT_SECRET` | DiscordアプリのClient Secret |
| 秘密 | `DISCORD_BOT_TOKEN` | DiscordアプリのBotのトークン（知らせを送る） |
| 秘密 | `OPERATOR_IDS` | 運営者（下の「管理画面」）のDiscordユーザーID。何人いても、カンマか空白で区切って並べる |
| 変数（任意） | `YOKI_GOOGLE_CLIENT_ID` | Googleカレンダーとの連携を使うときだけ。下の「Googleカレンダーと連携する」 |
| 秘密（任意） | `GOOGLE_CLIENT_SECRET` | 同じく。GoogleのOAuthクライアントのシークレット |
| 秘密（任意） | `GOOGLE_TOKEN_KEY` | 同じく。Googleのrefresh tokenを暗号にする鍵 |
| 秘密（任意） | `UPDATE_DISPATCH_TOKEN` | 運営の管理画面のボタンで更新するときだけ。下の「新しい版に上げる」 |

DiscordのユーザーIDは、Discordの設定の「詳細設定」で開発者モードをONにし、自分のアイコンを右クリックして「ユーザーIDをコピー」で取れる。

運営者のIDは、公開のログに出さないように秘密に置く（公開のリポジトリでは、Actionsのログはだれでも読める）。

公開のたびに確かめたいなら、environmentの「Required reviewers」に自分を入れる。承認するまで公開が止まる。

### 5. 公開する

mainにアプリの変更（`src/`・`migrations/`・設定）をpushすると動く。Actionsの画面の「アプリを公開する」から、手で動かすこともできる。型の確認 → テスト（カバレッジ100%）→ 組み立て（値が欠けていたら止まる。開発用ログインが残っていても止まる）→ 本番のD1にマイグレーション → 公開、の順に進む。秘密の値は、公開する版と一緒に送る。

### 6. 利用規約とプライバシーポリシーを整える

公開したアドレスの `/terms` と `/privacy` に出る。運営の管理画面（`/admin/`）の「規約」で、運営者の名前と問い合わせ先を入れ、本文を確かめる。既定の文は、このリポジトリのままの卓予定に合わせてある。前にCDNを置くなど、公開のしかたが違えば直す。Discordの開発者ポータルの「General Information」のTerms of Service URLとPrivacy Policy URLにも、この2つのアドレスを入れる。

### Googleでのログインと、Googleカレンダーとの連携（任意）

Googleでのログインと、Googleカレンダーとの連携は、同じOAuthクライアントを使う。どちらも、下の手順で3つの値（クライアントID・クライアント シークレット・鍵）をそろえたときだけ使える。

**Googleでログイン**（入口の「Googleでログイン」と、設定の画面の「ログインの方法」）: 利用者そのものは今までどおりDiscordのアカウントで、Googleは結びつけたもう1つの入り口になる。初めてのGoogleアカウントは、続けてDiscordでログインして結びつける（グループに入れるかはDiscordのサーバーで決まるため）。求めるのは `openid`・`email` だけ。値がそろっていなければ、ボタンを出さない。

**Googleカレンダーとの連携**（設定の画面の「カレンダー連携」）: 参加する卓を本人のGoogleカレンダーに書き込み、本人の予定から予定表に × と △ を入れる。値がそろっていなければ、画面に「使えません」と出る。

購読URLと、卓ごとの「Googleカレンダーに追加」は、何も設定しなくても使える。

#### 1. Google Cloudでプロジェクトを作る

「APIとサービス」でGoogle Calendar APIを有効にする。

#### 2. OAuth同意画面を作る

アプリ名・サポートのメール・アプリのホームページ（公開するアドレス）・プライバシーポリシー（`<公開するアドレス>/privacy`）・利用規約（`/terms`）を入れる。スコープは `openid`・`email`・`https://www.googleapis.com/auth/calendar.events.owned`（本人が持つカレンダーの予定だけ。卓予定はメインのカレンダーしか触らないので、共有されたカレンダーにも届く `calendar.events` は求めない）。

#### 3. OAuthクライアントIDを作る

種類は「ウェブ アプリケーション」。承認済みのリダイレクトURIに `<公開するアドレス>/auth/google/callback` を入れる（手元で本物を試すなら `http://localhost:5173/auth/google/callback` も）。

#### 4. 鍵を作る

`openssl rand -base64 32` の出力を `GOOGLE_TOKEN_KEY` にする。refresh tokenはこの鍵で暗号にしてD1に置くので、鍵を替えると、連携していた人は連携し直しになる。

#### 5. GitHubに値を入れる

変数 `YOKI_GOOGLE_CLIENT_ID` にクライアントID、秘密 `GOOGLE_CLIENT_SECRET` にクライアント シークレット、秘密 `GOOGLE_TOKEN_KEY` に4の鍵を入れて、公開し直す。

`calendar.events.owned` はGoogleの「機密性の高いスコープ」なので、だれでも連携できるようにするには、Googleの審査（OAuthアプリの確認）を受ける。審査の前は、同意画面の「テストユーザー」に足した人だけが連携できる（100人まで）。テストのあいだは、refresh tokenが7日で切れるので、連携し直しになる。

審査では、プライバシーポリシーにGoogleのデータの扱い（受け取るもの・使い道・Limited Useに従うこと）が書いてあるかを見られる。既定の文には書いてある。直したときは、消さないように気を付ける。

連携した人のrefresh tokenは、画面・ログ・運営の管理画面には出さない。本人が連携を外すと、運営者が利用者を消すと、書き込んだ予定を消し、Googleの許可を取り消してから消す。

Googleでのログインが求める `openid`・`email` は、機密性の高いスコープではない。ただし同意画面が「テスト」のあいだは、テストユーザーしかログインできない。だれでもGoogleでログインできるようにするには、同意画面の公開ステータスを「本番環境」にする（`calendar.events.owned` の審査が済むまでは、カレンダーの連携に「確認されていないアプリ」の注意が出る）。

Googleでログインした人がグループに入れるかは、Discordのサーバーの一覧の控えで決める。控えが24時間より古くなったら、そのサーバーに知らせのBotがいればBotで確かめ（Discordのログインの画面は出ない）、いなければDiscordに聞き直す。

### 新しい版に上げる（更新）

元のリポジトリ（[Xelltis/yoki](https://github.com/Xelltis/yoki)）は、版（`v1.2.0` など）をGitHubのReleaseとして出す（下の「版を出す」）。フォークして公開している卓予定は、運営の管理画面の「更新」で新しい版と変わったことを見て、ボタンかGitHubの画面で取り込む。コードを触らずに追いつける。

**新しい版を知る**: 運営の管理画面の「様子」のいちばん上と、「更新」の区分に出る。元のリポジトリのReleaseを、1時間に1回まで読む（トークンは要らない）。表（D1）の変更を含む版は、そう出る。

**更新する**: 「更新」の区分のボタンか、GitHubのActionsの「卓予定を更新する」（`.github/workflows/update.yml`）の「Run workflow」。ワークフローが元のリポジトリのタグをmainに取り込み、公開のワークフローを動かす。公開のワークフローは、表を変える前のD1の地点（bookmark）をSummaryに控えてから、表の変更を当てて公開する。

**取り込みでぶつかったら**: フォークでコードを直していると、ぶつかることがある。そのときはmainを変えずに `update/v1.2.0` のブランチとPRを作って止まる。GitHubの画面で直してマージすると公開される。サーバーごとの値はenvironmentに、規約の文はD1にあるので、コードを直さずに使っていればぶつからない。

初めの1回だけ、次を準備する。

#### 1. フォークでActionsを使えるようにする

フォークでは、Actionsは初めは止まっている（Actionsの画面で使うと決める）。Settings → Actions → Generalの「Workflow permissions」を「Read and write permissions」にし、「Allow GitHub Actions to create and approve pull requests」を入れる（ぶつかったときのPRのため）。

#### 2. mainに書き込むトークン（おすすめ）

元のリポジトリが `.github/workflows/` を変えた版は、Actionsの既定のトークンではmainに書き込めない。GitHubのSettings → Developer settings → Fine-grained tokensで、このリポジトリだけに「Contents」と「Workflows」のRead and writeを付けたトークンを作り、リポジトリのSettings → Secrets and variables → ActionsのRepository secretsに `UPDATE_PUSH_TOKEN` として入れる（environmentではなく、リポジトリのsecret）。

#### 3. 管理画面のボタンで更新する（任意）

このリポジトリだけに「Actions」のRead and writeを付けたトークンを作り、environment「production」の秘密 `UPDATE_DISPATCH_TOKEN` に入れて公開し直す。Workerはこのトークンで更新のワークフローを動かし、その記録を読む。コードは書き換えられない権限にとどめる。無ければ、「更新」の区分にGitHubの画面を開くボタンが出る。

#### 4. 元のリポジトリを変える（任意。フォークのフォークなど）

リポジトリのSettings → Secrets and variables → ActionsのRepository variablesに `YOKI_UPSTREAM`（`owner/name`）を入れる。

困ったときは、次の順に戻す。

Worker: Cloudflareの画面のWorkers → `yoki` → Deploymentsで、前の版に戻す（`npx wrangler rollback` でもよい）。

D1: 表を変えた版なら、公開のワークフローのSummaryに出たbookmarkへ `npx wrangler d1 time-travel restore yoki --bookmark=<bookmark>` で戻す。その地点より後に書かれたもの（予定・回答など）は消える。

コード: mainの取り込みのコミットをrevertする（そのままだと、次の公開でまた新しい版が出る）。

### 独自のドメインで公開する（Route 53とCloudFront）

Workersに独自のドメインを直接付けるには、そのドメインのDNSをCloudflareに移す必要がある（DNSを別のところに残す形は、Cloudflareの有料のプランが要る）。ドメインのDNSをRoute 53に残したまま公開するときは、前にAWS CloudFrontを置き、CloudFrontからworkers.devのアドレスへ渡す。

Workerに届く要求のアドレスはworkers.devのままになる。アプリは、自分のアドレス（Discordログインの戻り先・知らせのリンク・CSRFの確かめ）を `YOKI_APP_URL` で決めるので、そのまま動く。

workers.devのアドレスもそのまま開けるが、ログインの戻り先とcookieは公開のアドレスに結びつくので、workers.devのままでは使えない（ログインの途中で止まる）。使う人を絞りたいときは、運営の管理画面で新規登録の受付を止める。

#### 1. 公開するCloudflareの側

上の1〜5のとおり。workers.devは有効のままにする（CloudFrontの行き先になる）。

#### 2. 証明書

AWS Certificate Managerで、**us-east-1（バージニア北部）** に、使うドメイン（`yoki.example.com` など）の証明書を作る。検証はRoute 53のDNSで行う。

#### 3. CloudFrontのディストリビューションを作る

オリジン: `yoki.<アカウントのサブドメイン>.workers.dev`。プロトコルはHTTPSのみ。

既定のビヘイビア: ビューワーのプロトコルは「Redirect HTTP to HTTPS」、許可するメソッドは「GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE」、キャッシュポリシーは「CachingDisabled」、オリジンリクエストポリシーは「AllViewerExceptHostHeader」（Host以外のヘッダー・cookie・クエリをすべて渡す。Hostを渡すとCloudflareが受け取らない）。

（速くしたいとき）`/assets/*` のビヘイビアを足し、キャッシュポリシーを「CachingOptimized」にする。組み立てたJSとCSSは、名前に中身の印が付くので長く控えてよい。

代替ドメイン名に `yoki.example.com`、証明書に2を選ぶ。

#### 4. Route 53

`yoki.example.com` のAとAAAAのレコードを、エイリアスでCloudFrontのディストリビューションに向ける。ほかのレコードはそのまま。

#### 5. 値を直す

`YOKI_APP_URL` を `https://yoki.example.com` にし、DiscordアプリのRedirectsに `https://yoki.example.com/auth/callback` を足して、公開し直す。Googleカレンダーと連携しているなら、Googleの承認済みのリダイレクトURIにも `https://yoki.example.com/auth/google/callback` を足す。

#### 6. 確かめる

`https://yoki.example.com/` でログインでき、グループを開けること。

DNSをCloudflareに移せるドメインなら、CloudFrontを置かずに、Cloudflareの画面でWorkerに独自のドメイン（Custom Domain）を足せる。そのときも `YOKI_APP_URL` とDiscordのRedirectsを直す。

Cloudflareは無料のプランで動く。グループが増えて、知らせの見回りで送る数が多くなったら、有料のプラン（Workers Paid）にする。

## 管理画面

管理画面は2つある。

**グループの管理画面**（`/g/:id/admin/`）: そのグループの管理者が使う。メンバーの登録・卓をまとめて変える・Discordの知らせ・管理者・送信の記録・グループを消す、をまとめてある。上の帯の右の「管理」のボタンか、あなたのメニューの「設定」から開く。管理者でなければ開けない。区分ごとにURLがある（`/g/:id/admin/notify/` など。`/g/:id/admin/` は前に開いていた区分へ移る）。

**運営の管理画面**（`/admin/`）: 公開した人（運営者。秘密の `OPERATOR_IDS` に書いた人）が使う。入口の画面と、グループの画面のグループの切り替えに「運営の管理画面」のリンクが出る。区分ごとにURLがある（`/admin/users/` など）。

**様子**: グループ・利用者・有効なログイン・動いている卓の数、知らせの見回り（cron）が動いているか、Discordへの送信の失敗。

**新規登録の受付**（様子の中）: 止めると、新しいグループの作成と、初めての人のログインを断る。もう使っている人と今あるグループは、そのまま使える。運営者は、止めていてもログインでき、グループも作れる。初めは受け付けている。

**グループ**: 一覧と中身（Discordサーバー・メンバー・卓の数・最後に使われた日）。管理者の付け替え、Discordサーバーの付け替え、グループを消す（名前を打ち込んで確かめる。中身も消え、戻せない）。

**利用者**: ログインを切る、締め出す・戻す、消す。締め出した人はDiscordでログインできなくなり、残っていたログインも効かなくなる。Discordのアカウントで止めるので、別のアカウントを作られると止められない。運営者は締め出せない。

消すのは、本人から消してほしいと頼まれたとき（プライバシーポリシーの「消し方」）。その人の情報（ログイン・Discordの名前・入っているサーバーの控え）と、どのグループのメンバーの行も消える。予定とメモは消え、卓と回答には名前だけが残る。元に戻せない。Discordサーバーにいれば、次に開いたときにまた入れる。運営者と、締め出している人は消せない（締め出しの印も消えてしまうため）。Googleカレンダーと連携していれば、書き込んだ予定を消し、Googleの許可を取り消してから消す。

**更新**: 動いている版と、元のリポジトリの最新の版・変わったこと・表の変更があるか。新しい版があれば、ボタンかGitHubの画面で更新する（上の「新しい版に上げる」）。新しい版があることは、「様子」のいちばん上にも出る。

**規約**: 利用規約（`/terms`）とプライバシーポリシー（`/privacy`）の、運営者の名前・問い合わせ先・本文を直す。直していなければ既定の文が出る。本文を空にして保存すると、既定の文に戻る。2つのページは、ログインしていない人も読める。入口の画面と、グループの画面の設定からリンクしている。

運営者は、グループの中身（卓・予定）は見ない。運営者がした操作は、CloudflareのWorkersのログ（Observability）に1行ずつ残る（`"audit"` で探せる）。

## 版を出す（元のリポジトリ）

版は [semantic-release](https://github.com/semantic-release/semantic-release)（設定は `.releaserc.json`）が、mainにアプリの変更が入ったときに、公開のワークフロー（`.github/workflows/deploy.yml`）の中で出す。PRは使わない。コミットをmainに入れる（PRをマージする）だけで、版を出すところまで進む。フォークでは動かない。

公開のワークフローは、確かめる（型・lint・テスト）→ 版を出す → 公開する、の順に進む。確かめが通らなければ、版も出さない。

前の版のタグから後のコミット（Conventional Commits）を見て、`feat` は小さい版（1.1.0 → 1.2.0）、`fix`・`perf`・`revert` はいちばん小さい版（1.1.0 → 1.1.1）、`!` 付き（互換を壊す変更）は大きい版（2.0.0）を上げる。`docs`・`ci` などだけなら、版は出さない。

版を出すと、タグ `vX.Y.Z` とGitHubのRelease（変わったことの一覧。`feat`・`fix`・`perf`・`revert` だけ）ができる。各地の卓予定の「更新」に、変わったこととして出る。

アプリに入れる版は、いちばん近い版のタグから読む（`vite.config.ts`）。`package.json` の `version` は使わない（`0.0.0-development` のまま）。変わったことの一覧は、ファイルに書かずGitHubのReleasesに置く。

コミットのtypeが版の上げ方を決めるので、typeを正しく付ける。各地の卓予定は、版を飛ばして上げることがある。表の変更（`migrations/`）は、前の版から順に当たれば動くように書く。

`semantic-release` と、見出しを日本語にする `conventional-changelog-conventionalcommits` は開発用の依存に入れる。手元で `GITHUB_TOKEN=$(gh auth token) npx semantic-release --dry-run --no-ci` とすると、次の版と変わったことの一覧を、何も作らずに確かめられる。`conventional-changelog-conventionalcommits` は、semantic-releaseが使う書き出しの部品と同じ世代（今は9）にそろえる（10はsemantic-release 25では動かない）。

npm auditは0件に保つ。semantic-releaseが抱える2つは、`tools/shims/` の差し替えに替えている（`package.json` の `overrides`）。`micromatch` は直った版の無い `braces` に頼るので、同じ呼び方を `picomatch` で動かすものに替える。`@semantic-release/npm` はnpm本体を同梱し、その中の部品が指摘されるので、何もしないものに替える（npmには公開しない。`.releaserc.json` でプラグインを決めているので、ふだんは読み込まれない）。semantic-releaseを上げたら、`npm audit` と `--dry-run` で確かめる。

## サイト（GitHub Pages）

紹介と使い方のページは `website/` にあり、VitePressで組み立ててGitHub Pages（https://xelltis.github.io/yoki/）に公開する。

```
npm run site         手元で開く（http://localhost:5174/yoki/。直すとすぐ反映される）
npm run site:build   組み立てる（website/.vitepress/dist/）
```

使い方のページは `website/guide/` のMarkdown。試せる例・スクリーンショット・ボタンの名前は、`website/.vitepress/theme/components/` の部品を本文から使う（`<AvailDemo />`、`<Shot name="pc-calendar" themed alt="…" />`、`<Ui icon="settings">設定</Ui>` など）。

本文や部品のアイコンは `<Ms name="event" />`（ボタンの名前なら `<Ui icon="event">`）。足したら、`website/.vitepress/theme/icons.ts` の `ICONS` にも足す（テストが確かめる）。トップのページの特長のアイコンは `index.md` の `points` と `theme/components/HomeFeatures.vue`。

アプリの見た目を変えたら、`npm run screenshots` で撮り直してコミットする（サイトの組み立てでは撮らない）。

アプリを公開したら、`config.ts` の `APP_URL` に書く。上のナビに「アプリを開く」が出る。

アプリの「使い方」のボタンは、サイト（`config.ts` の `SITE_URL`）を指す。サイトのアドレスを変えたら、アプリの側も直す（テストが確かめる）。

公開はGitHub Actions（`.github/workflows/pages.yml`）が、mainに `website/` の変更が入ったときに行う。初めてのときは、リポジトリのSettings → PagesのSourceを「GitHub Actions」にする。非公開のリポジトリからPagesを公開するには、GitHubの有料のプランが要る。

## ほかのコマンド

| コマンド | すること |
|---|---|
| `npm run build` | 公開する形に組み立てる（`dist/`）。公開はGitHub Actionsが行う（上の「公開」） |
| `npm run preview` | 組み立てたものを手元で動かす |
| `npm run db:migrate:local` | 手元のD1にマイグレーションを当てる（本番は公開のときに当たる） |
| `npm run types` | `wrangler.jsonc` から型（`worker-configuration.d.ts`）を作り直す |
| `npm run site` / `site:build` / `site:preview` | サイトを手元で開く・組み立てる・組み立てたものを開く（下の「サイト」） |
| `npm run screenshots` | サイトに載せるアプリのスクリーンショットを `website/public/screenshots/` に撮る（開発サーバーをその場で立てる） |
| `npm run og-image` | SNSやDiscordにリンクを貼ったときに出る画像を、`website/public/og.png` とアプリの `src/client/public/og.png` に書き出す（同じもの） |
| `npm run icons` | `brand/yoki.png` から、ファビコン（`favicon.ico`）・ホーム画面と上の帯のロゴ（`icon-192.png`）・iPhoneとAndroidのアイコンを、`src/client/public/` と `website/public/` に書き出す。元の絵を変えたら回して、出したファイルをコミットする |

## 書くときの決まり

**日本語は[yomiyasu](https://github.com/nanaism/yomiyasu)の書き方にそろえる。** 英数字の前後に半角空白を入れない（「Googleでログイン」「1つ」）。画面の文・文書・コミットの説明のどれも同じ。ただし、日付と時刻・IDと名前のような区切りの空白と、絵文字のあとの空白は残す。Markdownの文書は `npm run lint:ja`（`tools/lint-ja.mjs`）が、`tools/yomiyasu/` に置いたyomiyasuの検査（`yomiyasu_lint.py`。Python 3の標準ライブラリだけで動く）で確かめ、指摘があれば止まる。lefthookはコミットするMarkdownを、`npm run lint` とCIは全部を確かめる。検査を新しい版にするときは、本家の `scripts/yomiyasu_lint.py` と `LICENSE` をそのまま置き換える。Claude Codeには、yomiyasuのプラグイン（`.claude/settings.json`）が入る。

**日付は日本時間で扱う。** WorkersはUTCで動く。日付と時刻は `src/worker/lib/jst.ts` を使い、`new Date(y, m, d)` や `getHours()` は使わない。

**画面から呼べる関数は、`src/shared/api.ts` の `RPC_FUNCS` とサーバーの一覧（`src/worker/routes/rpc.ts`）だけ。** 足すときは両方に書く（片方だけだと型の確認で止まる）。管理者だけの関数は、サーバーの一覧で `admin` を付ける。

**画面とサーバーで形を合わせるものは `src/shared/` に置く。** 画面データ（`ConsoleData`）や返事の型を変えるときは、ここを直す。サーバーは返す値を、画面は使う値を、型の確認で合わせる。

**画面の道（URL）を足すときは、3か所にそろえる。** タブ・区分の一覧（`src/shared/routes.ts`）、Workerのページ（`src/worker/routes/pages.ts`）、画面の道（`src/client/router.tsx`）。

**グループの画面のデータは、`ConsoleSync`（`src/client/features/console/api/sync.ts`）だけで読み書きする。** 部品は `useData()` で読み、書くのは `sync.write()`。押してすぐ画面へ出すときは、`model/optimistic.ts` の、データを受けて新しいデータを返す関数を渡す（仮のIDは `__tmp__`）。

**D1の問い合わせの数を増やしすぎない。** 1回の呼び出しで使える数に上限がある（無料のプランで50）。卓の数だけ文を作らず、JSON（`json_each`）で1文にまとめる。

**表を変えるときは、マイグレーションを足す。** `migrations/` に番号の続くファイルを足し、すでにあるファイルは書き換えない。

**画面にアイコンを足したら**（`<Icon name>`）、`src/client/ui/icons.ts` に `~icons/material-symbols/<名前>-outline-rounded` のimportと `ICONS` の行を、名前のアルファベット順で足す（無い名前は型の確認で止まる。使っていない名前が残っていたらテストが止まる）。アイコンは [unplugin-icons](https://github.com/unplugin/unplugin-icons) が組み立てのときにSVGにしてJSに入れる。画像やフォント（Google FontsのMaterial Symbols）では読まない。

**アイコンの集まりは、ライセンスを確かめたものだけを使う。** 今はMaterial Symbols（Google。Apache License 2.0。`@iconify-json/material-symbols`）だけ。ほかの集まりを使うときは、ライセンスを確かめてから `tools/icons.ts` の `ALLOWED_ICON_SETS` に足す（テストが、集まりのライセンスと一覧を突き合わせる）。

**見た目はTailwind CSSのクラスで書く。** 色・寸法・文字の大きさは `src/client/styles/theme.css` のトークンを使い、色を直に書かない（`bg-card`・`text-muted`・`p-10` など。寸法はpxで数える: `p-10` は10px）。いくつもの画面でくり返す形は、`ui/` や `features/…/styles.ts` にTailwindのクラスの組み合わせとして置く。クラスの名前を文字列のつなぎで組み立てない（Tailwindが見つけられず、CSSが出ない）。配色を変えるときは、Tailwindを通らないところ（Workerの知らせと規約のページ・サイト・SNS用の画像・manifestとtheme-color）も一緒に直す（[docs/architecture.md](docs/architecture.md) の「見た目」）。

**e2eとスクリーンショットの道具が使う形を保つ。** 要素のID・`data-*`・`window.yoki`（`D`・`selectDay`・`showTab`）を変えるときは、`test/e2e/smoke.js` と `website/tools/screenshots.js` も直す。

メンバーは中ではIDで持ち、画面とのやり取りでは名前を使う（`src/worker/domain/people.ts`）。

## ライセンス

[MIT](LICENSE)。

画面とサイトのアイコンは [Material Symbols](https://github.com/google/material-design-icons)（Google。[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)）を使っている。組み立てたアプリとサイトには、使ったアイコンのSVGだけが入る。

日本語の検査に使う `tools/yomiyasu/yomiyasu_lint.py` は、[yomiyasu](https://github.com/nanaism/yomiyasu)（nanaism。MIT License。`tools/yomiyasu/LICENSE`）のものをそのまま置いている。
