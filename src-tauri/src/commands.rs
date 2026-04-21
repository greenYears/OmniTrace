use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

use crate::db;
use crate::ingest::scanner::scan_home_sources;
use crate::ingest::upsert::{initialize_database, upsert_sessions};

#[derive(Debug, Clone, Serialize)]
pub struct SessionListItem {
    pub id: String,
    pub source_id: String,
    pub title: String,
    pub updated_at: String,
    pub project_name: String,
    pub message_count: i64,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionMessageDto {
    pub id: String,
    pub role: String,
    pub content_text: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionDetailDto {
    pub id: String,
    pub source_id: String,
    pub title: String,
    pub updated_at: String,
    pub started_at: String,
    pub ended_at: String,
    pub project_name: String,
    pub project_path: String,
    pub message_count: i64,
    pub preview: String,
    pub messages: Vec<SessionMessageDto>,
}

fn resolve_home_root() -> Result<std::path::PathBuf, String> {
    if let Some(path) = std::env::var_os("OMNITRACE_HOME_DIR") {
        return Ok(path.into());
    }

    std::env::var_os("HOME")
        .map(Into::into)
        .ok_or_else(|| "HOME is not set".to_string())
}

fn open_history_database() -> Result<Connection, String> {
    let result = scan_home_sources(resolve_home_root()?).map_err(|e| e.to_string())?;

    let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
    db::configure_connection(&conn).map_err(|e| e.to_string())?;
    initialize_database(&conn).map_err(|e| e.to_string())?;
    upsert_sessions(&conn, &result.sessions).map_err(|e| e.to_string())?;
    Ok(conn)
}

fn list_session_items(conn: &Connection) -> Result<Vec<SessionListItem>, String> {
    let mut stmt = conn
        .prepare(
            r#"
SELECT
  s.id,
  s.source_id,
  s.title,
  s.updated_at,
  p.display_name,
  s.message_count,
  COALESCE(
    (SELECT SUBSTR(m.content_text, 1, 120)
     FROM messages m
     WHERE m.session_id = s.id AND m.role = 'user'
     ORDER BY m.seq_no ASC LIMIT 1),
    ''
  )
FROM sessions s
JOIN projects p ON p.id = s.project_id
ORDER BY s.updated_at DESC, s.source_id ASC, s.external_id ASC
"#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(SessionListItem {
                id: row.get(0)?,
                source_id: row.get(1)?,
                title: row.get(2)?,
                updated_at: row.get(3)?,
                project_name: row.get(4)?,
                message_count: row.get(5)?,
                preview: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn load_session_detail(
    conn: &Connection,
    id: &str,
) -> Result<Option<SessionDetailDto>, String> {
    let session = conn
        .query_row(
            r#"
SELECT
  s.id,
  s.source_id,
  s.title,
  s.updated_at,
  s.started_at,
  s.ended_at,
  p.display_name,
  p.path,
  s.message_count,
  COALESCE(
    (SELECT SUBSTR(m.content_text, 1, 120)
     FROM messages m
     WHERE m.session_id = s.id AND m.role = 'user'
     ORDER BY m.seq_no ASC LIMIT 1),
    ''
  )
FROM sessions s
JOIN projects p ON p.id = s.project_id
WHERE s.id = ?1
"#,
            [id],
            |row| {
                Ok(SessionDetailDto {
                    id: row.get(0)?,
                    source_id: row.get(1)?,
                    title: row.get(2)?,
                    updated_at: row.get(3)?,
                    started_at: row.get(4)?,
                    ended_at: row.get(5)?,
                    project_name: row.get(6)?,
                    project_path: row.get(7)?,
                    message_count: row.get(8)?,
                    preview: row.get(9)?,
                    messages: Vec::new(),
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some(mut detail) = session else {
        return Ok(None);
    };

    let mut stmt = conn
        .prepare(
            r#"
SELECT id, role, content_text, created_at
FROM messages
WHERE session_id = ?1
ORDER BY seq_no ASC
"#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([id], |row| {
            Ok(SessionMessageDto {
                id: row.get(0)?,
                role: row.get(1)?,
                content_text: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    detail.messages = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(Some(detail))
}

#[tauri::command]
pub fn scan_sources() -> Result<Vec<SessionListItem>, String> {
    let conn = open_history_database()?;
    list_session_items(&conn)
}

#[tauri::command]
pub fn get_session_detail(id: String) -> Result<Option<SessionDetailDto>, String> {
    let conn = open_history_database()?;
    load_session_detail(&conn, &id)
}
