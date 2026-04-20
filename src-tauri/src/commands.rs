use serde::Serialize;

use crate::ingest::scanner::scan_fixture_sources;

#[derive(Debug, Clone, Serialize)]
pub struct SessionListItem {
    pub source_id: String,
    pub title: String,
    pub updated_at: String,
    pub project_name: String,
    pub message_count: i64,
}

#[tauri::command]
pub fn scan_sources() -> Result<Vec<SessionListItem>, String> {
    let result = scan_fixture_sources(
        "tests/fixtures/claude_code".into(),
        "tests/fixtures/codex".into(),
    )
    .map_err(|e| e.to_string())?;

    let out = result
        .sessions
        .into_iter()
        .map(|s| SessionListItem {
            source_id: s.source_id,
            title: s.title,
            updated_at: s.updated_at,
            project_name: s.project.display_name,
            message_count: s.messages.len() as i64,
        })
        .collect();

    Ok(out)
}

