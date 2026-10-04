-- 知らせを Webhook から Bot（Discord アプリ）に替える。送り先は URL ではなく、Discord のチャンネル（ID）で持つ。
-- まだ公開前なので、Webhook の URL は移さずに消す

-- 基本のチャンネルと、種類ごとのチャンネル（開催前の知らせ・募集。空なら基本へ）
ALTER TABLE groups ADD COLUMN channel_id TEXT NOT NULL DEFAULT '';
ALTER TABLE groups ADD COLUMN remind_channel_id TEXT NOT NULL DEFAULT '';
ALTER TABLE groups ADD COLUMN recruit_channel_id TEXT NOT NULL DEFAULT '';
ALTER TABLE groups DROP COLUMN webhook_url;
ALTER TABLE groups DROP COLUMN remind_webhook_url;
ALTER TABLE groups DROP COLUMN recruit_webhook_url;

-- シリーズ専用のチャンネル（空なら基本へ）
ALTER TABLE series_notify ADD COLUMN channel_id TEXT NOT NULL DEFAULT '';
ALTER TABLE series_notify DROP COLUMN webhook_url;
