-- 自分あてのDMの知らせ（本人が選ぶ。どのグループにも効く）。
-- dm_kinds は受け取る知らせの種類（カンマ区切り。空なら受け取らない）、dm_channel はBotとのDMのチャンネル（開くたびに呼ばずに済むように控える）、
-- dm_error は最後に届かなかった理由（届けば空）
ALTER TABLE users ADD COLUMN dm_kinds TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN dm_channel TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN dm_error TEXT NOT NULL DEFAULT '';

-- 送るのを待っているDM。知らせを決めたところが積み、見回りが少しずつ送る（送ったら消す）
CREATE TABLE dm_queue (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
