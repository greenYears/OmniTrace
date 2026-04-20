use std::path::PathBuf;

use anyhow::{Context, Result};

use crate::adapters::claude_code::ClaudeCodeAdapter;
use crate::adapters::codex::CodexAdapter;
use crate::adapters::SessionAdapter;
use crate::domain::models::NormalizedSession;

#[derive(Debug, Clone)]
pub struct ScanResult {
    pub sessions: Vec<NormalizedSession>,
}

pub fn scan_fixture_sources(claude_root: PathBuf, codex_root: PathBuf) -> Result<ScanResult> {
    let claude = ClaudeCodeAdapter::new(claude_root);
    let codex = CodexAdapter::new(codex_root);

    let mut sessions = Vec::new();

    let claude_paths = claude
        .discover_sessions()
        .with_context(|| "discover claude_code sessions")?;
    for path in claude_paths {
        let s = claude
            .parse_session(&path)
            .with_context(|| format!("parse claude_code session: {}", path.display()))?;
        sessions.push(s);
    }

    let codex_paths = codex
        .discover_sessions()
        .with_context(|| "discover codex sessions")?;
    for path in codex_paths {
        let s = codex
            .parse_session(&path)
            .with_context(|| format!("parse codex session: {}", path.display()))?;
        sessions.push(s);
    }

    // RFC3339 timestamps sort lexicographically; keep ties stable across sources/ids.
    sessions.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.source_id.cmp(&b.source_id))
            .then_with(|| a.external_id.cmp(&b.external_id))
    });

    Ok(ScanResult { sessions })
}

