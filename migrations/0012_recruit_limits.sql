-- 募集の定員と締め切り（募集中の卓だけが持つ）。
-- capacity は参加希望を受ける人数（GMは数えない。NULLなら決めない）、recruit_due は参加希望・興味ありを受ける最後の日（NULLなら決めない）、
-- due_urged_at は締め切りの日にGMへ知らせた日時（二重に送らないため）
ALTER TABLE sessions ADD COLUMN capacity INTEGER CHECK (capacity BETWEEN 1 AND 20);
ALTER TABLE sessions ADD COLUMN recruit_due TEXT;
ALTER TABLE sessions ADD COLUMN due_urged_at TEXT;
