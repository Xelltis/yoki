# 卓予定の作り

開発する人向けに、卓予定の作りと、そう決めた理由をまとめる。使う人向けの説明はサイト（`website/`、GitHub Pages）、手元で動かす方法と公開の手順は [README.md](../README.md) にある。

2026-10-03 に、Google Apps Script（GAS）＋スプレッドシートの版から作り直した。業務の決まり（卓の状態、参加希望の扱い、日程調整の流れなど）は GAS 版のまま移し、関数ごとに元の関数名をコメントに残してある。GAS 版のコードと文書（旧いガイド・セキュリティレビュー・UI の再設計案）は、git の `gas-final` タグで読める（`git show gas-final:src/server/Polls.js` など）。

## 全体

Worker 1 つで、次の 3 つを受け持つ。

- **画面**: `src/client` を Vite で組み立てた静的ファイル（Workers Static Assets）。`wrangler.jsonc` の `run_worker_first` にある道（`/api/*`・`/auth/*`・`/g/*`・`/dev/*`）だけ Worker が先に受ける
- **API**: Hono（`src/worker/app.ts`）
- **知らせの見回り**: 5 分おきの cron（`scheduled`）

| 道 | 中身 |
|---|---|
| `/` | 入口（`src/client/index.html`）。`GET /api/me` でログインしているかを聞き、グループの一覧か「Discord でログイン」を出す |
| `/g/:id/` | グループのアプリ。入れる人には `console/index.html`（データの入っていない骨組み）を返す。データは画面が API で読む |
| `/auth/login` `/auth/callback` `POST /auth/logout` | Discord ログイン |
| `GET /api/me` `POST /api/groups` | 入口の画面が使う |
| `POST /api/g/:id/:fn` | 画面からの呼び出し |
| `POST /dev/login` `POST /dev/reset` | 開発用ログイン（開発サーバーだけ） |

## ログインとメンバーの確認

**ログイン**（`auth/oauth.ts`）。Discord の OAuth2 の認可コードの流れで、scope は `identify`（誰か）と `guilds`（どのサーバーにいるか）。`prompt=none` で、許可済みなら Discord の画面を出さずに戻る。state は HttpOnly の cookie（`/auth` だけ、10 分）で照合する。トークンを受け取ったら `/users/@me` と `/users/@me/guilds` を読み、**Discord のトークンは保存しない**。

**控えるサーバー**。参加しているサーバーのうち、卓予定のグループがあるサーバーと、本人が管理できる（オーナー・管理者・サーバー管理の権限がある）サーバーだけを `user_guilds` に控える。ほかのサーバーは覚えない。

**ログインの続き**（`auth/session.ts`）。ランダムな 32 バイトを cookie（`__Host-yoki_sid`、HttpOnly・Secure・SameSite=Lax）に入れ、D1 にはその SHA-256 だけを置く。期限は 30 日。手元（http://localhost）では Secure を付けられないので、名前を `yoki_sid` にする。

**グループに入れるか**（`auth/guard.ts`）。グループに結びつけた Discord サーバーが、控えにあれば入れる。

- 控えが 24 時間より古ければ、`/auth/login` に送って Discord に聞き直す（`prompt=none` なので、画面はほとんど出ない）。サーバーを抜けた人は、最長 24 時間で入れなくなる
- 控えにサーバーが無いとき、控えが 5 分より古ければ一度だけ聞き直す（そのあとサーバーに入った人のため）。新しければ 403
- Discord のトークンを持たないので、裏で Discord に問い合わせることはない。そのかわり、抜けた人を締め出すまでに時間差がある

**「あなた」はサーバーが決める**。ログインした人に結びついたメンバーが「あなた」（`Actor`）になる。初めて入ったときは、管理者が Discord ID 付きで先に登録していた行に結びつけ、無ければ Discord の表示名で新しく作る。画面から送られる名前は、誰のぶんを入れるかの指定にだけ使い、本人かどうかの判断には使わない。

**管理者**は、`members.is_admin` が付いた人と、そのサーバーの管理権限を持つ人。権限を持つ人はいつも管理者なので、管理者が 0 人になってグループを直せなくなることはない。

**CSRF**（`auth/csrf.ts`）。cookie は SameSite=Lax。GET 以外は、`Origin` か `Sec-Fetch-Site` が自分のときだけ受ける。`/api` は JSON だけを受ける。

## データベース（D1）

表の定義は `migrations/0001_init.sql`。日付（開催日・予定・メモ）は日本時間の `YYYY-MM-DD`、日時（〜した時刻）は UTC の ISO 文字列。

