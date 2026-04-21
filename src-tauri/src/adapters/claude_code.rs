use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::Value;

use crate::adapters::{discover_jsonl_sessions, SessionAdapter};
use crate::domain::models::{MessageRecord, NormalizedSession, ProjectRecord};

#[derive(Debug, Clone)]
pub struct ClaudeCodeAdapter {
    root: PathBuf,
}

impl ClaudeCodeAdapter {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn parse_line(v: &Value, seq_no: i64) -> Result<(String, MessageRecord, String, String)> {
        let session_id = v
            .get("sessionId")
            .and_then(|x| x.as_str())
            .ok_or_else(|| anyhow!("missing sessionId"))?
            .to_string();

        let project_path = v
            .get("project")
            .and_then(|x| x.as_str())
            .unwrap_or("Unknown Project")
            .to_string();
        let project_name = Path::new(&project_path)
            .file_name()
            .and_then(|x| x.to_str())
            .unwrap_or("Unknown Project")
            .to_string();

        let ts_ms = v
            .get("timestamp")
            .and_then(|x| x.as_i64())
            .ok_or_else(|| anyhow!("missing timestamp"))?;
        let created_at = DateTime::<Utc>::from_timestamp_millis(ts_ms)
            .ok_or_else(|| anyhow!("invalid timestamp millis: {ts_ms}"))?
            .to_rfc3339_opts(SecondsFormat::Millis, true);

        let display = v.get("display").and_then(|x| x.as_str()).unwrap_or("");
        let pasted = v.get("pastedContents");
        let content_text = if !display.is_empty() {
            display.to_string()
        } else {
            match pasted {
                None => String::new(),
                Some(Value::Null) => String::new(),
                Some(Value::String(s)) => s.clone(),
                Some(Value::Object(map)) if map.is_empty() => String::new(),
                Some(other) => other.to_string(),
            }
        };

        Ok((
            session_id.clone(),
            MessageRecord {
                role: "user".to_string(),
                content_text,
                created_at: created_at.clone(),
                seq_no,
                metadata_json: "{}".to_string(),
            },
            created_at,
            project_name,
        ))
    }
}

impl SessionAdapter for ClaudeCodeAdapter {
    fn source_id(&self) -> &'static str {
        "claude_code"
    }

    fn discover_sessions(&self) -> std::io::Result<Vec<PathBuf>> {
        discover_jsonl_sessions(&self.root)
    }

    fn parse_session(&self, path: &Path) -> Result<NormalizedSession> {
        let f = File::open(path).with_context(|| format!("open session: {}", path.display()))?;
        let reader = BufReader::new(f);

        let mut external_id: Option<String> = None;
        let mut project_path: Option<String> = None;
        let mut project_name: Option<String> = None;
        let mut started_at: Option<String> = None;
        let mut ended_at: Option<String> = None;
        let mut messages = Vec::new();
        let mut seq_no = 0_i64;

        for (i, line) in reader.lines().enumerate() {
            let line_no = i + 1;
            let line = line.with_context(|| format!("read line {line_no}"))?;
            if line.trim().is_empty() {
                continue;
            }
            let v: Value = serde_json::from_str(&line)
                .with_context(|| format!("parse json line {line_no}: {}", path.display()))?;

            let (sid, msg, created_at, proj_name) = Self::parse_line(&v, seq_no)?;
            if let Some(existing) = &external_id {
                if existing != &sid {
                    return Err(anyhow!(
                        "mismatched sessionId at line {} in {}",
                        line_no,
                        path.display()
                    ));
                }
            } else {
                external_id = Some(sid);
            }
            if project_path.is_none() {
                project_path = Some(
                    v.get("project")
                        .and_then(|x| x.as_str())
                        .unwrap_or("Unknown Project")
                        .to_string(),
                );
            }
            if project_name.is_none() {
                project_name = Some(proj_name);
            }

            if started_at.is_none() {
                started_at = Some(created_at.clone());
            }
            ended_at = Some(created_at.clone());
            messages.push(msg);
            seq_no += 1;
        }

        let external_id = external_id.ok_or_else(|| anyhow!("empty session file"))?;
        let started_at = started_at.ok_or_else(|| anyhow!("empty session file"))?;
        let ended_at = ended_at.clone().unwrap_or_else(|| started_at.clone());
        let updated_at = ended_at.clone();
        let project_path = project_path.unwrap_or_else(|| "Unknown Project".to_string());
        let project_name = project_name.unwrap_or_else(|| "Unknown Project".to_string());

        Ok(NormalizedSession {
            source_id: self.source_id().to_string(),
            external_id: external_id.clone(),
            title: project_name.clone(),
            started_at,
            ended_at,
            updated_at,
            project: ProjectRecord {
                path: project_path,
                display_name: project_name,
            },
            messages,
            raw_ref: path.display().to_string(),
        })
    }
}
