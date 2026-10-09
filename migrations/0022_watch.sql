-- 見学の枠。卓に関わる人に、見学（watch。参加はしないが見る人）を足す。定員にも参加者にも数えない。
-- 役の決まり（CHECK）を変えるので、表を作り直して中身を移す（索引も作り直す）
CREATE TABLE session_people_new (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('gm', 'member', 'want', 'interest', 'watch')),
  pos INTEGER NOT NULL,
  member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
  guest_name TEXT,
  CHECK ((member_id IS NULL) <> (guest_name IS NULL))
);
INSERT INTO session_people_new (session_id, role, pos, member_id, guest_name) SELECT session_id, role, pos, member_id, guest_name FROM session_people;
DROP TABLE session_people;
ALTER TABLE session_people_new RENAME TO session_people;
CREATE UNIQUE INDEX session_people_member ON session_people(session_id, role, member_id) WHERE member_id IS NOT NULL;
CREATE UNIQUE INDEX session_people_guest ON session_people(session_id, role, guest_name) WHERE guest_name IS NOT NULL;
CREATE INDEX session_people_by_member ON session_people(member_id);
