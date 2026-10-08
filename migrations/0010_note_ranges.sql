-- 日付メモを期間で書けるようにする（合宿・テスト期間など、何日か続く予定）。
-- date は期間の始まり、end_date は終わり（1日だけのメモは NULL）。1つの日に始まるメモは、今までどおり1つだけ
ALTER TABLE day_notes ADD COLUMN end_date TEXT;
