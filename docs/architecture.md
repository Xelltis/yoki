# 卓予定の作り

開発する人向けに、卓予定の作りと、そう決めた理由をまとめる。使う人向けの説明はサイト（`website/`、GitHub Pages）、手元で動かす方法と公開の手順は [README.md](../README.md) にある。

2026-10-03 に、Google Apps Script（GAS）＋スプレッドシートの版から作り直した。業務の決まり（卓の状態、参加希望の扱い、日程調整の流れなど）は GAS 版のまま移し、関数ごとに元の関数名をコメントに残してある。GAS 版のコードと文書（旧いガイド・セキュリティレビュー・UI の再設計案）は、git の `gas-final` タグで読める（`git show gas-final:src/server/Polls.js` など）。

## 全体

Worker 1 つで、次の 3 つを受け持つ。

- **画面**: `src/client` を Vite で組み立てた静的ファイル（Workers Static Assets）。`wrangler.jsonc` の `run_worker_first` にある道（`/api/*`・`/auth/*`・`/g/*`・`/dev/*`・`/admin`・`/admin/*`）だけ Worker が先に受ける。ここに無い道は、確かめずに静的ファイルとして配られる
- **API**: Hono（`src/worker/app.ts`）
- **知らせの見回り**: 5 分おきの cron（`scheduled`）

| 道 | 中身 |
|---|---|
| `/` | 入口（`src/client/index.html`）。`GET /api/me` でログインしているかを聞き、グループの一覧か「Discord でログイン」を出す |
| `/g/:id/` | グループのアプリ。入れる人には `console/index.html`（データの入っていない骨組み）を返す。データは画面が API で読む |
| `/g/:id/admin/` | グループの管理画面。同じ `console/index.html` を返し、画面が URL を見て管理の区域で開く。そのグループの管理者でなければ 403 の案内 |
| `/admin/` | 運営の管理画面（`operator/index.html`）。ログインしていなければ Discord ログインへ、運営者でなければ 403 の案内 |
| `/terms` `/privacy` | 利用規約とプライバシーポリシー。だれでも読める。Worker が D1 から本文を読み、その場で HTML にして返す（JS は使わない。`routes/html.ts` の `legalPage`） |
| `/auth/login` `/auth/callback` `POST /auth/logout` | Discord ログイン |
| `GET /api/me` `POST /api/groups` | 入口の画面が使う |
| `POST /api/g/:id/:fn` | 画面からの呼び出し |
| `GET` / `POST /api/admin/*` | 運営の管理画面が使う（下の「運営の管理画面」） |
| `POST /dev/login` `POST /dev/reset` | 開発用ログイン（開発サーバーだけ） |

## ログインとメンバーの確認

**ログイン**（`auth/oauth.ts`）。Discord の OAuth2 の認可コードの流れで、scope は `identify`（誰か）と `guilds`（どのサーバーにいるか）。`prompt=none` で、許可済みなら Discord の画面を出さずに戻る。state は HttpOnly の cookie（`/auth` だけ、10 分）で照合する。トークンを受け取ったら `/users/@me` と `/users/@me/guilds` を読み、**Discord のトークンは保存しない**。

**控えるサーバー**。参加しているサーバーのうち、卓予定のグループがあるサーバーと、本人が管理できる（オーナー・管理者・サーバー管理の権限がある）サーバーだけを `user_guilds` に控える。ほかのサーバーは覚えない。

**ログインの続き**（`auth/session.ts`）。ランダムな 32 バイトを cookie（`__Host-yoki_sid`、HttpOnly・Secure・SameSite=Lax）に入れ、D1 にはその SHA-256 だけを置く。期限は 30 日。手元（http://localhost）では Secure を付けられないので、名前を `yoki_sid` にする。

**グループに入れるか**（`auth/guard.ts`）。グループに結びつけた Discord サーバーが、控えにあれば入れる。

- 控えが 24 時間より古ければ、`/auth/login` に送って Discord に聞き直す（`prompt=none` なので、画面はほとんど出ない）。サーバーを抜けた人は、最長 24 時間で入れなくなる
- 控えにサーバーが無いとき、控えが 5 分より古ければ一度だけ聞き直す（そのあとサーバーに入った人のため）。新しければ 403
- ログインした人の Discord のトークンは持たないので、その人のサーバーの出入りを裏で問い合わせることはない。そのかわり、抜けた人を締め出すまでに時間差がある（知らせに使う Bot のトークンは別で、Worker の secret に置く）

