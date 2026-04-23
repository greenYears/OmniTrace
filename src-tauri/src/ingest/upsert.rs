use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};

use crate::db::queries::{insert_message_sql, upsert_project_sql, upsert_session_sql};
use crate::db::schema::schema_sql;
use crate::domain::models::NormalizedSession;

pub fn initialize_database(conn: &Connection) -> Result<()> {
    conn.execute_batch(schema_sql())
        .with_context(|| "execute schema_sql batch")?;
    Ok(())
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
