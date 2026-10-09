-- 日程調整の回答の締め切り（調整中の卓が候補日を出したときだけ持つ）。
-- poll_due は回答を待つ最後の日（NULLなら決めない）、poll_urged_at は締め切りの前日に、まだ答えていない人へ催促した日時、
-- poll_closed_at は締め切りが過ぎたことをGMに知らせた日時（どちらも二重に送らないため）
ALTER TABLE sessions ADD COLUMN poll_due TEXT;
ALTER TABLE sessions ADD COLUMN poll_urged_at TEXT;
ALTER TABLE sessions ADD COLUMN poll_closed_at TEXT;
