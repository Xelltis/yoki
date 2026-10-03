-- 卓予定（Yoki）のデータベース。
-- 日付（開催日・予定・メモ）は日本時間の YYYY-MM-DD、日時（〜した時刻）は UTC の ISO 文字列。真偽は 0 / 1。

-- cron が「この時刻の仕事はもう回した」を覚える
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Discord でログインした人
CREATE TABLE users (
  id TEXT PRIMARY KEY,                -- Discord のユーザー ID
  username TEXT NOT NULL,
  global_name TEXT,
  avatar TEXT,
  guilds_checked_at TEXT NOT NULL,    -- 参加しているサーバーを Discord から読んだ日時
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);

-- ログインしたときに控えるサーバー。卓予定のグループがあるサーバーと、本人が管理できるサーバーだけ
CREATE TABLE user_guilds (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT,
  can_manage INTEGER NOT NULL DEFAULT 0,   -- オーナー・管理者・サーバー管理の権限がある
  PRIMARY KEY (user_id, guild_id)
);

-- ログインの続き。cookie の値そのものは持たず、ハッシュだけ持つ
CREATE TABLE auth_sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX auth_sessions_expires ON auth_sessions(expires_at);

-- グループ（Discord サーバーに結びつく）と、その設定
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  guild_name TEXT NOT NULL,
  guild_icon TEXT,
  title TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  next_session_seq INTEGER NOT NULL DEFAULT 1,       -- 卓の番号（S001…）の続き。使った番号は使い直さない
  webhook_url TEXT NOT NULL DEFAULT '',              -- 基本のチャンネル
  remind_webhook_url TEXT NOT NULL DEFAULT '',       -- 開催前の知らせのチャンネル（空なら基本）
  recruit_webhook_url TEXT NOT NULL DEFAULT '',      -- 募集の知らせのチャンネル（空なら基本）
  notify_on_save INTEGER NOT NULL DEFAULT 1,         -- 登録・変更のときに Discord へ送る（画面のチェックの既定）
  remind_enabled INTEGER NOT NULL DEFAULT 0,         -- 開催前の知らせを自動で送る
  remind_set_by TEXT NOT NULL DEFAULT '',            -- それを有効にした人と日時
  notify_days INTEGER NOT NULL DEFAULT 1 CHECK (notify_days BETWEEN 0 AND 30),
  notify_hour INTEGER NOT NULL DEFAULT 20 CHECK (notify_hour BETWEEN 0 AND 23),
  urge INTEGER NOT NULL DEFAULT 1,                   -- 期間前の催促
  soon INTEGER NOT NULL DEFAULT 0,                   -- 開始直前の知らせ
  soon_minutes INTEGER NOT NULL DEFAULT 30 CHECK (soon_minutes BETWEEN 5 AND 720),
  auto_finish INTEGER NOT NULL DEFAULT 1,            -- 過ぎた卓を自動で終了
  cal_months INTEGER NOT NULL DEFAULT 2 CHECK (cal_months BETWEEN 1 AND 12),
  avail_days INTEGER NOT NULL DEFAULT 60 CHECK (avail_days BETWEEN 7 AND 366)
);
CREATE INDEX groups_guild ON groups(guild_id);

-- メンバー。ログインした人は user_id で結びつく。名前はグループの中で一意
CREATE TABLE members (
  id INTEGER PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  discord_id TEXT NOT NULL DEFAULT '',     -- メンション用。ログインした人は自動で入る
  note TEXT NOT NULL DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (group_id, name)
);
CREATE UNIQUE INDEX members_user ON members(group_id, user_id) WHERE user_id IS NOT NULL;

-- シリーズごとの知らせ（送り先と、開催前の知らせの日時）。days / hour が NULL なら基本の値
CREATE TABLE series_notify (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  series TEXT NOT NULL,
  webhook_url TEXT NOT NULL DEFAULT '',
  also_base INTEGER NOT NULL DEFAULT 1,
  days INTEGER CHECK (days BETWEEN 0 AND 30),
  hour INTEGER CHECK (hour BETWEEN 0 AND 23),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (group_id, series)
);

-- 卓。画面には 'S' + seq（S001）の形で見せる
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('募集', '調整中', '開催', '終了', '中止')),
  date TEXT,                              -- 開催日
  start_time TEXT NOT NULL DEFAULT '',    -- HH:MM
  end_time TEXT NOT NULL DEFAULT '',
  place TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  series TEXT NOT NULL DEFAULT '',
  series_end TEXT,                        -- シリーズの最終日
  window_from TEXT,                       -- 期間（募集・調整中だけ）
  window_to TEXT,
  candidates TEXT NOT NULL DEFAULT '[]',  -- 日程調整の候補日（YYYY-MM-DD の JSON 配列）
  editor TEXT NOT NULL DEFAULT '',        -- 最後に保存した人の名前
  updated_at TEXT NOT NULL,
  notified_at TEXT,                       -- 開催前の知らせを送った
  asked_at TEXT,                          -- 興味ありの人に参加確認を送った
  urged_at TEXT,                          -- 期間前の催促を送った
  soon_at TEXT,                           -- 開始直前の知らせを送った
  poll_ready_at TEXT,                     -- 日程調整の回答がそろった知らせを送った
  UNIQUE (group_id, seq)
);
CREATE INDEX sessions_status_date ON sessions(status, date);

-- 卓に関わる人。メンバーなら member_id、メンバーに無い人（ゲスト）なら guest_name
CREATE TABLE session_people (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('gm', 'member', 'want', 'interest')),
  pos INTEGER NOT NULL,
  member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
  guest_name TEXT,
  CHECK ((member_id IS NULL) <> (guest_name IS NULL))
);
CREATE UNIQUE INDEX session_people_member ON session_people(session_id, role, member_id) WHERE member_id IS NOT NULL;
CREATE UNIQUE INDEX session_people_guest ON session_people(session_id, role, guest_name) WHERE guest_name IS NOT NULL;
CREATE INDEX session_people_by_member ON session_people(member_id);

-- メンバーの予定（都合の悪い日の △ ×）。空欄は参加できる
CREATE TABLE availability (
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  mark TEXT NOT NULL CHECK (mark IN ('△', '×')),
  PRIMARY KEY (member_id, date)
) WITHOUT ROWID;

-- 予定のマスに添えるメモ
CREATE TABLE avail_notes (
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  text TEXT NOT NULL CHECK (length(text) <= 200),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (member_id, date)
);

-- 日付メモ（卓と関係のない予定）
CREATE TABLE day_notes (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  text TEXT NOT NULL CHECK (length(text) <= 500),
  by_name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (group_id, date)
);

-- 日程調整の回答
CREATE TABLE poll_votes (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
  guest_name TEXT,
  vote TEXT NOT NULL CHECK (vote IN ('◯', '×')),
  updated_at TEXT NOT NULL,
  CHECK ((member_id IS NULL) <> (guest_name IS NULL))
);
CREATE UNIQUE INDEX poll_votes_member ON poll_votes(session_id, date, member_id) WHERE member_id IS NOT NULL;
CREATE UNIQUE INDEX poll_votes_guest ON poll_votes(session_id, date, guest_name) WHERE guest_name IS NOT NULL;

-- Discord へ送った記録
CREATE TABLE notify_log (
  id INTEGER PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  result TEXT NOT NULL
);
CREATE INDEX notify_log_group ON notify_log(group_id, id);
