use anyhow::{Context, Result};
use rusqlite::Connection;

pub fn knowledge_schema_sql() -> &'static str {
    r#"
CREATE TABLE IF NOT EXISTS llm_providers (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  base_url            TEXT NOT NULL,
  model               TEXT NOT NULL,
  temperature         REAL NOT NULL DEFAULT 0.3,
  max_output_tokens   INTEGER NOT NULL DEFAULT 4096,
  max_cost_per_run    REAL,
  input_price_per_1k  REAL,
  output_price_per_1k REAL,
  enabled             INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_knowledge_runs (
  id                        TEXT PRIMARY KEY,
  project_id                TEXT NOT NULL,
  provider_id               TEXT NOT NULL,
  model                     TEXT NOT NULL,
  scope_type                TEXT NOT NULL,
  started_at_filter         TEXT,
  ended_at_filter           TEXT,
  selected_session_ids_json TEXT,
  status                    TEXT NOT NULL DEFAULT 'draft',
  estimated_input_tokens    INTEGER NOT NULL DEFAULT 0,
  estimated_output_tokens   INTEGER NOT NULL DEFAULT 0,
  actual_input_tokens       INTEGER NOT NULL DEFAULT 0,
  actual_output_tokens      INTEGER NOT NULL DEFAULT 0,
  actual_cost               REAL NOT NULL DEFAULT 0.0,
  last_session_updated_at   TEXT,
  error_message             TEXT,
  created_at                TEXT NOT NULL,
  finished_at               TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(provider_id) REFERENCES llm_providers(id)
);

CREATE TABLE IF NOT EXISTS knowledge_evidence (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL,
  project_id       TEXT NOT NULL,
  evidence_type    TEXT NOT NULL,
  title            TEXT NOT NULL,
  content_json     TEXT NOT NULL,
  confidence       REAL NOT NULL DEFAULT 0.5,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at       TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES project_knowledge_runs(id) ON DELETE CASCADE,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL,
  project_id  TEXT NOT NULL,
  doc_type    TEXT NOT NULL,
  title       TEXT NOT NULL,
  markdown    TEXT NOT NULL DEFAULT '',
  version     INTEGER NOT NULL DEFAULT 1,
  edited      INTEGER NOT NULL DEFAULT 0,
  export_path TEXT,
  exported_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES project_knowledge_runs(id) ON DELETE CASCADE,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS project_export_settings (
  project_id            TEXT PRIMARY KEY,
  export_dir            TEXT NOT NULL DEFAULT 'docs/agents/',
  common_tasks_filename TEXT NOT NULL DEFAULT 'common-tasks.md',
  domain_rules_filename TEXT NOT NULL DEFAULT 'domain-rules.md',
  pitfalls_filename     TEXT NOT NULL DEFAULT 'pitfalls.md',
  overwrite_strategy    TEXT NOT NULL DEFAULT 'confirm',
  updated_at            TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_runs_project
  ON project_knowledge_runs(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_evidence_run
  ON knowledge_evidence(run_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_project
  ON knowledge_documents(project_id, doc_type, version DESC);
"#
}

pub fn run_knowledge_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(knowledge_schema_sql())
        .with_context(|| "execute knowledge schema SQL")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_base_schema(conn: &Connection) {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS projects (
              id           TEXT PRIMARY KEY,
              path         TEXT NOT NULL UNIQUE,
              display_name TEXT
            );
            "#,
        )
        .unwrap();
    }

    #[test]
    fn knowledge_schema_creates_all_tables() {
        let conn = Connection::open_in_memory().unwrap();
        setup_base_schema(&conn);
        run_knowledge_migrations(&conn).expect("migration should succeed");

        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();

        assert!(tables.contains(&"llm_providers".to_string()));
        assert!(tables.contains(&"project_knowledge_runs".to_string()));
        assert!(tables.contains(&"knowledge_evidence".to_string()));
        assert!(tables.contains(&"knowledge_documents".to_string()));
        assert!(tables.contains(&"project_export_settings".to_string()));
    }

    #[test]
    fn knowledge_migration_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        setup_base_schema(&conn);
        run_knowledge_migrations(&conn).expect("first migration should succeed");
        run_knowledge_migrations(&conn).expect("second migration should succeed");
    }

    #[test]
    fn cascade_delete_removes_evidence_and_documents() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        setup_base_schema(&conn);
        run_knowledge_migrations(&conn).unwrap();

        conn.execute(
            "INSERT INTO projects (id, path) VALUES ('p1', '/tmp/proj')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO llm_providers (id, name, base_url, model, created_at, updated_at) VALUES ('prov1', 'test', 'http://localhost', 'gpt-4', '2026-01-01', '2026-01-01')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO project_knowledge_runs (id, project_id, provider_id, model, scope_type, status, created_at) VALUES ('run1', 'p1', 'prov1', 'gpt-4', 'all', 'completed', '2026-01-01')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO knowledge_evidence (id, run_id, project_id, evidence_type, title, content_json, created_at) VALUES ('ev1', 'run1', 'p1', 'pitfall', 'test', '{}', '2026-01-01')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO knowledge_documents (id, run_id, project_id, doc_type, title, created_at, updated_at) VALUES ('doc1', 'run1', 'p1', 'pitfalls', 'Pitfalls', '2026-01-01', '2026-01-01')",
            [],
        )
        .unwrap();

        conn.execute(
            "DELETE FROM project_knowledge_runs WHERE id = 'run1'",
            [],
        )
        .unwrap();

        let ev_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM knowledge_evidence", [], |row| {
                row.get(0)
            })
            .unwrap();
        let doc_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM knowledge_documents", [], |row| {
                row.get(0)
            })
            .unwrap();

        assert_eq!(ev_count, 0);
        assert_eq!(doc_count, 0);
    }
}
