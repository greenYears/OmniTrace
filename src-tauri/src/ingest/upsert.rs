use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};

use crate::db::queries::{insert_message_sql, upsert_project_sql, upsert_session_sql};
use crate::db::schema;
use crate::domain::models::NormalizedSession;

pub fn initialize_database(conn: &Connection) -> Result<()> {
    schema::run_migrations(conn)
}

pub struct IngestRecord {
    pub id: String,
    pub source_id: String,
    pub scan_path: String,
    pub file_fingerprint: String,
    pub last_scanned_at: Option<String>,
    pub parse_status: String,
    pub error_message: Option<String>,
}

pub fn upsert_ingest_record(
    conn: &Connection,
    source_id: &str,
    scan_path: &str,
    fingerprint: &str,
    parse_status: &str,
    error_message: Option<&str>,
) -> Result<()> {
    let id = format!("ingest:{source_id}:{scan_path}");
    let now = crate::db::current_timestamp();
    conn.execute(
        r#"
        INSERT INTO ingest_records (id, source_id, scan_path, file_fingerprint, last_scanned_at, parse_status, error_message)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(id) DO UPDATE SET
          file_fingerprint = excluded.file_fingerprint,
          last_scanned_at = excluded.last_scanned_at,
          parse_status = excluded.parse_status,
          error_message = excluded.error_message
        "#,
        params![&id, source_id, scan_path, fingerprint, &now, parse_status, error_message],
    )
    .with_context(|| "upsert ingest_record")?;
    Ok(())
}

pub fn find_ingest_record(
    conn: &Connection,
    source_id: &str,
    fingerprint: &str,
) -> Result<Option<IngestRecord>> {
    let record = conn
        .query_row(
            "SELECT id, source_id, scan_path, file_fingerprint, last_scanned_at, parse_status, error_message FROM ingest_records WHERE source_id = ?1 AND file_fingerprint = ?2",
            params![source_id, fingerprint],
            |row| {
                Ok(IngestRecord {
                    id: row.get(0)?,
                    source_id: row.get(1)?,
                    scan_path: row.get(2)?,
                    file_fingerprint: row.get(3)?,
                    last_scanned_at: row.get(4)?,
                    parse_status: row.get(5)?,
                    error_message: row.get(6)?,
                })
            },
        )
        .optional()
        .with_context(|| "find ingest_record")?;
    Ok(record)
}

pub fn cleanup_stale_records(conn: &Connection) -> Result<usize> {
    let mut stmt = conn
        .prepare("SELECT scan_path FROM ingest_records")
        .with_context(|| "prepare stale record scan")?;

    let stale_paths: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .with_context(|| "query stale records")?
        .filter_map(|r| r.ok())
        .filter(|path| !std::path::Path::new(path).exists())
        .collect();

    let mut removed = 0usize;
    for scan_path in &stale_paths {
        // Find session whose raw_ref matches this scan_path
        let session_ids: Vec<String> = conn
            .prepare("SELECT id FROM sessions WHERE raw_ref = ?1")
            .with_context(|| "prepare session lookup by raw_ref")?
            .query_map([scan_path], |row| row.get::<_, String>(0))
            .with_context(|| "query sessions by raw_ref")?
            .filter_map(|r| r.ok())
            .collect();

        for sid in &session_ids {
            conn.execute("DELETE FROM messages WHERE session_id = ?1", [sid])
                .with_context(|| "delete stale messages")?;
            conn.execute("DELETE FROM sessions WHERE id = ?1", [sid])
                .with_context(|| "delete stale session")?;
            removed += 1;
        }

        conn.execute(
            "DELETE FROM ingest_records WHERE scan_path = ?1",
            [scan_path],
        )
        .with_context(|| "delete stale ingest_record")?;
    }

    Ok(removed)
}

fn project_id_for_path(path: &str) -> String {
    // Stable id: matches queries' behavior (upsert by unique path) and avoids id churn.
    format!("project:{path}")
}

fn default_session_id(source_id: &str, external_id: &str) -> String {
    format!("session:{source_id}:{external_id}")
}

fn message_id_for(session_id: &str, seq_no: i64) -> String {
    format!("message:{session_id}:{seq_no}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn upsert_ingest_record_updates_same_path_when_fingerprint_changes() {
        let conn = Connection::open_in_memory().expect("in-memory sqlite connection");
        initialize_database(&conn).expect("schema should initialize");

        upsert_ingest_record(
            &conn,
            "codex",
            "/tmp/session.jsonl",
            "fingerprint-before",
            "success",
            None,
        )
        .expect("initial ingest record should insert");

        upsert_ingest_record(
            &conn,
            "codex",
            "/tmp/session.jsonl",
            "fingerprint-after",
            "success",
            None,
        )
        .expect("same path with changed fingerprint should update");

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM ingest_records", [], |row| row.get(0))
            .expect("count query should succeed");
        assert_eq!(count, 1);

        let fingerprint: String = conn
            .query_row(
                "SELECT file_fingerprint FROM ingest_records WHERE scan_path = ?1",
                ["/tmp/session.jsonl"],
                |row| row.get(0),
            )
            .expect("fingerprint query should succeed");
        assert_eq!(fingerprint, "fingerprint-after");
    }
}

fn find_existing_session_id(
    conn: &Connection,
    source_id: &str,
    external_id: &str,
) -> Result<Option<String>> {
    let id = conn
        .query_row(
            "SELECT id FROM sessions WHERE source_id = ?1 AND external_id = ?2",
            params![source_id, external_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .with_context(|| "lookup existing session id")?;
    Ok(id)
}

pub fn upsert_sessions(conn: &Connection, sessions: &[NormalizedSession]) -> Result<()> {
    let tx = conn
        .unchecked_transaction()
        .with_context(|| "begin sqlite transaction")?;

    {
        for s in sessions {
            let project_id = project_id_for_path(&s.project.path);
            tx.execute(
                upsert_project_sql(),
                params![&project_id, &s.project.path, &s.project.display_name],
            )
            .with_context(|| "upsert project")?;

            let existing_id = find_existing_session_id(&tx, &s.source_id, &s.external_id)?;
            let session_id = existing_id.unwrap_or_else(|| {
                default_session_id(s.source_id.as_str(), s.external_id.as_str())
            });

            // Allow re-runs: ensure we don't keep stale messages if message count shrinks.
            tx.execute(
                "DELETE FROM messages WHERE session_id = ?1",
                params![&session_id],
            )
            .with_context(|| "delete old messages for session")?;

            let message_count = s.messages.len() as i64;
            tx.execute(
                upsert_session_sql(),
                params![
                    &session_id,
                    &s.source_id,
                    &project_id,
                    &s.external_id,
                    &s.title,
                    &s.started_at,
                    &s.ended_at,
                    &s.updated_at,
                    message_count,
                    Option::<&str>::None,
                    &s.raw_ref,
                    s.file_size as i64,
                    &s.model_id
                ],
            )
            .with_context(|| "upsert session")?;

            for msg in &s.messages {
                let msg_id = message_id_for(&session_id, msg.seq_no);
                tx.execute(
                    insert_message_sql(),
                    params![
                        &msg_id,
                        &session_id,
                        &msg.role,
                        &msg.content_text,
                        &msg.created_at,
                        msg.seq_no,
                        &msg.metadata_json
                    ],
                )
                .with_context(|| "insert message")?;
            }
        }
    }

    tx.commit().with_context(|| "commit sqlite transaction")?;
    Ok(())
}
