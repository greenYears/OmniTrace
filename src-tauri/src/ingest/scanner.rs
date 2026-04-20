use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::Deserialize;
use serde_json::Value;

use crate::adapters::claude_code::ClaudeCodeAdapter;
use crate::adapters::codex::CodexAdapter;
use crate::adapters::SessionAdapter;
use crate::domain::models::{MessageRecord, NormalizedSession, ProjectRecord};

#[derive(Debug, Clone)]
pub struct ScanResult {
    pub sessions: Vec<NormalizedSession>,
}

#[derive(Debug, Deserialize)]
struct ClaudeHistoryEntry {
    #[serde(rename = "sessionId")]
    session_id: String,
    display: Option<String>,
    #[serde(rename = "pastedContents")]
    pasted_contents: Option<Value>,
    timestamp: i64,
    project: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ClaudeSessionMeta {
    #[serde(rename = "sessionId")]
    session_id: String,
    cwd: Option<String>,
    #[serde(rename = "startedAt")]
    started_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct CodexHistoryEntry {
    session_id: String,
    ts: i64,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CodexSessionIndexEntry {
    id: String,
    thread_name: Option<String>,
    updated_at: Option<String>,
}

#[derive(Debug, Default)]
struct ClaudeAccumulator {
    started_at_ms: Option<i64>,
    ended_at_ms: Option<i64>,
    project_path: Option<String>,
    messages: Vec<(i64, String)>,
}

#[derive(Debug, Default)]
struct CodexAccumulator {
    started_at_s: Option<i64>,
    ended_at_s: Option<i64>,
    messages: Vec<(i64, String)>,
}

fn sort_sessions(mut sessions: Vec<NormalizedSession>) -> Vec<NormalizedSession> {
    sessions.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.source_id.cmp(&b.source_id))
            .then_with(|| a.external_id.cmp(&b.external_id))
    });
    sessions
}

fn scan_adapter_sessions<A: SessionAdapter>(adapter: &A) -> Result<Vec<NormalizedSession>> {
    let mut sessions = Vec::new();

    let paths = adapter
        .discover_sessions()
        .with_context(|| format!("discover {} sessions", adapter.source_id()))?;
    for path in paths {
        let session = adapter
            .parse_session(&path)
            .with_context(|| format!("parse {} session: {}", adapter.source_id(), path.display()))?;
        sessions.push(session);
    }

    Ok(sessions)
}

fn rfc3339_millis(ts_ms: i64) -> Result<String> {
    DateTime::<Utc>::from_timestamp_millis(ts_ms)
        .ok_or_else(|| anyhow::anyhow!("invalid timestamp millis: {ts_ms}"))
        .map(|dt| dt.to_rfc3339_opts(SecondsFormat::Millis, true))
}

fn rfc3339_seconds(ts_s: i64) -> Result<String> {
    DateTime::<Utc>::from_timestamp(ts_s, 0)
        .ok_or_else(|| anyhow::anyhow!("invalid timestamp seconds: {ts_s}"))
        .map(|dt| dt.to_rfc3339_opts(SecondsFormat::Secs, true))
}

fn read_jsonl<T>(path: &Path) -> Result<Vec<T>>
where
    T: for<'de> Deserialize<'de>,
{
    if !path.exists() {
        return Ok(Vec::new());
    }

    let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
    let reader = BufReader::new(file);
    let mut items = Vec::new();

    for (index, line) in reader.lines().enumerate() {
        let line_no = index + 1;
        let line = line.with_context(|| format!("read line {line_no} from {}", path.display()))?;
        if line.trim().is_empty() {
            continue;
        }
        let item = serde_json::from_str(&line)
            .with_context(|| format!("parse json line {line_no} from {}", path.display()))?;
        items.push(item);
    }

    Ok(items)
}

fn read_claude_session_meta(root: &Path) -> Result<HashMap<String, ClaudeSessionMeta>> {
    let sessions_dir = root.join("sessions");
    if !sessions_dir.exists() {
        return Ok(HashMap::new());
    }

    let mut out = HashMap::new();
    for entry in std::fs::read_dir(&sessions_dir)
        .with_context(|| format!("read_dir {}", sessions_dir.display()))?
    {
        let entry = entry.with_context(|| format!("read entry in {}", sessions_dir.display()))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let contents =
            std::fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
        let meta: ClaudeSessionMeta = serde_json::from_str(contents.trim())
            .with_context(|| format!("parse {}", path.display()))?;
        out.insert(meta.session_id.clone(), meta);
    }

    Ok(out)
}

fn project_display_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Unknown Project")
        .to_string()
}

fn claude_message_text(entry: &ClaudeHistoryEntry) -> String {
    if let Some(display) = &entry.display {
        if !display.is_empty() {
            return display.clone();
        }
    }

    match &entry.pasted_contents {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(value)) => value.clone(),
        Some(Value::Object(map)) if map.is_empty() => String::new(),
        Some(other) => other.to_string(),
    }
}

