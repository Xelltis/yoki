# 卓予定の作り

開発する人向けに、卓予定の作りと、そう決めた理由をまとめる。使う人向けの説明はサイト（`website/`、GitHub Pages）、手元で動かす方法と公開の手順は [README.md](../README.md) にある。

2026-10-03 に、Google Apps Script（GAS）＋スプレッドシートの版から作り直した。業務の決まり（卓の状態、参加希望の扱い、日程調整の流れなど）は GAS 版のまま移し、関数ごとに元の関数名をコメントに残してある。GAS 版のコードと文書（旧いガイド・セキュリティレビュー・UI の再設計案）は、git の `gas-final` タグで読める（`git show gas-final:src/server/Polls.js` など）。

## 全体

Worker 1 つで、次の 3 つを受け持つ。

- **画面**: `src/client` を Vite で組み立てた静的ファイル（Workers Static Assets）。`wrangler.jsonc` の `run_worker_first` にある道（`/api/*`・`/auth/*`・`/g/*`・`/dev/*`・`/admin`・`/admin/*`・`/terms`・`/privacy`・`/cal/*`）だけ Worker が先に受ける。ここに無い道は、確かめずに静的ファイルとして配られる
- **API**: Hono（`src/worker/app.ts`）
- **知らせの見回り**: 5 分おきの cron（`scheduled`）

| 道 | 中身 |
|---|---|
| `/` | 入口（`src/client/index.html` と React の `features/home/`）。`GET /api/me` でログインしているかを聞き、グループの一覧か「Discord でログイン」を出す |
| `/g/:id/` と `/g/:id/<タブ>/` | グループの画面。入れる人には、入口と同じ骨組み（`index.html`。データは入っていない）を返す。中身は画面の道が決め、データは画面が API で読む。リンクの中身を読みに来たもの（Discord など）には、ログインへ送らずに骨組みを返す（下の「リンクの見た目」） |
| `/g/:id/admin/` と `/g/:id/admin/<区分>/` | グループの管理画面。同じ骨組みを返す。そのグループの管理者でなければ 403 の案内 |
| `/admin/` と `/admin/<区分>/` | 運営の管理画面。同じ骨組みを返す（控えさせない）。ログインしていなければ Discord ログインへ、運営者でなければ 403 の案内 |
| `/terms` `/privacy` | 利用規約とプライバシーポリシー。だれでも読める。Worker が D1 から本文を読み、その場で HTML にして返す（JS は使わない。`routes/html.ts` の `legalPage`） |
| `/auth/login` `/auth/callback` `POST /auth/logout` | Discord ログイン |
| `GET /api/me` `POST /api/groups` | 入口の画面が使う |
| `POST /api/g/:id/:fn` | 画面からの呼び出し |
| `GET` / `POST /api/admin/*` | 運営の管理画面が使う（下の「運営の管理画面」） |
| `GET /cal/<token>.ics` | 購読 URL（iCalendar）。ログインせずに読む（下の「カレンダーとの連携」） |
| `/auth/google/start` `/auth/google/login` `/auth/google/callback` | Google カレンダーとの連携と、Google でのログイン（OAuth） |
| `POST /dev/login` `POST /dev/reset` | 開発用ログイン（開発サーバーだけ）。`/dev/reset` は、開発用の人の Google 連携と偽の Google の中身も消す |
| `/dev/google/authorize` `/dev/google/state` `POST /dev/google/busy` | 開発用の偽の Google（開発サーバーで Google の値が空のときだけ） |

**リンクの見た目（OGP）**。リンクを Discord などに貼ると、貼られた側がページを読みに来て、題・説明・画像を出す。
- 画面の骨組み（`index.html`）に、卓予定の題・一言・画像（`/og.png`。`npm run og-image` がサイトと同じ画像を書き出す）のタグを置く。画像の URL は、組み立てのときに公開するアドレス（`YOKI_APP_URL`）を入れて、省かない形にする（`vite.config.ts` の `appOrigin`）
- 読みに来たものはログインしないので、グループの画面と運営の管理画面はログインへ送られ、Discord のログインのページの見た目が出てしまう。User-Agent で見分け（`routes/og.ts` の `isPreviewBot`）、ログインへ送らずに骨組みを返し、タグを道ごとの文に書き換える。骨組みにはグループの中身が無く、グループの名前も出さない（「卓予定のグループ」）。見分けを外れても、ふつうの人と同じくログインへ送られるだけ
- 利用規約とプライバシーポリシー（`routes/html.ts`）も、同じタグを付ける