- `users`・`user_guilds`・`auth_sessions`: ログイン
- `groups`: グループと設定（Webhook・知らせの日時・各種の ON/OFF・卓の番号の続き）
- `members`: メンバー。名前はグループの中で一意
- `sessions`・`session_people`: 卓と、関わる人（GM・参加者・参加希望・興味あり）
- `availability`・`avail_notes`・`day_notes`・`poll_votes`・`series_notify`・`notify_log`
- `meta`: cron の「この時刻はもう回した」印

**メンバーは中では ID で持つ**。画面とのやり取りは GAS 版と同じく名前で行い、`domain/people.ts` で変換する。名前を変えても 1 か所を直すだけで済む（GAS 版では、名前の変更が一部の表に伝わらなかった）。メンバーに無い人（ゲスト）は、`guest_name` に名前だけで持つ。メンバーを消すと、その人が入っていた卓と回答はゲストの名前に置き換わり、予定とメモは消える。

**卓の ID** は画面には `S001` の形で見せる。グループごとの通し番号で、使った番号は使い直さない（S999 の次は S1000）。

## 画面からの呼び出し

`POST /api/g/:id/:fn` に、GAS 版と同じ形の form を JSON で送り、同じ形の返事（`{ ok, message, data }`）を返す。画面の `api()`（`src/client/console/api.ts`）は、`google.script.run` と同じ使い方のまま、通信だけを `fetch` に替えてある。

- 画面とサーバーの約束（呼べる関数の名前・画面データ `ConsoleData`・返事の形・卓の状態）は `src/shared/api.ts` に置き、両方から読む。サーバーの一覧（`routes/rpc.ts`）は名前の型で固めてあり、足りなくても多すぎても型の確認で止まる。`consoleData()` は `ConsoleData` を返すと書いてあるので、返す形が変わると型の確認で分かる
- `src/shared/` は、ブラウザの型も Workers の型も使わない（どちらからも読めるように）
- 管理者だけの関数は、サーバーの一覧に書く
- 書き込みの返事には、最新の画面データ（`data`）を付ける。画面は読み直さずに済む
- エラーは `{ error }`。`AUTH:` で始まればログインし直し（画面がそのまま `/auth/login` へ送る）、`ADMIN:` で始まれば管理者だけの操作

**読み込み**（`domain/load.ts`）。グループ 1 つ分を 1 回の `db.batch` で読む。開催日が過ぎた「開催」の卓を「終了」にする UPDATE も、同じ回に入れてある。

**書き込み**。読み込んだデータで確かめてから、1 回の `db.batch`（全部成功か全部失敗）で書く。GAS 版のロックは要らない（行番号がずれることが無いため）。同じ卓を 2 人が同時に直すと、あとから保存したほうが残る（GAS 版と同じ）。

**D1 の上限**。1 回の呼び出しで使える問い合わせの数に上限がある（無料のプランで 50）。卓の数だけ文を作らず、JSON の配列を `json_each` で展開して 1 文にまとめる（`domain/people.ts`・`domain/sessions.ts` のまとめての変更など）。

## Discord への送信

- 送り先（`discord/targets.ts`）: シリーズの専用チャンネル → 知らせの種類のチャンネル（開催前の知らせ・募集） → 基本のチャンネル、の順に選ぶ
- 送信（`discord/send.ts`）: 429・5xx・通信の切れは、3 秒・8 秒と待って 3 回まで送り直す（`Retry-After` を見て、最長 15 秒）。1 回ごとに `notify_log` に 1 行残す
- 画面からの送信は `sendDiscordStep`（`discord/step.ts`）で 1 回ずつ。待ちと送り直しは画面が回す（GAS 版と同じ）
- 回答そろい・日程決定は、回答や決定を受けたサーバーがその場で送る（画面を閉じられても届くように）
- Webhook の URL は Discord の形だけを受け付け、それ以外には送らない。画面には伏せた形だけを渡す
- サンプルのグループの Webhook（ID が全部 0）には送らず、送ったことにする

## 知らせの見回り（cron）

`domain/patrol.ts`。cron は 5 分おきに動く（時刻は UTC だが、中で日本時間に直して判断する）。

