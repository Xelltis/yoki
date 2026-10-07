# 卓予定の作り

開発する人向けに、卓予定の作りと、そう決めた理由をまとめる。使う人向けの説明はサイト（`website/`、GitHub Pages）、手元で動かす方法と公開の手順は [README.md](../README.md) にある。

2026-10-03に、Google Apps Script（GAS）＋スプレッドシートの版から作り直した。業務の決まり（卓の状態、参加希望の扱い、日程調整の流れなど）はGAS版のまま移し、関数ごとに元の関数名をコメントに残してある。GAS版のコードと文書（旧いガイド・セキュリティレビュー・UIの再設計案）は、gitの `gas-final` タグで読める（`git show gas-final:src/server/Polls.js` など）。

## 全体

Worker 1つで、次の3つを受け持つ。

**画面**: `src/client` をViteで組み立てた静的ファイル（Workers Static Assets）。`wrangler.jsonc` の `run_worker_first` にある道（`/api/*`・`/auth/*`・`/g/*`・`/dev/*`・`/admin`・`/admin/*`・`/terms`・`/privacy`・`/cal/*`）だけWorkerが先に受ける。ここに無い道は、確かめずに静的ファイルとして配られる。

**API**: Hono（`src/worker/app.ts`）。

**知らせの見回り**: 5分おきのcron（`scheduled`）。

| 道 | 中身 |
|---|---|
| `/` | 入口（`src/client/index.html` とReactの `features/home/`）。`GET /api/me` でログインしているかを聞き、グループの一覧か「Discordでログイン」を出す |
| `/g/:id/` と `/g/:id/<タブ>/` | グループの画面。入れる人には、入口と同じ骨組み（`index.html`。データは入っていない）を返す。中身は画面の道が決め、データは画面がAPIで読む。リンクの中身を読みに来たもの（Discordなど）には、ログインへ送らずに骨組みを返す（下の「リンクの見た目」） |
| `/g/:id/admin/` と `/g/:id/admin/<区分>/` | グループの管理画面。同じ骨組みを返す。そのグループの管理者でなければ403の案内 |
| `/admin/` と `/admin/<区分>/` | 運営の管理画面。同じ骨組みを返す（控えさせない）。ログインしていなければDiscordログインへ、運営者でなければ403の案内 |
| `/terms` `/privacy` | 利用規約とプライバシーポリシー。だれでも読める。WorkerがD1から本文を読み、その場でHTMLにして返す（JSは使わない。`routes/html.ts` の `legalPage`） |
| `/auth/login` `/auth/callback` `POST /auth/logout` | Discordログイン |
| `GET /api/me` `POST /api/groups` | 入口の画面が使う |
| `POST /api/g/:id/:fn` | 画面からの呼び出し |
| `GET` / `POST /api/admin/*` | 運営の管理画面が使う（下の「運営の管理画面」） |
| `GET /cal/<token>.ics` | 購読URL（iCalendar）。ログインせずに読む（下の「カレンダーとの連携」） |
| `/auth/google/start` `/auth/google/login` `/auth/google/callback` | Googleカレンダーとの連携と、Googleでのログイン（OAuth） |
| `POST /dev/login` `POST /dev/reset` | 開発用ログイン（開発サーバーだけ）。`/dev/reset` は、開発用の人のGoogle連携と偽のGoogleの中身も消す |
| `/dev/google/authorize` `/dev/google/state` `POST /dev/google/busy` | 開発用の偽のGoogle（開発サーバーでGoogleの値が空のときだけ） |

**リンクの見た目（OGP）**。リンクをDiscordなどに貼ると、貼られた側がページを読みに来て、題・説明・画像を出す。

画面の骨組み（`index.html`）に、卓予定の題・一言・画像（`/og.png`。`npm run og-image` がサイトと同じ画像を書き出す）のタグを置く。骨組みのタグはアドレスを省いた形（組み立てのときには、公開のアドレスが分からない）。入口（`/`）は、Workerがタグを公開のアドレスを入れた形に書き換えて返す（`routes/pages.ts`。`wrangler.jsonc` の `run_worker_first` に `/` を入れてある）。

読みに来たものはログインしないので、グループの画面と運営の管理画面はログインへ送られ、Discordのログインのページの見た目が出てしまう。User-Agentで見分け（`routes/og.ts` の `isPreviewBot`）、ログインへ送らずに骨組みを返し、タグを道ごとの文に書き換える。骨組みにはグループの中身が無く、グループの名前も出さない（「卓予定のグループ」）。見分けを外れても、ふつうの人と同じくログインへ送られるだけ。

利用規約とプライバシーポリシー（`routes/html.ts`）も、同じタグを付ける。

## ログインとメンバーの確認

**ログイン**（`auth/oauth.ts`）。DiscordのOAuth2の認可コードの流れで、scopeは `identify`（誰か）と `guilds`（どのサーバーにいるか）。`prompt=none` で、許可済みならDiscordの画面を出さずに戻る。stateはHttpOnlyのcookie（`/auth` だけ、10分）で照合する。トークンを受け取ったら `/users/@me` と `/users/@me/guilds` を読み、**Discordのトークンは保存しない**。

**控えるサーバー**。参加しているサーバーのうち、卓予定のグループがあるサーバーと、本人が管理できる（オーナー・管理者・サーバー管理の権限がある）サーバーだけを `user_guilds` に控える。ほかのサーバーは覚えない。

**ログインの続き**（`auth/session.ts`）。ランダムな32バイトをcookie（`__Host-yoki_sid`、HttpOnly・Secure・SameSite=Lax）に入れ、D1にはそのSHA-256だけを置く。期限は30日。ログインし直すとき（聞き直し・Googleとの結びつけ）は、そのブラウザの前の控えを消してから作る。使えない控えが残り、ログインの数が増えないようにするため。手元（http://localhost）ではSecureを付けられないので、名前を `yoki_sid` にする。

**Googleでログイン**（`auth/google-login.ts`・`routes/google.ts`）。利用者そのものはDiscordのアカウント（`users`）のままで、Googleのアカウントは結びつけたもう1つの入り口（`google_logins`。人ごとに1つ、Googleのアカウントごとに1人）。

`/auth/google/login` からGoogleのOAuth2（scopeは `openid email`、`prompt=select_account`）。戻ってくる先はカレンダーの連携と同じ `/auth/google/callback` で、stateのcookie（`yoki_glogin`）で見分ける。id_tokenはGoogleのトークンの窓口から直接受け取るので署名は確かめず、`aud` が自分のクライアントIDかを確かめて、`sub`（GoogleのアカウントのID）を使う。