## ログインとメンバーの確認

**ログイン**（`auth/oauth.ts`）。Discord の OAuth2 の認可コードの流れで、scope は `identify`（誰か）と `guilds`（どのサーバーにいるか）。`prompt=none` で、許可済みなら Discord の画面を出さずに戻る。state は HttpOnly の cookie（`/auth` だけ、10 分）で照合する。トークンを受け取ったら `/users/@me` と `/users/@me/guilds` を読み、**Discord のトークンは保存しない**。

**控えるサーバー**。参加しているサーバーのうち、卓予定のグループがあるサーバーと、本人が管理できる（オーナー・管理者・サーバー管理の権限がある）サーバーだけを `user_guilds` に控える。ほかのサーバーは覚えない。

**ログインの続き**（`auth/session.ts`）。ランダムな 32 バイトを cookie（`__Host-yoki_sid`、HttpOnly・Secure・SameSite=Lax）に入れ、D1 にはその SHA-256 だけを置く。期限は 30 日。手元（http://localhost）では Secure を付けられないので、名前を `yoki_sid` にする。

**Google でログイン**（`auth/google-login.ts`・`routes/google.ts`）。利用者そのものは Discord のアカウント（`users`）のままで、Google のアカウントは結びつけたもう 1 つの入り口（`google_logins`。人ごとに 1 つ、Google のアカウントごとに 1 人）。
- `/auth/google/login` から Google の OAuth2（scope は `openid email`、`prompt=select_account`）。戻ってくる先はカレンダーの連携と同じ `/auth/google/callback` で、state の cookie（`yoki_glogin`）で見分ける。id_token は Google のトークンの窓口から直接受け取るので署名は確かめず、`aud` が自分のクライアント ID かを確かめて、`sub`（Google のアカウントの ID）を使う
- 結びついている `sub` なら、その人でログインする（締め出された人は断る）。初めての `sub` は、`sub` とメールを暗号にした cookie（`__Host-yoki_glink`。10 分）に控えて入口へ戻し、続けて Discord でログイン（開発用ログインも）したあとに結びつける。cookie は `GOOGLE_TOKEN_KEY` の AES-GCM なので、書き換えて人の Google のアカウントを結びつけることはできない。`__Host-` なので、ほかのサブドメインから差し込むこともできない
- 控えを使うのは、結びつけるために押したログインだけ（入口が `/auth/login?link_google=1` と、開発用ログインの `link_google` を付ける。Discord のログインでは state の cookie に控える）。黙って行う聞き直しのログインでは使わず、ログアウトでは控えも消す。共用の端末で、前の人の Google のアカウントが次の人に結びつかないように
- ログインしている人は、設定の画面の「ログインの方法」から結びつけ（`?link=1`。始めた人と戻ってきた人が同じか確かめる）、外せる（`unlinkGoogleLogin`）。ほかの人に結びついている Google のアカウントは断る

**グループに入れるか**（`auth/guard.ts`）。グループに結びつけた Discord サーバーが、控えにあれば入れる。

- 控え（ログインのときに読んだサーバーの一覧か、Bot で確かめた日時）が 24 時間より新しければ、控えで決める
- 古い・控えにサーバーが無いときは、知らせの Bot がそのサーバーにいれば、Bot に聞く（`discord/member.ts`。サーバーのメンバーを 1 人読むだけなので、Gateway の特別な権限は要らない）。いれば入れ、確かめた日時を `user_guilds.checked_at` に残す（管理できるかは、オーナーか、ロールの権限に管理者・サーバー管理があるかで決める）。いなければ 403 にして控えからも外す。Google でログインした人を、Discord のログインの画面へ送らずに済ませるため
- Bot がいない・Discord が答えないときは、今までどおり。控えが 24 時間より古ければ `/auth/login` に送って Discord に聞き直す（`prompt=none` なので、画面はほとんど出ない）。控えにサーバーが無いとき、控えが 5 分より古ければ一度だけ聞き直し（そのあとサーバーに入った人のため）、新しければ 403
- ログインした人の Discord のトークンは持たないので、裏で問い合わせるのは Bot がいるサーバーだけ。Bot がいないサーバーでは、抜けた人を締め出すまでに最長 24 時間の時間差がある（知らせに使う Bot のトークンは別で、Worker の secret に置く）
- グループを作るとき（管理できるサーバーの一覧）は、今までどおり新しい Discord のログインが要る

