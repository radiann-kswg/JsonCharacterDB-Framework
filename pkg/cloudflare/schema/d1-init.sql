-- ============================================================
-- CreationsDB D1 スキーマ定義
-- database: creationsdb-d1
-- 用途: 正規化メタ・レコードインデックス・全文検索テーブル
-- 備考: R2 (creationsdb-data) との役割分担
--   R2 → data/**/*.json の静的ミラー（スキーマ定義・画像等フォールバック）
--   D1 → 作品/DBメタ・レコード検索インデックス・FTS5
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 作品メタ (data/db_meta.json の CreationWorks エントリに対応)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS works (
  key        TEXT PRIMARY KEY,  -- '#Works_NumberTales' 形式
  title      TEXT,
  title_en   TEXT,
  summary    TEXT,
  is_hidden  INTEGER NOT NULL DEFAULT 0,  -- Works_Hidden フラグ
  meta_json  TEXT                         -- CreationWorks entry 全体 JSON（予備参照用）
);

-- ─────────────────────────────────────────────────────────────
-- DB メタ (作品別 db_meta.json の Databases エントリに対応)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dbs (
  work_key    TEXT NOT NULL,  -- '#Works_NumberTales'
  db_key      TEXT NOT NULL,  -- '#DB_Primary' / '#Ref_Glossary'
  db_label    TEXT,
  db_label_en TEXT,
  db_layer    TEXT NOT NULL DEFAULT 'DataBases',
  is_hidden   INTEGER NOT NULL DEFAULT 0,  -- DB_Hidden フラグ
  PRIMARY KEY (work_key, db_key)
);

CREATE INDEX IF NOT EXISTS idx_dbs_work ON dbs(work_key);

-- ─────────────────────────────────────────────────────────────
-- レコード本体（検索インデックス + JSON ブロブ）
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS records (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  work_key        TEXT    NOT NULL,                     -- '#Works_NumberTales'
  db_name         TEXT    NOT NULL,                     -- 'Primary'
  idx_key         TEXT    NOT NULL DEFAULT 'Num',       -- 主インデックスフィールド（ドット記法可）
  idx_value       TEXT,                                 -- 主インデックス値
  is_private      INTEGER NOT NULL DEFAULT 0,           -- isPrivate フラグ
  searchable_text TEXT,                                 -- 全文検索用テキスト（JSON.stringify ベース）
  data_json       TEXT    NOT NULL                      -- レコード完全 JSON
);

CREATE INDEX IF NOT EXISTS idx_records_lookup
  ON records(work_key, db_name, idx_key, idx_value);

CREATE INDEX IF NOT EXISTS idx_records_list
  ON records(work_key, db_name, is_private);

-- ─────────────────────────────────────────────────────────────
-- FTS5 全文検索インデックス (D1 は FTS5 対応)
-- records テーブルの searchable_text を対象とした外部コンテンツ FTS
-- ─────────────────────────────────────────────────────────────

CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
  work_key        UNINDEXED,
  db_name         UNINDEXED,
  searchable_text,
  content         = records,
  content_rowid   = id
);

-- FTS トリガー: records の INSERT / DELETE / UPDATE に連動して FTS を同期
CREATE TRIGGER IF NOT EXISTS records_ai AFTER INSERT ON records BEGIN
  INSERT INTO records_fts(rowid, work_key, db_name, searchable_text)
    VALUES (new.id, new.work_key, new.db_name, new.searchable_text);
END;

CREATE TRIGGER IF NOT EXISTS records_ad AFTER DELETE ON records BEGIN
  INSERT INTO records_fts(records_fts, rowid, work_key, db_name, searchable_text)
    VALUES ('delete', old.id, old.work_key, old.db_name, old.searchable_text);
END;

CREATE TRIGGER IF NOT EXISTS records_au AFTER UPDATE ON records BEGIN
  INSERT INTO records_fts(records_fts, rowid, work_key, db_name, searchable_text)
    VALUES ('delete', old.id, old.work_key, old.db_name, old.searchable_text);
  INSERT INTO records_fts(rowid, work_key, db_name, searchable_text)
    VALUES (new.id, new.work_key, new.db_name, new.searchable_text);
END;
