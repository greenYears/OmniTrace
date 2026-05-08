use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::adapters::claude_code::ClaudeCodeAdapter;
use crate::adapters::codex::CodexAdapter;
use crate::adapters::{
    discover_jsonl_sessions, normalize_project_path, project_display_name, SessionAdapter,
};
use crate::domain::detail::extract_model_id;
use crate::domain::models::{MessageRecord, NormalizedSession, ProjectRecord};
use crate::ingest::fingerprint::file_fingerprint;
use crate::ingest::upsert::{cleanup_stale_records, find_ingest_record, upsert_ingest_record};

#[derive(Debug, Clone)]
pub struct ScanResult {
    pub sessions: Vec<NormalizedSession>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionScanProgress {
    pub source_id: String,
    pub phase: String,
    pub path: String,
    pub files_scanned: usize,
    pub sessions_found: usize,
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
struct ClaudeProjectSessionsIndex {
    entries: Vec<ClaudeProjectSessionEntry>,
}

#[derive(Debug, Deserialize)]
struct ClaudeProjectSessionEntry {
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(rename = "fullPath")]
    full_path: Option<String>,
    #[serde(rename = "projectPath")]
    project_path: Option<String>,
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
    cwd: Option<String>,
    updated_at: Option<String>,
}

#[derive(Debug, Default)]
struct CodexSessionMeta {
    cwd: Option<String>,
    path: Option<String>,
}

#[derive(Debug, Default)]
struct ClaudeSessionPathMeta {
    path: Option<String>,
    project_path: Option<String>,
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
    let mut noop = |_event| {};
    scan_adapter_sessions_with_progress(adapter, &mut noop)
}

fn scan_adapter_sessions_with_progress<A, F>(
    adapter: &A,
    on_progress: &mut F,
) -> Result<Vec<NormalizedSession>>
where
    A: SessionAdapter,
    F: FnMut(SessionScanProgress),
{
    let mut sessions = Vec::new();

    let paths = adapter
        .discover_sessions()
        .with_context(|| format!("discover {} sessions", adapter.source_id()))?;
    for path in paths {
        on_progress(SessionScanProgress {
            source_id: adapter.source_id().to_string(),
            phase: "解析会话".to_string(),
            path: path.display().to_string(),
            files_scanned: sessions.len() + 1,
            sessions_found: sessions.len(),
        });
        let mut session = adapter.parse_session(&path).with_context(|| {
            format!("parse {} session: {}", adapter.source_id(), path.display())
        })?;
        if session.model_id.is_empty() && !session.raw_ref.is_empty() {
            session.model_id = extract_model_id(adapter.source_id(), Path::new(&session.raw_ref));
        }
        sessions.push(session);
        on_progress(SessionScanProgress {
            source_id: adapter.source_id().to_string(),
            phase: "解析会话".to_string(),
            path: path.display().to_string(),
            files_scanned: sessions.len(),
            sessions_found: sessions.len(),
        });
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

fn read_claude_project_sessions(root: &Path) -> Result<HashMap<String, ClaudeSessionPathMeta>> {
    let projects_dir = root.join("projects");
    if !projects_dir.exists() {
        return Ok(HashMap::new());
    }

    let mut out = HashMap::new();
    for entry in std::fs::read_dir(&projects_dir)
        .with_context(|| format!("read_dir {}", projects_dir.display()))?
    {
        let entry = entry.with_context(|| format!("read entry in {}", projects_dir.display()))?;
        let project_dir = entry.path();
        if !project_dir.is_dir() {
            continue;
        }

        let index_path = project_dir.join("sessions-index.json");
        if index_path.exists() {
            let contents = std::fs::read_to_string(&index_path)
                .with_context(|| format!("read {}", index_path.display()))?;
            let index: ClaudeProjectSessionsIndex = serde_json::from_str(&contents)
                .with_context(|| format!("parse {}", index_path.display()))?;

            for session in index.entries {
                let candidate_path = session
                    .full_path
                    .filter(|path| Path::new(path).exists())
                    .or_else(|| {
                        let inferred = project_dir.join(format!("{}.jsonl", session.session_id));
                        inferred.exists().then(|| inferred.display().to_string())
                    });
                let entry = out
                    .entry(session.session_id)
                    .or_insert_with(ClaudeSessionPathMeta::default);
                if entry.path.is_none() {
                    entry.path = candidate_path;
                }
                if entry.project_path.is_none() {
                    entry.project_path = session.project_path;
                }
            }
        }

        for session_path in discover_jsonl_sessions(&project_dir).with_context(|| {
            format!(
                "discover claude project sessions in {}",
                project_dir.display()
            )
        })? {
            let Some(session_id) = session_path
                .file_stem()
                .and_then(|value| value.to_str())
                .map(|value| value.to_string())
            else {
                continue;
            };

            let entry = out
                .entry(session_id)
                .or_insert_with(ClaudeSessionPathMeta::default);
            if entry.path.is_none() {
                entry.path = Some(session_path.display().to_string());
            }
        }
    }

    Ok(out)
}

fn read_codex_session_meta(root: &Path) -> Result<HashMap<String, CodexSessionMeta>> {
    let sessions_dir = root.join("sessions");
    if !sessions_dir.exists() {
        return Ok(HashMap::new());
    }

    let mut out = HashMap::new();
    for path in discover_jsonl_sessions(&sessions_dir)
        .with_context(|| format!("discover codex sessions in {}", sessions_dir.display()))?
    {
        let file = File::open(&path).with_context(|| format!("open {}", path.display()))?;
        let reader = BufReader::new(file);

        for (index, line) in reader.lines().enumerate() {
            let line_no = index + 1;
            let line =
                line.with_context(|| format!("read line {line_no} from {}", path.display()))?;
            if line.trim().is_empty() {
                continue;
            }

            let value: Value = serde_json::from_str(&line)
                .with_context(|| format!("parse json line {line_no} from {}", path.display()))?;
            if value.get("type").and_then(|v| v.as_str()) != Some("session_meta") {
                continue;
            }

            let payload = value.get("payload").unwrap_or(&Value::Null);
            if let Some(session_id) = payload.get("id").and_then(|v| v.as_str()) {
                out.entry(session_id.to_string())
                    .or_insert_with(|| CodexSessionMeta {
                        cwd: payload
                            .get("cwd")
                            .and_then(|v| v.as_str())
                            .map(|v| v.to_string()),
                        path: Some(path.display().to_string()),
                    });
            }
            break;
        }
    }

    Ok(out)
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

fn scan_real_claude_sources_with_progress<F>(
    root: &Path,
    on_progress: &mut F,
) -> Result<Vec<NormalizedSession>>
where
    F: FnMut(SessionScanProgress),
{
    let meta_by_session = read_claude_session_meta(root).unwrap_or_default();
    let raw_by_session = read_claude_project_sessions(root).unwrap_or_default();

    let mut grouped: HashMap<String, ClaudeAccumulator> = HashMap::new();

    // Collect entries from history.jsonl (may be empty or only current session)
    let history = root.join("history.jsonl");
    if history.exists() {
        on_progress(SessionScanProgress {
            source_id: "claude_code".to_string(),
            phase: "解析历史".to_string(),
            path: history.display().to_string(),
            files_scanned: 1,
            sessions_found: grouped.len(),
        });
        let entries: Vec<ClaudeHistoryEntry> = read_jsonl(&history)?;
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
    }

    // Parse project session JSONL files not already discovered from history
    for (session_id, path_meta) in &raw_by_session {
        if grouped.contains_key(session_id) {
            continue;
        }
        let Some(raw_path) = &path_meta.path else {
            continue;
        };
        on_progress(SessionScanProgress {
            source_id: "claude_code".to_string(),
            phase: "解析会话".to_string(),
            path: raw_path.clone(),
            files_scanned: grouped.len() + 1,
            sessions_found: grouped.len(),
        });
        let file = match File::open(raw_path) {
            Ok(f) => f,
            Err(_) => continue,
        };
        let reader = BufReader::new(file);
        let mut min_ts: Option<i64> = None;
        let mut max_ts: Option<i64> = None;
        let mut cwd: Option<String> = None;
        let mut first_user_text: Option<String> = None;

        for line in reader.lines() {
            let Ok(line) = line else { break };
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let ts = value.get("timestamp").and_then(|v| v.as_str());
            if let Some(ts_str) = ts {
                if let Ok(dt) = ts_str.parse::<DateTime<Utc>>() {
                    let ms = dt.timestamp_millis();
                    min_ts = Some(min_ts.map_or(ms, |c| c.min(ms)));
                    max_ts = Some(max_ts.map_or(ms, |c| c.max(ms)));
                }
            }
            if cwd.is_none() {
                cwd = value
                    .get("cwd")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
            if first_user_text.is_none()
                && value.get("type").and_then(|v| v.as_str()) == Some("user")
            {
                first_user_text = value
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_str())
                    .map(|s| s.to_string());
            }
        }

        let Some(started_ms) = min_ts else { continue };
        let ended_ms = max_ts.unwrap_or(started_ms);
        let acc = grouped.entry(session_id.clone()).or_default();
        acc.started_at_ms = Some(started_ms);
        acc.ended_at_ms = Some(ended_ms);
        if acc.project_path.is_none() {
            acc.project_path = cwd.or_else(|| path_meta.project_path.clone());
        }
        if let Some(text) = first_user_text {
            acc.messages.push((started_ms, text));
        }
        on_progress(SessionScanProgress {
            source_id: "claude_code".to_string(),
            phase: "解析会话".to_string(),
            path: raw_path.clone(),
            files_scanned: grouped.len(),
            sessions_found: grouped.len(),
        });
    }

    let mut sessions = Vec::new();
    for (session_id, mut acc) in grouped {
        acc.messages.sort_by_key(|(timestamp, _)| *timestamp);
        let meta = meta_by_session.get(&session_id);
        let raw = raw_by_session.get(&session_id);
        let project_path = normalize_project_path(
            &acc.project_path
                .or_else(|| raw.and_then(|value| value.project_path.clone()))
                .or_else(|| meta.and_then(|value| value.cwd.clone()))
                .unwrap_or_else(|| "Unknown Project".to_string()),
        );
        let project_name = project_display_name(&project_path);

        let started_at_ms = match meta
            .and_then(|value| value.started_at)
            .or(acc.started_at_ms)
        {
            Some(ms) => ms,
            None => continue,
        };
        let ended_at_ms = acc.ended_at_ms.unwrap_or(started_at_ms);
        let Ok(started_at) = rfc3339_millis(started_at_ms) else {
            continue;
        };
        let Ok(ended_at) = rfc3339_millis(ended_at_ms) else {
            continue;
        };

        let messages: Vec<_> = acc
            .messages
            .into_iter()
            .enumerate()
            .filter_map(|(seq_no, (timestamp, content_text))| {
                let created_at = rfc3339_millis(timestamp).ok()?;
                Some(MessageRecord {
                    role: "user".to_string(),
                    content_text,
                    created_at,
                    seq_no: seq_no as i64,
                    metadata_json: "{}".to_string(),
                })
            })
            .collect();

        let raw_ref = raw
            .and_then(|value| value.path.clone())
            .unwrap_or_else(|| history.display().to_string());

        sessions.push(NormalizedSession {
            source_id: "claude_code".to_string(),
            external_id: session_id,
            title: project_name.clone(),
            started_at,
            ended_at: ended_at.clone(),
            updated_at: ended_at,
            project: ProjectRecord {
                path: project_path,
                display_name: project_name,
            },
            messages,
            raw_ref: raw_ref.clone(),
            file_size: std::fs::metadata(Path::new(&raw_ref))
                .map(|m| m.len())
                .unwrap_or(0),
            model_id: raw
                .and_then(|value| value.path.as_ref())
                .map(|p| extract_model_id("claude_code", Path::new(p)))
                .unwrap_or_default(),
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
    let meta_by_session = read_codex_session_meta(root)?;
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
        let started_at_s = acc
            .started_at_s
            .context("codex session missing started_at")?;
        let ended_at_s = acc.ended_at_s.unwrap_or(started_at_s);
        let started_at = rfc3339_seconds(started_at_s)?;
        let ended_at = rfc3339_seconds(ended_at_s)?;
        let index = index_by_session.get(&session_id);
        let project_path = normalize_project_path(
            &index
                .and_then(|entry| entry.cwd.clone())
                .or_else(|| {
                    meta_by_session
                        .get(&session_id)
                        .and_then(|meta| meta.cwd.clone())
                })
                .unwrap_or_else(|| "Unknown Project".to_string()),
        );
        let project_name = project_display_name(&project_path);
        let title_suffix = index
            .and_then(|entry| entry.thread_name.clone())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| project_name.clone());
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
            title: title_suffix,
            started_at,
            ended_at,
            updated_at,
            project: ProjectRecord {
                path: project_path,
                display_name: project_name,
            },
            messages,
            raw_ref: meta_by_session
                .get(&session_id)
                .and_then(|meta| meta.path.clone())
                .unwrap_or_else(|| history.display().to_string()),
            file_size: meta_by_session
                .get(&session_id)
                .and_then(|meta| meta.path.as_ref())
                .map(|p| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0))
                .unwrap_or(0),
            model_id: meta_by_session
                .get(&session_id)
                .and_then(|meta| meta.path.as_ref())
                .map(|p| extract_model_id("codex", Path::new(p)))
                .unwrap_or_default(),
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
    scan_home_sources_with_progress(home_root, |_event| {})
}

pub fn scan_home_sources_with_progress<F>(
    home_root: PathBuf,
    mut on_progress: F,
) -> Result<ScanResult>
where
    F: FnMut(SessionScanProgress),
{
    let claude_root = home_root.join(".claude");
    on_progress(SessionScanProgress {
        source_id: "claude_code".to_string(),
        phase: "扫描目录".to_string(),
        path: claude_root.display().to_string(),
        files_scanned: 0,
        sessions_found: 0,
    });
    let mut sessions = scan_real_claude_sources_with_progress(&claude_root, &mut on_progress)?;
    on_progress(SessionScanProgress {
        source_id: "claude_code".to_string(),
        phase: "完成来源".to_string(),
        path: claude_root.display().to_string(),
        files_scanned: 0,
        sessions_found: sessions.len(),
    });

    let codex_sessions_dir = home_root.join(".codex/sessions");
    if codex_sessions_dir.exists() {
        let before = sessions.len();
        let codex = CodexAdapter::new(codex_sessions_dir);
        let codex_sessions = scan_adapter_sessions_with_progress(&codex, &mut on_progress)?;
        sessions.extend(codex_sessions);
        on_progress(SessionScanProgress {
            source_id: "codex".to_string(),
            phase: "完成来源".to_string(),
            path: home_root.join(".codex").display().to_string(),
            files_scanned: sessions.len() - before,
            sessions_found: sessions.len() - before,
        });
    } else {
        on_progress(SessionScanProgress {
            source_id: "codex".to_string(),
            phase: "扫描目录".to_string(),
            path: home_root.join(".codex").display().to_string(),
            files_scanned: 0,
            sessions_found: 0,
        });
        sessions.extend(scan_real_codex_sources(&home_root.join(".codex"))?);
        on_progress(SessionScanProgress {
            source_id: "codex".to_string(),
            phase: "完成来源".to_string(),
            path: home_root.join(".codex").display().to_string(),
            files_scanned: 0,
            sessions_found: sessions
                .iter()
                .filter(|session| session.source_id == "codex")
                .count(),
        });
    }

    Ok(ScanResult {
        sessions: sort_sessions(sessions),
    })
}

/// Check which sources need re-scanning based on file fingerprints.
/// Returns (claude_needs_scan, codex_needs_scan).
pub fn check_sources_needing_scan(conn: &Connection, home_root: &Path) -> (bool, bool) {
    let claude_root = home_root.join(".claude");
    let claude_files = discover_claude_source_files(&claude_root);
    let claude_needs_scan = claude_files.iter().any(|p| {
        let Ok(fp) = file_fingerprint(p) else {
            return true;
        };
        find_ingest_record(conn, "claude_code", &fp)
            .ok()
            .flatten()
            .map(|r| r.parse_status != "success")
            .unwrap_or(true)
    });

    let codex_sessions_dir = home_root.join(".codex/sessions");
    let codex_root = home_root.join(".codex");
    let codex_needs_scan = if codex_sessions_dir.exists() {
        let codex = CodexAdapter::new(codex_sessions_dir);
        let paths = codex.discover_sessions().unwrap_or_default();
        paths.iter().any(|p| {
            let Ok(fp) = file_fingerprint(p) else {
                return true;
            };
            find_ingest_record(conn, "codex", &fp)
                .ok()
                .flatten()
                .map(|r| r.parse_status != "success")
                .unwrap_or(true)
        })
    } else {
        let codex_files = discover_codex_source_files(&codex_root);
        codex_files.iter().any(|p| {
            let Ok(fp) = file_fingerprint(p) else {
                return true;
            };
            find_ingest_record(conn, "codex", &fp)
                .ok()
                .flatten()
                .map(|r| r.parse_status != "success")
                .unwrap_or(true)
        })
    };

    (claude_needs_scan, codex_needs_scan)
}

/// Parse session files from disk (no DB access needed).
pub fn parse_home_sessions<F>(
    home_root: &Path,
    scan_claude: bool,
    scan_codex: bool,
    mut on_progress: F,
) -> Result<Vec<NormalizedSession>>
where
    F: FnMut(SessionScanProgress),
{
    let mut sessions = Vec::new();

    if scan_claude {
        let claude_root = home_root.join(".claude");
        on_progress(SessionScanProgress {
            source_id: "claude_code".to_string(),
            phase: "解析会话".to_string(),
            path: claude_root.display().to_string(),
            files_scanned: 0,
            sessions_found: 0,
        });
        let claude_sessions =
            scan_real_claude_sources_with_progress(&claude_root, &mut on_progress)?;
        sessions.extend(claude_sessions);
        on_progress(SessionScanProgress {
            source_id: "claude_code".to_string(),
            phase: "完成来源".to_string(),
            path: claude_root.display().to_string(),
            files_scanned: sessions.len(),
            sessions_found: sessions.len(),
        });
    }

    if scan_codex {
        let codex_sessions_dir = home_root.join(".codex/sessions");
        let codex_root = home_root.join(".codex");
        on_progress(SessionScanProgress {
            source_id: "codex".to_string(),
            phase: "解析会话".to_string(),
            path: codex_root.display().to_string(),
            files_scanned: 0,
            sessions_found: sessions.len(),
        });
        if codex_sessions_dir.exists() {
            let codex = CodexAdapter::new(codex_sessions_dir);
            let codex_sessions = scan_adapter_sessions_with_progress(&codex, &mut on_progress)?;
            sessions.extend(codex_sessions);
        } else {
            let codex_sessions = scan_real_codex_sources(&codex_root)?;
            sessions.extend(codex_sessions);
        }
        on_progress(SessionScanProgress {
            source_id: "codex".to_string(),
            phase: "完成来源".to_string(),
            path: codex_root.display().to_string(),
            files_scanned: sessions.iter().filter(|s| s.source_id == "codex").count(),
            sessions_found: sessions.len(),
        });
    }

    Ok(sessions)
}

/// Persist parsed sessions and update ingest records.
pub fn persist_scan_results(
    conn: &Connection,
    sessions: &[NormalizedSession],
    home_root: &Path,
    claude_scanned: bool,
    codex_scanned: bool,
) -> Result<()> {
    crate::db::schema::run_migrations(conn)?;

    if !sessions.is_empty() {
        crate::ingest::upsert::upsert_sessions(conn, sessions)?;
    }

    if claude_scanned {
        let claude_root = home_root.join(".claude");
        let claude_files = discover_claude_source_files(&claude_root);
        record_ingest_for_files(conn, "claude_code", &claude_files)?;
    }
    if codex_scanned {
        let codex_root = home_root.join(".codex");
        let codex_sessions_dir = codex_root.join("sessions");
        let codex_files = if codex_sessions_dir.exists() {
            let codex = CodexAdapter::new(codex_sessions_dir);
            codex.discover_sessions().unwrap_or_default()
        } else {
            discover_codex_source_files(&codex_root)
        };
        record_ingest_for_files(conn, "codex", &codex_files)?;
    }

    cleanup_stale_records(conn)?;
    Ok(())
}

fn discover_claude_source_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();

    let history = root.join("history.jsonl");
    if history.exists() {
        files.push(history);
    }

    let projects_dir = root.join("projects");
    if projects_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&projects_dir) {
            for entry in entries.flatten() {
                let project_dir = entry.path();
                if !project_dir.is_dir() {
                    continue;
                }
                if let Ok(jsonl_files) = discover_jsonl_sessions(&project_dir) {
                    files.extend(jsonl_files);
                }
            }
        }
    }

    files
}

fn discover_codex_source_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();

    let history = root.join("history.jsonl");
    if history.exists() {
        files.push(history);
    }

    let sessions_dir = root.join("sessions");
    if sessions_dir.exists() {
        if let Ok(jsonl_files) = discover_jsonl_sessions(&sessions_dir) {
            files.extend(jsonl_files);
        }
    }

    files
}

fn record_ingest_for_files(conn: &Connection, source_id: &str, files: &[PathBuf]) -> Result<()> {
    for file_path in files {
        let fp = file_fingerprint(file_path)?;
        upsert_ingest_record(
            conn,
            source_id,
            &file_path.display().to_string(),
            &fp,
            "success",
            None,
        )?;
    }
    Ok(())
}
