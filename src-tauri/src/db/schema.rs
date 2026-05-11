use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension};

pub const CURRENT_SCHEMA_VERSION: &str = "2";

pub fn schema_sql() -> &'static str {
    r#"
CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

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
  file_size     INTEGER NOT NULL DEFAULT 0,
  model_id      TEXT NOT NULL DEFAULT '',
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

pub fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(schema_sql())
        .with_context(|| "execute schema_sql batch")?;
    upgrade_ingest_records_table(conn)?;
    crate::knowledge::schema::run_knowledge_migrations(conn)
        .with_context(|| "execute knowledge schema migrations")?;

    let current: Option<String> = conn
        .query_row(
            "SELECT value FROM _meta WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )
        .optional()
        .with_context(|| "read schema_version")?;

    match current {
        None => {
            conn.execute(
                "INSERT INTO _meta (key, value) VALUES ('schema_version', ?1)",
                [CURRENT_SCHEMA_VERSION],
            )
            .with_context(|| "set schema_version")?;
        }
        Some(version) if version == CURRENT_SCHEMA_VERSION => {}
        Some(_older) => {
            // Future: apply incremental migrations here
        }
    }

    Ok(())
}

fn table_columns(conn: &Connection, table_name: &str) -> Result<Vec<String>> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table_name})"))
        .with_context(|| format!("prepare table_info for {table_name}"))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .with_context(|| format!("read table_info for {table_name}"))?
        .collect::<std::result::Result<Vec<_>, _>>()
        .with_context(|| format!("collect columns for {table_name}"))?;
    Ok(columns)
}

fn add_column_if_missing(
    conn: &Connection,
    columns: &[String],
    table_name: &str,
    column_name: &str,
    column_sql: &str,
) -> Result<()> {
    if columns.iter().any(|column| column == column_name) {
        return Ok(());
    }

    conn.execute(
        &format!("ALTER TABLE {table_name} ADD COLUMN {column_sql}"),
        [],
    )
    .with_context(|| format!("add {table_name}.{column_name} column"))?;
    Ok(())
}

fn upgrade_ingest_records_table(conn: &Connection) -> Result<()> {
    let columns = table_columns(conn, "ingest_records")?;
    add_column_if_missing(
        conn,
        &columns,
        "ingest_records",
        "file_fingerprint",
        "file_fingerprint TEXT",
    )?;
    add_column_if_missing(
        conn,
        &columns,
        "ingest_records",
        "last_scanned_at",
        "last_scanned_at TEXT",
    )?;
    add_column_if_missing(
        conn,
        &columns,
        "ingest_records",
        "parse_status",
        "parse_status TEXT NOT NULL DEFAULT 'success'",
    )?;
    add_column_if_missing(
        conn,
        &columns,
        "ingest_records",
        "error_message",
        "error_message TEXT",
    )?;

    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_ingest_records_source_fingerprint ON ingest_records(source_id, file_fingerprint)",
        [],
    )
    .with_context(|| "create ingest_records fingerprint index")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

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

    #[test]
    fn run_migrations_creates_meta_table_and_sets_version() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).expect("migrations should succeed");

        let version: String = conn
            .query_row(
                "SELECT value FROM _meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
    }

    #[test]
    fn run_migrations_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).expect("first migration should succeed");
        run_migrations(&conn).expect("second migration should succeed");
    }

    #[test]
    fn run_migrations_upgrades_legacy_ingest_records_table() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE ingest_records (
              id        TEXT PRIMARY KEY,
              source_id TEXT NOT NULL,
              scan_path TEXT NOT NULL
            );
            "#,
        )
        .expect("legacy ingest_records table should be created");

        run_migrations(&conn).expect("migrations should upgrade legacy table");

        crate::ingest::upsert::upsert_ingest_record(
            &conn,
            "codex",
            "/tmp/session.jsonl",
            "fingerprint-1",
            "success",
            None,
        )
        .expect("upsert should work after legacy migration");
    }
}
