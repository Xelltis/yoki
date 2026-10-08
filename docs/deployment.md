# 公開と更新

Yokiを自分のCloudflareに公開する仕組みと、新しいバージョンに上げる仕組み。開発の始め方は [CONTRIBUTING.md](../CONTRIBUTING.md)、作りとその理由は [architecture.md](architecture.md) にある。

公開のしかたは2つある。設置する人（運営者）には、ボタンをすすめる。

| しかた | 向いている人 | 公開する仕組み |
|---|---|---|
| 「Deploy to Cloudflare」のボタン（おすすめ） | Yokiを自分のCloudflareに立てたい人 | Cloudflareの組み立て（Workers Builds） |
| GitHub Actions | 元のリポジトリ（Xelltis/yoki）と、コードに手を入れながら使う人 | `.github/workflows/deploy.yml` |

どちらでも、手元から `wrangler deploy` はしない。公開するCloudflareごとに違う値（D1のID・Discordアプリの値・運営者のIDなど）は、リポジトリに置かない。

設置する人向けには、ボタンでの手順を画面の操作に沿って、サイトの「[設置する](https://xelltis.github.io/yoki/setup/)」（`website/setup/`）に書いてある。この文書は、その裏の仕組みと、GitHub Actionsでの公開の手順。手順を変えたら、この文書とサイトの両方を直す。

## ボタンで設置する

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Xelltis/yoki/tree/release)

ボタンは `release` のブランチを指す。`release` は、バージョンを出すたびにそのバージョンのコミットに合わせる（[CONTRIBUTING.md](../CONTRIBUTING.md) の「バージョンを出す」）。なので設置する人は、いつもバージョンを出したときの中身を受け取る。バージョンを出すのは、元のリポジトリの公開のワークフローで、テスト（型・lint・カバレッジ・e2e）が全部通ったときだけ。Workers Buildsはテストを動かさないが、ボタンでの設置も更新も、テストを通ったバージョンだけを受け取る。

ボタンを押すと、Cloudflareが次をする。

| Cloudflareがすること | リポジトリの側の用意 |
|---|---|
| 設置する人のGitHubに、中身を写したリポジトリを作る（フォークではない。元の履歴とタグは無い） | バージョンは `package.json` の `version` に持たせる（タグに頼らない） |
| D1を作り、そのIDを写したリポジトリの `wrangler.jsonc` に書き込む | `wrangler.jsonc` にはD1のIDを書かない |
| Workerのsecretの値を聞く | 聞く名前は `.dev.vars.example` のコメントでない行（Discordアプリの3つと `OPERATOR_IDS`）。説明は `package.json` の `"cloudflare"` |
| 組み立てて公開する（Workers Builds）。この後も、mainが変わるたびに公開し直す | `npm run build` と `npm run deploy`（表の変更を当ててから `wrangler deploy`） |

Viteは、`wrangler deploy` の行き先（`.wrangler/deploy/config.json`）を `src/client/` の下に書く。直下で動く `wrangler deploy` から見えるように、組み立ての終わりに直下にも同じ行き先を書く（`vite.config.ts` の `deployRedirect`）。表の変更（`wrangler d1 migrations apply`）は行き先を見ないので、直下の `wrangler.jsonc`（CloudflareがIDを書いたもの）を読む。

Workerの値は、どれもsecretにする（varsにしない）。Workers Buildsは公開のたびに、設定に無いvarsを消すため。公開のアドレス（`APP_URL`）は無くてもよい。そのときは届いた要求のアドレスを使い、要求の無い見回り（cron）のために、ログインのたびにD1に控える（`auth/origin.ts`）。公開しているリポジトリの名前（運営の管理画面の「更新」）は、組み立てのときにGitのoriginから読む。

写したリポジトリでは、公開のワークフロー（`deploy.yml`）とサイトの公開（`pages.yml`）は動かない。更新のワークフロー（`update.yml`）は動く（下の「新しいバージョンに上げる」）。

## GitHub Actionsで公開する

元のリポジトリと、フォークして自分で公開するときのやり方。公開するCloudflareごとの値は、GitHubのenvironment「production」に置く。D1のIDとリポジトリの名前は組み立てた設定（`dist/yoki/wrangler.json`）に入れ（`vite.config.ts`）、ほかはWorkerのsecretとして公開するバージョンと一緒に送る（`deploy.yml`）。

