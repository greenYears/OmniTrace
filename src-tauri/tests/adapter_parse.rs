use std::path::PathBuf;

use tmpomnitrace_bootstrapmpul84appomnitrace_lib::adapters::claude_code::ClaudeCodeAdapter;
use tmpomnitrace_bootstrapmpul84appomnitrace_lib::adapters::codex::CodexAdapter;
use tmpomnitrace_bootstrapmpul84appomnitrace_lib::adapters::SessionAdapter;

#[test]
fn parses_claude_code_fixture_session() {
    let adapter = ClaudeCodeAdapter::new(PathBuf::from("tests/fixtures/claude_code"));
    let sessions = adapter.discover_sessions().expect("discover should succeed");
    assert_eq!(sessions.len(), 1);

    let s = adapter
        .parse_session(&sessions[0])
        .expect("parse should succeed");

    assert_eq!(s.source_id, "claude_code");
    assert_eq!(s.project.display_name, "monorepo");
    assert_eq!(s.messages.len(), 4);
}

#[test]
fn parses_codex_fixture_session() {
    let adapter = CodexAdapter::new(PathBuf::from("tests/fixtures/codex"));
    let sessions = adapter.discover_sessions().expect("discover should succeed");
    assert_eq!(sessions.len(), 1);

    let s = adapter
        .parse_session(&sessions[0])
        .expect("parse should succeed");

    assert_eq!(s.source_id, "codex");
    assert_eq!(s.project.display_name, "Unknown Project");
    assert_eq!(s.messages.len(), 4);
}

