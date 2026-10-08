-- 卓の変更の履歴。だれが・いつ・何をしたか（登録・変更・まとめての変更・日程調整・行けなくなった）を卓ごとに残す。
-- 卓を消すと一緒に消える。毎日の片付けで、卓ごとに新しい50件だけを残す
CREATE TABLE session_history (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  by_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX session_history_session ON session_history(session_id, id);
