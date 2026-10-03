# Yoki（卓予定管理）

TRPG の卓の予定を、Google スプレッドシートと Apps Script で管理するツール。ウェブアプリの画面から、卓の登録、メンバーの都合（△×）、募集、日程調整を行い、知らせを Discord の Webhook に送る。

手元の作業（開発サーバー・テスト・Apps Script への反映）は Node.js（22.12 以降か 24 以降）で行う。道具は Vite（開発サーバー）・Vitest（テスト）・clasp（Apps Script への反映）。最初に一度だけ次を実行する。

```
npm install
npm run dev           http://localhost:5173/ でアプリが動く（Apps Script もシートも無しで。下の「手元で動かす」）
```

## フォルダ構成

```
src/                  Apps Script に送るのはここだけ（clasp の rootDir）
  appsscript.json     Apps Script の設定（タイムゾーン、ウェブアプリの公開範囲など）
  server/             サーバー側のスクリプト。役割ごとに分けてある
  client/             画面の HTML。1 つの画面を、骨組み・CSS・JS の 3 つに分けてある
test/                 Vitest のテスト。Apps Script のモックの上で src/server を通しで動かす
index.html            開発サーバーの入口（アプリ）。中身は dev/ が組み立てる
dev/                  アプリを手元で動かす部品（ブラウザの中で動くサーバー側と、サンプルデータ）
mock/                 画面の作り直し案のモック
promo/                X 用の告知画像と、広報用の画像を書き出すスクリプト
tools/                src/ を Apps Script と同じ形で読む小道具、Vite のプラグイン、開発サーバーを立てる小道具
vite.config.js        Vite（開発サーバー）と Vitest（テスト）の設定
assets/               アイコンなどの素材
docs/                 導入手順・使い方・検証の記録（guide.md）と、配布・画面の作り直しの案、セキュリティレビュー
```

### src/server

| ファイル | 中身 |
|---|---|
| `Config.js` | 定数。シート名・列の並び・状態・設定の既定値 |
| `Triggers.js` | シートのメニュー、`onOpen`・`onEdit`、トリガーの登録、表示の描き直しの予約、シートの版 |
| `WebApp.js` | `doGet`（画面を返す）と、画面が最初に読む一式（`getConsoleData`） |
| `Auth.js` | 合言葉と管理者の合言葉 |
| `Sessions.js` | 卓の登録・変更・削除、まとめての変更、参加希望 |
| `Members.js` | メンバーの登録・変更・削除 |
| `Availability.js` | メンバーの予定（△×）、予定メモ、日付メモ |
| `Polls.js` | 日程調整 |
| `Settings.js` | 設定タブ（知らせの設定・シリーズごとの通知・接続テスト） |
| `Notify.js` | 見回り（開催前の知らせ・期間前の催促・開始直前の知らせ） |
| `Discord.js` | Discord への送信、送り直し、文面、通知ログ |
| `Lock.js` | 書き込みの順番待ち（スクリプトロック） |
| `Data.js` | シートからの読み込み（`loadContext_` など） |
| `Model.js` | 読み込んだ卓の並べ替え、期間と候補日、卓に入っている人、全員空きの日 |
| `Views.js` | 表示シート（カレンダー・一覧・管理・都合）の描き直し |
| `Sheets.js` | シートの用意と整え直し |
| `Sample.js` | サンプルデータ |
| `Utils.js` | 日付・祝日・文字列の小道具 |

### src/client

| ファイル | 中身 |
|---|---|
| `Console.html` / `ConsoleCss.html` / `ConsoleJs.html` | ウェブアプリの画面（骨組み / 見た目 / 動き） |
| `Tutorial.html` / `TutorialCss.html` / `TutorialJs.html` | 使い方のページ（`?page=tutorial` で開く） |

`doGet` は `Console.html` をテンプレートとして読み、`<?!= include_('client/ConsoleCss'); ?>` の位置に CSS と JS のファイルを差し込んで返す。

## 書くときの決まり

- **トップレベル（関数の外）でほかのファイルの定数を使わない。** Apps Script はファイルを並びの順に 1 つずつ読み込み、並びは push の順やエディタの操作で変わる。関数の中からなら、どのファイルの定数も使える。定数どうしを組み合わせて作る定数は、相手と同じファイルに置く。テストは `server/` を逆の順でも読み込んで、これを確かめている。
- 画面から `google.script.run` で呼べるのは、名前が `_` で終わらない関数。中だけで使う関数は `_` で終える。
- 画面にアイコンを足したら、`Console.html` 先頭の読み込みの `icon_names` にも名前をアルファベット順で足す。
- ファイルを足すときは、`src/server/` なら `.js`、`src/client/` なら `.html` にする（`.claspignore` がこの形だけを通す）。

## テスト