結びついている `sub` なら、その人でログインする（締め出された人は断る）。初めての `sub` は、`sub` とメールを暗号にしたcookie（`__Host-yoki_glink`。10分）に控えて入口へ戻し、続けてDiscordでログイン（開発用ログインも）したあとに結びつける。cookieは `GOOGLE_TOKEN_KEY` のAES-GCMなので、書き換えて人のGoogleのアカウントを結びつけることはできない。`__Host-` なので、ほかのサブドメインから差し込むこともできない。

控えを使うのは、結びつけるために押したログインだけ（入口が `/auth/login?link_google=1` と、開発用ログインの `link_google` を付ける。Discordのログインではstateのcookieに控える）。黙って行う聞き直しのログインでは使わず、ログアウトでは控えも消す。共用の端末で、前の人のGoogleのアカウントが次の人に結びつかないように。

ログインしている人は、設定の画面の「ログインの方法」から結びつけ（`?link=1`。始めた人と戻ってきた人が同じか確かめる）、外せる（`unlinkGoogleLogin`）。ほかの人に結びついているGoogleのアカウントは断る。

**グループに入れるか**（`auth/guard.ts`）。グループに結びつけたDiscordサーバーが、控えにあれば入れる。

控え（ログインのときに読んだサーバーの一覧か、Botで確かめた日時）が24時間より新しければ、控えで決める。

古い・控えにサーバーが無いときは、知らせのBotがそのサーバーにいれば、Botに聞く（`discord/member.ts`。サーバーのメンバーを1人読むだけなので、Gatewayの特別な権限は要らない）。いれば入れ、確かめた日時を `user_guilds.checked_at` に残す（管理できるかは、オーナーか、ロールの権限に管理者・サーバー管理があるかで決める）。いなければ403にして控えからも外す。Googleでログインした人を、Discordのログインの画面へ送らずに済ませるため。

Botがいない・Discordが答えないときは、今までどおり。控えが24時間より古ければ `/auth/login` に送ってDiscordに聞き直す（`prompt=none` なので、画面はほとんど出ない）。控えにサーバーが無いとき、控えが5分より古ければ一度だけ聞き直し（そのあとサーバーに入った人のため）、新しければ403。

ログインした人のDiscordのトークンは持たないので、裏で問い合わせるのはBotがいるサーバーだけ。Botがいないサーバーでは、抜けた人を締め出すまでに最長24時間の時間差がある（知らせに使うBotのトークンは別で、Workerのsecretに置く）。

グループを作るとき（管理できるサーバーの一覧）は、今までどおり新しいDiscordのログインが要る。

**「あなた」はサーバーが決める**。ログインした人に結びついたメンバーが「あなた」（`Actor`）になる。初めて入ったときは、管理者がDiscord ID付きで先に登録していた行に結びつけ、無ければDiscordの表示名で新しく作る。予定・参加希望・日程調整の回答は、本人のぶんだけ入れられる（`requireSelf`。管理者も、ほかの人の代わりには入れない）。画面から送られる名前は、本人の名前と同じかを確かめるだけに使う。なので、ゲストとDiscordのIDの無いメンバーは回答できず、日程調整の「全員そろった」は回答できる人（`pollVoters`）で数える。

**管理者**は、`members.is_admin` が付いた人と、そのサーバーの管理権限を持つ人。権限を持つ人はいつも管理者なので、管理者が0人になってグループを直せなくなることはない。

**締め出し**。運営者が締め出した人は、`users.banned_at` に日時が入る。

`/auth/callback`（と開発用ログイン）は、プロフィールを書く前に見て、`/?login=banned` へ返す。

`currentViewer` は締め出した人を「ログインしていない」として扱う。締め出す前に持っていたcookieも効かない（締め出すときに、その人のログインも消す）。

usersの行は消さない（印がそこにあるため）。DiscordのユーザーIDは使い回されないので印は保てるが、別のアカウントは止められない。

**運営者**（`auth/operator.ts`）。`OPERATOR_IDS`（Workerのsecret。カンマか空白で区切る）に書いたDiscordユーザーIDの人。開発サーバーでは、手元（localhost）から開いたときだけ、開発用ログインのひよりも運営者になる。運営者は締め出せない。

**CSRF**（`auth/csrf.ts`）。cookieはSameSite=Lax。GET以外は、`Origin` か `Sec-Fetch-Site` が自分のときだけ受ける。`/api` はJSONだけを受ける。

## データベース（D1）

表の定義は `migrations/`（`0001_init.sql` が最初の形、`0002_admin.sql` が締め出し・最後に使われた日と索引、`0003_bot.sql` が知らせのBot、`0004_calendar.sql` がカレンダーとの連携、`0005_member_check.sql` がBotで確かめた日時、`0006_google_login.sql` がGoogleでのログイン）。日付（開催日・予定・メモ）は日本時間の `YYYY-MM-DD`、日時（〜した時刻）はUTCのISO文字列。

`users`・`user_guilds`・`auth_sessions`: ログイン。`users.banned_at`・`banned_reason` は締め出し。

`groups`: グループと設定（知らせのチャンネル・知らせの日時・各種のON/OFF・卓の番号の続き）。`last_used_at` は最後に使われた日時（画面から呼ばれるたびに、10分に1回まで書き換える）。

`members`: メンバー。名前はグループの中で一意。

`sessions`・`session_people`: 卓と、関わる人（GM・参加者・参加希望・興味あり）。

`availability`・`avail_notes`・`day_notes`・`poll_votes`・`series_notify`・`notify_log`。

`meta`: cronの「この時刻はもう回した」印、最後の見回りの記録、新規登録の受付（`registration`）、利用規約とプライバシーポリシー（`legal_operator`・`legal_contact`・直した本文の `legal_terms`・`legal_privacy`）。開発サーバーでは偽のGoogleの中身（`dev_google`）も。

`calendar_feeds`: 購読URL（人とグループの組で1つ。token・載せる卓・最後に読まれた日時）。

`google_links`: Googleカレンダーとの連携（人ごと。メール・暗号にしたrefresh token・書き込み／読み込みのONとOFF・印を決める時間帯・最後に回った日時と失敗）。

`google_events`: Googleに書き込んだ予定（人と卓ごとの予定のIDと中身の要約）。卓や連携が消えてもGoogleの予定を消すまで覚えておくので、外部キーにしない。

`google_logins`: Googleでのログイン（GoogleのアカウントのID・メール → 利用者）。`user_guilds.checked_at` は、そのサーバーにいることをBotで確かめた日時。

`google_dismissed`: Googleの予定から入った印を、本人が消した日（その日には、もう入れない）。`availability.source` は、本人が入れた印なら空、Googleの予定から入れた印なら `google`。

