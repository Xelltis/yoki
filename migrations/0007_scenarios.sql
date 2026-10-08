-- シナリオと通過。グループで遊ぶシナリオを登録し、だれが通過したか（遊んだ・GMをした）を持つ。
-- 「終了」の卓にシナリオが付いていれば、その卓のGMと参加者は通過したものとして扱う（読み込みのときに卓から計算し、ここには書かない）。
-- ここに書くのは、本人や管理者が付けた印と、「終了」の卓を消すときに書き写した通過

CREATE TABLE scenarios (
  id INTEGER PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  system TEXT NOT NULL DEFAULT '' CHECK (length(system) <= 50),           -- 遊ぶシステム（クトゥルフ神話TRPGなど）
  players_min INTEGER CHECK (players_min BETWEEN 1 AND 20),             -- PLの人数（GMは数えない）
  players_max INTEGER CHECK (players_max BETWEEN 1 AND 20),
  hours TEXT NOT NULL DEFAULT '' CHECK (length(hours) <= 20),             -- 遊ぶ時間の目安（「4時間」など）
  url TEXT NOT NULL DEFAULT '' CHECK (length(url) <= 500),                -- 配布や販売のページ
  memo TEXT NOT NULL DEFAULT '' CHECK (length(memo) <= 500),
  created_by INTEGER REFERENCES members(id) ON DELETE SET NULL,           -- 登録した人（消せるのは、この人と管理者）
  updated_at TEXT NOT NULL,
  UNIQUE (group_id, name)
);

-- 通過の印。played は遊んだ（PL）、gm はGMをした・GMできる（中身を知っている）。どちらも、PLとしては遊べない
CREATE TABLE member_scenarios (
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('played', 'gm')),
  at TEXT NOT NULL,
  PRIMARY KEY (scenario_id, member_id)
) WITHOUT ROWID;
CREATE INDEX member_scenarios_member ON member_scenarios(member_id);

-- 卓で遊ぶシナリオ（無ければ NULL）。シナリオを消したら外す
ALTER TABLE sessions ADD COLUMN scenario_id INTEGER REFERENCES scenarios(id) ON DELETE SET NULL;
