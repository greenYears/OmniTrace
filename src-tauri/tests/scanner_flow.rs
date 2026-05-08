use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension};

use tmpomnitrace_bootstrapmpul84appomnitrace_lib::db;
use tmpomnitrace_bootstrapmpul84appomnitrace_lib::ingest::scanner::{
    persist_scan_results, scan_fixture_sources, scan_home_sources, scan_home_sources_with_progress,
};
use tmpomnitrace_bootstrapmpul84appomnitrace_lib::ingest::upsert::{
    initialize_database, upsert_sessions,
};

fn temp_path(name: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("omnitrace-{name}-{stamp}"))
}

#[test]
fn scan_and_upsert_fixture_sessions_end_to_end() {
    let result = scan_fixture_sources(
        PathBuf::from("tests/fixtures/claude_code"),
        PathBuf::from("tests/fixtures/codex"),
    )
    .expect("scan should succeed");

    assert_eq!(result.sessions.len(), 2);
    assert_eq!(result.sessions[0].messages.len(), 4);

    let conn = Connection::open_in_memory().expect("in-memory sqlite connection");
    db::configure_connection(&conn).expect("configure connection should succeed");
    initialize_database(&conn).expect("schema init should succeed");

    upsert_sessions(&conn, &result.sessions).expect("upsert should succeed");

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM sessions;", [], |row| row.get(0))
        .expect("count query should succeed");
    assert_eq!(count, 2);

    let message_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM messages;", [], |row| row.get(0))
        .expect("message count query should succeed");
    assert_eq!(message_count, 8);

    let project_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM projects;", [], |row| row.get(0))
        .expect("project count query should succeed");
    assert_eq!(project_count, 2);

    let fk_check: String = conn
        .query_row("PRAGMA foreign_key_check;", [], |_row| {
            Ok(String::from("violated"))
        })
        .optional()
        .expect("foreign key check should succeed")
        .unwrap_or_else(|| String::from("ok"));
    assert_eq!(fk_check, "ok");
}

#[test]
fn scan_and_upsert_real_history_layout_end_to_end() {
    let home = temp_path("real-history");
    let claude_sessions = home.join(".claude/sessions");
    let claude_projects = home.join(".claude/projects/-Users-test-workspace-alpha");
    let codex_root = home.join(".codex");
    let codex_sessions = codex_root.join("sessions/2026/04/20");
    fs::create_dir_all(&claude_sessions).expect("claude sessions dir should be created");
    fs::create_dir_all(&claude_projects).expect("claude projects dir should be created");
    fs::create_dir_all(&codex_root).expect("codex dir should be created");
    fs::create_dir_all(&codex_sessions).expect("codex nested sessions dir should be created");

    fs::write(
        home.join(".claude/history.jsonl"),
        concat!(
            "{\"display\":\"/help\",\"pastedContents\":{},\"timestamp\":1776651200000,\"project\":\"/Users/test/workspace/OmniTrace/src-tauri\",\"sessionId\":\"claude-1\"}\n",
            "{\"display\":\"/exit\",\"pastedContents\":{},\"timestamp\":1776651203000,\"project\":\"/Users/test/workspace/OmniTrace/src-tauri\",\"sessionId\":\"claude-1\"}\n"
        ),
    )
    .expect("claude history should be written");
    fs::write(
        claude_sessions.join("123.json"),
        "{\"pid\":123,\"sessionId\":\"claude-1\",\"cwd\":\"/Users/test/workspace/OmniTrace/src-tauri\",\"startedAt\":1776651199000,\"version\":\"2.1.114\",\"kind\":\"interactive\",\"entrypoint\":\"cli\"}\n",
    )
    .expect("claude session metadata should be written");
    fs::write(
        claude_projects.join("sessions-index.json"),
        concat!(
            "{\n",
            "  \"version\": 1,\n",
            "  \"entries\": [\n",
            "    {\n",
            "      \"sessionId\": \"claude-1\",\n",
            "      \"fullPath\": \"/tmp/omnitrace-should-not-be-used.jsonl\",\n",
            "      \"projectPath\": \"/Users/test/workspace/OmniTrace/src-tauri\"\n",
            "    }\n",
            "  ]\n",
            "}\n"
        ),
    )
    .expect("claude session index should be written");
    fs::write(
        claude_projects.join("claude-1.jsonl"),
        concat!(
            "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"/help\"}]},\"timestamp\":\"2026-04-19T03:46:40.000Z\",\"sessionId\":\"claude-1\"}\n",
            "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"已打开。\"}]},\"timestamp\":\"2026-04-19T03:46:42.000Z\",\"sessionId\":\"claude-1\"}\n"
        ),
    )
    .expect("claude project session should be written");

    fs::write(
        home.join(".codex/history.jsonl"),
        concat!(
            "{\"session_id\":\"codex-1\",\"ts\":1776662000,\"text\":\"one\"}\n",
            "{\"session_id\":\"codex-1\",\"ts\":1776662061,\"text\":\"two\"}\n"
        ),
    )
    .expect("codex history should be written");
    fs::write(
        home.join(".codex/session_index.jsonl"),
        "{\"id\":\"codex-1\",\"thread_name\":\"Thread A\",\"updated_at\":\"2026-04-20T05:14:21Z\"}\n",
    )
    .expect("codex index should be written");
    let codex_session_path = codex_sessions.join("rollout-2026-04-20T05-13-20-codex-1.jsonl");
    fs::write(
        &codex_session_path,
        concat!(
            "{\"timestamp\":\"2026-04-20T05:13:20Z\",\"type\":\"session_meta\",\"payload\":{\"id\":\"codex-1\",\"cwd\":\"/Users/test/workspace/bravo\"}}\n",
            "{\"timestamp\":\"2026-04-20T05:13:21Z\",\"type\":\"response_item\",\"payload\":{\"role\":\"user\",\"text\":\"one\"}}\n"
        ),
    )
    .expect("codex session metadata should be written");

    let result = scan_home_sources(home.clone()).expect("scan should succeed");

    assert_eq!(result.sessions.len(), 2);
    assert_eq!(result.sessions[0].source_id, "codex");
    assert_eq!(result.sessions[0].title, "bravo");
    assert_eq!(result.sessions[0].project.display_name, "bravo");
    assert_eq!(
        result.sessions[0].raw_ref,
        codex_session_path.display().to_string()
    );
    assert_eq!(result.sessions[1].source_id, "claude_code");
    assert_eq!(result.sessions[1].project.display_name, "OmniTrace");
    assert_eq!(
        result.sessions[1].project.path,
        "/Users/test/workspace/OmniTrace"
    );
    assert_eq!(
        result.sessions[1].raw_ref,
        claude_projects.join("claude-1.jsonl").display().to_string()
    );

    let conn = Connection::open_in_memory().expect("in-memory sqlite connection");
    db::configure_connection(&conn).expect("configure connection should succeed");
    initialize_database(&conn).expect("schema init should succeed");
    upsert_sessions(&conn, &result.sessions).expect("upsert should succeed");

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM sessions;", [], |row| row.get(0))
        .expect("count query should succeed");
    assert_eq!(count, 2);

    let _ = fs::remove_dir_all(home);
}

