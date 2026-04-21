use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::Value;

use crate::adapters::{discover_jsonl_sessions, SessionAdapter};
use crate::domain::models::{MessageRecord, NormalizedSession, ProjectRecord};

#[derive(Debug, Clone)]
pub struct CodexAdapter {
    root: PathBuf,
}

impl CodexAdapter {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
}

impl SessionAdapter for CodexAdapter {
    fn source_id(&self) -> &'static str {
        "codex"
    }

    fn discover_sessions(&self) -> std::io::Result<Vec<PathBuf>> {
        discover_jsonl_sessions(&self.root)
    }

    fn parse_session(&self, path: &Path) -> Result<NormalizedSession> {
        let f = File::open(path).with_context(|| format!("open session: {}", path.display()))?;
        let reader = BufReader::new(f);

        let mut external_id: Option<String> = None;
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

            let sid = v
                .get("session_id")
                .and_then(|x| x.as_str())
                .ok_or_else(|| anyhow!("missing session_id"))?
                .to_string();
            if let Some(existing) = &external_id {
                if existing != &sid {
                    return Err(anyhow!(
                        "mismatched session_id at line {} in {}",
                        line_no,
                        path.display()
                    ));
                }
            } else {
                external_id = Some(sid);
            }

            let ts_s = v
                .get("ts")
                .and_then(|x| x.as_i64())
                .ok_or_else(|| anyhow!("missing ts"))?;
            let created_at = DateTime::<Utc>::from_timestamp(ts_s, 0)
                .ok_or_else(|| anyhow!("invalid timestamp seconds: {ts_s}"))?
                .to_rfc3339_opts(SecondsFormat::Secs, true);

            let text = v.get("text").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let msg = MessageRecord {
                role: "user".to_string(),
                content_text: text,
                created_at: created_at.clone(),
                seq_no,
                metadata_json: "{}".to_string(),
            };

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

        Ok(NormalizedSession {
            source_id: self.source_id().to_string(),
            external_id: external_id.clone(),
            title: external_id.clone(),
            started_at,
            ended_at,
            updated_at,
            project: ProjectRecord {
                path: "Unknown Project".to_string(),
                display_name: "Unknown Project".to_string(),
            },
            messages,
            raw_ref: path.display().to_string(),
        })
    }
}
