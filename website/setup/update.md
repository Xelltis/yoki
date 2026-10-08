---
description: 設置したYokiを、新しいバージョンに上げる手順と、困ったときの戻し方。
---

# 新しいバージョンに上げる

Yokiの新しいバージョンは、元のリポジトリ（[Xelltis/yoki](https://github.com/Xelltis/yoki)）のRelease（`v1.4.0` など）として出ます。設置したYokiは、運営の管理画面で新しいバージョンと変わったことを見て、ボタンかGitHubの画面から取り込めます。コードを触る必要はありません。

更新を受け持つのは、あなたのリポジトリのGitHub Actions（「Yokiを更新する」のワークフロー）です。ボタンで設置したリポジトリにも、このワークフローが入っています。

## 初めに1回だけ準備する

### 1. Actionsの権限を変える

あなたのリポジトリの「Settings」→「Actions」→「General」を開きます。「Workflow permissions」を「Read and write permissions」にし、「Allow GitHub Actions to create and approve pull requests」に印を入れて保存してください。更新のワークフローが、mainに書き込み、PRを作るために要ります。

この2つを選べないときは、リポジトリを持つOrganizationの設定で止められています。Organizationの「Settings」→「Actions」→「General」で、同じ設定を許してください。

### 2. mainに書き込むトークンを入れる（おすすめ）

元のリポジトリが `.github/workflows/` のファイルを変えたバージョンは、Actionsの既定のトークンではmainに書き込めません。どのバージョンでも取り込めるように、専用のトークンを入れておきます。

GitHubの「Settings」（あなたのアカウントの設定）→「Developer settings」→「Fine-grained tokens」でトークンを作ります。対象のリポジトリはあなたのリポジトリだけにし、権限は「Contents」と「Workflows」の「Read and write」を付けてください。

作ったトークンの入れ先は、あなたのリポジトリの「Settings」→「Secrets and variables」→「Actions」の「Repository secrets」です。名前は `UPDATE_PUSH_TOKEN` にします。

### 3. 管理画面のボタンで更新できるようにする（任意）

このトークンを入れると、運営の管理画面の「更新」のボタンで更新を始められます。入れなければ、同じ場所に「GitHubで更新する」のボタンが出て、GitHubの画面から始める形です。

2と同じ手順で、あなたのリポジトリだけに「Actions」の「Read and write」を付けたトークンを作ります。入れ先は、YokiのWorkerのsecretで、名前は `UPDATE_DISPATCH_TOKEN` です。

| 設置のしかた | 入れ先 |
|---|---|
| ボタンで設置した | Cloudflareの画面で `yoki` を開き、「Settings」→「Variables and Secrets」に、種類を「Secret」にして足す |
| GitHub Actionsで公開している | environment「production」の秘密に足し、Actionsの「アプリを公開する」で公開し直す |

Yokiは、このトークンで更新のワークフローを動かし、その記録を読むだけです。Yokiからコードを書き換えられないように、ほかの権限は付けないでください。

## 新しいバージョンを知る

新しいバージョンが出ると、運営の管理画面の「様子」のいちばん上と、「更新」の区分に出ます。Yokiは、元のリポジトリのReleaseを1時間に1回まで読みます。すぐ確かめたいときは、「更新」の「確かめ直す」を押してください。

「更新」の区分では、変わったことの一覧と、データベースの表の変更を含むかを確かめられます。使う人向けに書き直した説明の置き場所は、このサイトの[リリースノート](../releases/)です。

## 更新する

「更新」の区分の「v…に更新する」を押します。トークンを入れていなければ、ボタンは「GitHubで更新する」です。押すとActionsの「Yokiを更新する」が開くので、「Run workflow」を押してください。

更新のワークフローは、新しいバージョンをあなたのリポジトリのmainに入れます。取り込み方は、設置のしかたによって次の表のとおりです。

| 設置のしかた | 取り込み方 | 公開 |
|---|---|---|
| ボタンで設置した | 新しいバージョンのファイルで入れ替える。Cloudflareが `wrangler.jsonc` に書いたデータベースのIDなどは引き継ぐ | mainが変わると、Cloudflareが組み立てて公開する |
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
