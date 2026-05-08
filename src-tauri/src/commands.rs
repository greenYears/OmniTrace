use std::path::Path;

use chrono::Utc;
use rusqlite::{Connection, OptionalExtension};
use serde::Deserialize;
use serde::Serialize;
use tauri::Emitter;

use crate::db;
use crate::domain::detail::{parse_detail_messages, DetailMessageRecord};
use crate::ingest::scanner::{
    check_sources_needing_scan, parse_home_sessions, persist_scan_results,
};
use crate::ingest::token_probe::{probe_token_usage_with_progress, TokenUsageProbeReport};

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

fn format_anyhow_error(error: anyhow::Error) -> String {
    format!("{error:#}")
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

#[derive(Debug, Clone, Serialize)]
pub struct ScanAllResult {
    pub session_count: i64,
    pub message_count: i64,
    pub last_scanned_at: String,
    pub files_scanned: usize,
    pub records_scanned: usize,
    pub records_with_usage: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanStats {
    pub session_count: i64,
    pub message_count: i64,
    pub last_scanned_at: Option<String>,
}

#[tauri::command]
pub async fn list_sessions(
    state: tauri::State<'_, db::AppState>,
) -> Result<Vec<SessionListItem>, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
        list_session_items(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scan_all_data(
    window: tauri::Window,
    state: tauri::State<'_, db::AppState>,
) -> Result<ScanAllResult, String> {
    let home_root = resolve_home_root()?;
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Phase 1: Brief lock — check which sources need scanning
        let (scan_claude, scan_codex) = {
            let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
            check_sources_needing_scan(&conn, &home_root)
        };

        // Phase 2: No lock — parse files from disk (heavy I/O)
        if scan_claude || scan_codex {
            let parsed = parse_home_sessions(
                &home_root,
                scan_claude,
                scan_codex,
                |progress| {
                    let _ = window.emit("session-scan-progress", progress);
                },
            )
            .map_err(format_anyhow_error)?;

            // Phase 3: Brief lock — write sessions to DB
            {
                let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
                persist_scan_results(&conn, &parsed, &home_root, scan_claude, scan_codex)
                    .map_err(format_anyhow_error)?;
            }
        }

        // Phase 4: No lock — probe token usage
        let token_report = probe_token_usage_with_progress(&home_root, |progress| {
            let _ = window.emit("token-probe-progress", progress);
        })
        .map_err(format_anyhow_error)?;

        // Phase 5: Brief lock — save token report + update scan timestamp
        let (session_count, message_count, last_scanned_at) = {
            let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
            let report_json = serde_json::to_string(&token_report)
                .map_err(|e| format!("serialize token report: {e}"))?;
            conn.execute(
                "INSERT INTO _meta (key, value) VALUES ('token_probe_report', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [&report_json],
            )
            .map_err(|e| format!("save token report: {e}"))?;

            let now = Utc::now().to_rfc3339();
            conn.execute(
                "INSERT INTO _meta (key, value) VALUES ('last_scanned_at', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [&now],
            )
            .map_err(|e| format!("save scan timestamp: {e}"))?;

            let session_count: i64 = conn
                .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
                .unwrap_or(0);
            let message_count: i64 = conn
                .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
                .unwrap_or(0);
            (session_count, message_count, now)
        };

        Ok(ScanAllResult {
            session_count,
            message_count,
            last_scanned_at,
            files_scanned: token_report.files_scanned,
            records_scanned: token_report.records_scanned,
            records_with_usage: token_report.records_with_usage,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_session_detail(
    id: String,
    state: tauri::State<'_, db::AppState>,
) -> Result<Option<SessionDetailDto>, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
        load_session_detail(&conn, &id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_token_report(
    state: tauri::State<'_, db::AppState>,
) -> Result<Option<TokenUsageProbeReport>, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
        let json: Option<String> = conn
            .query_row(
                "SELECT value FROM _meta WHERE key = 'token_probe_report'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        match json {
            Some(json) => {
                let report: TokenUsageProbeReport = serde_json::from_str(&json)
                    .map_err(|e| format!("deserialize token report: {e}"))?;
                Ok(Some(report))
            }
            None => Ok(None),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_scan_stats(state: tauri::State<'_, db::AppState>) -> Result<ScanStats, String> {
    let conn = state
        .db
        .lock()
        .map_err(|_| "db lock poisoned".to_string())?;
    let session_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
        .unwrap_or(0);
    let message_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
        .unwrap_or(0);
    let last_scanned_at: Option<String> = conn
        .query_row(
            "SELECT value FROM _meta WHERE key = 'last_scanned_at'",
            [],
            |row| row.get(0),
        )
        .optional()
        .unwrap_or(None);
    Ok(ScanStats {
        session_count,
        message_count,
        last_scanned_at,
    })
}

#[tauri::command]
pub async fn delete_session(
    id: String,
    state: tauri::State<'_, db::AppState>,
) -> Result<(), String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;

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

        if let Some(ref path) = raw_ref {
            conn.execute("DELETE FROM ingest_records WHERE scan_path = ?1", [path])
                .map_err(|e| e.to_string())?;
        }

        conn.execute("DELETE FROM messages WHERE session_id = ?1", [&id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM sessions WHERE id = ?1", [&id])
            .map_err(|e| e.to_string())?;

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