#[test]
fn scan_home_sources_reports_progress_paths() {
    let home = temp_path("real-history-progress");
    let codex_sessions = home.join(".codex/sessions/2026/04/20");
    fs::create_dir_all(&codex_sessions).expect("codex nested sessions dir should be created");

    let codex_session_path = codex_sessions.join("rollout-2026-04-20T05-13-20-codex-1.jsonl");
    fs::write(
        &codex_session_path,
        concat!(
            "{\"timestamp\":\"2026-04-20T05:13:20Z\",\"type\":\"session_meta\",\"payload\":{\"id\":\"codex-1\",\"cwd\":\"/Users/test/workspace/bravo\"}}\n",
            "{\"timestamp\":\"2026-04-20T05:13:21Z\",\"type\":\"response_item\",\"payload\":{\"role\":\"user\",\"text\":\"one\"}}\n"
        ),
    )
    .expect("codex session should be written");

    let mut progress = Vec::new();
    let result = scan_home_sources_with_progress(home.clone(), |event| {
        progress.push(event);
    })
    .expect("scan should succeed");

    assert_eq!(result.sessions.len(), 1);
    assert!(progress.iter().any(|event| {
        event.source_id == "codex"
            && event.phase == "解析会话"
            && event.path == codex_session_path.display().to_string()
            && event.files_scanned >= 1
            && event.sessions_found >= 1
    }));

    let _ = fs::remove_dir_all(home);
}

#[test]
fn persist_scan_results_upgrades_legacy_ingest_records_before_writing() {
    let home = temp_path("legacy-ingest-persist");
    let codex_root = home.join(".codex");
    fs::create_dir_all(&codex_root).expect("codex dir should be created");
    fs::write(
        codex_root.join("history.jsonl"),
        "{\"session_id\":\"codex-1\",\"ts\":1776662000,\"text\":\"one\"}\n",
    )
    .expect("codex history should be written");

    let conn = Connection::open_in_memory().expect("in-memory sqlite connection");
    db::configure_connection(&conn).expect("configure connection should succeed");
    conn.execute_batch(
        r#"
        CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          display_name TEXT
        );
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          project_id TEXT,
          external_id TEXT NOT NULL,
          title TEXT NOT NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          message_count INTEGER NOT NULL DEFAULT 0,
          summary_hint TEXT,
          raw_ref TEXT,
          file_size INTEGER NOT NULL DEFAULT 0,
          model_id TEXT NOT NULL DEFAULT '',
          UNIQUE(source_id, external_id)
        );
        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content_text TEXT NOT NULL,
          created_at TEXT NOT NULL,
          seq_no INTEGER NOT NULL,
          metadata_json TEXT,
          UNIQUE(session_id, seq_no)
        );
        CREATE TABLE ingest_records (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          scan_path TEXT NOT NULL
        );
        "#,
    )
    .expect("legacy schema should be created");

    persist_scan_results(&conn, &[], &home, false, true)
        .expect("persist should upgrade legacy ingest_records and record files");

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM ingest_records", [], |row| row.get(0))
        .expect("ingest count query should succeed");
    assert_eq!(count, 1);

    let _ = fs::remove_dir_all(home);
}