**「あなた」はサーバーが決める**。ログインした人に結びついたメンバーが「あなた」（`Actor`）になる。初めて入ったときは、管理者が Discord ID 付きで先に登録していた行に結びつけ、無ければ Discord の表示名で新しく作る。予定・参加希望・日程調整の回答は、本人のぶんだけ入れられる（`requireSelf`。管理者も、ほかの人の代わりには入れない）。画面から送られる名前は、本人の名前と同じかを確かめるだけに使う。なので、ゲストと Discord の ID の無いメンバーは回答できず、日程調整の「全員そろった」は回答できる人（`pollVoters`）で数える。

**管理者**は、`members.is_admin` が付いた人と、そのサーバーの管理権限を持つ人。権限を持つ人はいつも管理者なので、管理者が 0 人になってグループを直せなくなることはない。

**締め出し**。運営者が締め出した人は、`users.banned_at` に日時が入る。

- `/auth/callback`（と開発用ログイン）は、プロフィールを書く前に見て、`/?login=banned` へ返す
- `currentViewer` は締め出した人を「ログインしていない」として扱う。締め出す前に持っていた cookie も効かない（締め出すときに、その人のログインも消す）
- users の行は消さない（印がそこにあるため）。Discord のユーザー ID は使い回されないので印は保てるが、別のアカウントは止められない

**運営者**（`auth/operator.ts`）。`OPERATOR_IDS`（Worker の secret。カンマか空白で区切る）に書いた Discord ユーザー ID の人。開発サーバーでは、手元（localhost）から開いたときだけ、開発用ログインのひよりも運営者になる。運営者は締め出せない。

**CSRF**（`auth/csrf.ts`）。cookie は SameSite=Lax。GET 以外は、`Origin` か `Sec-Fetch-Site` が自分のときだけ受ける。`/api` は JSON だけを受ける。

## データベース（D1）

表の定義は `migrations/`（`0001_init.sql` が最初の形、`0002_admin.sql` が締め出し・最後に使われた日と索引、`0003_bot.sql` が知らせの Bot、`0004_calendar.sql` がカレンダーとの連携、`0005_member_check.sql` が Bot で確かめた日時、`0006_google_login.sql` が Google でのログイン）。日付（開催日・予定・メモ）は日本時間の `YYYY-MM-DD`、日時（〜した時刻）は UTC の ISO 文字列。

- `users`・`user_guilds`・`auth_sessions`: ログイン。`users.banned_at`・`banned_reason` は締め出し
- `groups`: グループと設定（知らせのチャンネル・知らせの日時・各種の ON/OFF・卓の番号の続き）。`last_used_at` は最後に使われた日時（画面から呼ばれるたびに、10 分に 1 回まで書き換える）
- `members`: メンバー。名前はグループの中で一意
- `sessions`・`session_people`: 卓と、関わる人（GM・参加者・参加希望・興味あり）
- `availability`・`avail_notes`・`day_notes`・`poll_votes`・`series_notify`・`notify_log`
- `meta`: cron の「この時刻はもう回した」印、最後の見回りの記録、新規登録の受付（`registration`）、利用規約とプライバシーポリシー（`legal_operator`・`legal_contact`・直した本文の `legal_terms`・`legal_privacy`）。開発サーバーでは偽の Google の中身（`dev_google`）も
- `calendar_feeds`: 購読 URL（人とグループの組で 1 つ。token・載せる卓・最後に読まれた日時）
- `google_links`: Google カレンダーとの連携（人ごと。メール・暗号にした refresh token・書き込み／読み込みの ON と OFF・印を決める時間帯・最後に回った日時と失敗）
- `google_events`: Google に書き込んだ予定（人と卓ごとの予定の ID と中身の要約）。卓や連携が消えても Google の予定を消すまで覚えておくので、外部キーにしない
- `google_logins`: Google でのログイン（Google のアカウントの ID・メール → 利用者）。`user_guilds.checked_at` は、そのサーバーにいることを Bot で確かめた日時
- `google_dismissed`: Google の予定から入った印を、本人が消した日（その日には、もう入れない）。`availability.source` は、本人が入れた印なら空、Google の予定から入れた印なら `google`