[Vitest](https://vitest.dev/) で回す。

```
npm test              一度だけ回す
npm run test:watch    ファイルを保存するたびに回し直す
```

| ファイル | 中身 |
|---|---|
| `test/scheduler.test.js` | 1 枚のスプレッドシートを、初期設定から順に操作していく筋書き（48 節）。節は前の節が作った状態の上で動く |
| `test/load-order.test.js` | `src/server` を名前順でも逆順でも読み込めるか（読み込む順に頼っていないか） |
| `test/client.test.js` | 画面の `<script>` の構文と、CSS・JS の差し込み |
| `test/dev.test.js` | 開発サーバーで動かすアプリの組み立て。ブラウザの中で動くサーバー側でサンプルが作れるか |
| `test/mock_gas.js` | Apps Script（SpreadsheetApp など）のモック。無いメソッドを呼ぶとすぐ落ちる |
| `test/helpers/load-gas.js` | モックと `src/server` を、Apps Script と同じく 1 ファイルずつ読み込む |

「いま」は 2026-09-20 12:00 に固定し、タイムゾーンは Apps Script と同じ Asia/Tokyo にしてある（`vite.config.js`）。

## Apps Script への反映

[clasp](https://github.com/google/clasp) で送る。`.clasp.json`（スクリプト ID）はリポジトリに入れていない。`.clasp.json.example` を `.clasp.json` に写して、スクリプト ID を入れる。前から使っている `.clasp.json` には `"rootDir": "src"` を足す。

```
npm run push
npx clasp redeploy <デプロイ ID> -d "卓予定管理シートverNN"
```

clasp は `npm install` で入る（版は `package.json` で決めてある）。`clasp login` がまだなら、先に `npx clasp login` を実行する。

送るのは `src/` の中（`appsscript.json` と `server/`・`client/` のファイル）だけ。`rootDir` が無いと何も送らない。

Apps Script 側のファイル名は `src/` からの相対パスになる（`server/Config`、`client/Console` など）。いまの構成を初めて送ると、Apps Script 側にあった `Code`・`Console`・`Tutorial` は消え、これらのファイルに置き換わる。関数の名前は変えていないので、トリガーはそのまま動く。公開中のウェブアプリは、2 行目の redeploy で新しい版に切り替わる（URL は変わらない）。

詳しい手順は `docs/guide.md` にある。

## 手元で動かす（開発サーバー）

```
npm run dev
```

`http://localhost:5173/` を開くと、アプリが Apps Script もシートも無しに動く。本物の画面（`src/client`）とサーバー側（`src/server`）を、Apps Script のモック（`test/mock_gas.js`）の上でブラウザの中だけで動かし、サンプルデータで始まる。開発にも、画面を見せるのにも、スクリーンショットにも、これを使う。

- `src/` や `dev/` のファイルを保存すると、開いている画面が読み込み直される。
- 操作はどこにも保存されない。開き直すか、左下の「最初に戻す」で最初の状態に戻る。合言葉は聞かない。Discord へは送ったことにするだけで、どこにも届かない。

| URL | ページ |
|---|---|
| `/` | アプリ |
| `/?page=tutorial` | 使い方のページ。本物と同じく、アプリの URL の後ろに `?page=tutorial` を付ける |
| `/mock/ui2026-v1.html` | UI 2026 案 ver1（手書きのモック） |
| `/mock/ui2026-v2.html` | UI 2026 案 ver2（アプリに `mock/ver2-overlay.html` を重ねる） |
| `/promo/x-announcement.html` | X 用の告知画像（1600×900） |

アプリの URL の後ろには、次を付けられる（`&` でつなぐ）。`?clean` は左下の札を隠す（スクリーンショット用）。`?theme=dark` か `?theme=light` で配色、`?me=こまち` で「あなた」、`?tab=recruit` で最初の画面（cal・recruit・avail・members・settings）。

`index.html` と `mock/ui2026-v2.html` は Vite に「ここにページがある」と知らせる入口で、中身は開くたびに組み立てる（`vite.config.js` の `pages` と `tools/vite-plugin-gas-pages.js`）。組み立ての部品は `dev/` にある。

| ファイル | 中身 |
|---|---|
| `dev/pages.js` | 組み立て方。本物の画面を doGet と同じく組み立て、下の部品を差し込む |
| `dev/seed.js` | サンプルデータ。ブラウザの中のサーバー側と同じ場所で動き、`saveSession` などを呼んで作る |
| `dev/google-script-run.js` | `google.script.run` の代わり。呼ばれた関数を、ブラウザの中のサーバー側で動かす |
| `dev/params.js` | URL の `?tab=`・`?me=`・`?theme=` を読む |
| `dev/badge.html` | 左下の札（サンプルデータで動いていることと「最初に戻す」）。シートとログアウトのボタンは隠す |

## ほかのコマンド

| コマンド | すること |
|---|---|
| `npm run status` | clasp で送るファイルの一覧を出す（送りはしない） |
| `npm run screenshots` | 開発サーバーを立て、アプリのスクリーンショットを `promo/images/` に撮る |
| `npm run promo` | 開発サーバーを立て、X 用の告知画像を `promo/images/x-announcement.png` に書き出す |

`screenshots` と `promo` は、開発サーバーをその場で立てて止める（`npm run dev` を立てておく必要は無い）。ブラウザ（Playwright の Chromium）を使う。初めてのときは先に `npx playwright install chromium` を実行する。書き出した画像はリポジトリに入れない（`.gitignore`）。