**メンバーは中ではIDで持つ**。画面とのやり取りはGAS版と同じく名前で行い、`domain/people.ts` で変換する。名前を変えても1か所を直すだけで済む（GAS版では、名前の変更が一部の表に伝わらなかった）。メンバーに無い人（ゲスト）は、`guest_name` に名前だけで持つ。メンバーを消すと、その人が入っていた卓と回答はゲストの名前に置き換わり、予定とメモは消える。

グループを消すと、中身（メンバー・卓・予定・メモ・回答・送信の記録）は、表の決まり（`ON DELETE CASCADE`）で一緒に消える。

**卓のID** は画面には `S001` の形で見せる。グループごとの通し番号で、使った番号は使い直さない（S999の次はS1000）。

## 画面からの呼び出し

`POST /api/g/:id/:fn` に、GAS版と同じ形のformをJSONで送り、同じ形の返事（`{ ok, message, data }`）を返す。画面は `rpc()`（`src/client/features/console/api/rpc.ts`）で呼び、読み込みと書き込みの順番は `ConsoleSync`（同じフォルダの `sync.ts`。下の「画面」）が整える。

画面とサーバーの約束（呼べる関数の名前・画面データ `ConsoleData`・返事の形・卓の状態）は `src/shared/api.ts` に置き、両方から読む。サーバーの一覧（`routes/rpc.ts`）は名前の型で固めてあり、足りなくても多すぎても型の確認で止まる。`consoleData()` は `ConsoleData` を返すと書いてあるので、返す形が変わると型の確認で分かる。

`src/shared/` は、ブラウザの型もWorkersの型も使わない（どちらからも読めるように）。

管理者だけの関数は、サーバーの一覧に書く。

書き込みの返事には、最新の画面データ（`data`）を付ける。画面は読み直さずに済む。グループを消す `deleteGroup` だけは付けない（消したあとは読めないため）。

エラーは `{ error }`。`AUTH:` で始まればログインし直し（画面がそのまま `/auth/login` へ送る）、`ADMIN:` で始まれば管理者だけの操作、`GONE:` で始まればグループが消えた（画面は控えを消し、自動の読み直しを止めて、入口へのリンクを出す。ほかのタブで消されたとき）。

**読み込み**（`domain/load.ts`）。グループ1つ分を1回の `db.batch` で読む。開催日が過ぎた「開催」の卓を「終了」にするUPDATEも、同じ回に入れてある。

**書き込み**。読み込んだデータで確かめてから、1回の `db.batch`（全部成功か全部失敗）で書く。GAS版のロックは要らない（行番号がずれることが無いため）。同じ卓を2人が同時に直すと、あとから保存したほうが残る（GAS版と同じ）。

**D1の上限**。1回の呼び出しで使える問い合わせの数に上限がある（無料のプランで50）。卓の数だけ文を作らず、JSONの配列を `json_each` で展開して1文にまとめる（`domain/people.ts`・`domain/sessions.ts` のまとめての変更など）。

## Discordへの送信

知らせは、卓予定のBot（ログインと同じDiscordアプリのBot）が、チャンネルにメッセージを書いて送る。Webhookは使わない。

**Bot**: トークンはWorkerのsecret（`DISCORD_BOT_TOKEN`）。Gatewayには繋がず、RESTだけを使う（送る: `POST /channels/{id}/messages`、読む: `GET /guilds/{id}/channels`・`GET /channels/{id}`）。小道具は `discord/channel.ts`。

**Botを招く**: グループの管理者が、管理画面の「知らせ」から自分のサーバーに招く。招くURLは、Client IDとグループのサーバーから作る（`botInviteUrl`。求める権限は、チャンネルを見る・メッセージを送る・埋め込みリンク）。Botは公開（Public Bot）。

**送り先はチャンネルのID**: `groups.channel_id`（基本）・`remind_channel_id`・`recruit_channel_id`（種類ごと。空なら基本）・`series_notify.channel_id`（シリーズ専用）。

選ぶ: 管理画面が `getDiscordChannels` で、送り先にできるチャンネル（テキストとアナウンス）の一覧を読む。

保存する: サーバーでBotに `GET /channels/{id}` を聞き、グループのサーバーのチャンネルであることを確かめる。Botはほかのサーバーにもいるので、そのチャンネルには送らせない。

送り先（`discord/targets.ts`）: シリーズの専用チャンネル → 知らせの種類のチャンネル（開催前の知らせ・募集） → 基本のチャンネル、の順に選ぶ。同じチャンネルは1つにまとめる。

送信（`discord/send.ts`）。

429・5xx・通信の切れは、3秒・8秒と待って3回まで送り直す（`Retry-After` を見て、最長15秒）。1回ごとに `notify_log` に1行残す。

本文に `allowed_mentions: { parse: ['users'] }` を付ける。メモに書かれた @everyone などで、全員に通知が飛ばないようにする。

失敗の種類: 401（Botのトークン）・403（チャンネルの権限）・404（チャンネルが無いか、Botが外された）・429・5xx・400・通信。

画面からの送信は `sendDiscordStep`（`discord/step.ts`）で1回ずつ。待ちと送り直しは画面が回す（GAS版と同じ）。

回答そろい・日程決定は、回答や決定を受けたサーバーがその場で送る（画面を閉じられても届くように）。

サンプルのグループのチャンネル（IDが全部0）には送らず、送ったことにする（開発用ログインとスクリーンショットのため）。

## 知らせの見回り（cron）

`domain/patrol.ts`。cronは5分おきに動く（時刻はUTCだが、中で日本時間に直して判断する）。

**毎時の仕事**（開催前の知らせ・期間前の催促・過ぎた卓の自動終了）は、`meta` の印（`hourly` = `2026-10-10T20`）を進められたときだけ回す。5分おきでも1時間に1回になり、見回りが重なっても抜けても大丈夫。

**開始直前の知らせ**は毎回見る。

**二重に送らない**。送る前に卓の印（`notified_at` など）を `UPDATE … WHERE … IS NULL RETURNING` で取り、取れた卓だけを送る。全部の送り先で失敗したら印を戻し、次の回で送り直す。

開催前の知らせは、送り先と「あと何日」ごとに1通にまとめ、10卓ごとに分ける（Discordのembedは1通に10個まで）。

問い合わせは、送る卓のあるグループだけを読む。

毎日1回（日本時間の4時以降）、期限切れのログイン、古い送信記録（グループごとに500件まで）、90日より前の予定とメモ、1年より前の日付メモを片付ける。