**メンバーは中では ID で持つ**。画面とのやり取りは GAS 版と同じく名前で行い、`domain/people.ts` で変換する。名前を変えても 1 か所を直すだけで済む（GAS 版では、名前の変更が一部の表に伝わらなかった）。メンバーに無い人（ゲスト）は、`guest_name` に名前だけで持つ。メンバーを消すと、その人が入っていた卓と回答はゲストの名前に置き換わり、予定とメモは消える。

グループを消すと、中身（メンバー・卓・予定・メモ・回答・送信の記録）は、表の決まり（`ON DELETE CASCADE`）で一緒に消える。

**卓の ID** は画面には `S001` の形で見せる。グループごとの通し番号で、使った番号は使い直さない（S999 の次は S1000）。

## 画面からの呼び出し

`POST /api/g/:id/:fn` に、GAS 版と同じ形の form を JSON で送り、同じ形の返事（`{ ok, message, data }`）を返す。画面は `rpc()`（`src/client/features/console/api/rpc.ts`）で呼び、読み込みと書き込みの順番は `ConsoleSync`（同じフォルダの `sync.ts`。下の「画面」）が整える。

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
- Google カレンダーと連携している人を、長く回っていない人から 5 人ずつ同期する（卓の書き込みと、1 時間おきの予定の読み込み。下の「カレンダーとの連携」）。毎日の片付けでは、90 日より前の「消した日」の記録と、連携が無くなった人・過ぎた卓の、書いた予定の控えも消す
- 回ごとに、`runPatrol` が `meta` の `patrol`（時刻・かかった時間・成否・エラー）と、うまくいったら `patrol_ok_at` を書く。失敗は投げ直す（Cloudflare の cron の失敗としても残る）。記録が書けなくても、見回りの結果は変えない

## カレンダーとの連携

卓を、ふだん使っているカレンダーに出す。どれも、設定の画面の「カレンダー連携」（`settings/CalendarCard.tsx`）から、本人だけが使う。

**購読 URL**（`domain/calendar.ts`・`routes/calendar.ts`・`lib/ics.ts`）。`/cal/<token>.ics` の iCalendar を、カレンダーのアプリ（Google カレンダーの「URL で追加」など）がログインせずに読む。

- token は 32 バイトのランダム（43 文字）で、人とグループの組ごとに 1 つ。作り直すと token が変わり、前の URL は 404 になる。止めると消える
- 読めるのは、作った人がまだそのグループのメンバーで、締め出されておらず、グループの Discord サーバーの控えがある間だけ。ほかは 404（あるかどうかも教えない）
- 載せる卓は開催と終了（中止・募集・調整中は載せない）で、過ぎた卓は 180 日前まで。「自分が入る卓だけ（GM か参加者）」か「グループの卓すべて」を、人ごとに選ぶ。説明には GM・参加者・メモ・グループの画面の URL を入れる。URL を知っている人はメモまで読めるので、画面に「人に渡さない」と書いてある
- 時刻は日本時間（`TZID:Asia/Tokyo` の VTIMEZONE）。終わりの時刻が無ければ 3 時間、終わりが開始より前なら次の日まで。時刻が無ければ終日。行は 75 オクテットで折り返す

**卓ごとの「Google カレンダーに追加」**（`model/calendar.ts`）。日の内訳のボタンが、Google カレンダーの「予定を作成」の画面を、中身を入れた形で開く。連携していなくても使える。

**Google との連携**（`google/`・`domain/google.ts`・`routes/google.ts`）。

