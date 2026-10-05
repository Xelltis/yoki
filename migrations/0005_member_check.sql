-- その人がそのサーバーにいることを、Bot で確かめた日時。ログインで読んだサーバーの一覧（users.guilds_checked_at）が古くても、
-- こちらが新しければ聞き直さない（Bot がいるサーバーでは、Discord のログインの画面へ送らずに済ませるため）
ALTER TABLE user_guilds ADD COLUMN checked_at TEXT;