Googleカレンダーと連携している人を、長く回っていない人から5人ずつ同期する（卓の書き込みと、1時間おきの予定の読み込み。下の「カレンダーとの連携」）。毎日の片付けでは、90日より前の「消した日」の記録と、連携が無くなった人・過ぎた卓の、書いた予定の控えも消す。

回ごとに、`runPatrol` が `meta` の `patrol`（時刻・かかった時間・成否・エラー）と、うまくいったら `patrol_ok_at` を書く。失敗は投げ直す（Cloudflareのcronの失敗としても残る）。記録が書けなくても、見回りの結果は変えない。

## カレンダーとの連携

卓を、ふだん使っているカレンダーに出す。どれも、設定の画面の「カレンダー連携」（`settings/CalendarCard.tsx`）から、本人だけが使う。

**購読URL**（`domain/calendar.ts`・`routes/calendar.ts`・`lib/ics.ts`）。`/cal/<token>.ics` のiCalendarを、カレンダーのアプリ（Googleカレンダーの「URLで追加」など）がログインせずに読む。

tokenは32バイトのランダム（43文字）で、人とグループの組ごとに1つ。作り直すとtokenが変わり、前のURLは404になる。止めると消える。

読めるのは、作った人がまだそのグループのメンバーで、締め出されておらず、グループのDiscordサーバーの控えがある間だけ。ほかは404（あるかどうかも教えない）。

載せる卓は開催と終了（中止・募集・調整中は載せない）で、過ぎた卓は180日前まで。「自分が入る卓だけ（GMか参加者）」か「グループの卓すべて」を、人ごとに選ぶ。説明にはGM・参加者・メモ・グループの画面のURLを入れる。URLを知っている人はメモまで読めるので、画面に「人に渡さない」と書いてある。

時刻は日本時間（`TZID:Asia/Tokyo` のVTIMEZONE）。終わりの時刻が無ければ3時間、終わりが開始より前なら次の日まで。時刻が無ければ終日。行は75オクテットで折り返す。

**卓ごとの「Googleカレンダーに追加」**（`model/calendar.ts`）。日の内訳のボタンが、Googleカレンダーの「予定を作成」の画面を、中身を入れた形で開く。連携していなくても使える。

**Googleとの連携**（`google/`・`domain/google.ts`・`routes/google.ts`）。

OAuth2の認可コードの流れ。scopeは `openid`・`email`・`https://www.googleapis.com/auth/calendar.events.owned`（本人が持つカレンダーの予定だけ。使うのはメインのカレンダーだけなので、共有されたカレンダーにも届く `calendar.events` より狭いものにする）。refresh tokenを受け取るため、`access_type=offline`・`prompt=consent` で同意の画面を出す。stateはHttpOnlyのcookie（`/auth/google` だけ、10分）に、連携を始めた人のIDと戻り先と一緒に入れ、戻ってきた人が同じでなければ受け取らない。

**refresh tokenは持つ**（Discordのトークンを持たないのとは違う）。本人が画面を開いていないときにも、卓を書き直し、予定を読むため。`GOOGLE_TOKEN_KEY`（Workerのsecret）でAES-GCMの暗号にして `google_links` に置き、画面・ログ・運営者のAPIには出さない。本人が連携を外すときと、運営者が利用者を消すときは、書き込んだ予定・Googleの予定から入れた印・連携の行を消し、Googleの許可も取り消す（`forgetGoogle`）。別のGoogleアカウントで連携し直したら、前のアカウントに書いた予定を消す。

書き込み: 本人がGMか参加者として入っている、開催と終了の卓。あるべき予定と `google_events` を比べ、足りない・変わった・要らなくなったものだけGoogleを呼ぶ。開催日から7日より前の卓は、もう触らない（書いた予定はGoogleに残る）。卓の中身が変わる呼び出しは、返事のあとで（`waitUntil`）そのグループで書き込んでいる人を書き直す。

読み込み: 本人のメインのカレンダーの予定から、決めた時間帯（既定は19:00〜23:00。30分刻みで、終わりは24:00まで）が全部埋まれば ×、一部なら △ を入れる。数えないのは、卓予定が書いた予定・「予定なし」・欠席した予定・取り消された予定。終日の予定は、日本時間の0時から次の日の0時まで埋まっているとみる。本人が入れた印・本人が消した日・卓に入っている日には入れない。受け取るのは時間を決める欄だけで、予定の名前・場所・説明は受け取らない（`fields`）。

Googleを呼ぶのは1回の要求で40回まで。残りは次の回（見回り）に回す。どちらも、あるべき形に合わせ直す作りなので、途中でやめてよい。

本番は `GOOGLE_CLIENT_ID`（vars）・`GOOGLE_CLIENT_SECRET`・`GOOGLE_TOKEN_KEY`（secret）の3つがそろったときだけ使う。無ければ画面に「使えません」と出す（購読URLと追加のボタンは使える）。

開発サーバーで `GOOGLE_CLIENT_ID` が空なら、開発用の偽のGoogle（`google/dev.ts`）を使う。同意の画面を出さずに許可したことにし、書き込んだ予定と「予定あり」の時間は `meta` の `dev_google` に置く。`app.ts` と `google/config.ts` が `import.meta.env.DEV` のときだけ使うので、本番の組み立てには入らない（`vite.config.ts` の `noDevLogin` が `/dev/google` も確かめる）。

## 運営の管理画面

公開した人（運営者）が、すべてのグループと利用者を見渡し、困ったときに手を入れる場所。APIは `routes/admin.ts`、中身は `domain/admin.ts`、画面とサーバーの型は `src/shared/admin.ts`。入口のグループの一覧の「運営の管理画面」と、グループの画面の上の帯のグループの切り替え（運営者だけに出る）から開く。