- OAuth2 の認可コードの流れ。scope は `openid`・`email`・`https://www.googleapis.com/auth/calendar.events`。refresh token を受け取るため、`access_type=offline`・`prompt=consent` で同意の画面を出す。state は HttpOnly の cookie（`/auth/google` だけ、10 分）に、連携を始めた人の ID と戻り先と一緒に入れ、戻ってきた人が同じでなければ受け取らない
- **refresh token は持つ**（Discord のトークンを持たないのとは違う）。本人が画面を開いていないときにも、卓を書き直し、予定を読むため。`GOOGLE_TOKEN_KEY`（Worker の secret）で AES-GCM の暗号にして `google_links` に置き、画面・ログ・運営者の API には出さない。本人が連携を外すときと、運営者が利用者を消すときは、書き込んだ予定・Google の予定から入れた印・連携の行を消し、Google の許可も取り消す（`forgetGoogle`）。別の Google アカウントで連携し直したら、前のアカウントに書いた予定を消す
- 書き込み: 本人が GM か参加者として入っている、開催と終了の卓。あるべき予定と `google_events` を比べ、足りない・変わった・要らなくなったものだけ Google を呼ぶ。開催日から 7 日より前の卓は、もう触らない（書いた予定は Google に残る）。卓の中身が変わる呼び出しは、返事のあとで（`waitUntil`）そのグループで書き込んでいる人を書き直す
- 読み込み: 本人のメインのカレンダーの予定から、決めた時間帯（既定は 19:00〜23:00。30 分刻みで、終わりは 24:00 まで）が全部埋まれば ×、一部なら △ を入れる。数えないのは、卓予定が書いた予定・「予定なし」・欠席した予定・取り消された予定。終日の予定は、日本時間の 0 時から次の日の 0 時まで埋まっているとみる。本人が入れた印・本人が消した日・卓に入っている日には入れない。受け取るのは時間を決める欄だけで、予定の名前・場所・説明は受け取らない（`fields`）
- Google を呼ぶのは 1 回の要求で 40 回まで。残りは次の回（見回り）に回す。どちらも、あるべき形に合わせ直す作りなので、途中でやめてよい
- 本番は `GOOGLE_CLIENT_ID`（vars）・`GOOGLE_CLIENT_SECRET`・`GOOGLE_TOKEN_KEY`（secret）の 3 つがそろったときだけ使う。無ければ画面に「使えません」と出す（購読 URL と追加のボタンは使える）
- 開発サーバーで `GOOGLE_CLIENT_ID` が空なら、開発用の偽の Google（`google/dev.ts`）を使う。同意の画面を出さずに許可したことにし、書き込んだ予定と「予定あり」の時間は `meta` の `dev_google` に置く。`app.ts` と `google/config.ts` が `import.meta.env.DEV` のときだけ使うので、本番の組み立てには入らない（`vite.config.ts` の `noDevLogin` が `/dev/google` も確かめる）

## 運営の管理画面

公開した人（運営者）が、すべてのグループと利用者を見渡し、困ったときに手を入れる場所。API は `routes/admin.ts`、中身は `domain/admin.ts`、画面とサーバーの型は `src/shared/admin.ts`。入口のグループの一覧の「運営の管理画面」と、グループの画面の上の帯のグループの切り替え（運営者だけに出る）から開く。

