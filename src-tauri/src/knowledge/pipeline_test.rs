#[cfg(test)]
mod tests {
    use crate::knowledge::chunking::{self, MessageForAnalysis};
    use crate::knowledge::evidence;
    use crate::knowledge::extraction;
    use crate::knowledge::export;
    use crate::knowledge::models::*;
    use crate::knowledge::redaction;
    use crate::knowledge::schema;
    use rusqlite::Connection;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        // Base tables
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, display_name TEXT);
            CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, project_id TEXT, external_id TEXT NOT NULL, title TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT NOT NULL, updated_at TEXT NOT NULL, message_count INTEGER NOT NULL DEFAULT 0, summary_hint TEXT, raw_ref TEXT, file_size INTEGER NOT NULL DEFAULT 0, model_id TEXT NOT NULL DEFAULT '', FOREIGN KEY(project_id) REFERENCES projects(id), UNIQUE(source_id, external_id));
            CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL, content_text TEXT NOT NULL, created_at TEXT NOT NULL, seq_no INTEGER NOT NULL, metadata_json TEXT, FOREIGN KEY(session_id) REFERENCES sessions(id), UNIQUE(session_id, seq_no));
            "#,
        ).unwrap();
        schema::run_knowledge_migrations(&conn).unwrap();
        conn
    }

    fn make_evidence(title: &str, etype: EvidenceType, confidence: f64) -> KnowledgeEvidence {
        KnowledgeEvidence {
            id: uuid::Uuid::new_v4().to_string(),
            run_id: "run1".to_string(),
            project_id: "proj1".to_string(),
            evidence_type: etype,
            title: title.to_string(),
            content: EvidenceContent {
                summary: "s".to_string(),
                details: "d".to_string(),
                recommended_action: "a".to_string(),
                related_files: vec![],
            },
            confidence,
            source_refs: vec![],
            created_at: "2026-01-01".to_string(),
        }
    }

    fn make_messages(session_id: &str) -> Vec<MessageForAnalysis> {
        vec![
            MessageForAnalysis {
                role: "user".to_string(),
                content: "How do I fix the auth middleware bug?".to_string(),
                timestamp: "2026-01-01T10:00:00Z".to_string(),
                session_title: "Fix auth bug".to_string(),
                session_id: session_id.to_string(),
            },
            MessageForAnalysis {
                role: "assistant".to_string(),
                content: "The auth middleware has a timing issue. Fix by adding a mutex lock around the token validation.".to_string(),
                timestamp: "2026-01-01T10:01:00Z".to_string(),
                session_title: "Fix auth bug".to_string(),
                session_id: session_id.to_string(),
            },
        ]
    }

    #[test]
    fn full_redaction_and_chunking_pipeline() {
        let engine = redaction::RedactionEngine::with_default_rules();

        let raw_content = "User /Users/alice/project reported that API_KEY=sk-abc123def456ghi789jkl012mno345 is broken. Contact alice@example.com";
        let redacted = engine.redact(raw_content);

        assert!(redacted.contains("~/project"));
        assert!(redacted.contains("[REDACTED_SECRET]"));
        assert!(redacted.contains("[REDACTED_EMAIL]"));
        assert!(!redacted.contains("alice@example.com"));
    }

    #[test]
    fn chunking_multiple_sessions() {
        let sessions = vec![
            make_messages("s1"),
            make_messages("s2"),
            make_messages("s3"),
        ];

        let chunks = chunking::chunk_sessions(sessions, Some(20_000));
        assert_eq!(chunks.len(), 1, "small sessions should merge into one chunk");
        assert_eq!(chunks[0].session_ids.len(), 3);
    }

    #[test]
    fn evidence_dedup_and_grouping() {
        let evidence = vec![
            make_evidence("Auth bug", EvidenceType::Pitfall, 0.9),
            make_evidence("Auth bug", EvidenceType::Pitfall, 0.7), // duplicate
            make_evidence("Auth pattern", EvidenceType::TaskPattern, 0.8),
            make_evidence("Test verification", EvidenceType::Verification, 0.6),
            make_evidence("Business rule", EvidenceType::DomainRule, 0.85),
        ];

        let deduped = evidence::deduplicate_evidence(evidence);
        assert_eq!(deduped.len(), 4, "exact duplicates should be removed");

        let filtered = evidence::filter_by_confidence(deduped, 0.3);
        assert_eq!(filtered.len(), 4, "all above threshold");

        let groups = evidence::group_by_doc_type(filtered);
        assert_eq!(groups.get(&DocType::CommonTasks).unwrap().len(), 2);
        assert_eq!(groups.get(&DocType::DomainRules).unwrap().len(), 1);
        assert_eq!(groups.get(&DocType::Pitfalls).unwrap().len(), 1);
    }

    #[test]
    fn parse_evidence_json_variants() {
        let valid = r#"[{"type":"pitfall","title":"Test","summary":"s","details":"d","recommended_action":"a","related_files":[],"source_refs":[],"confidence":0.8}]"#;
        let parsed = extraction::parse_evidence_response(valid).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].title, "Test");

        let in_code_block = "```json\n".to_string() + valid + "\n```";
        let parsed2 = extraction::parse_evidence_response(&in_code_block).unwrap();
        assert_eq!(parsed2.len(), 1);

        let invalid = "not json at all";
        assert!(extraction::parse_evidence_response(invalid).is_err());
    }

    #[test]
    fn export_path_validation_and_write() {
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let root = dir.path();

        // Valid path
        let valid = export::validate_export_path(root, "docs/agents/test.md");
        assert!(valid.is_ok());

        // Traversal attack
        let traversal = export::validate_export_path(root, "../../../etc/passwd");
        assert!(traversal.is_err());

        // Write and verify
        let target = valid.unwrap();
        let diffs = vec![export::ExportDiff {
            target_path: target.clone(),
            exists: false,
            old_content: None,
            new_content: "# Test Document\n\nContent here".to_string(),
            unified_diff: String::new(),
        }];

        let results = export::execute_export(&diffs, OverwriteStrategy::Overwrite).unwrap();
        assert!(results[0].written);
        assert!(std::fs::read_to_string(&target).unwrap().contains("Test Document"));
    }

    #[test]
    fn schema_and_provider_crud() {
        let conn = setup_db();

        // Insert project
        conn.execute(
            "INSERT INTO projects (id, path, display_name) VALUES ('p1', '/tmp/test', 'TestProject')",
            [],
        ).unwrap();

        // Insert provider
        conn.execute(
            "INSERT INTO llm_providers (id, name, base_url, model, temperature, max_output_tokens, enabled, created_at, updated_at) VALUES ('prov1', 'Test', 'http://localhost:11434/v1', 'llama3', 0.3, 4096, 1, '2026-01-01', '2026-01-01')",
            [],
        ).unwrap();

        // Insert run
        conn.execute(
            "INSERT INTO project_knowledge_runs (id, project_id, provider_id, model, scope_type, status, estimated_input_tokens, estimated_output_tokens, created_at) VALUES ('run1', 'p1', 'prov1', 'llama3', 'all', 'completed', 5000, 2000, '2026-01-01')",
            [],
        ).unwrap();

        // Insert evidence
        conn.execute(
            "INSERT INTO knowledge_evidence (id, run_id, project_id, evidence_type, title, content_json, confidence, created_at) VALUES ('ev1', 'run1', 'p1', 'pitfall', 'Auth bug', '{\"summary\":\"s\",\"details\":\"d\",\"recommended_action\":\"a\",\"related_files\":[]}', 0.9, '2026-01-01')",
            [],
        ).unwrap();

        // Insert document
        conn.execute(
            "INSERT INTO knowledge_documents (id, run_id, project_id, doc_type, title, markdown, version, created_at, updated_at) VALUES ('doc1', 'run1', 'p1', 'pitfalls', 'Pitfalls', '# Pitfalls\n\nAuth bug details', 1, '2026-01-01', '2026-01-01')",
            [],
        ).unwrap();

        // Verify reads
        let run_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM project_knowledge_runs WHERE project_id = 'p1'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(run_count, 1);

        let ev_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM knowledge_evidence WHERE run_id = 'run1'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(ev_count, 1);

        let doc_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM knowledge_documents WHERE project_id = 'p1'",
            [],
            |r| r.get(0),
        ).unwrap();
        assert_eq!(doc_count, 1);

        // Verify cascade delete
        conn.execute("DELETE FROM project_knowledge_runs WHERE id = 'run1'", []).unwrap();
        let ev_after: i64 = conn.query_row("SELECT COUNT(*) FROM knowledge_evidence", [], |r| r.get(0)).unwrap();
        let doc_after: i64 = conn.query_row("SELECT COUNT(*) FROM knowledge_documents", [], |r| r.get(0)).unwrap();
        assert_eq!(ev_after, 0);
        assert_eq!(doc_after, 0);
    }
}
