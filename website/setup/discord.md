---
description: Yokiのログインと知らせ（Bot）に使うDiscordアプリを、Discord Developer Portalで作る手順。画像付き。
---

# Discordアプリを作る

Yokiは、「Discordでログイン」と、チャンネルへの知らせ（Bot）に、1つのDiscordアプリを使います。このアプリは、設置する人が自分のDiscordのアカウントで作ります。費用はかからず、かかる時間は10分ほどです。

このページの手順で、次の4つを控えます。[設置する](./)の手順2で、ボタンの入力欄に入れる値です。

| 控えるもの | 入れる欄 | 控える手順 |
|---|---|---|
| Client ID | `DISCORD_CLIENT_ID` | [2. Client IDとClient Secretを控える](#_2-client-idとclient-secretを控える) |
| Client Secret | `DISCORD_CLIENT_SECRET` | 同じ |
| Botのトークン | `DISCORD_BOT_TOKEN` | [3. Botのトークンを控える](#_3-botのトークンを控える) |
| あなたのDiscordユーザーID | `OPERATOR_IDS` | [5. あなたのDiscordユーザーIDを控える](#_5-あなたのdiscordユーザーidを控える) |

> [!WARNING]
> Client SecretとBotのトークンは、パスワードと同じです。知られると、ほかの人があなたのBotとして動けます。人に見せず、チャットや公開の場所に貼らないでください。漏れたと思ったら、同じ画面の「リセット」で作り直します。

画像の中のオレンジの枠と番号は、押す場所と順番です。Discordの画面は、ときどき見た目が変わります。

## 1. アプリを作る

[Discord Developer Portal](https://discord.com/developers/applications) を開き、Discordのアカウントでログインします。右上の「新しいアプリケーション」を押してください。

[![Discord Developer Portalのアプリの一覧。右上の「新しいアプリケーション」のボタンを枠で囲んでいる](/setup/discord/01-new-application.png)](/setup/discord/01-new-application.png)

窓が開いたら、「名前」にアプリの名前を入れ（1）、規約への同意に印を付けて（2）、「作成」を押します（3）。名前は、ログインの画面とBotの名前に出るので、「Yoki」や、仲間に分かる名前がよいでしょう。「チーム」は「個人」のままでかまいません。

[![アプリを新規作成する窓。1は名前の欄（Yokiと入っている）、2は規約への同意のチェック、3は作成のボタン](/setup/discord/02-create-application.png)](/setup/discord/02-create-application.png)

「私は人間です」の確認が出たら、チェックを入れて、出てきた問題に答えてください。

[![「ちょっと待って！あなた、本当に人間ですよね？」の窓。hCaptchaの「私は人間です」のチェックがある](/setup/discord/03-captcha.png)](/setup/discord/03-captcha.png)

アプリができると、アプリの画面（一般情報）が開きます。このあとの設定は、左の「インストール」「OAuth2」「Bot」を切り替えながら進める形です。

[![アプリの一般情報の画面。左の項目のうち、インストール・OAuth2・Botを枠で囲んでいる](/setup/discord/04-app-menu.png)](/setup/discord/04-app-menu.png)

## 2. Client IDとClient Secretを控える

左の「OAuth2」を開きます。「クライアントID」の右のボタン（1）で、Client IDを写して控えてください。

次に「秘密をリセット」（2）を押します。確かめの窓で進めると、Client Secretが1回だけ出るので、写して控えてください。あとから見直すことはできません。無くしたときは、もう一度「秘密をリセット」で作り直します（前のものは使えなくなります）。

[![OAuth2の画面のクライアント情報。1はクライアントIDを写すボタン、2は「秘密をリセット」のボタン。クライアントIDの値はぼかしてある](/setup/discord/05-oauth2-client.png)](/setup/discord/05-oauth2-client.png)

## 3. Botのトークンを控える

左の「Bot」を開きます。「トークンをリセット」（1）を押すと、Botのトークンが1回だけ出るので、写して控えてください。Client Secretと同じく、あとから見直すことはできません。

[![Botの画面のトークンの欄。1は「トークンをリセット」のボタン](/setup/discord/07-bot-token.png)](/setup/discord/07-bot-token.png)

同じ画面の下の方は、初めの状態のままでかまいません。「公開Bot」はONのまま（1）、Privileged Gateway Intentsの3つはOFFのまま（2）にしておきます。

[![Botの画面の下の方。1は公開BotのスイッチでON、2はPresence Intent・Server Members Intent・Message Content Intentの3つのスイッチでOFF](/setup/discord/08-bot-settings.png)](/setup/discord/08-bot-settings.png)

公開BotをONにしておくのは、グループの管理者が、Yokiの画面から自分のDiscordサーバーにBotを招くためです。YokiのBotは、メッセージを書くことと、卓をサーバーのイベントにすることだけをします。Discordの会話を読みに行かないので、Intentsは要りません。

## 4. インストールリンクを「なし」にする

左の「インストール」を開きます。「インストールリンク」の選ぶ欄を開き、「なし」を選んでください（1）。

[![インストールの画面。インストールリンクの選ぶ欄を開き、1の「なし」を枠で囲んでいる](/setup/discord/09-install-link.png)](/setup/discord/09-install-link.png)

「なし」になったのを確かめ（2）、画面の下に出る「変更を保存」を押します（3）。

[![インストールリンクが「なし」になった画面。2は選ぶ欄、3は画面の下の「変更を保存」のボタン](/setup/discord/10-install-save.png)](/setup/discord/10-install-save.png)

Botを招くURLは、Yokiが作ります。求める権限は「チャンネルを見る」「メッセージを送信」「埋め込みリンク」の3つです。卓をDiscordのイベントに出すグループだけ、「イベントを作成」も求めます。Discordが用意するリンクは使いません。

## 5. あなたのDiscordユーザーIDを控える

あなたを、設置したYokiの運営者にするための値です。Discordのアプリ（PCかブラウザ）で、左下の歯車（ユーザー設定）を開きます。左の「開発者」を押し（1）、「開発者モード」をONにしてください（2）。

[![Discordの設定の「開発者」の画面。1は左の「開発者」、2は開発者モードのスイッチでON。左上のプロフィールはぼかしてある](/setup/discord/12-discord-developer-mode.png)](/setup/discord/12-discord-developer-mode.png)

設定を閉じたら、左下のあなたのアイコンを押し（1）、出てきた欄の「ユーザーIDをコピー」を押します（2）。写した数字の並びが、あなたのDiscordユーザーIDです。

[![左下の自分のアイコンを押して開いた欄。1は左下の自分の欄（ぼかしてある）、2は「ユーザーIDをコピー」](/setup/discord/13-discord-copy-user-id.png)](/setup/discord/13-discord-copy-user-id.png)

ここまでで、4つの値がそろいました。[設置する](./)の手順2に進み、ボタンを押してください。

## 6. 設置したあと: リダイレクトを入れる

Yokiを設置して公開のアドレス（`https://yoki.<サブドメイン>.workers.dev` など）が分かったら、このアプリに戻ってきます（[設置する](./)の手順3）。

左の「OAuth2」の「リダイレクト」で「Redirect を追加」を押し、出てきた欄に `https://<公開のアドレス>/auth/callback` を入れて（1）、画面の下の「変更を保存」を押します（2）。

[![OAuth2の画面のリダイレクト。1は https://yoki.example.workers.dev/auth/callback と入れた欄、2は画面の下の「変更を保存」のボタン](/setup/discord/06-oauth2-redirect.png)](/setup/discord/06-oauth2-redirect.png)

アドレスは、1文字でも違うとログインできません（「Invalid OAuth2 redirect_uri」と出ます）。最後の / も付けずに、そのまま入れてください。

## 7. 設置したあと: 利用規約とプライバシーポリシーのアドレスを入れる

Yokiの利用規約とプライバシーポリシーを整えたら（[設置する](./)の手順5）、そのアドレスも、このアプリに入れておきます。

左の「一般情報」を開き、下の方の「利用規約URL」に `https://<公開のアドレス>/terms` を（1）、「プライバシーポリシーURL」に `https://<公開のアドレス>/privacy` を入れて（2）、「変更を保存」を押します（3）。

[![一般情報の画面の下の方。1は利用規約URL、2はプライバシーポリシーURLの欄、3は画面の下の「変更を保存」のボタン](/setup/discord/11-terms-privacy.png)](/setup/discord/11-terms-privacy.png)
