-- 卓をDiscordのサーバーのイベント（Guild Scheduled Event）にも出す。グループごとに管理者が入れる（初めは切ってある）。
-- 書くのは見回り。卓を変える呼び出しは、書き直しが要る印（events_pending）を付けるだけ（重なって同じイベントを2つ作らないように）
ALTER TABLE groups ADD COLUMN discord_events INTEGER NOT NULL DEFAULT 0;   -- 卓をDiscordのイベントにも出す
ALTER TABLE groups ADD COLUMN events_pending INTEGER NOT NULL DEFAULT 0;   -- イベントの書き直しが要る（見回りが拾って0に戻す）
ALTER TABLE groups ADD COLUMN events_error TEXT NOT NULL DEFAULT '';       -- 最後の失敗（うまくいけば空）。管理画面に出す
CREATE INDEX groups_events_pending ON groups(events_pending) WHERE events_pending = 1;

-- 作ったイベント（グループと卓ごと）。卓やグループが消えても、サーバーを付け替えても、Discordのイベントを消すまで覚えておくので、外部キーにしない。
-- guild_id は作ったサーバー、hash は書いた中身の要約（変わったら書き直す）、start_at は始まりの時刻（始まったイベントは触らない）
CREATE TABLE discord_events (
  group_id TEXT NOT NULL,
  session_id INTEGER NOT NULL,
  guild_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  hash TEXT NOT NULL,
  date TEXT NOT NULL,
  start_at TEXT NOT NULL,
  PRIMARY KEY (group_id, session_id)
) WITHOUT ROWID;
