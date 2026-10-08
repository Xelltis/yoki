-- 卓ごとのスレッド。グループの管理者が入れると、卓の知らせ（登録・変更・日程調整・準備・催促など）を、卓ごとのスレッドにまとめる。
-- スレッドは、その卓の最初の知らせのメッセージから作る。thread_id はスレッド（チャンネル）のID、thread_parent はスレッドを作ったチャンネルのID
ALTER TABLE groups ADD COLUMN threads INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN thread_id TEXT;
ALTER TABLE sessions ADD COLUMN thread_parent TEXT;
