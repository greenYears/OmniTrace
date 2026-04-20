use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectRecord {
    pub path: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageRecord {
    pub role: String,
    pub content_text: String,
    pub created_at: String,
    pub seq_no: i64,
    pub metadata_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NormalizedSession {
    pub source_id: String,
    pub external_id: String,
    pub title: String,
    pub started_at: String,
    pub ended_at: String,
    pub updated_at: String,
    pub project: ProjectRecord,
    pub messages: Vec<MessageRecord>,
    pub raw_ref: String,
}

impl NormalizedSession {
    pub fn untitled(source_id: &str, started_at_rfc3339: &str) -> Self {
        Self {
            source_id: source_id.to_string(),
            external_id: format!("untitled:{source_id}:{started_at_rfc3339}"),
            title: format!("{source_id} @ {started_at_rfc3339}"),
            started_at: started_at_rfc3339.to_string(),
            ended_at: started_at_rfc3339.to_string(),
            updated_at: started_at_rfc3339.to_string(),
            project: ProjectRecord {
                path: "Unknown Project".to_string(),
                display_name: "Unknown Project".to_string(),
            },
            messages: Vec::new(),
            raw_ref: String::new(),
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

    #[test]
    fn normalized_session_untitled_keeps_raw_started_at_without_parsing() {
        let s = NormalizedSession::untitled("claude_code", "not-rfc3339");
        assert_eq!(s.started_at, "not-rfc3339");
        assert_eq!(s.external_id, "untitled:claude_code:not-rfc3339");
    }
}