| 道 | 中身 |
|---|---|
| `GET /api/admin/overview` | 数（グループ・利用者・有効なログイン・動いている卓）、見回りの様子、24時間と7日の送信の失敗の数、最近の失敗（全グループで50件） |
| `GET /api/admin/groups` `GET /api/admin/groups/:id` | グループの一覧と、メンバー（名前・ログインした人・管理者か・最後のログイン）を加えた中身 |
| `POST /api/admin/groups/:id/admins` | 管理者の印を付け外しする。まだ開いていない人も、Discord IDで管理者として足せる。印が0人になる外し方は断る |
| `POST /api/admin/groups/:id/guild` | Discordサーバーを付け替える。メンバーの行・管理者の印は残す。知らせのチャンネルは古いサーバーのものなので、いつも外す |
| `POST /api/admin/groups/:id/delete` | グループを消す。名前を打ち込んで、一致したときだけ |
| `GET /api/admin/users` `POST /api/admin/users/:id/logout` `POST /api/admin/users/:id/ban` | 利用者の一覧、ログインを切る、締め出す・戻す |
| `POST /api/admin/users/:id/delete` | 利用者を消す（本人から頼まれたとき）。usersの行（ログインとサーバーの控えは表の決まりで一緒に消える）と、どのグループでもその人のメンバーの行（`user_id` か `discord_id` が同じもの）を消し、グループの `created_by` を空にする。メンバーの行の消し方はグループの管理者がメンバーを消すときと同じ（予定とメモは消え、卓と回答はゲストの名前になる）。運営者と、締め出している人（消すと印も消える）は断る。Googleカレンダーと連携していれば、書き込んだ予定を消し、Googleの許可を取り消してから消す |
| `POST /api/admin/registration` | 新規登録を受け付ける・止める（`{open}`） |
| `GET /api/admin/legal` `POST /api/admin/legal` | 利用規約とプライバシーポリシーの、運営者の名前・問い合わせ先・本文を読む・保存する（`{operator?, contact?, terms?, privacy?}`。省いたものは変えない） |
| `GET /api/admin/update` `POST /api/admin/update` | 動いている版と、元のリポジトリの最新の版を比べる（`?refresh=1` でGitHubを読み直す）・最新の版への更新を始める（下の「版と更新」） |

どの道も、ログインしていなければ `AUTH:` の401、運営者でなければ403。返事は `Cache-Control: no-store`。

読むものはGET、変えるものはPOST（JSON）。CSRFの確かめは `/api` のほかの道と同じ。

変えた操作は、`{"audit":"operator",…}` のJSON 1行をlogに出す（WorkersのObservabilityに残る監査の控え）。グループの管理者がグループを消したときも `{"audit":"group-admin",…}` を出す。

運営者は、グループの中身（卓・予定）は見ない。見るのは数と名前だけ。

送信の失敗に数えるのは、`送信失敗` と `送らず` で始まる記録だけ（`HTTP…`・`ERROR…` は送り直しの途中）。

見回りは、最後の回が15分より前なら止まっているかもしれない、として出す。

新規登録の受付（`domain/registration.ts`）。止めると、グループを作る道（`POST /api/groups`）と、初めての人のログイン（`/auth/callback`・開発用ログイン。usersに行が無い人）を断る。もう使っている人と運営者は通す。運営者が自分を締め出さないように、運営者はいつでも入れて、グループも作れる。画面には `/api/me` の `registration` で知らせる。

利用規約とプライバシーポリシー（`domain/legal.ts`）。既定の文（`domain/legal-text.ts`）は、このリポジトリのままの卓予定に合わせて書いてあり、アプリの作りが変わってずれたら直す。運営者が本文を直すと `meta` に保存し、直していなければ既定の文を出す（既定の文を直せば、直していない公開先にもそのまま出る）。本文を空か既定の文と同じにして保存すると、既定の文に戻る。本文の書き方は見出し・箇条書き・段落・リンクだけで、HTMLはそのまま文字で出す（`lib/markup.ts`）。

Discordサーバーを付け替えると、新しいサーバーの人は、控えが5分より古くなったときに黙って読み直して入れるようになり、古いサーバーの人は入れなくなる。

## 版と更新

卓予定はOSSとして、ほかの人が自分のCloudflareに設置して公開する。設置の主な道は「Deploy to Cloudflare」のボタンで、フォークしてGitHub Actionsで公開する道もある（下の「公開」）。元のリポジトリが出す版に、各地の卓予定が運営の管理画面から追いつけるようにする（WordPressの更新と同じ役目）。Workerは自分のコードを書き換えない。取り込みは、各地のリポジトリのGitHub Actionsがする。

**版**: `package.json` の `version`。`vite.config.ts` が組み立てのときに読み、`__APP_VERSION__` としてWorkerに入れる（`src/worker/version.ts`）。ボタンで作ったリポジトリは、元の履歴とタグを持たない（中身を1つのコミットにしたもの）ので、版はタグではなくファイルに持たせる。元のリポジトリでは、公開のワークフローの中でsemantic-release（`.releaserc.json`）がConventional Commitsから次の版を決める。`tools/release/commit-version.mjs` が `package.json` と `package-lock.json` の版を書き換えてコミットし（`[skip ci]`。`GITHUB_TOKEN` のpushなので、公開のワークフローは二度動かない）、semantic-releaseがそのコミットにタグとGitHubのReleaseを作る。最後に `release` のブランチをそのコミットに合わせる。ボタンは `release` を指すので、設置する人はいつも版を出したときの中身を受け取る。版のコミットはActionsのボットが作るので、署名は付かない。公開のワークフローは、版を出したあとのmainを取って組み立てる。

**新しい版を知る**（`domain/update.ts`）: 元のリポジトリ（`UPSTREAM_REPOSITORY`。無ければ `update/config.ts` の既定）の最新のReleaseをGitHubのAPIで読み、今の版と比べる。新しければ、2つのタグのあいだに変わったファイル（compare）に `migrations/` があるかで、表の変更を含むかを出す。読んだ結果は `meta` の `update_check` に控え、1時間は読み直さない（GitHubのAPIは、トークンなしでは1時間に60回まで）。Releaseが404なら、リポジトリそのものも読む。リポジトリも見えなければ（非公開・名前の誤り）、「版がまだ無い」とは言わずに理由を出す。読めなければ理由を出し、前に読めた最新の版は残す。

**更新する**（`.github/workflows/update.yml`。各地のリポジトリで動く）: 元のリポジトリのタグをfetchし、履歴がつながっているかで取り込み方を変える。版の形（`vX.Y.Z`）を確かめてから使い、入力は式の中に直に書かない（スクリプトの差し込みを防ぐ）。

ボタンで作ったリポジトリ（履歴がつながっていない）: 版のファイルで入れ替える。Cloudflareが設置のときに `wrangler.jsonc` に書いた値（Workerの名前・D1の名前とID）は、`tools/update/carry-wrangler.mjs` が新しい版の `wrangler.jsonc` に引き継ぐ（コメント付きの文のまま、値の行だけを書き換える）。入れ替える前に、今のコードが今の版（`package.json` の版のタグ。`wrangler.jsonc` は除く）と同じかを比べ、違えば設置した人が変えたものとして、mainを変えずにPRを作って止まる。mainへのpushで、Workers Buildsが表の変更を当てて公開する。

フォーク（履歴がつながっている）: タグをmainにマージし、公開のワークフローを動かす。ぶつかったらmainを変えずに `update/vX.Y.Z` のブランチとPRを作って止まる。

