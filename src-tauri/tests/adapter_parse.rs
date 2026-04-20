use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tmpomnitrace_bootstrapmpul84appomnitrace_lib::adapters::claude_code::ClaudeCodeAdapter;
use tmpomnitrace_bootstrapmpul84appomnitrace_lib::adapters::codex::CodexAdapter;
use tmpomnitrace_bootstrapmpul84appomnitrace_lib::adapters::SessionAdapter;

fn temp_path(name: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("omnitrace-{name}-{stamp}"))
}

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
    assert_eq!(s.title, "Claude Code: monorepo");
    assert_eq!(s.started_at, "2026-04-20T02:13:20.000Z");
    assert_eq!(s.ended_at, "2026-04-20T02:13:33.000Z");
    assert_eq!(s.updated_at, "2026-04-20T02:13:33.000Z");
    assert_eq!(s.messages.len(), 4);
    assert_eq!(s.messages[0].role, "user");
    assert_eq!(s.messages[0].metadata_json, "{}");
    assert_eq!(s.messages[0].seq_no, 0);
    assert_eq!(s.messages[3].seq_no, 3);
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
    assert_eq!(
        s.title,
        "Codex: 01900000-0000-7000-8000-000000000000"
    );
    assert_eq!(s.started_at, "2026-04-20T05:13:20Z");
    assert_eq!(s.ended_at, "2026-04-20T05:16:23Z");
    assert_eq!(s.updated_at, "2026-04-20T05:16:23Z");
    assert_eq!(s.messages.len(), 4);
    assert_eq!(s.messages[0].role, "user");
    assert_eq!(s.messages[0].metadata_json, "{}");
    assert_eq!(s.messages[0].seq_no, 0);
    assert_eq!(s.messages[3].seq_no, 3);
}

#[test]
fn rejects_mixed_session_ids_inside_one_claude_file() {
    let root = temp_path("claude-mixed");
    fs::create_dir_all(&root).expect("temp dir should be created");
    let file = root.join("mixed.jsonl");
    fs::write(
        &file,
        concat!(
            "{\"display\":\"/help\",\"pastedContents\":{},\"timestamp\":1776651200000,\"project\":\"/Users/REDACTED/workspace/acme/monorepo\",\"sessionId\":\"aaa\"}\n",
            "{\"display\":\"/exit\",\"pastedContents\":{},\"timestamp\":1776651203000,\"project\":\"/Users/REDACTED/workspace/acme/monorepo\",\"sessionId\":\"bbb\"}\n"
        ),
    )
    .expect("fixture file should be written");

    let adapter = ClaudeCodeAdapter::new(root.clone());
    let err = adapter.parse_session(&file).expect_err("mixed session ids must fail");

    assert!(err.to_string().contains("mismatched sessionId"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn rejects_mixed_session_ids_inside_one_codex_file() {
    let root = temp_path("codex-mixed");
    fs::create_dir_all(&root).expect("temp dir should be created");
    let file = root.join("mixed.jsonl");
    fs::write(
        &file,
        concat!(
            "{\"session_id\":\"aaa\",\"ts\":1776662000,\"text\":\"one\"}\n",
            "{\"session_id\":\"bbb\",\"ts\":1776662061,\"text\":\"two\"}\n"
        ),
    )
    .expect("fixture file should be written");

    let adapter = CodexAdapter::new(root.clone());
    let err = adapter.parse_session(&file).expect_err("mixed session ids must fail");

    assert!(err.to_string().contains("mismatched session_id"));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn codex_seq_no_stays_dense_across_blank_lines() {
    let root = temp_path("codex-blank-lines");
    fs::create_dir_all(&root).expect("temp dir should be created");
    let file = root.join("dense.jsonl");
    fs::write(
        &file,
        concat!(
            "{\"session_id\":\"aaa\",\"ts\":1776662000,\"text\":\"one\"}\n",
            "\n",
            "{\"session_id\":\"aaa\",\"ts\":1776662061,\"text\":\"two\"}\n"
        ),
    )
    .expect("fixture file should be written");

    let adapter = CodexAdapter::new(root.clone());
    let session = adapter.parse_session(&file).expect("fixture should parse");

    assert_eq!(session.messages.len(), 2);
    assert_eq!(session.messages[0].seq_no, 0);
    assert_eq!(session.messages[1].seq_no, 1);
    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn discover_sessions_skips_symlink_directories() {
    use std::os::unix::fs::symlink;

    let root = temp_path("discover-symlink");
    let real = root.join("real");
    fs::create_dir_all(&real).expect("real dir should be created");
    fs::write(
        real.join("sample.jsonl"),
        "{\"display\":\"/help\",\"pastedContents\":{},\"timestamp\":1776651200000,\"project\":\"/Users/REDACTED/workspace/acme/monorepo\",\"sessionId\":\"aaa\"}\n",
    )
    .expect("sample file should be written");

    let loop_dir = root.join("loop");
    symlink(Path::new(&root), &loop_dir).expect("symlink should be created");

    let adapter = ClaudeCodeAdapter::new(root.clone());
    let sessions = adapter.discover_sessions().expect("discover should succeed");

    assert_eq!(sessions.len(), 1);
    assert!(sessions[0].ends_with("sample.jsonl"));
    let _ = fs::remove_dir_all(root);
}
