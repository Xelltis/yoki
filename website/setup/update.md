---
description: 設置したYokiを、新しいバージョンに上げる手順と、困ったときの戻し方。
---

# 新しいバージョンに上げる

Yokiの新しいバージョンは、元のリポジトリ（[Xelltis/yoki](https://github.com/Xelltis/yoki)）のRelease（`v1.4.0` など）として出ます。設置したYokiは、運営の管理画面で新しいバージョンと変わったことを見て、ボタンかGitHubの画面から取り込めます。コードを触る必要はありません。

更新を受け持つのは、あなたのリポジトリのGitHub Actions（「Yokiを更新する」のワークフロー）です。ボタンで設置したときは、このワークフローを初めに1回だけ入れます。

## 初めに1回だけ準備する

### 1. 更新のワークフローを入れる（ボタンで設置したとき）

ボタンで作ったリポジトリには、GitHub Actionsのワークフローのファイル（`.github/workflows/`）が入っていません。リポジトリを作るCloudflareのGitHub Appに、ワークフローのファイルを書く権限が無いためです。更新のワークフローは、あなたが入れてください。

4のトークンを入れてあれば、運営の管理画面の「更新」に「更新のワークフローを入れる」のボタンが出ます。押すと、ファイルの名前と中身を入れたGitHubの画面が開きます。そのまま「Commit changes」を押してください。

ボタンが出ないときは、手で入れます。あなたのリポジトリで「Add file」→「Create new file」を開き、名前を `.github/workflows/update.yml` にします。中身には元のリポジトリの[update.yml](https://github.com/Xelltis/yoki/blob/release/.github/workflows/update.yml)をそのまま写し、「Commit changes」を押してください。

入れたワークフローは、書き換えずに使い続けられます。更新のたびに、取り込むバージョンの手順を読んで動くからです。

### 2. リポジトリのActionsの設定を変える

あなたのリポジトリの「Settings」→「Actions」→「General」を開きます。「Workflow permissions」を「Read and write permissions」にし、「Allow GitHub Actions to create and approve pull requests」に印を入れて保存してください。更新のワークフローが、mainに書き込み、PRを作るために要ります。

この2つを選べないときは、リポジトリを持つOrganizationの設定で止められています。Organizationの「Settings」→「Actions」→「General」で、同じ設定を許してください。

ここで変えるのはリポジトリの設定で、4で作るトークンの権限とは別のものです。

### 3. mainに書き込むトークンを入れる（GitHub Actionsで公開しているとき）

ボタンで設置したときは要りません。ボタンで作ったリポジトリの更新は、ワークフローのファイルを変えないためです。

フォークしてGitHub Actionsで公開しているときは、元のリポジトリが `.github/workflows/` のファイルを変えたバージョンを、Actionsの既定のトークンではmainに書き込めません。どのバージョンでも取り込めるように、専用のトークンを入れておきます。

GitHubの「Settings」（あなたのアカウントの設定）→「Developer settings」→「Fine-grained tokens」でトークンを作ります。対象のリポジトリはあなたのリポジトリだけにし、権限は「Contents」と「Workflows」の「Read and write」を付けてください。

作ったトークンの入れ先は、あなたのリポジトリの「Settings」→「Secrets and variables」→「Actions」の「Repository secrets」です。名前は `UPDATE_PUSH_TOKEN` にします。

### 4. 管理画面のボタンで更新できるようにする（任意）

このトークンを入れると、運営の管理画面の「更新」のボタンで更新を始められます。入れなければ、同じ場所に「GitHubで更新する」のボタンが出て、GitHubの画面から始める形です。

2で変えたリポジトリの設定とは別に、GitHubのトークンを作ります。どちらにも「Actions」と「Read and write」が出てきますが、2はリポジトリの設定で、ここで決めるのはトークンの権限です。3のトークンとも別にしてください。

1. GitHubの「Settings」（あなたのアカウントの設定）→「Developer settings」→「Fine-grained tokens」を開き、「Generate new token」を押す
2. 「Repository access」を「Only select repositories」にして、あなたのリポジトリを選ぶ
3. 「Permissions」で、「Actions」を「Read and write」にする
4. 「Generate token」を押して、出たトークンを控える

付けるのは「Actions」だけです（「Metadata」の「Read-only」は、自動で付きます）。「Workflows」は名前が似ていますが、ワークフローのファイルを書き換える権限で、ワークフローを動かすのは「Actions」の権限です。

作ったトークンの入れ先は、YokiのWorkerのsecretです。名前は `UPDATE_DISPATCH_TOKEN` にします。

| 設置のしかた | 入れ先 |
|---|---|
| ボタンで設置した | Cloudflareの画面で `yoki` を開き、「Settings」→「Variables and Secrets」に、種類を「Secret」にして足す |
| GitHub Actionsで公開している | environment「production」の秘密に足し、Actionsの「アプリを公開する」で公開し直す |

Yokiは、このトークンで更新のワークフローを動かし、その記録を読むだけです。Yokiからコードを書き換えられないように、ほかの権限は付けないでください。元のリポジトリのReleaseも、このトークンで読みます（公開されたリポジトリは、どのトークンでも読めるため）。

## 新しいバージョンを知る

新しいバージョンが出ると、運営の管理画面の「様子」のいちばん上と、「更新」の区分に出ます。Yokiは、元のリポジトリのReleaseを1時間に1回まで読みます。すぐ確かめたいときは、「更新」の「確かめ直す」を押してください。

GitHubは、トークンなしの読み出しの数を、出口のアドレスごとに1時間60回までにしています。Cloudflareでは出口をほかの利用者と分け合うので、この上限にすぐ達しますが、そのときはReleaseの一覧のフィード（RSSのようなもの）から読み直すので、新しいバージョンは分かります。ただし、表の変更を含むかは「分からない」のままです。確実に読ませたいときは、4のトークン（`UPDATE_DISPATCH_TOKEN`）を入れてください。

読めなかったときは、「新しいバージョンを確かめられませんでした」と理由が出ます。最新のバージョンの欄に残るのは、前に読めたものです。

運営者には、YokiのBotからDiscordのDMでも知らせます（毎日10時台に1回見ます。[運営者への知らせ](./admin#運営者への知らせ)）。

「更新」の区分では、変わったことの一覧と、データベースの表の変更を含むかを確かめられます。使う人向けに書き直した説明の置き場所は、このサイトの[リリースノート](../releases/)です。

## 更新する

「更新」の区分の「v…に更新する」を押します。トークンを入れていなければ、ボタンは「GitHubで更新する」です。押すとActionsの「Yokiを更新する」が開くので、「Run workflow」を押してください。

更新のワークフローは、新しいバージョンをあなたのリポジトリのmainに入れます。取り込み方は、設置のしかたによって次の表のとおりです。

| 設置のしかた | 取り込み方 | 公開 |
|---|---|---|
| ボタンで設置した | 新しいバージョンのファイルで入れ替える。`.github/` の中（入れた更新のワークフロー）と、Cloudflareが `wrangler.jsonc` に書いたデータベースのIDなどは残す | mainが変わると、Cloudflareが組み立てて公開する |
| GitHub Actionsで公開している（フォーク） | 新しいバージョンをマージする | 「アプリを公開する」のワークフローが公開する |

どちらでも、データベースの表の変更は、公開のときに当たります。数分たつと、運営の管理画面のバージョンが新しくなっているはずです。

バージョンは、飛ばして上げてもかまいません。間のバージョンの表の変更も、公開のときに順に当てるからです。

## mainに入れずにPRになるとき

次のときは、更新のワークフローがmainを変えずに止まり、`update/v1.4.0` のようなブランチとPRを作ります。

| 設置のしかた | PRになるとき |
|---|---|
| ボタンで設置した | あなたのリポジトリのコードが、設置したとき（か前の更新）のバージョンから変わっている。入れ替えると、その変更は消える |
| GitHub Actionsで公開している（フォーク） | マージで、あなたの変更とぶつかった |

PRを開き、差分を確かめてからマージしてください。マージすると公開されます。コードを直さずに使っていれば、PRにはなりません。

## DependabotのPRが届くとき

ボタンで設置したリポジトリに、Dependabotから `build(deps): bump …` のようなPRが届くことがあります。Dependabotは、使っている部品（依存）の新しいバージョンをPRにする、GitHubの仕組みです。元のリポジトリの設定ファイル（`.github/dependabot.yml`）が、設置のときに写ると動きます。

届いたPRは、マージせずに閉じてください。マージすると、テストを通っていない部品のまま公開され、次の更新も、コードが変わったとみなしてPRで止まります。部品は、新しいバージョンに上げるたびに、テストを通ったものに入れ替わります。

届かないようにするには、あなたのリポジトリで `.github/dependabot.yml` を開き、右上の「…」から「Delete file」を選んで消してください。更新は `.github/` を変えないので、消したままになります。

## 403と出るとき

「GitHubが403を返しました」と出るのは、トークンの権限が足りないときです。出たところによって、確かめるトークンが変わります。

| 出たところ | 確かめるトークン | 要る権限 |
|---|---|---|
| 運営の管理画面の「更新」 | Workerのsecretの `UPDATE_DISPATCH_TOKEN` | 「Actions」の「Read and write」（「Workflows」ではありません） |
| Actionsの「Yokiを更新する」の記録 | Actionsのsecretの `UPDATE_PUSH_TOKEN` | 「Contents」と「Workflows」の「Read and write」 |

運営の管理画面で出たときは、リポジトリの「Settings」→「Actions」→「General」（手順2）を変えても直りません。トークンの権限を確かめてください。

GitHubのトークンの画面では、「Repository access」も見てください。「Only select repositories」にして、あなたのリポジトリを選びます。「Public repositories」のままでは、どのリポジトリにも書き込めません。リポジトリがOrganizationのものなら、「Resource owner」をそのOrganizationにします（Organizationが認めるまで使えないこともあります）。

権限は、トークンを作ったあとでも変えられます。変えてもトークンの値は同じなので、入れ直す必要はありません。

ボタンで設置したときは、`UPDATE_PUSH_TOKEN` は要りません。入れてあって403になるなら、消してかまいません（Actionsの既定のトークンで書き込みます）。

## 「could not read Username」と出るとき

Actionsの「Yokiを更新する」の記録に、`could not read Username for 'https://github.com': terminal prompts disabled` と出て、初めの `actions/checkout` で止まることがあります。Actionsのsecretの `UPDATE_PUSH_TOKEN` に入れたトークンが、使えなくなったときです。トークンを作り直した・消した・期限が切れたときに起こります。同じトークンを `UPDATE_DISPATCH_TOKEN` にも使っていて、そちらのために作り直したときも同じです。

ボタンで設置したときは、`UPDATE_PUSH_TOKEN` を消してください。あなたのリポジトリの「Settings」→「Secrets and variables」→「Actions」の「Repository secrets」にあります。消すと、Actionsの既定のトークンで書き込みます。

GitHub Actionsで公開しているときは、手順3と同じ権限でトークンを作り直し、`UPDATE_PUSH_TOKEN` に入れ直してください。

## 困ったときに戻す

上げたバージョンで困ったら、次の順に戻します。

### Worker

Cloudflareの画面のWorkers（Workers & Pages）で `yoki` を開き、「Deployments」から前のバージョンに戻してください。

### データベース

表を変えたバージョンなら、D1のTime Travelで、更新の前の時刻に戻せます。ターミナルで `npx wrangler d1 time-travel restore yoki --timestamp=<更新の前の時刻>` を動かしてください（GitHub Actionsで公開しているなら、公開のワークフローのSummaryに出たbookmarkでも戻せます）。その時刻より後に書かれたもの（予定・回答など）は消えるので、気を付けてください。

### コード

mainの取り込みのコミット（`chore: Yokiのv…を取り込む`）を、revertしてください。ボタンで設置したリポジトリでは、revertすると前のバージョンで公開し直されます。

## 元のリポジトリを変える（任意）

フォークをさらにフォークしたときなど、バージョンを取り込む元を変えたいときに使います。あなたのリポジトリの「Settings」→「Secrets and variables」→「Actions」の「Repository variables」に、`YOKI_UPSTREAM` という名前で、元にするリポジトリ（`owner/name`）を入れてください。

運営の管理画面の「更新」が新しいバージョンを見に行く先も、同じ名前の値で変わります。ボタンで設置したなら、Cloudflareの画面で `yoki` を開き、「Settings」→「Build」の変数に `YOKI_UPSTREAM` を足して、公開し直してください。