| 道 | 中身 |
|---|---|
| `GET /api/admin/overview` | 数（グループ・利用者・有効なログイン・動いている卓）、見回りの様子、24 時間と 7 日の送信の失敗の数、最近の失敗（全グループで 50 件） |
| `GET /api/admin/groups` `GET /api/admin/groups/:id` | グループの一覧と、メンバー（名前・ログインした人・管理者か・最後のログイン）を加えた中身 |
| `POST /api/admin/groups/:id/admins` | 管理者の印を付け外しする。まだ開いていない人も、Discord ID で管理者として足せる。印が 0 人になる外し方は断る |
| `POST /api/admin/groups/:id/guild` | Discord サーバーを付け替える。メンバーの行・管理者の印は残す。知らせのチャンネルは古いサーバーのものなので、いつも外す |
| `POST /api/admin/groups/:id/delete` | グループを消す。名前を打ち込んで、一致したときだけ |
| `GET /api/admin/users` `POST /api/admin/users/:id/logout` `POST /api/admin/users/:id/ban` | 利用者の一覧、ログインを切る、締め出す・戻す |
| `POST /api/admin/users/:id/delete` | 利用者を消す（本人から頼まれたとき）。users の行（ログインとサーバーの控えは表の決まりで一緒に消える）と、どのグループでもその人のメンバーの行（`user_id` か `discord_id` が同じもの）を消し、グループの `created_by` を空にする。メンバーの行の消し方はグループの管理者がメンバーを消すときと同じ（予定とメモは消え、卓と回答はゲストの名前になる）。運営者と、締め出している人（消すと印も消える）は断る。Google カレンダーと連携していれば、書き込んだ予定を消し、Google の許可を取り消してから消す |
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

TypeScript と React 19 で書き、Vite が組み立てる。1 つの SPA で、Worker はどの画面の道でも同じ骨組み（`index.html`）を返し（入れるかは先に確かめる）、画面の道（`router.tsx`）が中身を決める。

**道**（TanStack Router。道はコードで書き、生成ファイルは使わない）。末尾はいつも `/`。

| 道 | 中身 |
|---|---|
| `/` | 入口（`features/home/`）。ログイン・グループの一覧・グループを作る |
| `/g/:id/`・`/g/:id/recruit/`・`avail/`・`settings/` | グループの画面のタブ。`/g/:id/` を初めて開いたときだけ、前に見ていたタブへ移る |
| `/g/:id/admin/<区分>/` | 管理の区域。区分は `members`・`ops`・`notify`・`table`・`admins`・`log`・`danger`。`/g/:id/admin/` は前に開いていた区分へ移る |
| `/admin/<区分>/` | 運営の管理画面。区分は `overview`・`groups`・`users`・`legal`。開いているグループは `?open=<ID>` |

- タブと区分の一覧は `src/shared/routes.ts` に置き、Worker（`routes/pages.ts`。知らない区分は 404）と画面の道の両方から読む。ログインのあとに戻る先も、この一覧で確かめる（`isReturnPath`）
- 検索の文字（`?login=…` など）は `URLSearchParams` のまま読む（TanStack Router の既定は JSON として読むため）
- JS は、入口・グループの画面の外枠・タブ・管理の区域・運営の管理画面ごとに分けて読む。公開で古い JS が消えていたら、1 度だけページを読み直す（`main.tsx`）
- 入口・グループの画面・運営の管理画面のあいだも、読み直さずに移る。どの画面も、同じ見た目の決まり（文字・欄・表）を使う

**データ**（TanStack Query。既定では自動で読み直さない。`app/queryClient.ts`）。

- グループの画面のデータは、キー `['console', グループの ID]` に 1 つだけ置き、`ConsoleSync`（`features/console/api/sync.ts`）が読み書きする。部品は `useData()` で読み、書くのは `sync.write()` だけ
- 読み込むのは、開いたとき・「更新」・自動更新（既定 3 分。この端末で変えられる。隠れている・窓が開いている・表をつかんでいる・文字を打っているあいだは待つ）・書き込みのあと
- 書き込みが始まると、走っている読み込みを取り消す（古いデータで上書きしないため）。書き込みの返事の `data` は、ほかの書き込みが残っていれば当てずに、全部が終わってからそっと読み直す。順番は単体テスト（`test/client/console-sync.test.ts`）で確かめる
- 押した瞬間に画面へ出し（楽観的な書き換え。`model/optimistic.ts` の、データを受けて新しいデータを返す関数。仮の ID は `__tmp__`）、返事の `data` で本物に置き換える。失敗したら戻して読み直す
- ブラウザの控え（`taku.cache:<ID>`）には、サーバーから来たデータだけを書き、開いたときにまず出す。ログアウトと「見つかりません」で消す。控えには `src/shared/api.ts` の形の印（`__API_SHAPE__`。`vite.config.ts` が組み立てのときに入れる）を一緒に置き、印が違えば使わない。公開で画面のデータに欄が増えたあと、古い形の控えで描いて画面が落ちないようにするため
- ログインが切れていたらログインし直す（続けて 2 回まで）。グループが消えていたら「見つかりません」を出す
- 運営の管理画面のデータは `['admin', …]`（`features/operator/api.ts`）。変えたあとと「更新」のときだけ読み直す

