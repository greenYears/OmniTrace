use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectRecord {
    pub id: String,
    pub path: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageRecord {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content_text: String,
    pub created_at: DateTime<Utc>,
    pub seq_no: i64,
    pub metadata_json: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NormalizedSession {
    pub id: String,
    pub source_id: String,
    pub project_id: Option<String>,
    pub external_id: String,
    pub title: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
    pub message_count: i64,
    pub summary_hint: Option<String>,
    pub raw_ref: Option<String>,
}

impl NormalizedSession {
    pub fn untitled(source_id: &str, started_at_rfc3339: &str) -> Self {
        // Title is deterministic and should not depend on other fields.
        let title = format!("{source_id} @ {started_at_rfc3339}");
        let started_at = DateTime::parse_from_rfc3339(started_at_rfc3339)
            .expect("started_at_rfc3339 must be RFC3339")
            .with_timezone(&Utc);
        Self {
            id: String::new(),
            source_id: source_id.to_string(),
            project_id: None,
            external_id: String::new(),
            title,
            started_at,
            ended_at: None,
            updated_at: started_at,
            message_count: 0,
            summary_hint: None,
            raw_ref: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalized_session_untitled_formats_title() {
        let s = NormalizedSession::untitled("claude_code", "2026-04-19T10:00:00Z");
        assert_eq!(s.title, "claude_code @ 2026-04-19T10:00:00Z");
    }
}