**「あなた」はサーバーが決める**。ログインした人に結びついたメンバーが「あなた」（`Actor`）になる。初めて入ったときは、管理者が Discord ID 付きで先に登録していた行に結びつけ、無ければ Discord の表示名で新しく作る。予定・参加希望・日程調整の回答は、本人のぶんだけ入れられる（`requireSelf`。管理者も、ほかの人の代わりには入れない）。画面から送られる名前は、本人の名前と同じかを確かめるだけに使う。なので、ゲストと Discord の ID の無いメンバーは回答できず、日程調整の「全員そろった」は回答できる人（`pollVoters`）で数える。

**管理者**は、`members.is_admin` が付いた人と、そのサーバーの管理権限を持つ人。権限を持つ人はいつも管理者なので、管理者が 0 人になってグループを直せなくなることはない。

**締め出し**。運営者が締め出した人は、`users.banned_at` に日時が入る。

- `/auth/callback`（と開発用ログイン）は、プロフィールを書く前に見て、`/?login=banned` へ返す
- `currentViewer` は締め出した人を「ログインしていない」として扱う。締め出す前に持っていた cookie も効かない（締め出すときに、その人のログインも消す）
- users の行は消さない（印がそこにあるため）。Discord のユーザー ID は使い回されないので印は保てるが、別のアカウントは止められない

**運営者**（`auth/operator.ts`）。`OPERATOR_IDS`（Worker の secret。カンマか空白で区切る）に書いた Discord ユーザー ID の人。開発サーバーでは、手元（localhost）から開いたときだけ、開発用ログインのひよりも運営者になる。運営者は締め出せない。

**CSRF**（`auth/csrf.ts`）。cookie は SameSite=Lax。GET 以外は、`Origin` か `Sec-Fetch-Site` が自分のときだけ受ける。`/api` は JSON だけを受ける。

## データベース（D1）

表の定義は `migrations/`（`0001_init.sql` が最初の形、`0002_admin.sql` が締め出し・最後に使われた日と索引）。日付（開催日・予定・メモ）は日本時間の `YYYY-MM-DD`、日時（〜した時刻）は UTC の ISO 文字列。

- `users`・`user_guilds`・`auth_sessions`: ログイン。`users.banned_at`・`banned_reason` は締め出し
- `groups`: グループと設定（知らせのチャンネル・知らせの日時・各種の ON/OFF・卓の番号の続き）。`last_used_at` は最後に使われた日時（画面から呼ばれるたびに、10 分に 1 回まで書き換える）
- `members`: メンバー。名前はグループの中で一意
- `sessions`・`session_people`: 卓と、関わる人（GM・参加者・参加希望・興味あり）
- `availability`・`avail_notes`・`day_notes`・`poll_votes`・`series_notify`・`notify_log`
- `meta`: cron の「この時刻はもう回した」印、最後の見回りの記録、新規登録の受付（`registration`）、利用規約とプライバシーポリシー（`legal_operator`・`legal_contact`・直した本文の `legal_terms`・`legal_privacy`）

**メンバーは中では ID で持つ**。画面とのやり取りは GAS 版と同じく名前で行い、`domain/people.ts` で変換する。名前を変えても 1 か所を直すだけで済む（GAS 版では、名前の変更が一部の表に伝わらなかった）。メンバーに無い人（ゲスト）は、`guest_name` に名前だけで持つ。メンバーを消すと、その人が入っていた卓と回答はゲストの名前に置き換わり、予定とメモは消える。

グループを消すと、中身（メンバー・卓・予定・メモ・回答・送信の記録）は、表の決まり（`ON DELETE CASCADE`）で一緒に消える。

**卓の ID** は画面には `S001` の形で見せる。グループごとの通し番号で、使った番号は使い直さない（S999 の次は S1000）。

## 画面からの呼び出し

`POST /api/g/:id/:fn` に、GAS 版と同じ形の form を JSON で送り、同じ形の返事（`{ ok, message, data }`）を返す。画面の `api()`（`src/client/console/api.ts`）は、`google.script.run` と同じ使い方のまま、通信だけを `fetch` に替えてある。

