-- 卓の記録とPCの台帳。終わった卓に、ログ（リプレイ）のURLと振り返りを残し、参加者ごとにPCの名前と結果（生還・ロストなど）を残す。
-- PCは卓の準備のキャラシと同じ行（session_sheets）に持つ。キャラシを出していない人も、終わった卓にはPCの名前と結果だけを書ける（URLは空）
ALTER TABLE sessions ADD COLUMN log_url TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN recap TEXT NOT NULL DEFAULT '';
ALTER TABLE session_sheets ADD COLUMN outcome TEXT NOT NULL DEFAULT '';