**部品**（`ui/`）。

- 窓（`Modal.tsx`）は body の直下の層に描き、`hidden` で開け閉めする。開いているあいだは後ろを触れなくし（inert）、閉じたらフォーカスを戻す。Esc はいちばん手前の窓だけを閉じる。確かめる窓（`confirm.tsx`）は、ほかの窓より手前の層に出す
- 窓の下のボタンは右に寄せ、「やめる」「閉じる」の右に進むボタンを置く。消すなど危ないボタン（`danger`）は左の端に置く（`components.css` の `.modal .btns`）。スマホでは進むボタンを広げる
- 設定を保存するボタンは、変えるまで押せないようにする（書きかけがあるか、いまの値と違うときだけ押せる）。押しても何も変わらない、ということを無くすため
- 長い名前や URL は、切れ目が無くても折り返す（`base.css` の `overflow-wrap`）。名前を入れる選ぶ欄には最大の幅を付け、表の名前の列は折り返す。ページが横にはみ出さないように
- グループの画面が読めない・グループが消された・ログインし直せないときは、カードで知らせて次にすることのボタンを出す（`shell/Loading.tsx`）。消されたあとは、タブを隠す
- 画面の状態（選んでいる日・開いている窓など）は、小さな入れ物（`store.ts`。`useSyncExternalStore`）に置く。書きかけの入力は、保存するまで読み直しで上書きしない
- アイコンは `<Icon name>` で、SVG として JS に入っている（画像やフォントは読まない）。`icons.ts` が `~icons/material-symbols/<名前>-outline-rounded` を import し、[unplugin-icons](https://github.com/unplugin/unplugin-icons) が組み立てのときに SVG の React の部品にする。名前は `ICONS` の鍵で、型で確かめる。大きさは文字の大きさ（1em）、色は文字の色。いま開いているタブなど押してあることを示すときは、塗りの形（`filled`。`FILLED`）
  - React 向けの変換は、unplugin-icons の既定（`@svgr` と Babel が要る）を使わず、`tools/icons.ts` の `reactIconCompiler` で、外側の `<svg>` の属性と中身をそのまま入れる。中身はアイコンの集まりの SVG で、利用者の入力は入らない
  - 使ってよい集まりは、ライセンスを確かめたものだけ（`tools/icons.ts` の `ALLOWED_ICON_SETS`。今は Material Symbols の Apache License 2.0）。`test/client/contract.test.js` が、使っている集まりと、その `info.json` のライセンスを突き合わせる
  - サイトも同じ集まりを unplugin-icons で使う（Vue の部品。`website/.vitepress/theme/icons.ts` と `<Ms name>`）。トップのページの特長は、VitePress が HTML の文字で受け取るので、`~icons/…?raw` の SVG の文字を渡す（`HomeFeatures.vue`）。SNS 用の画像を書き出す道具（`website/tools/og-image.js`）も、同じ集まりの SVG をページに入れる
- 開発用ログインの部品は `import.meta.env.DEV` のときだけ描くので、本番の組み立てでは消える（`noDevLogin` が JS を見て確かめる）。ログアウトと開発用ログインは、素のフォームの POST（サーバーが cookie を付けて移す）
- 確かめの道具（e2e・スクリーンショット）は、要素の ID・`data-*`・`body[data-area|data-tab]`・`window.yoki`（`D`・`selectDay`・`showTab`）を使う。変えるときは道具も直す

**グループの画面**（`features/console/`）。ふだんの区域（カレンダー・募集・調整・メンバーの予定の 3 つのタブと、あなたのメニューから開く設定）と、管理の区域（メンバーの登録・卓をまとめて変える・知らせ・このグループ・管理者・送信の記録・グループを消す）に分ける。外枠（`shell/ConsoleLayout.tsx`）は 1 つで、`body[data-area]` と `body[data-tab]` を置く。

| フォルダ | 中身 |
|---|---|
| `api/` | 呼び出し（`rpc.ts`）・読み書きの順番（`sync.ts`）・Discord への送信（`discord.ts`） |
| `model/` | 卓の読み方・日付・知らせの決まり・楽観的な書き換え（データを受けて返すだけの関数） |
| `shell/` | 外枠・上の帯（ヘルプとあなたのメニュー・管理画面への入口）とタブ・読み込み中 |
| `calendar/`・`recruit/`・`avail/`・`settings/` | タブ（募集・調整のタブには、候補日を選ぶ窓も） |
| `form/` | 卓の登録の窓と変更の窓（開く頼みに卓の ID があれば変更の窓。共通の欄・入力の決まり・保存は分けて置く）と、参加者を決める窓 |
| `admin/` | 管理の区域の区分 |

- 画面は見る人の手元の暦で日付を扱う（今日は、サーバーが日本時間で決めた `today`）

**見た目**（Tailwind CSS v4。`index.css` が入口で、`@tailwindcss/vite` が組み立てる）。

- 層の順は theme（トークン）→ base（要素の既定）→ components（部品）→ utilities（Tailwind のクラス）。ほとんどの見た目は、部品の JSX に Tailwind のクラスで書く
- トークン（`styles/theme.css`）: Tailwind の既定のトークン（色の一覧・rem の寸法）は使わず、置いたものだけを使う。寸法は px で数える（`--spacing: 1px`。`p-10` は 10px）。文字の大きさは `text-13` など、幅の区切りは 401・601・701・761・901・1061px（`sm:` は 601px 以上、`max-sm:` は 600px 以下）
- 色は、明るい・ダーク・OS のダークで値の変わる変数（`--card` など）に置き、`@theme inline` で Tailwind の色にする（`bg-card` は `var(--card)` を読む）。ダークの色は変数が変わるので、`dark:` はほとんど要らない。`dark:` は `data-theme="dark"` と、明るいを選んでいない OS のダークの両方に効く
- 配色: サービスアイコンの青（`#2D2AFE`）を、上の帯と大事なボタンに大きく使う。オレンジ・ピンク・黄は差し色。明るいが基本で、ダークは紺の地に明るめの青
  - アイコンの色は `brand`・`brand-light`・`orange`・`pink`・`yellow`・`cream` として、明るい・ダークで変えずに置く。飾り（グループの頭文字の札・入口の紹介など）に使う
  - 字の色は、地の色と組になった変数を使う（`accent-text`・`ok-text`・`soon-text` など）。オレンジは白い地の小さな字には読みにくいので、字には濃いオレンジの `soon-text` を使う
- 文字は Noto Sans JP（Google Fonts から読む。`index.html`・Worker のページ・サイトも同じ）。読めないあいだと、つながらないときは端末の字で出す
- 要素の既定（`styles/base.css`）: 文字・リンク・見出し・欄・表・フォームの中の名前・文字の大きさの設定（body の zoom）。Tailwind の preflight（要素の見た目を消す土台）は使わない。入れると、ブラウザの既定に頼っている見た目（見出しや段落の余白・ボタンの字など）が多くの部品で変わるため
- 部品（`styles/components.css`）: いくつもの画面で使う形だけを置く（アイコン・説明・カード・ボタン・ボタンの並び・欄の行・表の枠と行・窓の箱）。場面ごとの調整は、Tailwind のクラスで上書きする（クラスは部品に勝つ）
- くり返すクラスの組み合わせは、TypeScript の定数にする（`ui/chrome.ts` の上の帯、`ui/fields.ts` の設定の欄、`features/console/styles.ts` の知らせの行や札など）。クラスの名前は文字列のつなぎで組み立てない（Tailwind はファイルの文字から名前を探すので、組み立てた名前の CSS は出ない）
- Worker のページ（知らせと規約。`routes/html.ts`）・サイト（`website/.vitepress/theme/style.css`）・SNS 用の画像（`website/tools/og-image.html`）・`manifest.webmanifest` と `theme-color` は Tailwind を通らないので、同じ色を別に書いている。配色を変えるときは、`theme.css` と一緒に直す

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
