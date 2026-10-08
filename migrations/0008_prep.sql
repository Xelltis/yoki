-- 卓の準備。HO（ハンドアウト）の枠と、PLの希望・割り当て、秘匿HO、キャラシの提出と締め切り。
-- 秘匿HO（secret）は、その卓のGMと、割り当てた本人にだけ見せる（読み込みのSQLで絞る。管理者・運営者にも見せない）

-- HOの枠。pos は卓の中の番号（消しても詰めない。割り当てと秘匿HOが別の枠に移らないように）
CREATE TABLE session_slots (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL CHECK (pos BETWEEN 1 AND 12),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 30),      -- HO1・探偵 など
  summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 500),  -- 公開HO（全員に見せる）
  secret TEXT NOT NULL DEFAULT '' CHECK (length(secret) <= 2000),   -- 秘匿HO（GMと割り当てた本人だけ）
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,      -- 割り当てたPL
  updated_at TEXT NOT NULL,
  UNIQUE (session_id, pos)
);

-- PLの希望（第1・第2希望）
CREATE TABLE slot_hopes (
  slot_id INTEGER NOT NULL REFERENCES session_slots(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL CHECK (rank IN (1, 2)),
  PRIMARY KEY (slot_id, member_id)
) WITHOUT ROWID;
CREATE INDEX slot_hopes_member ON slot_hopes(member_id);

-- 出したキャラシ（キャラクターシートのURL）。メンバーごとに1つ
CREATE TABLE session_sheets (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  url TEXT NOT NULL CHECK (length(url) <= 500),
  pc_name TEXT NOT NULL DEFAULT '' CHECK (length(pc_name) <= 50),   -- キャラクターの名前
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, member_id)
) WITHOUT ROWID;
CREATE INDEX session_sheets_member ON session_sheets(member_id);

-- キャラシの締め切り（YYYY-MM-DD）と、締め切り前の催促を送った日時（締め切りを変えたら空に戻す）
ALTER TABLE sessions ADD COLUMN sheet_due TEXT;
ALTER TABLE sessions ADD COLUMN sheet_urged_at TEXT;
CREATE INDEX sessions_sheet_due ON sessions(sheet_due) WHERE sheet_due IS NOT NULL;
