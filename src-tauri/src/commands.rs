use std::path::PathBuf;

use rusqlite::Connection;
use serde::Serialize;

use crate::db;
use crate::ingest::scanner::scan_fixture_sources;
use crate::ingest::upsert::{initialize_database, upsert_sessions};

#[derive(Debug, Clone, Serialize)]
pub struct SessionListItem {
    pub source_id: String,
    pub title: String,
    pub updated_at: String,
    pub project_name: String,
    pub message_count: i64,
}

fn fixture_root(tool: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(tool)
}

fn list_session_items(conn: &Connection) -> Result<Vec<SessionListItem>, String> {
    let mut stmt = conn
        .prepare(
            r#"
SELECT
  sessions.source_id,
  sessions.title,
  sessions.updated_at,
  projects.display_name,
  sessions.message_count
FROM sessions
JOIN projects ON projects.id = sessions.project_id
ORDER BY sessions.updated_at DESC, sessions.source_id ASC, sessions.external_id ASC
"#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(SessionListItem {
                source_id: row.get(0)?,
                title: row.get(1)?,
                updated_at: row.get(2)?,
                project_name: row.get(3)?,
                message_count: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scan_sources() -> Result<Vec<SessionListItem>, String> {
    let result =
        scan_fixture_sources(fixture_root("claude_code"), fixture_root("codex"))
            .map_err(|e| e.to_string())?;

    let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
    db::configure_connection(&conn).map_err(|e| e.to_string())?;
    initialize_database(&conn).map_err(|e| e.to_string())?;
    upsert_sessions(&conn, &result.sessions).map_err(|e| e.to_string())?;

    list_session_items(&conn)
}
