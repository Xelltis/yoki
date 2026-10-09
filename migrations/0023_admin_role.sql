-- Discordのロールで管理者を決める。admin_role はそのロールのID（空なら使わない）、admin_role_name は画面に出す名前（選んだときに、Botで読んだ名前）
ALTER TABLE groups ADD COLUMN admin_role TEXT NOT NULL DEFAULT '';
ALTER TABLE groups ADD COLUMN admin_role_name TEXT NOT NULL DEFAULT '';
-- その人の、そのサーバーでのロール（Botで読んだもの。IDのJSONの配列）と、読んだ日時
ALTER TABLE user_guilds ADD COLUMN roles TEXT;
ALTER TABLE user_guilds ADD COLUMN roles_at TEXT;
