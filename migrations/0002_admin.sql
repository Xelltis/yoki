-- 管理画面（運営者の画面と、グループの管理者の画面）のための追加

-- 締め出し。印のある人はログインできない（印を残すため、users の行は消さない）
ALTER TABLE users ADD COLUMN banned_at TEXT;
ALTER TABLE users ADD COLUMN banned_reason TEXT NOT NULL DEFAULT '';

-- 最後に使われた日時。画面から呼ばれたとき、10 分に 1 回まで書き換える。
-- 今あるグループは、卓をいちばん最近変えた日時（無ければ作った日時）で埋める
ALTER TABLE groups ADD COLUMN last_used_at TEXT;
UPDATE groups SET last_used_at = coalesce((SELECT max(updated_at) FROM sessions WHERE sessions.group_id = groups.id), created_at);

-- 人ごとのログインを数える・消す（ログインを切る・締め出す）
CREATE INDEX auth_sessions_user ON auth_sessions (user_id);
-- グループをまたいで、最近の送信の失敗を数える
CREATE INDEX notify_log_at ON notify_log (at);