- 画面とサーバーの約束（呼べる関数の名前・画面データ `ConsoleData`・返事の形・卓の状態）は `src/shared/api.ts` に置き、両方から読む。サーバーの一覧（`routes/rpc.ts`）は名前の型で固めてあり、足りなくても多すぎても型の確認で止まる。`consoleData()` は `ConsoleData` を返すと書いてあるので、返す形が変わると型の確認で分かる
- `src/shared/` は、ブラウザの型も Workers の型も使わない（どちらからも読めるように）
- 管理者だけの関数は、サーバーの一覧に書く
- 書き込みの返事には、最新の画面データ（`data`）を付ける。画面は読み直さずに済む。グループを消す `deleteGroup` だけは付けない（消したあとは読めないため）
- エラーは `{ error }`。`AUTH:` で始まればログインし直し（画面がそのまま `/auth/login` へ送る）、`ADMIN:` で始まれば管理者だけの操作、`GONE:` で始まればグループが消えた（画面は控えを消し、自動の読み直しを止めて、入口へのリンクを出す。ほかのタブで消されたとき）

**読み込み**（`domain/load.ts`）。グループ 1 つ分を 1 回の `db.batch` で読む。開催日が過ぎた「開催」の卓を「終了」にする UPDATE も、同じ回に入れてある。

**書き込み**。読み込んだデータで確かめてから、1 回の `db.batch`（全部成功か全部失敗）で書く。GAS 版のロックは要らない（行番号がずれることが無いため）。同じ卓を 2 人が同時に直すと、あとから保存したほうが残る（GAS 版と同じ）。

**D1 の上限**。1 回の呼び出しで使える問い合わせの数に上限がある（無料のプランで 50）。卓の数だけ文を作らず、JSON の配列を `json_each` で展開して 1 文にまとめる（`domain/people.ts`・`domain/sessions.ts` のまとめての変更など）。

## Discord への送信

知らせは、卓予定の Bot（ログインと同じ Discord アプリの Bot）が、チャンネルにメッセージを書いて送る。Webhook は使わない。

- **Bot**: トークンは Worker の secret（`DISCORD_BOT_TOKEN`）。Gateway には繋がず、REST だけを使う（送る: `POST /channels/{id}/messages`、読む: `GET /guilds/{id}/channels`・`GET /channels/{id}`）。小道具は `discord/channel.ts`
- **Bot を招く**: グループの管理者が、管理画面の「知らせ」から自分のサーバーに招く。招く URL は、Client ID とグループのサーバーから作る（`botInviteUrl`。求める権限は、チャンネルを見る・メッセージを送る・埋め込みリンク）。Bot は公開（Public Bot）
- **送り先はチャンネルの ID**: `groups.channel_id`（基本）・`remind_channel_id`・`recruit_channel_id`（種類ごと。空なら基本）・`series_notify.channel_id`（シリーズ専用）
  - 選ぶ: 管理画面が `getDiscordChannels` で、送り先にできるチャンネル（テキストとアナウンス）の一覧を読む
  - 保存する: サーバーで Bot に `GET /channels/{id}` を聞き、グループのサーバーのチャンネルであることを確かめる。Bot はほかのサーバーにもいるので、そのチャンネルには送らせない
- 送り先（`discord/targets.ts`）: シリーズの専用チャンネル → 知らせの種類のチャンネル（開催前の知らせ・募集） → 基本のチャンネル、の順に選ぶ。同じチャンネルは 1 つにまとめる
- 送信（`discord/send.ts`）
  - 429・5xx・通信の切れは、3 秒・8 秒と待って 3 回まで送り直す（`Retry-After` を見て、最長 15 秒）。1 回ごとに `notify_log` に 1 行残す
  - 本文に `allowed_mentions: { parse: ['users'] }` を付ける。メモに書かれた @everyone などで、全員に通知が飛ばないようにする
  - 失敗の種類: 401（Bot のトークン）・403（チャンネルの権限）・404（チャンネルが無いか、Bot が外された）・429・5xx・400・通信
- 画面からの送信は `sendDiscordStep`（`discord/step.ts`）で 1 回ずつ。待ちと送り直しは画面が回す（GAS 版と同じ）
- 回答そろい・日程決定は、回答や決定を受けたサーバーがその場で送る（画面を閉じられても届くように）
- サンプルのグループのチャンネル（ID が全部 0）には送らず、送ったことにする（開発用ログインとスクリーンショットのため）

## 知らせの見回り（cron）

`domain/patrol.ts`。cron は 5 分おきに動く（時刻は UTC だが、中で日本時間に直して判断する）。

