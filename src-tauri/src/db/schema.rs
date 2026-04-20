pub fn schema_sql() -> &'static str {
    // Keep DDL as a single string so callers can execute it as a batch.
    r#"
CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  path         TEXT NOT NULL UNIQUE,
  display_name TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  source_id     TEXT NOT NULL,
  project_id    TEXT,
  external_id   TEXT NOT NULL,
  title         TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  ended_at      TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  summary_hint  TEXT,
  raw_ref       TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  UNIQUE(source_id, external_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  role          TEXT NOT NULL,
  content_text  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  seq_no        INTEGER NOT NULL,
  metadata_json TEXT,
  FOREIGN KEY(session_id) REFERENCES sessions(id),
  UNIQUE(session_id, seq_no)
);

CREATE TABLE IF NOT EXISTS ingest_records (
  id             TEXT PRIMARY KEY,
  source_id      TEXT NOT NULL,
  scan_path      TEXT NOT NULL,
  file_fingerprint TEXT NOT NULL,
  last_scanned_at TEXT,
  parse_status   TEXT NOT NULL,
  error_message  TEXT,
  UNIQUE(source_id, file_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_sessions_source_updated
  ON sessions(source_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_project_updated
  ON sessions(project_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_session_seq
  ON messages(session_id, seq_no);
"#
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_sql_contains_required_indexes() {
        let sql = schema_sql();
        assert!(sql.contains("idx_sessions_source_updated"));
        assert!(sql.contains("idx_sessions_project_updated"));
        assert!(sql.contains("idx_messages_session_seq"));
    }

    #[test]
    fn schema_sql_contains_foreign_keys_for_relations() {
        let sql = schema_sql();
        assert!(sql.contains("FOREIGN KEY(project_id)"));
        assert!(sql.contains("FOREIGN KEY(session_id)"));
    }

    #[test]
    fn schema_sql_requires_ended_at_for_current_model_shape() {
        let sql = schema_sql();
        assert!(sql.contains("ended_at      TEXT NOT NULL"));
    }
}
