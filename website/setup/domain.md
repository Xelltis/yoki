---
description: 設置した卓予定を、自分のドメインで公開する手順（任意）。
---

# 独自のドメインで公開する

設置した卓予定を、workers.devではなく自分のドメイン（`https://yoki.example.com` など）で公開する手順です。先に[設置する](./)の手順で、workers.devのアドレスで公開しておいてください。

やり方は、ドメインのDNSをどこに置くかで2つに分かれます。

| DNSの置き場所 | やり方 |
|---|---|
| Cloudflare（移せる） | CloudflareでWorkerにドメインを付ける（下の「Cloudflareで付ける」） |
| Route 53などに残す | 前にAWS CloudFrontを置き、workers.devへ渡す（下の「CloudFrontを置く」） |

Workersに独自のドメインを直接付けるには、ドメインのDNSがCloudflareにあることが要ります（DNSを別のところに残す形は、Cloudflareの有料のプランが要ります）。

## Cloudflareで付ける

ドメインのDNSをCloudflareに移せるなら、こちらが手軽です。Cloudflareの画面のWorkers（Workers & Pages）で `yoki` を開き、設定の「Domains & Routes」からCustom Domainを足します。そのあと、下の「値を直す」に進んでください。

## CloudFrontを置く

ドメインのDNSをRoute 53に残したまま公開するときは、前にAWS CloudFrontを置き、CloudFrontからworkers.devのアドレスへ渡します。

Workerに届く要求のアドレスは、workers.devのままです。卓予定は、自分のアドレス（Discordログインの戻り先・知らせのリンク・不正な送信の確かめ）を、Workerのsecretの `APP_URL` で決めるので、そのまま動きます。workers.devは有効のままにしてください（CloudFrontの行き先になります）。

### 1. 証明書を作る

AWS Certificate Managerで、**us-east-1（バージニア北部）** に、使うドメイン（`yoki.example.com` など）の証明書を作ります。検証には、Route 53のDNSを使ってください。

### 2. CloudFrontのディストリビューションを作る

| 設定 | 値 |
|---|---|
| オリジン | `yoki.<サブドメイン>.workers.dev`。プロトコルはHTTPSのみ |
| ビューワーのプロトコル | Redirect HTTP to HTTPS |
| 許可するメソッド | GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE |
| キャッシュポリシー | CachingDisabled |
| オリジンリクエストポリシー | AllViewerExceptHostHeader |
| 代替ドメイン名 | `yoki.example.com` |
| 証明書 | 1で作ったもの |

オリジンリクエストポリシーは、Host以外のヘッダー・cookie・クエリをすべてWorkerに渡すものを選びます。Hostまで渡すと、Cloudflareが受け取りません。

速くしたいときは、`/assets/*` のビヘイビアを足し、キャッシュポリシーを「CachingOptimized」にします。組み立てた画面のファイルは、名前に中身の印が付くので、長く控えてかまいません。

### 3. Route 53のレコードを向ける

`yoki.example.com` のAとAAAAのレコードを、エイリアスでCloudFrontのディストリビューションに向けてください。ほかのレコードは、そのままでかまいません。

workers.devのアドレスも開けますが、ログインの戻り先とcookieは公開のアドレスに結びつくので、workers.devからはログインできません。

## 値を直す

どちらのやり方でも、最後に次を直します。

| 直すところ | 直し方 |
|---|---|
| 卓予定のWorkerのsecret | `APP_URL` を `https://yoki.example.com` にする（下の表） |
| DiscordアプリのOAuth2 | Redirectsに `https://yoki.example.com/auth/callback` を足す |
| GoogleのOAuthクライアント（連携しているとき） | 承認済みのリダイレクトURIに `https://yoki.example.com/auth/google/callback` を足す |
| 利用規約・プライバシーポリシーのアドレス | Discord Developer PortalとGoogleの同意画面のアドレスを、新しいドメインに直す |

`APP_URL` の入れ先は、設置のしかたで違います。

| 設置のしかた | 入れ先 |
|---|---|
| ボタンで設置した | Cloudflareの画面で `yoki` を開き、「Settings」→「Variables and Secrets」に、種類を「Secret」にして足す |
| GitHub Actionsで公開している | environment「production」の変数 `YOKI_APP_URL` にし、Actionsの「アプリを公開する」で公開し直す |

`https://yoki.example.com/` を開いてログインでき、グループを開ければ、できあがりです。
