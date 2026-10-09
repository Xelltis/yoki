-- いつもの予定（本人が曜日ごとに決める印。グループのメンバーごと）。
-- weekly は { "曜日（0が日曜）": "△" | "×" } のJSON（空なら決めない）、weekly_until は、いつもの予定を入れ終えた最後の日
-- （予定表の範囲に新しく入った日にだけ入れる。本人が消した日に、また入れないように）
ALTER TABLE members ADD COLUMN weekly TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN weekly_until TEXT;