- **毎時の仕事**（開催前の知らせ・期間前の催促・過ぎた卓の自動終了）は、`meta` の印（`hourly` = `2026-10-10T20`）を進められたときだけ回す。5 分おきでも 1 時間に 1 回になり、見回りが重なっても抜けても大丈夫
- **開始直前の知らせ**は毎回見る
- **二重に送らない**。送る前に卓の印（`notified_at` など）を `UPDATE … WHERE … IS NULL RETURNING` で取り、取れた卓だけを送る。全部の送り先で失敗したら印を戻し、次の回で送り直す
- 開催前の知らせは、送り先と「あと何日」ごとに 1 通にまとめ、10 卓ごとに分ける（Discord の embed は 1 通に 10 個まで）
- 問い合わせは、送る卓のあるグループだけを読む
- 毎日 1 回（日本時間の 4 時以降）、期限切れのログイン、古い送信記録（グループごとに 500 件まで）、90 日より前の予定とメモ、1 年より前の日付メモを片付ける

## 日本時間

Workers は UTC で動く。日付と時刻はすべて `lib/jst.ts` で日本時間（UTC+9、夏時間なし）に直して扱い、暦日は `YYYY-MM-DD` の文字列のまま `Date.UTC` で計算する。`new Date(年, 月, 日)` や `getHours()` は使わない（`test/client/conventions.test.js` が確かめる）。

## 画面（src/client/）

TypeScript で書き、Vite が組み立てる。グループの画面は `console/main.ts` が入口で、画面ごとのファイルに分けてある。

| ファイル | 中身 |
|---|---|
| `state.ts` | 共有する状態（画面データ `D`・選んでいる日など）。書き換えは set〜 を通す |
| `api.ts`・`load.ts`・`render.ts` | 通信と Discord への送信、読み込みと自動更新、各タブを描き直す |
| `dom.ts`・`dates.ts`・`model.ts`・`notify.ts` | 小道具（要素・日付）と、卓の読み方・知らせの決まり（D から読むだけ） |
| `calendar.ts`・`day.ts`・`notices.ts`・`setup.ts` | カレンダーのタブ |
| `recruit.ts`・`poll.ts` | 募集・調整のタブと、候補日を選ぶ窓 |
| `avail.ts`・`avail-input.ts`・`ops.ts` | メンバーの予定のタブ（表とリスト・メモとまとめて入れる・卓をまとめて変える） |
| `form.ts`・`promote.ts` | 卓の登録・変更の窓 |
| `members.ts`・`settings.ts`・`series-notify.ts` | メンバーの登録と設定のタブ |
| `header.ts`・`tabs.ts`・`theme.ts`・`modal.ts`・`tips.ts` | 上の帯・タブ・見た目・窓・吹き出し |

- 各ファイルは関数と定数だけを持ち、読み込んだときには何もしない。イベントの登録は `init()` に書き、`main.ts` が順に呼ぶ。ファイルどうしが互いを呼ぶ（描き直しは別のタブの描き直しも呼ぶ）ので、読み込んだときに別のファイルの値を読むと、読み込みの順で壊れるため
- 押した瞬間に画面へ出し（D を書き換えて描き直す）、返事の `data` で本物に置き換える。失敗したら戻すか読み直す
- 画面は見る人の手元の暦で日付を扱う（今日は、サーバーが日本時間で決めた `D.today`）

## サイト（website/）

紹介と使い方のページは、アプリとは別に VitePress で組み立て、GitHub Pages に置く（Worker からは配らない）。アプリの「使い方」のボタンは、サイトを新しいタブで開く。

- 使い方の例（予定表・参加希望・日程調整・卓の登録）は Vue の部品で、押して試せる。例の日付は、見る人の手元の暦で「次の月曜」から数える。組み立てのときは決まった日で描き、ブラウザで数え直す（組み立てた HTML と食い違わないように）
- スクリーンショットは、開発サーバーのサンプルのグループで撮って（`npm run screenshots`）、リポジトリに入れる。サイトの組み立て（GitHub Actions）では、アプリを動かさない
- 検索は VitePress の手元の検索。日本語は語の間に空白が無いので、`Intl.Segmenter` で語に分けて索引を作る

## 開発とテスト

- `npm run dev`: Vite と Cloudflare のプラグインで、Worker とローカルの D1 ごと動く。開発用ログイン（`auth/dev.ts`）は `import.meta.env.DEV` のときだけ登録され、本番のビルドからは消える（組み立てた JS に残っていたら、vite.config.ts の `noDevLogin` が組み立てを止める）
- `npm test`: サーバーのテストは `@cloudflare/vitest-pool-workers` で、Workers の実行環境とローカルの D1 で動かす。テストごとに表を空にする。Discord への通信は `vi.spyOn(globalThis, 'fetch')` で差し替える
- `npm run e2e`: Playwright で、開発用ログインから卓の登録・日程調整の回答までを通す
