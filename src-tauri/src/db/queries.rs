pub fn upsert_project_sql() -> &'static str {
    r#"
INSERT INTO projects (id, path, display_name)
VALUES (?1, ?2, ?3)
ON CONFLICT(path) DO UPDATE SET
  id = excluded.id,
  display_name = excluded.display_name
"#
}

pub fn upsert_session_sql() -> &'static str {
    r#"
INSERT INTO sessions (
  id,
  source_id,
  project_id,
  external_id,
  title,
  started_at,
  ended_at,
  updated_at,
  message_count,
  summary_hint,
  raw_ref
)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
ON CONFLICT(source_id, external_id) DO UPDATE SET
  project_id = excluded.project_id,
  title = excluded.title,
  started_at = excluded.started_at,
  ended_at = excluded.ended_at,
  updated_at = excluded.updated_at,
  message_count = excluded.message_count,
  summary_hint = excluded.summary_hint,
  raw_ref = excluded.raw_ref
"#
}

pub fn insert_message_sql() -> &'static str {
    r#"
INSERT INTO messages (
  id,
  session_id,
  role,
  content_text,
  created_at,
  seq_no,
  metadata_json
)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
ON CONFLICT(session_id, seq_no) DO UPDATE SET
  role = excluded.role,
  content_text = excluded.content_text,
  created_at = excluded.created_at,
  metadata_json = excluded.metadata_json
"#
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_project_sql_updates_id_when_path_conflicts() {
        let sql = upsert_project_sql();
        assert!(sql.contains("id = excluded.id"));
    }
}
