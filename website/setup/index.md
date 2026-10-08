---
description: Yokiを「Deploy to Cloudflare」のボタンで自分のCloudflareに設置し、運営者として公開するまでの手順。
---

# 設置する

Yokiは、だれでも自分のCloudflareに設置して公開できます。設置した人は、そのYokiの運営者になります。

設置に使うのは、「Deploy to Cloudflare」のボタンです。ボタンを押すと、Cloudflareがあなたのアカウントにデータベースを作り、あなたのGitHubにYokiのコードを写して、公開まで済ませます。コードを書いたり、手元でコマンドを打ったりしなくてかまいません。

## 要るもの

| 要るもの | 使い道 | 費用 |
|---|---|---|
| GitHubのアカウント（[作り方](./github)） | Yokiのコードを置く。新しいバージョンへの更新もここで動く | 無料 |
| Cloudflareのアカウント（[作り方](./cloudflare)） | アプリ（Workers）とデータ（D1）を置く | 無料のプランで動く |
| Discordのアカウント | ログインと知らせに使うDiscordアプリを作る | 無料 |
| Googleのアカウント（任意） | Googleでのログインと、Googleカレンダーとの連携 | 無料 |

GitHubとCloudflareのアカウントが無ければ、先に作ってください。初めての人向けに、画像付きの手順を[GitHubのアカウントを作る](./github)と[Cloudflareのアカウントを作る](./cloudflare)にまとめてあります。

Cloudflareは、無料のプランのまま使えます。グループが増えて、知らせの見回りで送る数が多くなったら、有料のプラン（Workers Paid）にしてください。

## 流れ

| 手順 | すること | 使う画面 |
|---|---|---|
| 1 | Discordアプリを作る | Discord Developer Portal |
| 2 | ボタンを押して設置する | Cloudflare |
| 3 | 公開のアドレスをDiscordアプリに入れる | Discord Developer Portal |
| 4 | ログインして確かめる | Yoki |
| 5 | 利用規約とプライバシーポリシーを整える | Yoki・Discord Developer Portal |

手順1で控えた値は、手順2の入力欄に入れます。トークンとシークレットは、ほかの人に見せてはいけません。

## 1. Discordアプリを作る

Yokiのログインと知らせ（Bot）に使うDiscordアプリを、[Discord Developer Portal](https://discord.com/developers/applications) で作ります。画面の画像付きの手順は、[Discordアプリを作る](./discord)にまとめてあります。

その手順で、次の4つを控えてください。手順2の入力欄に入れます。

| 控えるもの | 入れる欄 |
|---|---|
| Client ID | `DISCORD_CLIENT_ID` |
| Client Secret | `DISCORD_CLIENT_SECRET` |
| Botのトークン | `DISCORD_BOT_TOKEN` |
| あなたのDiscordユーザーID | `OPERATOR_IDS` |

## 2. ボタンを押して設置する

次のボタンを押してください。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Xelltis/yoki/tree/release)

