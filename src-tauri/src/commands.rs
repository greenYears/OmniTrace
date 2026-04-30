use std::path::Path;
use std::sync::{LazyLock, Mutex};

use chrono::{DateTime, Duration, FixedOffset, NaiveDate, Utc};
use rusqlite::{Connection, OptionalExtension};
use serde::Deserialize;
use serde::Serialize;
use tauri::Emitter;

use crate::db;
use crate::domain::detail::{parse_detail_messages, DetailMessageRecord};
use crate::ingest::scanner::ScanResult;
use crate::ingest::scanner::{scan_home_sources_with_progress, SessionScanProgress};
use crate::ingest::token_probe::{probe_token_usage_with_progress, TokenUsageProbeReport};
use crate::ingest::upsert::{initialize_database, upsert_sessions};

static SCAN_CACHE: LazyLock<Mutex<Option<ScanResult>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Debug, Clone, Serialize)]
pub struct SessionListItem {
    pub id: String,
    pub resume_id: String,
    pub source_id: String,
    pub title: String,
    pub updated_at: String,
    pub project_name: String,
    pub project_path: String,
    pub message_count: i64,
    pub preview: String,
    pub file_size: i64,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionMessageDto {
    pub id: String,
    pub role: String,
    pub kind: String,
    pub content_text: String,
    pub created_at: String,
    pub tool_name: Option<String>,
    pub file_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionDetailDto {
    pub id: String,
    pub resume_id: String,
    pub source_id: String,
    pub title: String,
    pub updated_at: String,
    pub started_at: String,
    pub ended_at: String,
    pub project_name: String,
    pub project_path: String,
    pub message_count: i64,
    pub preview: String,
    pub file_size: i64,
    pub model_id: String,
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

fn load_scan_result(force_refresh: bool) -> Result<ScanResult, String> {
    load_scan_result_with_progress(force_refresh, |_event| {})
}

fn load_scan_result_with_progress<F>(
    force_refresh: bool,
    mut on_progress: F,
) -> Result<ScanResult, String>
where
    F: FnMut(SessionScanProgress),
{
    let mut cache = SCAN_CACHE
        .lock()
        .map_err(|_| "scan cache poisoned".to_string())?;
    if force_refresh || cache.is_none() {
        let result = scan_home_sources_with_progress(resolve_home_root()?, &mut on_progress)
            .map_err(|e| e.to_string())?;
        *cache = Some(result.clone());
        return Ok(result);
    }

    cache
        .as_ref()
        .cloned()
        .ok_or_else(|| "scan cache missing".to_string())
}

fn open_history_database(force_refresh: bool) -> Result<Connection, String> {
    let result = load_scan_result(force_refresh)?;

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
  s.external_id,
  s.source_id,
  s.title,
  s.updated_at,
  p.display_name,
  p.path,
  s.message_count,
  COALESCE(
    (SELECT SUBSTR(m.content_text, 1, 120)
     FROM messages m
     WHERE m.session_id = s.id AND m.role = 'user'
     ORDER BY m.seq_no ASC LIMIT 1),
    ''
  ),
  s.file_size,
  s.model_id
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
                resume_id: row.get(1)?,
                source_id: row.get(2)?,
                title: row.get(3)?,
                updated_at: row.get(4)?,
                project_name: row.get(5)?,
                project_path: row.get(6)?,
                message_count: row.get(7)?,
                preview: row.get(8)?,
                file_size: row.get(9)?,
                model_id: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn beijing_offset() -> FixedOffset {
    FixedOffset::east_opt(8 * 3600).expect("Asia/Shanghai offset should be valid")
}

fn filter_session_items_by_time_range(
    sessions: Vec<SessionListItem>,
    time_range: Option<&str>,
    now: DateTime<FixedOffset>,
) -> Vec<SessionListItem> {
    let Some(time_range) = time_range.filter(|value| *value != "all") else {
        return sessions;
    };
    let today = now.date_naive();
    let (start_date, end_date) = match time_range {
        "today" => (today, today),
        "7d" => (today - Duration::days(6), today),
        "30d" => (today - Duration::days(29), today),
        value if value.starts_with("custom:") => {
            let parts = value.split(':').collect::<Vec<_>>();
            if parts.len() != 3 {
                return Vec::new();
            }
            let Ok(start_date) = NaiveDate::parse_from_str(parts[1], "%Y-%m-%d") else {
                return Vec::new();
            };
            let Ok(end_date) = NaiveDate::parse_from_str(parts[2], "%Y-%m-%d") else {
                return Vec::new();
            };
            if start_date > end_date {
                return Vec::new();
            }
            (start_date, end_date)
        }
        _ => return sessions,
    };

    sessions
        .into_iter()
        .filter(|session| {
            DateTime::parse_from_rfc3339(&session.updated_at)
                .map(|updated_at| {
                    let updated_date = updated_at.with_timezone(&beijing_offset()).date_naive();
                    updated_date >= start_date && updated_date <= end_date
                })
                .unwrap_or(false)
        })
        .collect()
}

fn load_session_detail(conn: &Connection, id: &str) -> Result<Option<SessionDetailDto>, String> {
    #[derive(Debug, Clone)]
    struct SessionRow {
        id: String,
        resume_id: String,
        source_id: String,
        title: String,
        updated_at: String,
        started_at: String,
        ended_at: String,
        project_name: String,
        project_path: String,
        message_count: i64,
        preview: String,
        raw_ref: String,
        file_size: i64,
        model_id: String,
    }

    let session = conn
        .query_row(
            r#"
SELECT
  s.id,
  s.external_id,
  s.source_id,
  s.title,
  s.updated_at,
  s.started_at,
  s.ended_at,
  p.display_name,
  p.path,
  s.message_count,
  s.raw_ref,
  COALESCE(
    (SELECT SUBSTR(m.content_text, 1, 120)
     FROM messages m
     WHERE m.session_id = s.id AND m.role = 'user'
     ORDER BY m.seq_no ASC LIMIT 1),
    ''
  ),
  s.file_size,
  s.model_id
FROM sessions s
JOIN projects p ON p.id = s.project_id
WHERE s.id = ?1
"#,
            [id],
            |row| {
                Ok(SessionRow {
                    id: row.get(0)?,
                    resume_id: row.get(1)?,
                    source_id: row.get(2)?,
                    title: row.get(3)?,
                    updated_at: row.get(4)?,
                    started_at: row.get(5)?,
                    ended_at: row.get(6)?,
                    project_name: row.get(7)?,
                    project_path: row.get(8)?,
                    message_count: row.get(9)?,
                    raw_ref: row.get(10)?,
                    preview: row.get(11)?,
                    file_size: row.get(12)?,
                    model_id: row.get(13)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some(session) = session else {
        return Ok(None);
    };

    let parsed_messages = if !session.raw_ref.is_empty() {
        parse_detail_messages(&session.source_id, Path::new(&session.raw_ref)).ok()
    } else {
        None
    };

    let messages =
        if let Some(parsed_messages) = parsed_messages.filter(|messages| !messages.is_empty()) {
            parsed_messages
                .into_iter()
                .map(|message| map_detail_record(&session.id, message))
                .collect::<Vec<_>>()
        } else {
            load_db_session_messages(conn, id)?
        };

    let detail = SessionDetailDto {
        id: session.id,
        resume_id: session.resume_id,
        source_id: session.source_id,
        title: session.title,
        updated_at: session.updated_at,
        started_at: session.started_at,
        ended_at: session.ended_at,
        project_name: session.project_name,
        project_path: session.project_path,
        message_count: session.message_count,
        preview: session.preview,
        file_size: session.file_size,
        model_id: session.model_id,
        messages,
    };

    Ok(Some(detail))
}

#[derive(Debug, Default, Deserialize)]
struct MessageMetadata {
    kind: Option<String>,
    tool_name: Option<String>,
    #[serde(default)]
    file_paths: Vec<String>,
}

fn load_db_session_messages(conn: &Connection, id: &str) -> Result<Vec<SessionMessageDto>, String> {
    let mut stmt = conn
        .prepare(
            r#"
SELECT id, role, content_text, created_at, metadata_json
FROM messages
WHERE session_id = ?1
ORDER BY seq_no ASC
"#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([id], |row| {
            let metadata_json: String = row.get(4)?;
            let metadata =
                serde_json::from_str::<MessageMetadata>(&metadata_json).unwrap_or_default();
            Ok(SessionMessageDto {
                id: row.get(0)?,
                role: row.get(1)?,
                kind: metadata.kind.unwrap_or_else(|| "message".to_string()),
                content_text: row.get(2)?,
                created_at: row.get(3)?,
                tool_name: metadata.tool_name,
                file_paths: metadata.file_paths,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn map_detail_record(session_id: &str, record: DetailMessageRecord) -> SessionMessageDto {
    SessionMessageDto {
        id: format!("{session_id}:{}", record.seq_no),
        role: record.role,
        kind: record.kind,
        content_text: record.content_text,
        created_at: record.created_at,
        tool_name: record.tool_name,
        file_paths: record.file_paths,
    }
}

#[tauri::command]
pub async fn scan_sources(
    window: tauri::Window,
    time_range: Option<String>,
) -> Result<Vec<SessionListItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = load_scan_result_with_progress(true, |progress| {
            let _ = window.emit("session-scan-progress", progress);
        })?;
        let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        db::configure_connection(&conn).map_err(|e| e.to_string())?;
        initialize_database(&conn).map_err(|e| e.to_string())?;
        upsert_sessions(&conn, &result.sessions).map_err(|e| e.to_string())?;
        let sessions = list_session_items(&conn)?;
        Ok(filter_session_items_by_time_range(
            sessions,
            time_range.as_deref(),
            Utc::now().with_timezone(&beijing_offset()),
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_session_detail(id: String) -> Result<Option<SessionDetailDto>, String> {
    let conn = open_history_database(false)?;
    load_session_detail(&conn, &id)
}

#[tauri::command]
pub async fn probe_token_usage_sources(
    window: tauri::Window,
) -> Result<TokenUsageProbeReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        probe_token_usage_with_progress(&resolve_home_root()?, |progress| {
            let _ = window.emit("token-probe-progress", progress);
        })
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn delete_session(id: String) -> Result<(), String> {
    let conn = open_history_database(false)?;

    let raw_ref: Option<String> = conn
        .query_row("SELECT raw_ref FROM sessions WHERE id = ?1", [&id], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(ref path) = raw_ref {
        if !path.is_empty() && std::path::Path::new(path).exists() {
            std::fs::remove_file(path).map_err(|e| format!("delete file: {e}"))?;
        }
    }

    conn.execute("DELETE FROM messages WHERE session_id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sessions WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    let mut cache = SCAN_CACHE
        .lock()
        .map_err(|_| "scan cache poisoned".to_string())?;
    *cache = None;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{FixedOffset, TimeZone};

    fn item(id: &str, updated_at: &str) -> SessionListItem {
        SessionListItem {
            id: id.to_string(),
            resume_id: id.to_string(),
            source_id: "codex".to_string(),
            title: id.to_string(),
            updated_at: updated_at.to_string(),
            project_name: "project".to_string(),
            project_path: "/tmp/project".to_string(),
            message_count: 1,
            preview: String::new(),
            file_size: 0,
            model_id: String::new(),
        }
    }

    #[test]
    fn filters_session_items_by_selected_time_range_in_beijing_time() {
        let now = FixedOffset::east_opt(8 * 3600)
            .unwrap()
            .with_ymd_and_hms(2026, 4, 28, 11, 30, 0)
            .unwrap();
        let sessions = vec![
            item("today", "2026-04-28T02:00:00Z"),
            item("midnight", "2026-04-27T16:00:00Z"),
            item("week", "2026-04-22T00:00:00Z"),
            item("old", "2026-04-01T00:00:00Z"),
        ];

        let today = filter_session_items_by_time_range(sessions.clone(), Some("today"), now);
        assert_eq!(
            today
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["today", "midnight"]
        );

        let week = filter_session_items_by_time_range(sessions.clone(), Some("7d"), now);
        assert_eq!(
            week.iter().map(|item| item.id.as_str()).collect::<Vec<_>>(),
            vec!["today", "midnight", "week"]
        );

        let all = filter_session_items_by_time_range(sessions.clone(), Some("all"), now);
        assert_eq!(all.len(), 4);

        let custom = filter_session_items_by_time_range(
            sessions.clone(),
            Some("custom:2026-04-22:2026-04-28"),
            now,
        );
        assert_eq!(
            custom
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["today", "midnight", "week"]
        );

        let invalid =
            filter_session_items_by_time_range(sessions, Some("custom:2026-04-29:2026-04-01"), now);
        assert!(invalid.is_empty());
    }
}