fn scan_real_claude_sources(root: &Path) -> Result<Vec<NormalizedSession>> {
    let history = root.join("history.jsonl");
    if !history.exists() {
        return Ok(Vec::new());
    }

    let entries: Vec<ClaudeHistoryEntry> = read_jsonl(&history)?;
    let meta_by_session = read_claude_session_meta(root)?;

    let mut grouped: HashMap<String, ClaudeAccumulator> = HashMap::new();
    for entry in entries {
        let acc = grouped.entry(entry.session_id.clone()).or_default();
        acc.started_at_ms = Some(match acc.started_at_ms {
            Some(current) => current.min(entry.timestamp),
            None => entry.timestamp,
        });
        acc.ended_at_ms = Some(match acc.ended_at_ms {
            Some(current) => current.max(entry.timestamp),
            None => entry.timestamp,
        });
        if acc.project_path.is_none() {
            acc.project_path = entry.project.clone();
        }
        acc.messages
            .push((entry.timestamp, claude_message_text(&entry)));
    }

    let mut sessions = Vec::new();
    for (session_id, mut acc) in grouped {
        acc.messages.sort_by_key(|(timestamp, _)| *timestamp);
        let meta = meta_by_session.get(&session_id);
        let project_path = acc
            .project_path
            .or_else(|| meta.and_then(|value| value.cwd.clone()))
            .unwrap_or_else(|| "Unknown Project".to_string());
        let project_name = project_display_name(&project_path);

        let started_at_ms = meta
            .and_then(|value| value.started_at)
            .or(acc.started_at_ms)
            .context("claude session missing started_at")?;
        let ended_at_ms = acc.ended_at_ms.unwrap_or(started_at_ms);
        let started_at = rfc3339_millis(started_at_ms)?;
        let ended_at = rfc3339_millis(ended_at_ms)?;

        let messages = acc
            .messages
            .into_iter()
            .enumerate()
            .map(|(seq_no, (timestamp, content_text))| {
                Ok(MessageRecord {
                    role: "user".to_string(),
                    content_text,
                    created_at: rfc3339_millis(timestamp)?,
                    seq_no: seq_no as i64,
                    metadata_json: "{}".to_string(),
                })
            })
            .collect::<Result<Vec<_>>>()?;

        sessions.push(NormalizedSession {
            source_id: "claude_code".to_string(),
            external_id: session_id,
            title: format!("Claude Code: {project_name}"),
            started_at,
            ended_at: ended_at.clone(),
            updated_at: ended_at,
            project: ProjectRecord {
                path: project_path,
                display_name: project_name,
            },
            messages,
            raw_ref: history.display().to_string(),
        });
    }

    Ok(sessions)
}

fn scan_real_codex_sources(root: &Path) -> Result<Vec<NormalizedSession>> {
    let history = root.join("history.jsonl");
    if !history.exists() {
        return Ok(Vec::new());
    }

    let entries: Vec<CodexHistoryEntry> = read_jsonl(&history)?;
    let index_entries: Vec<CodexSessionIndexEntry> = read_jsonl(&root.join("session_index.jsonl"))?;
    let index_by_session: HashMap<String, CodexSessionIndexEntry> = index_entries
        .into_iter()
        .map(|entry| (entry.id.clone(), entry))
        .collect();

    let mut grouped: HashMap<String, CodexAccumulator> = HashMap::new();
    for entry in entries {
        let acc = grouped.entry(entry.session_id.clone()).or_default();
        acc.started_at_s = Some(match acc.started_at_s {
            Some(current) => current.min(entry.ts),
            None => entry.ts,
        });
        acc.ended_at_s = Some(match acc.ended_at_s {
            Some(current) => current.max(entry.ts),
            None => entry.ts,
        });
        acc.messages
            .push((entry.ts, entry.text.unwrap_or_default()));
    }

    let mut sessions = Vec::new();
    for (session_id, mut acc) in grouped {
        acc.messages.sort_by_key(|(timestamp, _)| *timestamp);
        let started_at_s = acc.started_at_s.context("codex session missing started_at")?;
        let ended_at_s = acc.ended_at_s.unwrap_or(started_at_s);
        let started_at = rfc3339_seconds(started_at_s)?;
        let ended_at = rfc3339_seconds(ended_at_s)?;
        let index = index_by_session.get(&session_id);
        let title_suffix = index
            .and_then(|entry| entry.thread_name.clone())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| session_id.clone());
        let updated_at = index
            .and_then(|entry| entry.updated_at.clone())
            .unwrap_or_else(|| ended_at.clone());

        let messages = acc
            .messages
            .into_iter()
            .enumerate()
            .map(|(seq_no, (timestamp, content_text))| {
                Ok(MessageRecord {
                    role: "user".to_string(),
                    content_text,
                    created_at: rfc3339_seconds(timestamp)?,
                    seq_no: seq_no as i64,
                    metadata_json: "{}".to_string(),
                })
            })
            .collect::<Result<Vec<_>>>()?;

        sessions.push(NormalizedSession {
            source_id: "codex".to_string(),
            external_id: session_id.clone(),
            title: format!("Codex: {title_suffix}"),
            started_at,
            ended_at,
            updated_at,
            project: ProjectRecord {
                path: "Unknown Project".to_string(),
                display_name: "Unknown Project".to_string(),
            },
            messages,
            raw_ref: history.display().to_string(),
        });
    }

    Ok(sessions)
}

pub fn scan_fixture_sources(claude_root: PathBuf, codex_root: PathBuf) -> Result<ScanResult> {
    let claude = ClaudeCodeAdapter::new(claude_root);
    let codex = CodexAdapter::new(codex_root);

    let mut sessions = scan_adapter_sessions(&claude)?;
    sessions.extend(scan_adapter_sessions(&codex)?);

    Ok(ScanResult {
        sessions: sort_sessions(sessions),
    })
}

pub fn scan_home_sources(home_root: PathBuf) -> Result<ScanResult> {
    let mut sessions = scan_real_claude_sources(&home_root.join(".claude"))?;
    sessions.extend(scan_real_codex_sources(&home_root.join(".codex"))?);

    Ok(ScanResult {
        sessions: sort_sessions(sessions),
    })
}
