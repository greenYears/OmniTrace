use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, SecondsFormat};
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

    fn parse_timestamp(v: &Value, key: &str) -> Result<String> {
        let raw = v
            .get(key)
            .and_then(|x| x.as_str())
            .ok_or_else(|| anyhow!("missing {key}"))?;

        if raw.contains('T') {
            return Ok(raw.to_string());
        }

        let ts_secs = raw.parse::<i64>().map_err(|_| anyhow!("not a number: {raw}"))?;
        let dt = DateTime::from_timestamp(ts_secs, 0)
            .ok_or_else(|| anyhow!("invalid timestamp: {raw}"))?;
        Ok(dt.to_rfc3339_opts(SecondsFormat::Millis, true))
    }

    fn extract_string(v: &Value, path: &[&str]) -> Option<String> {
        let mut current = v;
        for key in path {
            current = current.get(*key)?;
        }
        current.as_str().map(|s| s.to_string())
    }

    fn extract_text(payload: &Value) -> String {
        if let Some(text) = payload.get("text").and_then(|t| t.as_str()) {
            if !text.is_empty() {
                return text.to_string();
            }
        }

        let content = match payload.get("content").and_then(|c| c.as_array()) {
            Some(arr) => arr,
            None => return String::new(),
        };

        let parts: Vec<String> = content
            .iter()
            .filter_map(|item| {
                let item_type = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
                if matches!(item_type, "input_text" | "output_text" | "text") {
                    item.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
                } else {
                    None
                }
            })
            .filter(|s| !s.is_empty())
            .collect();

        parts.join("\n\n")
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
        let file_size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
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

            let msg_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
            let payload = v.get("payload").cloned().unwrap_or(Value::Null);

            match msg_type {
                "session_meta" => {
                    if external_id.is_none() {
                        external_id = Self::extract_string(&payload, &["id"]);
                    }
                    if project_path.is_none() {
                        if let Some(cwd) = Self::extract_string(&payload, &["cwd"]) {
                            project_path = Some(cwd.clone());
                            project_name = Some(
                                Path::new(&cwd)
                                    .file_name()
                                    .and_then(|n| n.to_str())
                                    .unwrap_or("Unknown Project")
                                    .to_string(),
                            );
                        }
                    }
                    if started_at.is_none() {
                        started_at = Self::parse_timestamp(&v, "timestamp").ok();
                    }
                }
                "response_item" => {
                    let payload_type = payload.get("type").and_then(|t| t.as_str()).unwrap_or("");

                    match payload_type {
                        "message" | "" => {
                            let role = payload
                                .get("role")
                                .and_then(|r| r.as_str())
                                .unwrap_or("user");

                            if role == "user" || role == "assistant" {
                                let content_text = Self::extract_text(&payload);
                                if content_text.is_empty() {
                                    continue;
                                }

                                let created_at = Self::parse_timestamp(&v, "timestamp").ok();

                                if started_at.is_none() {
                                    started_at = created_at.clone();
                                }
                                ended_at = created_at.clone();

                                messages.push(MessageRecord {
                                    role: role.to_string(),
                                    content_text,
                                    created_at: created_at.unwrap_or_default(),
                                    seq_no,
                                    metadata_json: "{}".to_string(),
                                });
                                seq_no += 1;
                            }
                        }
                        "function_call" | "custom_tool_call" => {
                            let tool_name = payload
                                .get("name")
                                .and_then(|n| n.as_str())
                                .unwrap_or("tool");
                            let args = payload
                                .get("arguments")
                                .and_then(|a| a.as_str())
                                .unwrap_or("");
                            let created_at = Self::parse_timestamp(&v, "timestamp").ok();

                            if started_at.is_none() {
                                started_at = created_at.clone();
                            }
                            ended_at = created_at.clone();

                            messages.push(MessageRecord {
                                role: "tool".to_string(),
                                content_text: args.to_string(),
                                created_at: created_at.unwrap_or_default(),
                                seq_no,
                                metadata_json: format!(r#"{{"tool_name":"{}","kind":"tool_call"}}"#, tool_name),
                            });
                            seq_no += 1;
                        }
                        "function_call_output" | "custom_tool_call_output" => {
                            let output = payload
                                .get("output")
                                .and_then(|o| o.as_str())
                                .unwrap_or("");
                            if output.is_empty() {
                                continue;
                            }
                            let created_at = Self::parse_timestamp(&v, "timestamp").ok();
                            ended_at = created_at.clone();

                            messages.push(MessageRecord {
                                role: "tool".to_string(),
                                content_text: output.to_string(),
                                created_at: created_at.unwrap_or_default(),
                                seq_no,
                                metadata_json: r#"{"kind":"tool_result"}"#.to_string(),
                            });
                            seq_no += 1;
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }

        let external_id = external_id
            .or_else(|| {
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_string())
            })
            .ok_or_else(|| anyhow!("empty session file: {}", path.display()))?;
        let started_at = started_at.ok_or_else(|| anyhow!("no timestamps in session file"))?;
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
            file_size,
            model_id: String::new(),
        })
    }
}