Cloudflareにログインすると、設置の画面（アプリケーションをセットアップする）が開きます。初めてのときは、「Git アカウント」の「新しい GitHub 接続」で、CloudflareとGitHubをつないでください（[画像付きの手順](./cloudflare#_6-設置のときに、githubとつなぐ)）。リポジトリの名前とWorkerの名前は、そのまま（`yoki`）でかまいません。D1のデータベースは、新しく作るほうを選びます。

入力欄には、手順1で控えた値を入れてください。

| 名前 | 入れるもの |
|---|---|
| `DISCORD_CLIENT_ID` | DiscordアプリのClient ID |
| `DISCORD_CLIENT_SECRET` | DiscordアプリのClient Secret |
| `DISCORD_BOT_TOKEN` | DiscordアプリのBotのトークン |
| `OPERATOR_IDS` | あなたのDiscordユーザーID。運営者が何人かいれば、カンマで区切って並べる |

運営者は、[運営の管理画面](./admin)を開ける人です。

最後のボタンを押すと、Cloudflareが次のことを済ませます。数分かかります。

| Cloudflareがすること | 中身 |
|---|---|
| リポジトリを作る | あなたのGitHubに、Yokiのコードを写したリポジトリを作る（フォークではない、あなたのリポジトリ） |
| データベースを作る | D1のデータベースを作り、そのIDをリポジトリの `wrangler.jsonc` に書き込む |
| 公開する | 組み立て、データベースの表を作って、公開する |
| 自動で公開し直す | これからは、リポジトリのmainが変わるたびに、Cloudflareが組み立てて公開し直す（Workers Builds） |

入れた値の置き場所は、Workerの「secret」です。あとから変えるときは、Cloudflareの画面のWorkers（Workers & Pages）で `yoki` を開き、「Settings」→「Variables and Secrets」で直してください。足すときは、種類を「Secret」にします（「Text」にすると、次に公開し直したときに消えてしまいます）。

## 3. 公開のアドレスをDiscordアプリに入れる

公開のアドレスは、`https://yoki.<サブドメイン>.workers.dev` の形です。Cloudflareの画面のWorkers（Workers & Pages）で `yoki` を開くと、出ています。

Discord Developer Portalのアプリの「OAuth2」を開き、「リダイレクト」に `https://<公開のアドレス>/auth/callback` を足して保存してください（[画像付きの手順](./discord#_6-設置したあと-リダイレクトを入れる)）。

## 4. ログインして確かめる

公開のアドレスを開き、「Discordでログイン」を押します。ログインできたら、あなたが入っているDiscordサーバーでグループを作ってみてください（[始め方](../guide/start)）。

運営者としてログインすると、入口の画面に「運営の管理画面」のリンクが出ます。出ないときは、`OPERATOR_IDS` に入れたIDが、ログインしたDiscordのアカウントのものかを確かめてください。

うまくいかないときは、次の表で確かめます。

| 起きたこと | 直し方 |
|---|---|
| Discordの画面に「Invalid OAuth2 redirect_uri」と出る | Discordアプリの「リダイレクト」に、公開のアドレスの `/auth/callback` が1文字も違わずに入っているかを確かめる |
| 「Discordログインの設定がありません」と出る | Workerのsecretに `DISCORD_CLIENT_ID` があるかを確かめる（手順2の終わり） |
| 公開が終わらない・失敗した | Cloudflareの画面で `yoki` を開き、「Deployments」か「Builds」で組み立ての記録を読む |

## 5. 利用規約とプライバシーポリシーを整える

公開のアドレスの `/terms` に利用規約が、`/privacy` にプライバシーポリシーが出ます。運営の管理画面の「規約」で、運営者の名前と問い合わせ先を入れ、本文を確かめてください。

既定の文は、このリポジトリのままのYokiに合わせてあります。前に別のサービスを置くなど、公開のしかたを変えたときは、本文も直してください。

Discord Developer Portalのアプリの「一般情報」の「利用規約URL」と「プライバシーポリシーURL」にも、この2つのアドレスを入れます（[画像付きの手順](./discord#_7-設置したあと-利用規約とプライバシーポリシーのアドレスを入れる)）。

## 設置したあとに

| したいこと | 読むページ |
|---|---|
| 新しいバージョンが出たら追いつく（初めに1回だけ準備がある） | [新しいバージョンに上げる](./update) |
| Googleでのログインと、Googleカレンダーとの連携を使う | [Googleと連携する](./google) |
| 自分のドメインで公開する | [独自のドメインで公開する](./domain) |
| 使う人を絞る・利用者を締め出す・規約を直す | [運営の管理画面](./admin) |

新しいバージョンへの準備は、設置した日に済ませておくのがおすすめです。

## GitHub Actionsで公開する

ボタンを使わずに、Yokiのリポジトリをフォークし、GitHub Actionsで公開するやり方もあります。コードに手を入れながら使いたい人向けで、値をGitHubに入れるなど、手順が多いやり方です。手順は、リポジトリの [docs/deployment.md](https://github.com/Xelltis/yoki/blob/main/docs/deployment.md) の「GitHub Actionsで公開する」にあります。
