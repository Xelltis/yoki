---
description: 卓予定を「Deploy to Cloudflare」のボタンで自分のCloudflareに設置し、運営者として公開するまでの手順。
---

# 設置する

卓予定は、だれでも自分のCloudflareに設置して公開できます。設置した人は、その卓予定の運営者になります。

設置に使うのは、「Deploy to Cloudflare」のボタンです。ボタンを押すと、Cloudflareがあなたのアカウントにデータベースを作り、あなたのGitHubに卓予定のコードを写して、公開まで済ませます。コードを書いたり、手元でコマンドを打ったりしなくてかまいません。

## 要るもの

| 要るもの | 使い道 | 費用 |
|---|---|---|
| GitHubのアカウント | 卓予定のコードを置く。新しい版への更新もここで動く | 無料 |
| Cloudflareのアカウント | アプリ（Workers）とデータ（D1）を置く | 無料のプランで動く |
| Discordのアカウント | ログインと知らせに使うDiscordアプリを作る | 無料 |
| Googleのアカウント（任意） | Googleでのログインと、Googleカレンダーとの連携 | 無料 |

Cloudflareは、無料のプランのまま使えます。グループが増えて、知らせの見回りで送る数が多くなったら、有料のプラン（Workers Paid）にしてください。

## 流れ

| 手順 | すること | 使う画面 |
|---|---|---|
| 1 | Discordアプリを作る | Discord Developer Portal |
| 2 | ボタンを押して設置する | Cloudflare |
| 3 | 公開のアドレスをDiscordアプリに入れる | Discord Developer Portal |
| 4 | ログインして確かめる | 卓予定 |
| 5 | 利用規約とプライバシーポリシーを整える | 卓予定・Discord Developer Portal |

手順1で控えた値は、手順2の入力欄に入れます。トークンとシークレットは、ほかの人に見せてはいけません。

## 1. Discordアプリを作る

[Discord Developer Portal](https://discord.com/developers/applications) で「New Application」を押し、アプリを作ります。名前は、ログインの画面とBotの名前に出ます（「卓予定」など）。ログインと知らせ（Bot）の両方に、この1つのアプリを使います。

左の項目ごとに、次のように設定してください。

| 項目 | 設定 |
|---|---|
| OAuth2 | Client IDを控える。「Reset Secret」でClient Secretを作って控える。Redirectsは、手順3で入れる |
| Bot | 「Reset Token」でトークンを作って控える。「Public Bot」はONにする。Privileged Gateway Intentsは全部OFFのまま |
| Installation | Install Linkを「None」にする |

Public BotをONにするのは、グループの管理者が卓予定の画面から、自分のDiscordサーバーにBotを招くためです。卓予定はGatewayにつながないので、Privileged Gateway Intentsは要りません。Botを招くURLは卓予定が作るので、Install Linkも要りません（求める権限は「チャンネルを見る」「メッセージを送信」「埋め込みリンク」です）。

あわせて、あなたのDiscordユーザーIDも控えてください。Discordの設定の「詳細設定」で開発者モードをONにし、自分のアイコンを右クリックして「ユーザーIDをコピー」で取れます。

## 2. ボタンを押して設置する

次のボタンを押してください。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Xelltis/yoki/tree/release)

Cloudflareにログインし、GitHubとつなぐと、設置の画面が開きます。リポジトリの名前とWorkerの名前は、そのまま（`yoki`）でかまいません。D1のデータベースは、新しく作るほうを選びます。

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
| リポジトリを作る | あなたのGitHubに、卓予定のコードを写したリポジトリを作る（フォークではない、あなたのリポジトリ） |
| データベースを作る | D1のデータベースを作り、そのIDをリポジトリの `wrangler.jsonc` に書き込む |
| 公開する | 組み立て、データベースの表を作って、公開する |
| 自動で公開し直す | これからは、リポジトリのmainが変わるたびに、Cloudflareが組み立てて公開し直す（Workers Builds） |

入れた値の置き場所は、Workerの「secret」です。あとから変えるときは、Cloudflareの画面のWorkers（Workers & Pages）で `yoki` を開き、「Settings」→「Variables and Secrets」で直してください。足すときは、種類を「Secret」にします（「Text」にすると、次に公開し直したときに消えてしまいます）。

## 3. 公開のアドレスをDiscordアプリに入れる

公開のアドレスは、`https://yoki.<サブドメイン>.workers.dev` の形です。Cloudflareの画面のWorkers（Workers & Pages）で `yoki` を開くと、出ています。

Discord Developer Portalのアプリの「OAuth2」を開き、Redirectsに `https://<公開のアドレス>/auth/callback` を足して保存してください。

## 4. ログインして確かめる

公開のアドレスを開き、「Discordでログイン」を押します。ログインできたら、あなたが入っているDiscordサーバーでグループを作ってみてください（[始め方](../guide/start)）。

運営者としてログインすると、入口の画面に「運営の管理画面」のリンクが出ます。出ないときは、`OPERATOR_IDS` に入れたIDが、ログインしたDiscordのアカウントのものかを確かめてください。

うまくいかないときは、次の表で確かめます。

| 起きたこと | 直し方 |
|---|---|
| Discordの画面に「Invalid OAuth2 redirect_uri」と出る | DiscordアプリのRedirectsに、公開のアドレスの `/auth/callback` が入っているかを確かめる |
| 「Discordログインの設定がありません」と出る | Workerのsecretに `DISCORD_CLIENT_ID` があるかを確かめる（手順2の終わり） |
| 公開が終わらない・失敗した | Cloudflareの画面で `yoki` を開き、「Deployments」か「Builds」で組み立ての記録を読む |

## 5. 利用規約とプライバシーポリシーを整える

公開のアドレスの `/terms` に利用規約が、`/privacy` にプライバシーポリシーが出ます。運営の管理画面の「規約」で、運営者の名前と問い合わせ先を入れ、本文を確かめてください。

既定の文は、このリポジトリのままの卓予定に合わせてあります。前に別のサービスを置くなど、公開のしかたを変えたときは、本文も直してください。

Discord Developer Portalの「General Information」のTerms of Service URLとPrivacy Policy URLにも、この2つのアドレスを入れます。

## 設置したあとに

| したいこと | 読むページ |
|---|---|
| 新しい版が出たら追いつく（初めに1回だけ準備がある） | [新しい版に上げる](./update) |
| Googleでのログインと、Googleカレンダーとの連携を使う | [Googleと連携する](./google) |
| 自分のドメインで公開する | [独自のドメインで公開する](./domain) |
| 使う人を絞る・利用者を締め出す・規約を直す | [運営の管理画面](./admin) |

新しい版への準備は、設置した日に済ませておくのがおすすめです。

## GitHub Actionsで公開する

ボタンを使わずに、卓予定のリポジトリをフォークし、GitHub Actionsで公開するやり方もあります。コードに手を入れながら使いたい人向けで、値をGitHubに入れるなど、手順が多いやり方です。手順は、リポジトリのREADMEの「GitHub Actionsで公開する」にあります。