- **毎時の仕事**（開催前の知らせ・期間前の催促・過ぎた卓の自動終了）は、`meta` の印（`hourly` = `2026-10-10T20`）を進められたときだけ回す。5 分おきでも 1 時間に 1 回になり、見回りが重なっても抜けても大丈夫
- **開始直前の知らせ**は毎回見る
- **二重に送らない**。送る前に卓の印（`notified_at` など）を `UPDATE … WHERE … IS NULL RETURNING` で取り、取れた卓だけを送る。全部の送り先で失敗したら印を戻し、次の回で送り直す
- 開催前の知らせは、送り先と「あと何日」ごとに 1 通にまとめ、10 卓ごとに分ける（Discord の embed は 1 通に 10 個まで）
- 問い合わせは、送る卓のあるグループだけを読む
- 毎日 1 回（日本時間の 4 時以降）、期限切れのログイン、古い送信記録（グループごとに 500 件まで）、90 日より前の予定とメモ、1 年より前の日付メモを片付ける
- 回ごとに、`runPatrol` が `meta` の `patrol`（時刻・かかった時間・成否・エラー）と、うまくいったら `patrol_ok_at` を書く。失敗は投げ直す（Cloudflare の cron の失敗としても残る）。記録が書けなくても、見回りの結果は変えない

## 運営の管理画面

公開した人（運営者）が、すべてのグループと利用者を見渡し、困ったときに手を入れる場所。API は `routes/admin.ts`、中身は `domain/admin.ts`、画面とサーバーの型は `src/shared/admin.ts`。

| 道 | 中身 |
|---|---|
| `GET /api/admin/overview` | 数（グループ・利用者・有効なログイン・動いている卓）、見回りの様子、24 時間と 7 日の送信の失敗の数、最近の失敗（全グループで 50 件） |
| `GET /api/admin/groups` `GET /api/admin/groups/:id` | グループの一覧と、メンバー（名前・ログインした人・管理者か・最後のログイン）を加えた中身 |
| `POST /api/admin/groups/:id/admins` | 管理者の印を付け外しする。まだ開いていない人も、Discord ID で管理者として足せる。印が 0 人になる外し方は断る |
| `POST /api/admin/groups/:id/guild` | Discord サーバーを付け替える。メンバーの行・管理者の印は残す。知らせのチャンネルは古いサーバーのものなので、いつも外す |
| `POST /api/admin/groups/:id/delete` | グループを消す。名前を打ち込んで、一致したときだけ |
| `GET /api/admin/users` `POST /api/admin/users/:id/logout` `POST /api/admin/users/:id/ban` | 利用者の一覧、ログインを切る、締め出す・戻す |
| `POST /api/admin/users/:id/delete` | 利用者を消す（本人から頼まれたとき）。users の行（ログインとサーバーの控えは表の決まりで一緒に消える）と、どのグループでもその人のメンバーの行（`user_id` か `discord_id` が同じもの）を消し、グループの `created_by` を空にする。メンバーの行の消し方はグループの管理者がメンバーを消すときと同じ（予定とメモは消え、卓と回答はゲストの名前になる）。運営者と、締め出している人（消すと印も消える）は断る |
| `POST /api/admin/registration` | 新規登録を受け付ける・止める（`{open}`） |
| `GET /api/admin/legal` `POST /api/admin/legal` | 利用規約とプライバシーポリシーの、運営者の名前・問い合わせ先・本文を読む・保存する（`{operator?, contact?, terms?, privacy?}`。省いたものは変えない） |

- どの道も、ログインしていなければ `AUTH:` の 401、運営者でなければ 403。返事は `Cache-Control: no-store`
- 読むものは GET、変えるものは POST（JSON）。CSRF の確かめは `/api` のほかの道と同じ
- 変えた操作は、`{"audit":"operator",…}` の JSON 1 行を log に出す（Workers の Observability に残る監査の控え）。グループの管理者がグループを消したときも `{"audit":"group-admin",…}` を出す
- 運営者は、グループの中身（卓・予定）は見ない。見るのは数と名前だけ
- 送信の失敗に数えるのは、`送信失敗` と `送らず` で始まる記録だけ（`HTTP…`・`ERROR…` は送り直しの途中）
- 見回りは、最後の回が 15 分より前なら止まっているかもしれない、として出す
- 新規登録の受付（`domain/registration.ts`）。止めると、グループを作る道（`POST /api/groups`）と、初めての人のログイン（`/auth/callback`・開発用ログイン。users に行が無い人）を断る。もう使っている人と運営者は通す。運営者が自分を締め出さないように、運営者はいつでも入れて、グループも作れる。画面には `/api/me` の `registration` で知らせる
- 利用規約とプライバシーポリシー（`domain/legal.ts`）。既定の文（`domain/legal-text.ts`）は、このリポジトリのままの卓予定に合わせて書いてあり、アプリの作りが変わってずれたら直す。運営者が本文を直すと `meta` に保存し、直していなければ既定の文を出す（既定の文を直せば、直していない公開先にもそのまま出る）。本文を空か既定の文と同じにして保存すると、既定の文に戻る。本文の書き方は見出し・箇条書き・段落・リンクだけで、HTML はそのまま文字で出す（`lib/markup.ts`）
- Discord サーバーを付け替えると、新しいサーバーの人は、控えが 5 分より古くなったときに黙って読み直して入れるようになり、古いサーバーの人は入れなくなる

