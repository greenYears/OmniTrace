use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension};

use tmpomnitrace_bootstrapmpul84appomnitrace_lib::db;
use tmpomnitrace_bootstrapmpul84appomnitrace_lib::ingest::scanner::{
    scan_fixture_sources, scan_home_sources,
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
        .query_row("PRAGMA foreign_key_check;", [], |_row| Ok(String::from("violated")))
        .optional()
        .expect("foreign key check should succeed")
        .unwrap_or_else(|| String::from("ok"));
    assert_eq!(fk_check, "ok");
}

#[test]
fn scan_and_upsert_real_history_layout_end_to_end() {
    let home = temp_path("real-history");
    let claude_sessions = home.join(".claude/sessions");
    let codex_root = home.join(".codex");
    fs::create_dir_all(&claude_sessions).expect("claude sessions dir should be created");
    fs::create_dir_all(&codex_root).expect("codex dir should be created");

    fs::write(
        home.join(".claude/history.jsonl"),
        concat!(
            "{\"display\":\"/help\",\"pastedContents\":{},\"timestamp\":1776651200000,\"project\":\"/Users/test/workspace/alpha\",\"sessionId\":\"claude-1\"}\n",
            "{\"display\":\"/exit\",\"pastedContents\":{},\"timestamp\":1776651203000,\"project\":\"/Users/test/workspace/alpha\",\"sessionId\":\"claude-1\"}\n"
        ),
    )
    .expect("claude history should be written");
    fs::write(
        claude_sessions.join("123.json"),
        "{\"pid\":123,\"sessionId\":\"claude-1\",\"cwd\":\"/Users/test/workspace/alpha\",\"startedAt\":1776651199000,\"version\":\"2.1.114\",\"kind\":\"interactive\",\"entrypoint\":\"cli\"}\n",
    )
    .expect("claude session metadata should be written");

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

    let result = scan_home_sources(home.clone()).expect("scan should succeed");

    assert_eq!(result.sessions.len(), 2);
    assert_eq!(result.sessions[0].source_id, "codex");
    assert_eq!(result.sessions[0].title, "Codex: Thread A");
    assert_eq!(result.sessions[1].source_id, "claude_code");
    assert_eq!(result.sessions[1].project.display_name, "alpha");

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