**2つのトークン**: 管理画面のボタンは、Workerのsecretの `UPDATE_DISPATCH_TOKEN`（そのリポジトリのActionsを動かすだけの権限）で、更新のワークフローを `workflow_dispatch` で動かし、その実行の一覧を読む。運営者のDiscordのアカウントを取られても、コードは書き換えられない。mainへの書き込みは、更新のワークフローがActionsのsecretの `UPDATE_PUSH_TOKEN`（ContentsとWorkflows）で行う。既定の `GITHUB_TOKEN` は `.github/workflows/` を書き換えられず、書き込んだpushでは公開のワークフローも動かないので、そのときは更新のワークフローが公開のワークフローを動かす。

**表の変更**: 公開のワークフローは、当てる前にD1のTime Travelの地点（bookmark）をSummaryに控える。Workers Buildsは控えないので、時刻で戻す。表の変更は戻せないので、困ったらWorkerを前の版に戻し、D1を更新の前に戻す。

`APP_REPOSITORY`（公開しているリポジトリ）は、組み立てのときにvarsに入れる。公開のワークフローは `github.repository` を渡し、Workers Buildsでは組み立てる場所のGitのoriginから読む（`vite.config.ts` の `appRepository`）。`owner/name` の形でなければ使わない（APIの道に入れるため）。

開発サーバーでは `APP_REPOSITORY` が空なので、開発用の偽のGitHub（`update/dev.ts`。最新はいつも今の小さい版を1つ上げたもの）を使う。偽物を選ぶ道は `import.meta.env.DEV` のときだけ。

## 日本時間

WorkersはUTCで動く。日付と時刻はすべて `lib/jst.ts` で日本時間（UTC+9、夏時間なし）に直して扱い、暦日は `YYYY-MM-DD` の文字列のまま `Date.UTC` で計算する。`new Date(年, 月, 日)` や `getHours()` は使わない（`test/client/conventions.test.js` が確かめる）。

## 画面（src/client/）

TypeScriptとReact 19で書き、Viteが組み立てる。1つのSPAで、Workerはどの画面の道でも同じ骨組み（`index.html`）を返し（入れるかは先に確かめる）、画面の道（`router.tsx`）が中身を決める。

**道**（TanStack Router。道はコードで書き、生成ファイルは使わない）。末尾はいつも `/`。

| 道 | 中身 |
|---|---|
| `/` | 入口（`features/home/`）。ログイン・グループの一覧・グループを作る |
| `/g/:id/`・`/g/:id/recruit/`・`avail/`・`settings/` | グループの画面のタブ。`/g/:id/` を初めて開いたときだけ、そのグループで前に見ていたタブ（募集・調整かメンバーの予定。設定は控えない）へ移る |
| `/g/:id/admin/<区分>/` | 管理の区域。区分は `members`・`ops`・`notify`・`table`・`admins`・`log`・`danger`。`/g/:id/admin/` は前に開いていた区分へ移る |
| `/admin/<区分>/` | 運営の管理画面。区分は `overview`・`groups`・`users`・`legal`。開いているグループは `?open=<ID>` |

タブと区分の一覧は `src/shared/routes.ts` に置き、Worker（`routes/pages.ts`。知らない区分は404）と画面の道の両方から読む。ログインのあとに戻る先も、この一覧で確かめる（`isReturnPath`）。

検索の文字（`?login=…` など）は `URLSearchParams` のまま読む（TanStack Routerの既定はJSONとして読むため）。

JSは、入口・グループの画面の外枠・タブ・管理の区域・運営の管理画面ごとに分けて読む。公開で古いJSが消えていたら、1度だけページを読み直す（`main.tsx`）。

入口・グループの画面・運営の管理画面のあいだも、読み直さずに移る。どの画面も、同じ見た目の決まり（文字・欄・表）を使う。

**データ**（TanStack Query。既定では自動で読み直さない。`app/queryClient.ts`）。

グループの画面のデータは、キー `['console', グループの ID]` に1つだけ置き、`ConsoleSync`（`features/console/api/sync.ts`）が読み書きする。部品は `useData()` で読み、書くのは `sync.write()` だけ。

読み込むのは、開いたとき・「更新」・自動更新（既定3分。この端末で変えられる。隠れている・窓が開いている・表をつかんでいる・文字を打っているあいだは待つ）・書き込みのあと。

書き込みが始まると、走っている読み込みを取り消す（古いデータで上書きしないため）。書き込みの返事の `data` は、ほかの書き込みが残っていれば当てずに、全部が終わってからそっと読み直す。順番は単体テスト（`test/client/console-sync.test.ts`）で確かめる。

押してすぐ画面へ出し（楽観的な書き換え。`model/optimistic.ts` の、データを受けて新しいデータを返す関数。仮のIDは `__tmp__`）、返事の `data` で本物に置き換える。失敗したら戻して読み直す。

ブラウザの控え（`taku.cache:<ID>`）には、サーバーから来たデータだけを書き、開いたときにまず出す。ログアウトと「見つかりません」で消す。控えには `src/shared/api.ts` の形の印（`__API_SHAPE__`。`vite.config.ts` が組み立てのときに入れる）を一緒に置き、印が違えば使わない。公開で画面のデータに欄が増えたあと、古い形の控えで描いて画面が落ちないようにするため。

ログインが切れていたらログインし直す（続けて2回まで）。グループが消えていたら「見つかりません」を出す。

運営の管理画面のデータは `['admin', …]`（`features/operator/api.ts`）。変えたあとと「更新」のときだけ読み直す。

**部品**（`ui/`）。

窓（`Modal.tsx`）はbodyの直下の層に描き、`hidden` で開け閉めする。開いているあいだは後ろを触れなくし（inert）、閉じたらフォーカスを戻す。Escはいちばん手前の窓だけを閉じる。確かめる窓（`confirm.tsx`）は、ほかの窓より手前の層に出す。

窓の下のボタンは右に寄せ、「やめる」「閉じる」の右に進むボタンを置く。消すなど危ないボタン（`danger`）は左の端に置く（`components.css` の `.modal .btns`）。スマホでは進むボタンを広げる。

設定を保存するボタンは、変えるまで押せないようにする（書きかけがあるか、いまの値と違うときだけ押せる）。押しても何も変わらない、ということを無くすため。

長い名前やURLは、切れ目が無くても折り返す（`base.css` の `overflow-wrap`）。名前を入れる選ぶ欄には最大の幅を付け、表の名前の列は折り返す。ページが横にはみ出さないように。

グループの画面が読めない・グループが消された・ログインし直せないときは、カードで知らせて次にすることのボタンを出す（`shell/Loading.tsx`）。消されたあとは、タブを隠す。

