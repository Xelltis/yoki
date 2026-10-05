-- Google でログインする（Discord のアカウントに結びつけた、もう 1 つの入り口）。人ごとに 1 つ、Google のアカウントごとに 1 人。
-- 利用者そのものは今までどおり Discord のアカウント（users）。初めて Google でログインした人は、続けて Discord でログインして結びつける
CREATE TABLE google_logins (
  google_sub TEXT PRIMARY KEY,                                   -- Google のアカウントの ID（変わらない）
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,                                           -- 本人に、どのアカウントかを見せるため
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
