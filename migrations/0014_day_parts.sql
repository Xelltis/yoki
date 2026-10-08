-- 時間帯（昼・夜）。グループの管理者が「昼と夜に分ける」を入れたグループだけ、予定の印を昼と夜に分けて持つ。
-- part は '' が終日（1日の印）、'昼'・'夜' が時間帯の印。1つの日には、終日の印か時間帯の印のどちらかだけを持つ
-- （時間帯の印を入れるときは、終日の印を昼と夜に分けてから書く）。主キーを変えるので、表を作り直して中身を移す
ALTER TABLE groups ADD COLUMN day_parts INTEGER NOT NULL DEFAULT 0;
CREATE TABLE availability_new (
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  part TEXT NOT NULL DEFAULT '' CHECK (part IN ('', '昼', '夜')),
  mark TEXT NOT NULL CHECK (mark IN ('△', '×')),
  source TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (member_id, date, part)
) WITHOUT ROWID;
INSERT INTO availability_new (member_id, date, part, mark, source) SELECT member_id, date, '', mark, source FROM availability;
DROP TABLE availability;
ALTER TABLE availability_new RENAME TO availability;
