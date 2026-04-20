use std::path::PathBuf;

use rusqlite::{Connection, OptionalExtension};

use tmpomnitrace_bootstrapmpul84appomnitrace_lib::db;
use tmpomnitrace_bootstrapmpul84appomnitrace_lib::ingest::scanner::scan_fixture_sources;
use tmpomnitrace_bootstrapmpul84appomnitrace_lib::ingest::upsert::{
    initialize_database, upsert_sessions,
};

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
