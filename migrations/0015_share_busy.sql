-- ほかのグループの卓。同じ利用者がほかのグループで入っている「開催」の卓の日（と時間帯）を、このグループの予定表に「他」として出す。
-- 出すのは日と時間帯だけ（グループや卓の名前は出さない）。本人が設定で止められる（1は出す。はじめは出す）
ALTER TABLE users ADD COLUMN share_busy INTEGER NOT NULL DEFAULT 1;
