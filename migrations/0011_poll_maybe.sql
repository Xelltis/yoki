-- 日程調整の回答に △（調整すれば行ける）を足す。表の決まり（CHECK）は変えられないので、作り直して中身を移す
CREATE TABLE poll_votes_new (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
  guest_name TEXT,
  vote TEXT NOT NULL CHECK (vote IN ('◯', '△', '×')),
  updated_at TEXT NOT NULL,
  CHECK ((member_id IS NULL) <> (guest_name IS NULL))
);
INSERT INTO poll_votes_new (session_id, date, member_id, guest_name, vote, updated_at)
  SELECT session_id, date, member_id, guest_name, vote, updated_at FROM poll_votes;
DROP TABLE poll_votes;
ALTER TABLE poll_votes_new RENAME TO poll_votes;
CREATE UNIQUE INDEX poll_votes_member ON poll_votes(session_id, date, member_id) WHERE member_id IS NOT NULL;
CREATE UNIQUE INDEX poll_votes_guest ON poll_votes(session_id, date, guest_name) WHERE guest_name IS NOT NULL;