## 日本時間

Workers は UTC で動く。日付と時刻はすべて `lib/jst.ts` で日本時間（UTC+9、夏時間なし）に直して扱い、暦日は `YYYY-MM-DD` の文字列のまま `Date.UTC` で計算する。`new Date(年, 月, 日)` や `getHours()` は使わない（`test/client/conventions.test.js` が確かめる）。

## 画面（src/client/）

TypeScript で書き、Vite が組み立てる。ページは 3 つ: 入口（`index.html`・`home.ts`）、グループの画面（`console/`）、運営の管理画面（`operator/`。console の `dom.ts`・`modal.ts` と見た目を借りる）。グループの画面は `console/main.ts` が入口で、画面ごとのファイルに分けてある。

**区域**（`area.ts`）。グループの画面は、1 つのページを URL で 2 つの区域に分ける。`/g/:id/` はふだんの区域（カレンダー・募集・調整・メンバーの予定・設定のタブ）、`/g/:id/admin/` は管理の区域（メンバーの登録・卓をまとめて変える・知らせ・この卓予定・管理者・送信の記録・グループを消す）。`body[data-area]` を置き、見せる・隠すは CSS で切り替える。描く処理は全部の要素を ID で触るので、ページを分けずに、同じ HTML のまま区域を分けている。管理の区域の区分は、URL の `#members` などで直接開ける。

| ファイル | 中身 |
|---|---|
| `state.ts` | 共有する状態（画面データ `D`・選んでいる日など）。書き換えは set〜 を通す |
| `api.ts`・`load.ts`・`render.ts` | 通信と Discord への送信、読み込みと自動更新、各タブを描き直す |
| `dom.ts`・`dates.ts`・`model.ts`・`notify.ts` | 小道具（要素・日付）と、卓の読み方・知らせの決まり（D から読むだけ） |
| `calendar.ts`・`day.ts`・`notices.ts`・`setup.ts` | カレンダーのタブ |
| `recruit.ts`・`poll.ts` | 募集・調整のタブと、候補日を選ぶ窓 |
| `avail.ts`・`avail-input.ts`・`ops.ts` | メンバーの予定のタブ（表とリスト・メモとまとめて入れる）と、卓をまとめて変える（管理の区域） |
| `form.ts`・`promote.ts` | 卓の登録・変更の窓 |
| `members.ts`・`settings.ts`・`series-notify.ts` | 設定のタブ（自分の名前と備考・この端末）と、管理の区域の区分（メンバーの登録・知らせ・管理者・送信の記録・グループを消す） |
| `area.ts`・`header.ts`・`tabs.ts`・`theme.ts`・`modal.ts`・`tips.ts` | 区域・上の帯・タブ・見た目・窓・吹き出し |

- 各ファイルは関数と定数だけを持ち、読み込んだときには何もしない。イベントの登録は `init()` に書き、`main.ts` が順に呼ぶ。ファイルどうしが互いを呼ぶ（描き直しは別のタブの描き直しも呼ぶ）ので、読み込んだときに別のファイルの値を読むと、読み込みの順で壊れるため
- 押した瞬間に画面へ出し（D を書き換えて描き直す）、返事の `data` で本物に置き換える。失敗したら戻すか読み直す
- 画面は見る人の手元の暦で日付を扱う（今日は、サーバーが日本時間で決めた `D.today`）

## サイト（website/）

紹介と使い方のページは、アプリとは別に VitePress で組み立て、GitHub Pages に置く（Worker からは配らない）。アプリの「使い方」のボタンは、サイトを新しいタブで開く。

