-- 行けなくなった（開催の卓の参加者が、行けなくなったことをGMに伝えた印）。本人が付け外しする。
-- 開催日が変わる・開催でなくなる・参加者から外れると消す（卓の保存とまとめての変更が、同じbatchで消す）
CREATE TABLE session_absences (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 200),   -- GMへの一言
  at TEXT NOT NULL,
  PRIMARY KEY (session_id, member_id)
) WITHOUT ROWID;
