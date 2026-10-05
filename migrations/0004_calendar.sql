-- カレンダーとの連携: 購読 URL（iCal）と、Google カレンダーとの連携（卓を書き込む・予定から都合の印を入れる）

-- 購読 URL（人とグループごとに 1 つ）。token は URL に入り、知っていればだれでも読めるので、長いランダムにする。
-- 作り直すと token が変わり、古い URL は読めなくなる。scope は mine（自分が GM か参加者の卓）か all（グループの卓すべて）
CREATE TABLE calendar_feeds (
  token TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('mine', 'all')),
  created_at TEXT NOT NULL,
  fetched_at TEXT,                         -- 最後に読まれた日時
  UNIQUE (group_id, user_id)
);

-- Google カレンダーとの連携（人ごと。入っているグループすべてに効く）。
-- refresh_token は Worker の secret（GOOGLE_TOKEN_KEY）で暗号化した値。画面・ログ・運営者の API には出さない。連携を外したら消す
CREATE TABLE google_links (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  write_events INTEGER NOT NULL DEFAULT 1, -- 参加する卓を Google カレンダーに書き込む
  read_busy INTEGER NOT NULL DEFAULT 1,    -- Google カレンダーの予定から、都合の印（△ ×）を入れる
  busy_from TEXT NOT NULL DEFAULT '19:00', -- 印を決める時間帯（HH:MM。to が 24:00 なら日の終わりまで）
  busy_to TEXT NOT NULL DEFAULT '23:00',
  created_at TEXT NOT NULL,
  checked_at TEXT,                         -- 見回りが最後に回った日時（回る順番に使う）
  synced_at TEXT,                          -- 卓を最後に書き込みに回った日時
  busy_at TEXT,                            -- 予定を最後に読んだ日時
  error TEXT NOT NULL DEFAULT ''           -- 最後の失敗（うまくいったら空）
);

-- Google カレンダーに書き込んだ予定（人と卓ごと）。卓や連携が消えても、Google の予定を消すまで覚えておくので、外部キーにしない。
-- hash は書き込んだ中身の要約（変わったら書き直す）。date は卓の開催日（古いものを片付ける）
CREATE TABLE google_events (
  user_id TEXT NOT NULL,
  session_id INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  date TEXT NOT NULL,
  PRIMARY KEY (user_id, session_id)
) WITHOUT ROWID;

-- 予定の印の出どころ。'' は本人が入れた印、'google' は Google カレンダーの予定から入れた印（本人が入れた印は上書きしない）
ALTER TABLE availability ADD COLUMN source TEXT NOT NULL DEFAULT '';

-- Google の予定から入れた印を、本人が消した日。この日には、もう入れない
CREATE TABLE google_dismissed (
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  PRIMARY KEY (member_id, date)
) WITHOUT ROWID;