- 使い方の例（予定表・参加希望・日程調整・卓の登録）は Vue の部品で、押して試せる。例の日付は、見る人の手元の暦で「次の月曜」から数える。組み立てのときは決まった日で描き、ブラウザで数え直す（組み立てた HTML と食い違わないように）
- スクリーンショットは、開発サーバーのサンプルのグループで撮って（`npm run screenshots`）、リポジトリに入れる。サイトの組み立て（GitHub Actions）では、アプリを動かさない
- アイコンは、元の絵 `brand/yoki.png` 1 枚から `npm run icons`（`website/tools/icons.js`）で書き出し、アプリとサイトの `public/` に同じものを置く。ブラウザ（Playwright）の canvas で縮め、ICO は PNG を詰めて Node で作る。どのページの頭のタグも同じファイルを指す（Worker のページは `routes/html.ts` の `HEAD_ICONS`。テストが確かめる）。manifest の `display` は `browser`（ホーム画面から開いても、Discord のログインがふつうのブラウザで進むように）
- 検索は VitePress の手元の検索。日本語は語の間に空白が無いので、`Intl.Segmenter` で語に分けて索引を作る

## 開発とテスト

- `npm run dev`: Vite と Cloudflare のプラグインで、Worker とローカルの D1 ごと動く。開発用ログイン（`auth/dev.ts`）は `import.meta.env.DEV` のときだけ登録され、本番のビルドからは消える（組み立てた JS に残っていたら、vite.config.ts の `noDevLogin` が組み立てを止める）
- `npm test`: サーバーのテストは `@cloudflare/vitest-pool-workers` で、Workers の実行環境とローカルの D1 で動かす。テストごとに表を空にする。Discord への通信は `vi.spyOn(globalThis, 'fetch')` で差し替える
- `npm run e2e`: Playwright で、開発用ログインから卓の登録・日程調整の回答、グループの管理画面、グループを消す、運営の管理画面（ログインを切る・締め出す）までを通す

## 公開

アプリは GitHub Actions（`.github/workflows/deploy.yml`）が、main にアプリの変更が入ったときに公開する。

- OSS として、公開する Cloudflare ごとに違う値はリポジトリに置かない。`wrangler.jsonc` には仮の値（D1 の ID は 0 が並んだもの、APP_URL と DISCORD_CLIENT_ID は空）だけを置き、手元の開発とテストはそのまま動く
- 本番の値は GitHub の environment「production」に置く。組み立てのとき、`vite.config.ts` が環境変数（`YOKI_D1_DATABASE_ID`・`YOKI_APP_URL`・`YOKI_DISCORD_CLIENT_ID`）を、組み立てた設定（`dist/yoki/wrangler.json`）に入れる。`YOKI_DEPLOY=1` のときに欠けていたら、組み立てを止める（仮の値のまま公開しないように）
- 秘密の値（`DISCORD_CLIENT_SECRET`・`DISCORD_BOT_TOKEN`）と運営者の ID（`OPERATOR_IDS`）は vars に置かず、Worker の secret にする。公開のたびに `wrangler deploy --secrets-file` で版と一緒に送る。vars は公開のログに出るため（公開のリポジトリでは、Actions のログはだれでも読める）
- マイグレーションと公開は、どちらも組み立てた設定（`--config dist/yoki/wrangler.json`）で行う
- wrangler には D1 の ID を省くと自動で作る機能もあるが、試験中で、マイグレーションとの順番も合わないので使わない

**前に CDN を置くとき**（`auth/origin.ts`）。ドメインの DNS を Cloudflare に移さずに独自のドメインで公開するときは、AWS CloudFront などを前に置き、workers.dev のアドレスへ渡す。

- CDN は Host を workers.dev にして渡すので、Worker に届く要求のアドレスは workers.dev のままになる。自分のアドレス（Discord ログインの戻り先・知らせのリンク・CSRF で受ける Origin）は、`APP_URL` を正とする（`appOrigin`）。CSRF は、届いた要求のアドレスと `APP_URL` の両方を「自分」として受ける
- cookie は Domain を付けないので、ブラウザが開いたドメイン（CDN のドメイン）に付く。CDN は cookie をそのまま渡す
- workers.dev へじかに来た要求も、そのまま受ける（CDN からの要求と見分けない）。ログインの戻り先と cookie は公開のアドレスに結びつくので、workers.dev のままでは使えない（ログインの途中の情報が workers.dev の cookie に残り、戻り先で見つからない）。使う人を絞るのは、新規登録の受付で行う