### 1. 公開するアドレスを決める

Cloudflareだけなら `https://yoki.<アカウントのサブドメイン>.workers.dev` になる（サブドメインは、Cloudflareの画面のWorkersで分かる）。Route 53などのドメインで公開するなら、下の「独自のドメインで公開する」のCloudFrontのアドレス（`https://yoki.example.com` など）。

### 2. Discordアプリを作る

[Discord Developer Portal](https://discord.com/developers/applications) で「新しいアプリケーション」を作る。ログインと知らせ（Bot）の両方に、この1つのアプリを使う。画面の画像付きの手順は、サイトの「[Discordアプリを作る](https://xelltis.github.io/yoki/setup/discord)」（`website/setup/discord.md`）。

OAuth2: 「リダイレクト」に `https://<公開するアドレス>/auth/callback` と `http://localhost:5173/auth/callback` を足す。クライアントIDと、「秘密をリセット」で出るクライアントシークレットを控える。

Bot: 「トークンをリセット」でトークンを作って控える。「公開Bot」はON（グループの管理者が、Yokiの画面から自分のサーバーに招く）。Privileged Gateway Intentsは全部OFFのまま（Gatewayには繋がない）。

インストール: 「インストールリンク」は「なし」（Botを招くURLはYokiが作る。求める権限は「チャンネルを見る」「メッセージを送信」「埋め込みリンク」。卓をDiscordのイベントに出すグループだけ「イベントを作成」も、卓ごとのスレッドを使うグループだけ「公開スレッドの作成」「スレッドでメッセージを送信」も）。

一般情報: 「Interactions Endpoint URL」は空のままでよい。運営の管理画面の「Discordのボタン」を入れると、YokiがBotのトークンでアプリのPublic Keyを読み、このURLに `https://<公開するアドレス>/api/discord/interactions` を入れる（新しいsecretは要らない）。

### 3. CloudflareでD1とAPIトークンを作る

D1: `npx wrangler login` のあと `npx wrangler d1 create yoki`（Cloudflareの画面のD1で作ってもよい）。出てきたdatabase IDを控える。

APIトークン: アカウントのAPIトークンを作る（Cloudflareの画面の「アカウントの管理」→「アカウントAPIトークン」）。権限は2つ。「Workers」（新しいほう。「Workers Scripts」は古い形）の「Admin」と、「D1」の「Edit」。初めての公開でWorkerを作るにはWorkersのAdminが要る（まだ無いWorkerだけに絞った権限は付けられない）。公開できたら、Workersは `yoki` のWorkerだけの「Editor」に下げてよい（公開と秘密の値はそれで足りる）。Workersの権限はD1を含まないので、本番のD1への表の変更のためにD1のEditが別に要る。テンプレートの「Edit Cloudflare Workers」はD1を含まず、要らない権限も多いので使わない。ユーザーのAPIトークンと違い、作った人に結びつかないので、その人がいなくなっても公開が止まらない（wranglerにはアカウントIDが要るが、deploy.ymlが `CLOUDFLARE_ACCOUNT_ID` を渡す）。

アカウントID: Cloudflareの画面のWorkersの右側に出る。

### 4. GitHubに値を入れる

公開のワークフローが動くのは、元のリポジトリと、GitHub Actionsで公開すると決めたリポジトリだけ。フォークでも、決めなければ動かない（PRを出すためだけのフォークで、公開しようとして止まらないように）。Settings → Secrets and variables → ActionsのRepository variablesに `YOKI_DEPLOY_WITH_ACTIONS` を `true` で入れる。

リポジトリのSettings → Environmentsで「production」を作り、次を入れる。

| 種類 | 名前 | 中身 |
|---|---|---|
| 変数（Variables） | `CLOUDFLARE_ACCOUNT_ID` | CloudflareのアカウントID |
| 変数 | `YOKI_D1_DATABASE_ID` | 3で作ったD1のdatabase ID |
| 変数 | `YOKI_DISCORD_CLIENT_ID` | DiscordアプリのClient ID |
| 秘密（Secrets） | `CLOUDFLARE_API_TOKEN` | 3で作ったアカウントのAPIトークン |
| 秘密 | `DISCORD_CLIENT_SECRET` | DiscordアプリのClient Secret |
| 秘密 | `DISCORD_BOT_TOKEN` | DiscordアプリのBotのトークン（知らせを送る） |
| 秘密 | `OPERATOR_IDS` | 運営者（運営の管理画面を開ける人）のDiscordユーザーID。何人いても、カンマか空白で区切って並べる |
| 変数（任意） | `YOKI_APP_URL` | 公開するアドレス（`https://…`）。前にCDNを置くときだけ要る（下の「独自のドメインで公開する」） |
| 変数（任意） | `YOKI_GOOGLE_CLIENT_ID` | Googleカレンダーとの連携を使うときだけ。下の「Googleでのログインと、Googleカレンダーとの連携」 |
| 秘密（任意） | `GOOGLE_CLIENT_SECRET` | 同じく。GoogleのOAuthクライアントのシークレット |
| 秘密（任意） | `GOOGLE_TOKEN_KEY` | 同じく。Googleのrefresh tokenを暗号にする鍵 |
| 秘密（任意） | `UPDATE_DISPATCH_TOKEN` | 運営の管理画面のボタンで更新するときだけ。下の「新しいバージョンに上げる」 |

DiscordのユーザーIDは、Discordのユーザー設定の「開発者」で開発者モードをONにし、左下の自分のアイコンを押して「ユーザーIDをコピー」で取れる。

運営者のIDは、公開のログに出さないように秘密に置く（公開のリポジトリでは、Actionsのログはだれでも読める）。

公開のたびに確かめたいなら、environmentの「Required reviewers」に自分を入れる。承認するまで公開が止まる。

### 5. 公開する

mainにアプリの変更（`src/`・`migrations/`・設定）をpushすると動く。Actionsの画面の「アプリを公開する」から、手で動かすこともできる。型の確認 → テスト（カバレッジ100%）→ 組み立て（D1のIDが無ければ止まる。開発用ログインが残っていても止まる）→ 本番のD1にマイグレーション → 公開、の順に進む。Workerのsecretは、公開するバージョンと一緒に送る。

### 6. 利用規約とプライバシーポリシーを整える

公開したアドレスの `/terms` と `/privacy` に出る。運営の管理画面（`/admin/`）の「規約」で、運営者の名前と問い合わせ先を入れ、本文を確かめる。既定の文は、このリポジトリのままのYokiに合わせてある。前にCDNを置くなど、公開のしかたが違えば直す。Discordの開発者ポータルのアプリの「一般情報」の「利用規約URL」と「プライバシーポリシーURL」にも、この2つのアドレスを入れる。

## Googleでのログインと、Googleカレンダーとの連携（任意）

Googleでのログインと、Googleカレンダーとの連携は、同じOAuthクライアントを使う。どちらも、下の手順で3つの値（クライアントID・クライアント シークレット・鍵）をそろえたときだけ使える。

**Googleでログイン**（入口の「Googleでログイン」と、設定の画面の「ログインの方法」）: 利用者そのものは今までどおりDiscordのアカウントで、Googleは結びつけたもう1つの入り口になる。初めてのGoogleアカウントは、続けてDiscordでログインして結びつける（グループに入れるかはDiscordのサーバーで決まるため）。求めるのは `openid`・`email` だけ。値がそろっていなければ、ボタンを出さない。

**Googleカレンダーとの連携**（設定の画面の「カレンダー連携」）: 参加する卓を本人のGoogleカレンダーに書き込み、本人の予定から予定表に × と △ を入れる。値がそろっていなければ、画面に「使えません」と出る。

購読URLと、卓ごとの「Googleカレンダーに追加」は、何も設定しなくても使える。

設置する人向けの、画面の画像付きの手順は、サイトの「[Googleと連携する](https://xelltis.github.io/yoki/setup/google)」（`website/setup/google.md`）。画面の名前は、Google Cloudの「Google Auth Platform」に合わせる。

### 1. Google Cloudでプロジェクトを作る

プロジェクトを作り、Google Calendar APIを有効にする。

### 2. Google Auth Platformを設定する

「開始」で、アプリ名・ユーザーサポートメール・対象（外部）・連絡先を入れる。

「ブランディング」に、ホームページ（公開するアドレス）・プライバシーポリシー（`<公開するアドレス>/privacy`）・利用規約（`/terms`）・承認済みドメインを入れる。ロゴは入れない（入れると、本番環境でGoogleの確認が要る）。

「データアクセス」に、スコープ `openid`・`.../auth/userinfo.email`・`https://www.googleapis.com/auth/calendar.events.owned` を足す。`calendar.events.owned` は本人が持つカレンダーの予定だけを触れる。Yokiはメインのカレンダーしか触らないので、共有されたカレンダーにも届く `calendar.events` は求めない。

### 3. OAuthクライアントを作る

「クライアント」で、種類を「ウェブ アプリケーション」にする。承認済みのリダイレクトURIに `<公開するアドレス>/auth/google/callback` を入れる（手元で本物を試すなら `http://localhost:5173/auth/google/callback` も）。クライアントシークレットは、作ったときの窓でだけ見られる（無くしたら、クライアントの画面の「Add secret」で作り直す）。

### 4. 鍵を作る

`openssl rand -base64 32` の出力（44文字）を `GOOGLE_TOKEN_KEY` にする。refresh tokenはこの鍵で暗号にしてD1に置くので、鍵を替えると、連携していた人は連携し直しになる。形が違う（32バイトのbase64でない）と、連携を「使えない」として扱う（`googleConfigured`）。

### 5. 値を入れる

ボタンで設置したなら、CloudflareのWorkerのVariables and Secretsに、`GOOGLE_CLIENT_ID`・`GOOGLE_CLIENT_SECRET`・`GOOGLE_TOKEN_KEY`（4の鍵）を、種類「Secret」で足す。GitHub Actionsで公開しているなら、変数 `YOKI_GOOGLE_CLIENT_ID` にクライアントID、秘密 `GOOGLE_CLIENT_SECRET` にクライアント シークレット、秘密 `GOOGLE_TOKEN_KEY` に4の鍵を入れて、公開し直す。

### 6. 使える人を決める

公開ステータスは、初めは「テスト中」で、「対象」のテストユーザー（100人まで）だけが使える。テスト中は、連携から7日でrefresh tokenが切れる（スコープが `openid`・`email` だけでないため）。

「アプリを公開」で「本番環境」にすれば、審査を受けなくても、だれでもGoogleでログインし、カレンダーと連携できる。ただし `calendar.events.owned` は「機密性の高いスコープ」なので、審査が済むまでは、連携のときに「確認されていないアプリ」の注意が出て（プロジェクトの持ち主と、同じGoogle Workspaceの組織の人には出ない）、連携できるのはプロジェクトの全期間で100人まで。Googleでのログイン（`openid`・`email`）には、注意は出ない。ブランディングの確認を受けるまでは、Googleの画面にアプリ名ではなく、公開するアドレスのドメインが出る。

審査は「検証センター」で、ブランディングの確認のあとに、データアクセスの確認を受ける。ブランディングでは、ホームページとプライバシーポリシーが開けることと、Search Consoleでサイトの持ち主だと確かめてあることを見られる。Yokiは、Search Consoleの確かめのファイルやタグを出さないので、workers.devのままでは確かめられない。独自のドメインで公開し、DNSで確かめる。データアクセスでは、スコープの使い道の説明と、使っているところの動画を求められる。プライバシーポリシーにGoogleのデータの扱い（受け取るもの・使い道・Limited Useに従うこと）が書いてあるかも見られる。既定の文には書いてある。直したときは、消さないように気を付ける。

連携した人のrefresh tokenは、画面・ログ・運営の管理画面には出さない。本人が連携を外すと、運営者が利用者を消すと、書き込んだ予定を消し、Googleの許可を取り消してから消す。

Googleでログインした人がグループに入れるかは、Discordのサーバーの一覧の控えで決める。控えが24時間より古くなったら、そのサーバーに知らせのBotがいればBotで確かめ（Discordのログインの画面は出ない）、いなければDiscordに聞き直す。

## 新しいバージョンに上げる（更新）

元のリポジトリ（[Xelltis/yoki](https://github.com/Xelltis/yoki)）は、バージョン（`v1.4.0` など）をGitHubのReleaseとして出す（[CONTRIBUTING.md](../CONTRIBUTING.md) の「バージョンを出す」）。設置したYokiは、運営の管理画面の「更新」で新しいバージョンと変わったことを見て、ボタンかGitHubの画面で取り込む。コードを触らずに追いつける。設置する人向けの手順は、サイトの「[新しいバージョンに上げる](https://xelltis.github.io/yoki/setup/update)」。

**新しいバージョンを知る**: 運営の管理画面の「様子」のいちばん上と、「更新」の区分に出る。元のリポジトリのReleaseを、1時間に1回まで読む（トークンは要らない）。表（D1）の変更を含むバージョンは、そう出る。トークンなしで読むので、元のリポジトリが非公開だと読めず、その理由が出る。

**更新する**: 「更新」の区分のボタンか、GitHubのActionsの「Yokiを更新する」（`.github/workflows/update.yml`）の「Run workflow」。ワークフローは、設置した人のリポジトリの作り方で、取り込み方を変える。

| リポジトリ | 見分け方 | 取り込み方 | 公開 |
|---|---|---|---|
| ボタンで作った | 元の履歴とつながっていない | バージョンのファイルで入れ替える。Cloudflareが `wrangler.jsonc` に書いた値（Workerの名前・D1の名前とID）は引き継ぐ（`tools/update/carry-wrangler.mjs`） | mainへのpushで、Workers Buildsが表の変更を当てて公開する |
| フォーク | 元の履歴とつながっている | バージョンのタグをマージする | 公開のワークフローが、表を変える前のD1の地点（bookmark）をSummaryに控えてから、表の変更を当てて公開する（`YOKI_DEPLOY_WITH_ACTIONS` が `true` のとき） |

**mainに入れずにPRにするとき**: ボタンで作ったリポジトリのコードが、今のバージョン（`package.json` のバージョンのタグ）から変わっているとき（入れ替えると、その変更が消えるため。`wrangler.jsonc` は比べない）と、フォークでマージがぶつかったとき。どちらも `update/v1.4.0` のブランチとPRを作って止まる。GitHubの画面で確かめてマージすると公開される。サーバーごとの値はsecretかenvironmentに、規約の文はD1にあるので、コードを直さずに使っていればPRにならない。

初めの1回だけ、次を準備する。

### 1. Actionsを使えるようにする

フォークでは、Actionsは初めは止まっている（Actionsの画面で使うと決める）。ボタンで作ったリポジトリでは、初めから動く。どちらも、Settings → Actions → Generalの「Workflow permissions」を「Read and write permissions」にし、「Allow GitHub Actions to create and approve pull requests」を入れる（PRのため）。

### 2. mainに書き込むトークン（おすすめ）

元のリポジトリが `.github/workflows/` を変えたバージョンは、Actionsの既定のトークンではmainに書き込めない。GitHubのSettings → Developer settings → Fine-grained tokensで、このリポジトリだけに「Contents」と「Workflows」のRead and writeを付けたトークンを作り、リポジトリのSettings → Secrets and variables → ActionsのRepository secretsに `UPDATE_PUSH_TOKEN` として入れる（environmentではなく、リポジトリのsecret）。

### 3. 管理画面のボタンで更新する（任意）

このリポジトリだけに「Actions」のRead and writeを付けたトークンを作り、Workerのsecretの `UPDATE_DISPATCH_TOKEN` に入れる（ボタンで設置したならCloudflareのWorkerのVariables and Secretsに種類「Secret」で、GitHub Actionsで公開しているならenvironment「production」の秘密に入れて公開し直す）。Workerはこのトークンで更新のワークフローを動かし、その記録を読む。コードは書き換えられない権限にとどめる。無ければ、「更新」の区分にGitHubの画面を開くボタンが出る。

### 4. 元のリポジトリを変える（任意。フォークのフォークなど）

リポジトリのSettings → Secrets and variables → ActionsのRepository variablesに `YOKI_UPSTREAM`（`owner/name`）を入れる（更新のワークフローが取り込む元）。運営の管理画面が新しいバージョンを見に行く先は、組み立てのときの `YOKI_UPSTREAM` で決まる。ボタンで設置したなら、Workers Buildsの組み立ての変数（Settings → Build）にも入れる。

困ったときは、次の順に戻す。

Worker: Cloudflareの画面のWorkers → `yoki` → Deploymentsで、前のバージョンに戻す（`npx wrangler rollback` でもよい）。

D1: 表を変えたバージョンなら、Time Travelで更新の前に戻す。`npx wrangler d1 time-travel restore yoki --timestamp=<更新の前の時刻>`（GitHub Actionsで公開しているなら、公開のワークフローのSummaryに出たbookmarkを `--bookmark=<bookmark>` で渡してもよい）。その地点より後に書かれたもの（予定・回答など）は消える。

コード: mainの取り込みのコミットをrevertする（そのままだと、次の公開でまた新しいバージョンが出る）。

## 独自のドメインで公開する（Route 53とCloudFront）

Workersに独自のドメインを直接付けるには、そのドメインのDNSをCloudflareに移す必要がある（DNSを別のところに残す形は、Cloudflareの有料のプランが要る）。ドメインのDNSをRoute 53に残したまま公開するときは、前にAWS CloudFrontを置き、CloudFrontからworkers.devのアドレスへ渡す。

Workerに届く要求のアドレスはworkers.devのままになる。アプリは、自分のアドレス（Discordログインの戻り先・知らせのリンク・CSRFの確かめ）をWorkerのsecretの `APP_URL` で決めるので、そのまま動く。

workers.devのアドレスもそのまま開けるが、ログインの戻り先とcookieは公開のアドレスに結びつくので、workers.devのままでは使えない（ログインの途中で止まる）。使う人を絞りたいときは、運営の管理画面で新規登録の受付を止める。

### 1. 公開するCloudflareの側

上の「ボタンで設置する」か「GitHub Actionsで公開する」のとおり。workers.devは有効のままにする（CloudFrontの行き先になる）。

### 2. 証明書

AWS Certificate Managerで、**us-east-1（バージニア北部）** に、使うドメイン（`yoki.example.com` など）の証明書を作る。検証はRoute 53のDNSで行う。

### 3. CloudFrontのディストリビューションを作る

オリジン: `yoki.<アカウントのサブドメイン>.workers.dev`。プロトコルはHTTPSのみ。

既定のビヘイビア: ビューワーのプロトコルは「Redirect HTTP to HTTPS」、許可するメソッドは「GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE」、キャッシュポリシーは「CachingDisabled」、オリジンリクエストポリシーは「AllViewerExceptHostHeader」（Host以外のヘッダー・cookie・クエリをすべて渡す。Hostを渡すとCloudflareが受け取らない）。

（速くしたいとき）`/assets/*` のビヘイビアを足し、キャッシュポリシーを「CachingOptimized」にする。組み立てたJSとCSSは、名前に中身の印が付くので長く控えてよい。

代替ドメイン名に `yoki.example.com`、証明書に2を選ぶ。

### 4. Route 53

`yoki.example.com` のAとAAAAのレコードを、エイリアスでCloudFrontのディストリビューションに向ける。ほかのレコードはそのまま。

### 5. 値を直す

Workerのsecretの `APP_URL` を `https://yoki.example.com` にし（ボタンで設置したならCloudflareのWorkerのVariables and Secretsで。GitHub Actionsで公開しているなら変数 `YOKI_APP_URL` を直して公開し直す）、DiscordアプリのRedirectsに `https://yoki.example.com/auth/callback` を足す。Googleカレンダーと連携しているなら、Googleの承認済みのリダイレクトURIにも `https://yoki.example.com/auth/google/callback` を足す。

### 6. 確かめる

`https://yoki.example.com/` でログインでき、グループを開けること。

DNSをCloudflareに移せるドメインなら、CloudFrontを置かずに、Cloudflareの画面でWorkerに独自のドメイン（Custom Domain）を足せる。そのときも `APP_URL` とDiscordのRedirectsを直す。

Cloudflareは無料のプランで動く。グループが増えて、知らせの見回りで送る数が多くなったら、有料のプラン（Workers Paid）にする。

## 使い方のサイト（GitHub Pages）

紹介と使い方のページ（`website/`）は、元のリポジトリだけが [GitHub Pages](https://xelltis.github.io/yoki/) に公開する。設置した人のリポジトリでは公開しない（アプリの「ヘルプ」は元のサイトを開く）。公開はGitHub Actions（`.github/workflows/pages.yml`）が、mainに `website/` の変更が入ったときに行う。初めてのときは、リポジトリのSettings → PagesのSourceを「GitHub Actions」にする。非公開のリポジトリからPagesを公開するには、GitHubの有料のプランが要る。