画面の状態（選んでいる日・開いている窓など）は、小さな入れ物（`store.ts`。`useSyncExternalStore`）に置く。書きかけの入力は、保存するまで読み直しで上書きしない。

アイコンは `<Icon name>` で、SVGとしてJSに入っている（画像やフォントは読まない）。`icons.ts` が `~icons/material-symbols/<名前>-outline-rounded` をimportし、[unplugin-icons](https://github.com/unplugin/unplugin-icons) が組み立てのときにSVGのReactの部品にする。名前は `ICONS` の鍵で、型で確かめる。大きさは文字の大きさ（1em）、色は文字の色。いま開いているタブなど押してあることを示すときは、塗りの形（`filled`。`FILLED`）。

React向けの変換は、unplugin-iconsの既定（`@svgr` とBabelが要る）を使わず、`tools/icons.ts` の `reactIconCompiler` で、外側の `<svg>` の属性と中身をそのまま入れる。中身はアイコンの集まりのSVGで、利用者の入力は入らない。

使ってよい集まりは、ライセンスを確かめたものだけ（`tools/icons.ts` の `ALLOWED_ICON_SETS`。今はMaterial SymbolsのApache License 2.0）。`test/client/contract.test.js` が、使っている集まりと、その `info.json` のライセンスを突き合わせる。

サイトも同じ集まりをunplugin-iconsで使う（Vueの部品。`website/.vitepress/theme/icons.ts` と `<Ms name>`）。トップのページの特長は、VitePressがHTMLの文字で受け取るので、`~icons/…?raw` のSVGの文字を渡す（`HomeFeatures.vue`）。SNS用の画像を書き出す道具（`website/tools/og-image.js`）も、同じ集まりのSVGをページに入れる。

開発用ログインの部品は `import.meta.env.DEV` のときだけ描くので、本番の組み立てでは消える（`noDevLogin` がJSを見て確かめる）。ログアウトと開発用ログインは、素のフォームのPOST（サーバーがcookieを付けて移す）。

確かめの道具（e2e・スクリーンショット）は、要素のID・`data-*`・`body[data-area|data-tab]`・`window.yoki`（`D`・`selectDay`・`showTab`）を使う。変えるときは道具も直す。

**グループの画面**（`features/console/`）。ふだんの区域（カレンダー・募集・調整・メンバーの予定の3つのタブと、あなたのメニューから開く設定）と、管理の区域（メンバーの登録・卓をまとめて変える・知らせ・このグループ・管理者・送信の記録・グループを消す）に分ける。外枠（`shell/ConsoleLayout.tsx`）は1つで、`body[data-area]` と `body[data-tab]` を置く。

| フォルダ | 中身 |
|---|---|
| `api/` | 呼び出し（`rpc.ts`）・読み書きの順番（`sync.ts`）・Discordへの送信（`discord.ts`） |
| `model/` | 卓の読み方・日付・知らせの決まり・楽観的な書き換え（データを受けて返すだけの関数） |
| `shell/` | 外枠・上の帯（ヘルプとあなたのメニュー・管理画面への入口）とタブ・読み込み中 |
| `calendar/`・`recruit/`・`avail/`・`settings/` | タブ（募集・調整のタブには、候補日を選ぶ窓も） |
| `form/` | 卓の登録の窓と変更の窓（開く頼みに卓のIDがあれば変更の窓。共通の欄・入力の決まり・保存は分けて置く）と、参加者を決める窓 |
| `admin/` | 管理の区域の区分 |

画面は見る人の手元の暦で日付を扱う（今日は、サーバーが日本時間で決めた `today`）。

**見た目**（Tailwind CSS v4。`index.css` が入口で、`@tailwindcss/vite` が組み立てる）。

層の順はtheme（トークン）→ base（要素の既定）→ components（部品）→ utilities（Tailwindのクラス）。ほとんどの見た目は、部品のJSXにTailwindのクラスで書く。

トークン（`styles/theme.css`）: Tailwindの既定のトークン（色の一覧・remの寸法）は使わず、置いたものだけを使う。寸法はpxで数える（`--spacing: 1px`。`p-10` は10px）。文字の大きさは `text-13` など、幅の区切りは401・601・701・761・901・1061px（`sm:` は601px以上、`max-sm:` は600px以下）。

色は、明るい・ダーク・OSのダークで値の変わる変数（`--card` など）に置き、`@theme inline` でTailwindの色にする（`bg-card` は `var(--card)` を読む）。ダークの色は変数が変わるので、`dark:` はほとんど要らない。`dark:` は `data-theme="dark"` と、明るいを選んでいないOSのダークの両方に効く。

配色: サービスアイコンの青（`#2D2AFE`）を、上の帯と大事なボタンに大きく使う。オレンジ・ピンク・黄は差し色。明るいが基本で、ダークは紺の地に明るめの青。

アイコンの色は `brand`・`brand-light`・`orange`・`pink`・`yellow`・`cream` として、明るい・ダークで変えずに置く。飾り（グループの頭文字の札・入口の紹介など）に使う。

字の色は、地の色と組になった変数を使う（`accent-text`・`ok-text`・`soon-text` など）。オレンジは白い地の小さな字には読みにくいので、字には濃いオレンジの `soon-text` を使う。

文字はNoto Sans JP（Google Fontsから読む。`index.html`・Workerのページ・サイトも同じ）。読めないあいだと、つながらないときは端末の字で出す。

要素の既定（`styles/base.css`）: 文字・リンク・見出し・欄・表・フォームの中の名前・文字の大きさの設定（bodyのzoom）。Tailwindのpreflight（要素の既定の見た目を消すCSS）は使わない。入れると、ブラウザの既定に頼っている見た目（見出しや段落の余白・ボタンの字など）が多くの部品で変わるため。

部品（`styles/components.css`）: いくつもの画面で使う形だけを置く（アイコン・説明・カード・ボタン・ボタンの並び・欄の行・表の枠と行・窓の箱）。場面ごとの調整は、Tailwindのクラスで上書きする（クラスは部品に勝つ）。

くり返すクラスの組み合わせは、TypeScriptの定数にする（`ui/chrome.ts` の上の帯、`ui/fields.ts` の設定の欄、`features/console/styles.ts` の知らせの行や札など）。クラスの名前は文字列のつなぎで組み立てない（Tailwindはファイルの文字から名前を探すので、組み立てた名前のCSSは出ない）。

Workerのページ（知らせと規約。`routes/html.ts`）・サイト（`website/.vitepress/theme/style.css`）・SNS用の画像（`website/tools/og-image.html`）・`manifest.webmanifest` と `theme-color` はTailwindを通らないので、同じ色を別に書いている。配色を変えるときは、`theme.css` と一緒に直す。

## サイト（website/）

紹介と使い方のページは、アプリとは別にVitePressで組み立て、GitHub Pagesに置く（Workerからは配らない）。アプリの「使い方」のボタンは、サイトを新しいタブで開く。

使い方の例（予定表・参加希望・日程調整・卓の登録）はVueの部品で、押して試せる。例の日付は、見る人の手元の暦で「次の月曜」から数える。組み立てのときは決まった日で描き、ブラウザで数え直す（組み立てたHTMLと食い違わないように）。

スクリーンショットは、開発サーバーのサンプルのグループで撮って（`npm run screenshots`）、リポジトリに入れる。サイトの組み立て（GitHub Actions）では、アプリを動かさない。

アイコンは、元の絵 `brand/yoki.png` 1枚から `npm run icons`（`website/tools/icons.js`）で書き出し、アプリとサイトの `public/` に同じものを置く。ブラウザ（Playwright）のcanvasで縮め、ICOはPNGを詰めてNodeで作る。どのページの頭のタグも同じファイルを指す（Workerのページは `routes/html.ts` の `HEAD_ICONS`。テストが確かめる）。manifestの `display` は `browser`（ホーム画面から開いても、Discordのログインがふつうのブラウザで進むように）。

検索はVitePressの手元の検索。日本語は語の間に空白が無いので、`Intl.Segmenter` で語に分けて索引を作る。

## 開発とテスト

`npm run dev`: ViteとCloudflareのプラグインで、WorkerとローカルのD1ごと動く。開発用ログイン（`auth/dev.ts`）は `import.meta.env.DEV` のときだけ登録され、本番のビルドからは消える（組み立てたJSに残っていたら、vite.config.tsの `noDevLogin` が組み立てを止める）。

`npm test`: サーバーのテストは `@cloudflare/vitest-pool-workers` で、Workersの実行環境とローカルのD1で動かす。テストごとに表を空にする。Discordへの通信は `vi.spyOn(globalThis, 'fetch')` で差し替える。

`npm run e2e`: Playwrightで、開発用ログインから卓の登録・日程調整の回答、グループの管理画面、グループを消す、運営の管理画面（ログインを切る・締め出す）までを通す。

## 公開

公開の道は2つある。どちらでも、公開するCloudflareごとに違う値はリポジトリに置かない（OSSとして）。

**「Deploy to Cloudflare」のボタン**（主な道）。Cloudflareが、設置する人のGitHubに中身を写したリポジトリを作り、D1を作ってそのIDを写した先の `wrangler.jsonc` に書き込み、Workers Buildsで公開する。このあとも、写した先のmainが変わるたびに、Workers Buildsが `npm run build` と `npm run deploy`（`wrangler d1 migrations apply DB --remote` のあと `wrangler deploy`）で公開し直す。元のリポジトリの側の用意は次のとおり。

`wrangler.jsonc` にはD1のIDを書かない（Cloudflareが作って書き込む）。手元の開発とテストは、IDが無くても動く。

Workerの値（DiscordアプリのClient IDとSecret・Botのトークン・運営者のID・公開のアドレス・Google）は、どれもWorkerのsecretにする（`src/worker/env.ts`）。Workers Buildsは公開のたびに、設定に無いvarsを消すため。ボタンが聞く名前は、`.dev.vars.example` のコメントでない行で、説明は `package.json` の `"cloudflare"` に書く。任意の値は、聞かれないようにコメントにしてある。

Viteは `wrangler deploy` の行き先（`.wrangler/deploy/config.json`）を、root（`src/client`）の下に書く。リポジトリの直下で動く `wrangler deploy` から見えるように、組み立ての終わりに直下にも同じ行き先を書く（`vite.config.ts` の `deployRedirect`）。`wrangler d1 migrations apply` は行き先を見ないので、直下の `wrangler.jsonc`（IDが書いてある）を読む。

写した先はフォークではないので、公開のワークフロー（`deploy.yml`）は動かない（動くのは、元のリポジトリ・フォーク・`YOKI_DEPLOY_WITH_ACTIONS` を入れたリポジトリ）。サイトの公開（`pages.yml`）は、元のリポジトリでだけ動く。

**GitHub Actions**（`.github/workflows/deploy.yml`。元のリポジトリとフォーク）。mainにアプリの変更が入ったときに公開する。本番の値はGitHubのenvironment「production」に置く。組み立てのとき、`vite.config.ts` がD1のID（`YOKI_D1_DATABASE_ID`）とリポジトリの名前（`YOKI_REPOSITORY`・`YOKI_UPSTREAM`）を、組み立てた設定（`dist/yoki/wrangler.json`）に入れる。`YOKI_DEPLOY=1` のときにD1のIDが無ければ、組み立てを止める。ほかの値は、公開のたびに `wrangler deploy --secrets-file` でWorkerのsecretとして版と一緒に送る。varsにしないのは、ボタンの道と置き場所をそろえるためと、varsは公開のログに出るため（公開のリポジトリでは、Actionsのログはだれでも読める）。マイグレーションと公開は、どちらも組み立てた設定（`--config dist/yoki/wrangler.json`）で行う。

**公開のアドレス**（`auth/origin.ts`）。`APP_URL` は無くてもよい（workers.devのまま公開するとき）。そのときは届いた要求のアドレスを使う。要求の無い見回り（cron）が知らせのリンクに使うために、Discordでログインするたびに、`meta` の `app_origin` に控える（変わったときだけ書く）。

**前にCDNを置くとき**（`auth/origin.ts`）。ドメインのDNSをCloudflareに移さずに独自のドメインで公開するときは、AWS CloudFrontなどを前に置き、workers.devのアドレスへ渡す。

CDNはHostをworkers.devにして渡すので、Workerに届く要求のアドレスはworkers.devのままになる。自分のアドレス（Discordログインの戻り先・知らせのリンク・CSRFで受けるOrigin）は、`APP_URL` を正とする（`appOrigin`）。CSRFは、届いた要求のアドレスと `APP_URL` の両方を「自分」として受ける。

cookieはDomainを付けないので、ブラウザが開いたドメイン（CDNのドメイン）に付く。CDNはcookieをそのまま渡す。

workers.devへじかに来た要求も、そのまま受ける（CDNからの要求と見分けない）。ログインの戻り先とcookieは公開のアドレスに結びつくので、workers.devのままでは使えない（ログインの途中の情報がworkers.devのcookieに残り、戻り先で見つからない）。使う人を絞るのは、新規登録の受付で行う。
