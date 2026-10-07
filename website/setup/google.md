---
description: 設置したYokiで、Googleでのログインと、Googleカレンダーとの連携を使えるようにする手順（任意）。Google Cloudの画面の画像付き。
---

# Googleと連携する

設置したYokiで、Googleでのログインと、Googleカレンダーとの連携を使えるようにする手順です。どちらも任意で、設定しなくてもYokiは使えます。

| 機能 | 使う人から見えるもの |
|---|---|
| Googleでログイン | 入口の「Googleでログイン」と、設定の画面の「ログインの方法」 |
| Googleカレンダーとの連携 | 設定の画面の「カレンダー連携」。参加する卓を本人のGoogleカレンダーに書き込み、本人の予定から予定表に × と △ を入れる |

2つの機能が使うのは、Google Cloudに作る1つのOAuthクライアントです。このページの手順で次の3つの値をそろえ、YokiのWorkerに入れると、画面に出ます。費用はかからず、かかる時間は30分ほどです。

| 値 | 入れる名前 | 作る手順 |
|---|---|---|
| クライアントID | `GOOGLE_CLIENT_ID` | [6. OAuthクライアントを作る](#_6-oauthクライアントを作る) |
| クライアントシークレット | `GOOGLE_CLIENT_SECRET` | 同じ |
| 鍵 | `GOOGLE_TOKEN_KEY` | [7. 鍵を作る](#_7-鍵を作る) |

購読URLと、卓ごとの「Googleカレンダーに追加」は、この設定が無くても使えます。

Googleでログインできるようになっても、利用者そのものはDiscordのアカウントのままです。Googleのアカウントは、Discordのアカウントに結びつけた、もう1つの入り口になります。グループに入れるかを決めるのは、Discordのサーバーです。

> [!WARNING]
> クライアントシークレットと鍵は、パスワードと同じです。人に見せず、チャットや公開の場所に貼らないでください。

始める前に、Yokiの公開のアドレス（`https://yoki.<サブドメイン>.workers.dev` など）を確かめておきます。[設置する](./)の手順2のあとに分かるアドレスです。このページの画像と表では、見本の `https://yoki.example.workers.dev` を使っています。

画像の中のオレンジの枠と番号は、押す場所と順番です。Google Cloudの画面は、ときどき見た目が変わります。

## 1. プロジェクトを作る

[Google Cloudのコンソール](https://console.cloud.google.com/) を開き、Googleのアカウントでログインしてください。初めて使うなら、利用規約への同意を求められます。

[新しいプロジェクト](https://console.cloud.google.com/projectcreate) の画面で、プロジェクト名を入れ（1）、「作成」を押してください（2）。名前は「Yoki」など、あとで見分けられるものにします（画像では `yoki-guide`）。

[![Google Cloudの新しいプロジェクトの画面。1はプロジェクト名の欄（yoki-guideと入っている）、2は作成のボタン。組織の欄はぼかしてある](/setup/google/01-new-project.png)](/setup/google/01-new-project.png)

組織の欄は、Google Workspaceを使っている人にだけ出ます。出なければ、そのまま進めてかまいません。課金（お支払い）の設定は要りません。

このあとの設定は、画面の上に名前が出ているプロジェクトに入ります。作り終わったら、上のプロジェクトの名前が、作ったものに替わっているかを確かめてください。替わっていなければ、名前を押して選び直します。

## 2. Google Calendar APIを有効にする

[Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com) の画面を開きます。上のプロジェクトの名前が1で作ったものになっているのを確かめ（1）、「有効にする」を押します（2）。

[![Google Calendar APIの画面。1は上のプロジェクトの名前（yoki-guide）、2は「有効にする」のボタン](/setup/google/02-enable-calendar-api.png)](/setup/google/02-enable-calendar-api.png)

## 3. Google Auth Platformを始める

[Google Auth Platform](https://console.cloud.google.com/auth/overview) を開きます。左の「ブランディング」「対象」「クライアント」「データアクセス」で、ログインの画面に出す名前・使える人・OAuthクライアント・求める権限を決める画面です。初めは、まん中の「開始」を押してください（1）。

[![Google Auth Platformの概要の画面。左のブランディング・対象・クライアント・データアクセスを枠で囲み、1は「開始」のボタン](/setup/google/03-auth-platform.png)](/setup/google/03-auth-platform.png)

4つの段を、上から順に埋めます。

### アプリ情報

「アプリ名」に `Yoki` など、使う人に分かる名前を入れます（1）。「ユーザー サポートメール」で問い合わせを受けるメールアドレスを選び（2）、「次へ」を押してください（3）。

[![アプリ情報の段。1はアプリ名の欄（Yokiと入っている）、2はユーザーサポートメールの欄（ぼかしてある）、3は次へのボタン](/setup/google/04-app-info.png)](/setup/google/04-app-info.png)

### 対象

「外部」を選び（1）、「次へ」を押します（2）。「外部」にすると、Googleのアカウントを持つ人ならだれでも使えるようにできます（初めは、あとで足すテストユーザーだけ）。「内部」は、Google Workspaceの組織の中の人だけが使う形で、組織が無いと選べません。

[![対象の段。1は「外部」を選んだところ、2は次へのボタン](/setup/google/05-audience-external.png)](/setup/google/05-audience-external.png)

### 連絡先情報

Googleからの知らせを受け取るメールアドレスを入れ（1）、「次へ」を押します（2）。

[![連絡先情報の段。1はメールアドレスの欄（ぼかしてある）、2は次へのボタン](/setup/google/06-contact.png)](/setup/google/06-contact.png)

### 終了

「Google API サービス: ユーザーデータに関するポリシー」への同意に印を付けます（1）。「続行」（2）、「作成」（3）の順に押してください。

[![終了の段。1はポリシーへの同意の印、2は続行のボタン、3は作成のボタン](/setup/google/07-finish.png)](/setup/google/07-finish.png)

## 4. ブランディングにアドレスを入れる

左の「ブランディング」を開き、下の方の「アプリのドメイン」に次を入れます。

| 欄 | 入れるもの |
|---|---|
| アプリケーションのホームページ（1） | `https://<公開のアドレス>` |
| アプリケーション プライバシー ポリシー リンク（2） | `https://<公開のアドレス>/privacy` |
| アプリケーション利用規約リンク（3） | `https://<公開のアドレス>/terms` |
| 承認済みドメイン（4） | 公開のアドレスのドメイン。workers.devなら `<サブドメイン>.workers.dev`、独自のドメインなら `example.com` の形 |

[![ブランディングのアプリのドメイン。1はホームページ、2はプライバシーポリシー、3は利用規約の欄で、どれもyoki.example.workers.devのアドレス。4は承認済みドメインの欄（example.workers.dev）](/setup/google/08-branding-domain.png)](/setup/google/08-branding-domain.png)

承認済みドメインの欄は、「ドメインの追加」を押すと出ます。入れ終えたら、画面のいちばん下の「保存」を押してください。

同じ画面の「アプリのロゴ」は、空のままにしておきます。ロゴを入れると、本番環境（下の9）にしたときに、Googleの確認が要るようになるためです。

Yokiの利用規約とプライバシーポリシーは、運営の管理画面の「規約」で整えます（[運営の管理画面](./admin)）。

## 5. 求める権限（スコープ）を足す

左の「データアクセス」を開き、「スコープを追加または削除」を押します（1）。

[![データアクセスの画面。1は「スコープを追加または削除」のボタン](/setup/google/09-data-access.png)](/setup/google/09-data-access.png)

右に出た一覧で、「.../auth/userinfo.email」（1）と「openid」（2）に印を付けます。

[![スコープの一覧。1はuserinfo.emailの行、2はopenidの行で、どちらも印が付いている](/setup/google/10-scopes-basic.png)](/setup/google/10-scopes-basic.png)

続けて、一覧の上の「フィルタ」に `calendar.events.owned` と入れて絞り込みます（1）。出てきた「.../auth/calendar.events.owned」に印を付け（2）、下の「更新」を押してください（3）。「.owned.readonly」の行ではありません。

[![フィルタでcalendar.events.ownedに絞り込んだスコープの一覧。1はフィルタ、2はcalendar.events.ownedの行で印が付いている、3は更新のボタン](/setup/google/11-scope-calendar.png)](/setup/google/11-scope-calendar.png)

「非機密のスコープ」に2つ（1）、「機密性の高いスコープ」に1つ（2）が入ったのを確かめ、下の「Save」を押します（3）。

[![データアクセスの画面。1は非機密のスコープのuserinfo.emailとopenid、2は機密性の高いスコープのcalendar.events.owned、3はSaveのボタン](/setup/google/12-scopes-saved.png)](/setup/google/12-scopes-saved.png)

Yokiが求める権限は、この3つだけです。

| スコープ | 使い道 |
|---|---|
| `openid`・`.../auth/userinfo.email` | Googleのアカウントを見分ける。Googleでのログインと、連携したアカウントの表示に使う |
| `.../auth/calendar.events.owned` | 本人が持つカレンダーの予定を読み書きする。参加する卓を書き込み、予定のある時間から予定表に × と △ を入れる |

`calendar.events.owned` は、本人が持つカレンダーの予定だけを触れるスコープです。Yokiはメインのカレンダーしか触らないので、共有されたカレンダーにも届く `calendar.events` は求めません。Googleの区分では、「機密性の高いスコープ」に入ります（下の9で、使える人の数にかかわります）。

## 6. OAuthクライアントを作る

左の「クライアント」を開き、「クライアントを作成」を押します（1）。

[![クライアントの画面。1は「クライアントを作成」](/setup/google/13-clients.png)](/setup/google/13-clients.png)

次のように入れて、いちばん下の「作成」を押してください（4）。

| 欄 | 入れるもの |
|---|---|
| アプリケーションの種類（1） | ウェブ アプリケーション |
| 名前（2） | `Yoki` など。Google Cloudの中で見分けるための名前で、使う人には出ない |
| 承認済みのリダイレクトURI（3） | `https://<公開のアドレス>/auth/google/callback` |

[![OAuthクライアントIDの作成の画面。1はアプリケーションの種類（ウェブ アプリケーション）、2は名前（Yoki）、3は承認済みのリダイレクトURI（https://yoki.example.workers.dev/auth/google/callback）、4は作成のボタン](/setup/google/14-create-client.png)](/setup/google/14-create-client.png)

リダイレクトURIの欄は、「承認済みのリダイレクトURI」の下の「URIを追加」を押すと出ます。上の「承認済みのJavaScript生成元」は、空のままでかまいません。

リダイレクトURIは、1文字でも違うとログインできません（「redirect_uri_mismatch」と出ます）。最後に / を付けずに、そのまま入れてください。設定が効くまで、数分かかることがあります。

作ると、クライアントIDとクライアントシークレットが窓に出ます。それぞれ右のボタンで写して（1・2）、控えてください。

[![「OAuthクライアントを作成しました」の窓。クライアントIDとクライアントシークレットの値はぼかしてある。1と2は、それぞれを写すボタン](/setup/google/15-client-secret.png)](/setup/google/15-client-secret.png)

クライアントシークレットを見られるのは、この窓が出ているあいだだけです。控える前に閉じてしまったら、「クライアント」の一覧で `Yoki` を開き、「Add secret」で新しいシークレットを作ります。「JSONをダウンロード」でファイルに保存してもかまいません。そのときは、ファイルを人に渡さず、値を入れ終えたら消してください。

## 7. 鍵を作る

連携した人のrefresh token（本人が画面を開いていないときにも、Googleカレンダーを読み書きするための値）は、この鍵で暗号にしてから、Yokiのデータベースに置きます。鍵は、ランダムな32バイトをbase64にした44文字の文字列で、最後は `=` です。

次のどれか1つで作れます。出てきた1行が鍵です。

macOS・Linuxのターミナルなら、次を入れます。

```sh
openssl rand -base64 32
```

WindowsのPowerShellなら、次のとおりです。

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

ターミナルを使わないなら、ブラウザでも作れます。どのページでもよいので、F12を押して開発者ツールを開き、「Console」に次を入れてEnterを押してください。

```js
btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
```

鍵を替えると、連携していた人は全員、連携し直しになります。いちど決めたら替えないでください。鍵の形が違うと、Yokiは連携を「使えない」として扱い、ボタンを出しません。

## 8. Yokiに値を入れる

ボタンで設置したなら、Cloudflareの画面のWorkers（Workers & Pages）で `yoki` を開き、「Settings」→「Variables and Secrets」の「Add」で、次の3つを足してください。種類は、3つとも「Secret」にします。入れ終えたら「Deploy」を押すと、すぐに使えるようになります。

| 名前 | 中身 |
|---|---|
| `GOOGLE_CLIENT_ID` | 6のクライアントID |
| `GOOGLE_CLIENT_SECRET` | 6のクライアントシークレット |
| `GOOGLE_TOKEN_KEY` | 7の鍵 |

GitHub Actionsで公開しているなら、GitHubのリポジトリのSettings → Environmentsの「production」に、変数 `YOKI_GOOGLE_CLIENT_ID` と、秘密 `GOOGLE_CLIENT_SECRET`・`GOOGLE_TOKEN_KEY` を入れ、Actionsの「アプリを公開する」で公開し直してください。

Yokiを開き直すと、入口に「Googleでログイン」が出ます。グループの画面の設定にある「カレンダー連携」にも、「Googleと連携する」のボタンが出るはずです。

## 9. 使える人を決める

Googleの「公開ステータス」には、「テスト中」と「本番環境」の2つがあります。作ったばかりのときは「テスト中」で、使えるのは「テストユーザー」に足した人だけです。

| 公開ステータス | 使える人 | 気を付けること |
|---|---|---|
| テスト中 | テストユーザーに足した人（100人まで） | 連携してから7日でGoogleの許可が切れ、連携し直しになる |
| 本番環境（審査なし） | Googleのアカウントを持つ人ならだれでも。カレンダーとの連携は100人まで | カレンダーと連携するときに「確認されていないアプリ」の注意が出る |
| 本番環境（審査あり） | だれでも | Googleの審査に、独自のドメインと準備が要る |

仲間うちで使うなら、まずテストユーザーで自分が試し、うまくいったら本番環境（審査なし）にするのがおすすめです。

### テストユーザーで試す

左の「対象」を開き、「テストユーザー」の「Add users」を押します（1）。

[![対象の画面のテストユーザー。1は「Add users」のボタン](/setup/google/16-test-users.png)](/setup/google/16-test-users.png)

使う人のGoogleのメールアドレスを入れてEnterを押すと（1）、1人ずつ足せます。足し終えたら、「保存」を押してください（2）。

[![ユーザーを追加の窓。1はメールアドレスの欄（member@example.comと入っている）、2は保存のボタン](/setup/google/17-add-test-user.png)](/setup/google/17-add-test-user.png)

テストユーザーに入っていない人がログインしようとすると、Googleの画面に「アクセスをブロック」と出て、先に進めません。

### 本番環境にする

「対象」の「公開ステータス」が「テスト中」になっています（1）。「アプリを公開」を押してください（2）。

[![公開ステータスの欄。1は「テスト中」、2は「アプリを公開」のボタン](/setup/google/18-publish.png)](/setup/google/18-publish.png)

公開してよいかを確かめる窓が出たら、「確認」を押します（1）。

[![本番環境にしてよいかを確かめる窓。1は確認のボタン](/setup/google/19-publish-confirm.png)](/setup/google/19-publish-confirm.png)

公開ステータスが「本番環境」に替われば、公開は済んでいます（2）。上に「アプリの検証が必要です」と出ますが（1）、審査を受けなくても使えます。

[![公開したあとの対象の画面。1は「アプリの検証が必要です」の帯、2は「本番環境」、3はOAuthユーザー数の上限の説明（上限は100）](/setup/google/20-published.png)](/setup/google/20-published.png)

審査を受けるまでは、2つの制限が残ります。1つめは、カレンダーと連携する人に、Googleが「このアプリはGoogleで確認されていません」の注意を出すことです。「詳細」を押し、「（安全ではないページ）に移動」を押すと進めます。連携する人には、この注意が出ることを先に伝えておいてください。Googleでのログインは、メールアドレスしか求めないので、この注意は出ません。

2つめは、カレンダーと連携できる人の数です。プロジェクトの全期間で100人までで（3）、連携を外した人も数のうちです。

### Googleの審査を受ける

100人より多くの人が連携する、または注意を出したくないときは、Googleの審査を受けます。左の「検証センター」から進め、先にブランディング（アプリ名とアドレス）、次にデータアクセス（機密性の高いスコープ）の順で確かめてもらいます。

[![検証センターの画面。Branding statusとData access statusの2つの欄があり、どちらも検証されていないと出ている](/setup/google/21-verification-center.png)](/setup/google/21-verification-center.png)

ブランディングの確認で見られるのは、ホームページとプライバシーポリシーが開けることと、ホームページのサイトの持ち主であることです。次の画像は、見本のアドレスのまま確かめてもらったときの結果です。

[![ブランディングの確認に関する問題の窓。ホームページが応答しない、ホームページのウェブサイトが登録されていない、プライバシーポリシーが応答しない、の3つが出ている](/setup/google/25-branding-issues.png)](/setup/google/25-branding-issues.png)

持ち主であることは、[Google Search Console](https://search.google.com/search-console) で、公開のアドレスのドメインを登録して確かめます。Yokiは、Search Consoleの確かめに使うファイルやタグを出しません。そのため、workers.devのアドレスのままでは確かめられず、DNSで確かめることになります。審査を受けるなら、先に[独自のドメインで公開](./domain)してください。

データアクセスの審査では、スコープの使い道の説明と、使っているところを写した動画を求められます。プライバシーポリシーに、Googleのデータの扱い（受け取るもの・使い道・Limited Useの決まりに従うこと）が書いてあるかも見られます。Yokiの既定の文には書いてありますので、運営の管理画面で本文を直したときは、この部分を消さないでください。

## 10. 連携する人に見える画面

連携する人は、Yokiの設定の画面で「Googleと連携する」を押すと、Googleの画面に移ります。使い方は、使う人向けの「[カレンダーに出す](../guide/calendar-sync)」にあります。

ブランディングの確認を受けるまで、Googleの画面に出る名前は「Yoki」ではありません。公開のアドレスのドメインが出ます（画像では `example.workers.dev`。1）。アカウントを選ぶと（2）、次の画面に進みます。

[![Googleのアカウントを選択する画面。1は「example.workers.devに移動」の文字、2はアカウントの欄（ぼかしてある）](/setup/google/22-account-chooser.png)](/setup/google/22-account-chooser.png)

本番環境で審査を受けていなければ、ここで「確認されていないアプリ」の注意が出ます（上の9）。プロジェクトを作った人と、同じGoogle Workspaceの組織の人には出ません。

続く画面で「次へ」を押すと（1）、カレンダーの許可を求める画面になります。

[![example.workers.devにログインする画面。メールアドレスはぼかしてある。1は次へのボタン](/setup/google/23-consent-signin.png)](/setup/google/23-consent-signin.png)

求めるのは、本人が持つカレンダーの予定の参照・作成・変更・削除だけです（1）。「許可」を押すと（2）、Yokiに戻って連携が済みます。

[![カレンダーの許可を求める画面。1は「オーナー権を持っているGoogleカレンダー上の予定の参照、作成、変更、削除」、2は許可のボタン](/setup/google/24-consent-calendar.png)](/setup/google/24-consent-calendar.png)

## うまくいかないとき

| 出るもの | 原因と直し方 |
|---|---|
| 入口に「Googleでログイン」が出ない。「カレンダー連携」に「使えません」と出る | 3つの値のどれかが無いか、鍵の形が違う（44文字で、最後が `=` か）。入れ直して、もう一度「Deploy」を押す |
| 「エラー 400: redirect_uri_mismatch」 | 6のリダイレクトURIが、公開のアドレスと1文字でも違う。入れ直して、数分待つ |
| 「アクセスをブロック」「エラー 403: access_denied」 | テスト中で、その人がテストユーザーに入っていない。9で足すか、本番環境にする |
| 7日ほどで、カレンダーとの同期が止まる | テスト中のまま。本番環境にしてから、連携し直してもらう |
| 「このアプリはGoogleで確認されていません」 | 本番環境で、審査を受けていない。「詳細」から進めば使える |
| カレンダーに卓が書き込まれない | 2のGoogle Calendar APIが有効になっていない |
| 急にどの人も連携できなくなった | 6か月使われないOAuthクライアントは、Googleが消すことがある。「クライアント」の画面で確かめ、消えていたら作り直して値を入れ直す |

## Yokiが守ること

連携した人のrefresh tokenは、画面・ログ・運営の管理画面のどこにも出しません。Googleから受け取るのは、アカウントのIDとメールアドレスと、予定があるかを決めるのに要る欄（予定の時間など）だけです。予定の名前や中身は受け取りません。

本人が連携を外したときと、運営者が利用者を消したときは、書き込んだ予定を消し、Googleの許可を取り消してから、控えを消します。
