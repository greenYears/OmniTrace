use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DetailMessageRecord {
    pub role: String,
    pub kind: String,
    pub content_text: String,
    pub created_at: String,
    pub seq_no: i64,
    pub tool_name: Option<String>,
    pub file_paths: Vec<String>,
}

#[derive(Debug, Clone)]
struct ToolContext {
    name: String,
}

pub fn parse_detail_messages(source_id: &str, path: &Path) -> Result<Vec<DetailMessageRecord>> {
    match source_id {
        "codex" => parse_codex_detail_messages(path),
        "claude_code" => parse_claude_detail_messages(path),
        _ => Ok(Vec::new()),
    }
}

pub fn extract_model_id(source_id: &str, path: &Path) -> String {
    match source_id {
        "claude_code" => extract_claude_model_id(path),
        "codex" => extract_codex_model_id(path),
        _ => String::new(),
    }
}

fn extract_claude_model_id(path: &Path) -> String {
    let Ok(lines) = read_jsonl_values(path) else {
        return String::new();
    };

    for value in &lines {
        if value.get("type").and_then(|v| v.as_str()) != Some("assistant") {
            continue;
        }
        if let Some(model) = value
            .get("message")
            .and_then(|m| m.get("model"))
            .and_then(|m| m.as_str())
        {
            if !model.is_empty() {
                return model.to_string();
            }
        }
    }

    String::new()
}

fn extract_codex_model_id(path: &Path) -> String {
    let Ok(lines) = read_jsonl_values(path) else {
        return String::new();
    };

    for value in &lines {
        let payload = match value.get("payload") {
            Some(p) => p,
            None => continue,
        };
        if let Some(model) = payload.get("model").and_then(|m| m.as_str()) {
            if !model.is_empty() {
                return model.to_string();
            }
        }
    }

    String::new()
}

fn parse_codex_detail_messages(path: &Path) -> Result<Vec<DetailMessageRecord>> {
    let lines = read_jsonl_values(path)?;
    let mut messages = Vec::new();
    let mut tools_by_call_id = HashMap::new();
    let mut seq_no = 0_i64;

    for value in lines {
        if value.get("type").and_then(|v| v.as_str()) != Some("response_item") {
            continue;
        }

        let payload = value.get("payload").unwrap_or(&Value::Null);
        let created_at = value
            .get("timestamp")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        let payload_type = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");

        match payload_type {
            "message" => {
                let role = payload
                    .get("role")
                    .and_then(|v| v.as_str())
                    .unwrap_or("assistant");
                let content_text = match role {
                    "developer" => None,
                    "user" => extract_codex_user_prompt(payload),
                    "assistant" | "system" => {
                        let text = extract_codex_message_text(payload);
                        (!text.is_empty()).then_some(text)
                    }
                    _ => None,
                };
                let Some(content_text) = content_text else {
                    continue;
                };

                push_detail_message(
                    &mut messages,
                    &mut seq_no,
                    role.to_string(),
                    "message".to_string(),
                    content_text,
                    created_at,
                    None,
                    Vec::new(),
                );
            }
            "function_call" | "custom_tool_call" => {
                let tool_name = payload
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("tool")
                    .to_string();
                let file_paths =
                    extract_file_paths_from_value(payload.get("arguments").unwrap_or(&Value::Null))
                        .into_iter()
                        .chain(extract_file_paths_from_value(
                            payload.get("input").unwrap_or(&Value::Null),
                        ))
                        .collect::<Vec<_>>();

                if let Some(call_id) = payload.get("call_id").and_then(|v| v.as_str()) {
                    tools_by_call_id.insert(
                        call_id.to_string(),
                        ToolContext {
                            name: tool_name.clone(),
                        },
                    );
                }

                push_detail_message(
                    &mut messages,
                    &mut seq_no,
                    "tool".to_string(),
                    "tool_call".to_string(),
                    format!("调用工具 {}", tool_name),
                    created_at,
                    Some(tool_name),
                    dedupe_paths(file_paths),
                );
            }
            "function_call_output" | "custom_tool_call_output" => {
                let tool_name = payload
                    .get("call_id")
                    .and_then(|v| v.as_str())
                    .and_then(|call_id| tools_by_call_id.get(call_id))
                    .map(|tool| tool.name.clone());
                let file_paths =
                    extract_file_paths_from_value(payload.get("output").unwrap_or(&Value::Null));

                if !file_paths.is_empty() {
                    push_detail_message(
                        &mut messages,
                        &mut seq_no,
                        "tool".to_string(),
                        "file_summary".to_string(),
                        build_file_summary_text(tool_name.as_deref(), file_paths.len()),
                        created_at,
                        tool_name,
                        dedupe_paths(file_paths),
                    );
                }
            }
            _ => {
                let role = payload.get("role").and_then(|v| v.as_str()).unwrap_or("");
                if role == "user" || role == "assistant" {
                    let content_text = extract_codex_message_text(payload);
                    if content_text.is_empty() {
                        continue;
                    }

                    push_detail_message(
                        &mut messages,
                        &mut seq_no,
                        role.to_string(),
                        "message".to_string(),
                        content_text,
                        created_at,
                        None,
                        Vec::new(),
                    );
                }
            }
        }
    }

    Ok(messages)
}

fn parse_claude_detail_messages(path: &Path) -> Result<Vec<DetailMessageRecord>> {
    let lines = read_jsonl_values(path)?;
    let mut messages = Vec::new();
    let mut tools_by_call_id = HashMap::new();
    let mut previous_snapshot_files = Vec::new();
    let mut seq_no = 0_i64;

    for value in lines {
        let entry_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let created_at = value
            .get("timestamp")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        match entry_type {
            "assistant" | "user" => {
                let message = value.get("message").unwrap_or(&Value::Null);
                let role = message
                    .get("role")
                    .and_then(|v| v.as_str())
                    .unwrap_or(entry_type);
                let content = message.get("content").and_then(|v| v.as_array());
                let content_text = if role == "user" {
                    extract_claude_user_prompt(&value, message)
                } else {
                    let text = extract_claude_text_content(content);
                    (!text.is_empty()).then_some(text)
                };
                if let Some(content_text) = content_text {
                    push_detail_message(
                        &mut messages,
                        &mut seq_no,
                        role.to_string(),
                        "message".to_string(),
                        content_text,
                        created_at.clone(),
                        None,
                        Vec::new(),
                    );
                }

                if role == "assistant" {
                    for item in content.into_iter().flatten() {
                        if item.get("type").and_then(|v| v.as_str()) != Some("tool_use") {
                            continue;
                        }

                        let tool_name = item
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("tool")
                            .to_string();
                        let file_paths = extract_file_paths_from_value(
                            item.get("input").unwrap_or(&Value::Null),
                        );

                        if let Some(call_id) = item.get("id").and_then(|v| v.as_str()) {
                            tools_by_call_id.insert(
                                call_id.to_string(),
                                ToolContext {
                                    name: tool_name.clone(),
                                },
                            );
                        }

                        push_detail_message(
                            &mut messages,
                            &mut seq_no,
                            "tool".to_string(),
                            "tool_call".to_string(),
                            format!("调用工具 {}", tool_name),
                            created_at.clone(),
                            Some(tool_name),
                            dedupe_paths(file_paths),
                        );
                    }
                } else {
                    for item in content.into_iter().flatten() {
                        if item.get("type").and_then(|v| v.as_str()) != Some("tool_result") {
                            continue;
                        }

                        let tool_name = item
                            .get("tool_use_id")
                            .and_then(|v| v.as_str())
                            .and_then(|call_id| tools_by_call_id.get(call_id))
                            .map(|tool| tool.name.clone());
                        let file_paths = extract_file_paths_from_value(
                            value.get("toolUseResult").unwrap_or(&Value::Null),
                        )
                        .into_iter()
                        .chain(extract_file_paths_from_value(
                            item.get("content").unwrap_or(&Value::Null),
                        ))
                        .collect::<Vec<_>>();

                        if !file_paths.is_empty() {
                            push_detail_message(
                                &mut messages,
                                &mut seq_no,
                                "tool".to_string(),
                                "file_summary".to_string(),
                                build_file_summary_text(tool_name.as_deref(), file_paths.len()),
                                created_at.clone(),
                                tool_name,
                                dedupe_paths(file_paths),
                            );
                        }
                    }
                }
            }
            "file-history-snapshot" => {
                if value.get("isSnapshotUpdate").and_then(|v| v.as_bool()) != Some(true) {
                    continue;
                }

                let current_files = sorted_paths(
                    value
                        .get("snapshot")
                        .and_then(|snapshot| snapshot.get("trackedFileBackups"))
                        .and_then(|files| files.as_object())
                        .map(|map| map.keys().cloned().collect::<Vec<_>>())
                        .unwrap_or_default(),
                );
                let file_paths = current_files
                    .iter()
                    .filter(|path| {
                        !previous_snapshot_files
                            .iter()
                            .any(|previous| previous == *path)
                    })
                    .cloned()
                    .collect::<Vec<_>>();
                previous_snapshot_files = current_files;

                if !file_paths.is_empty() {
                    push_detail_message(
                        &mut messages,
                        &mut seq_no,
                        "tool".to_string(),
                        "file_summary".to_string(),
                        build_file_summary_text(Some("file-history-snapshot"), file_paths.len()),
                        value
                            .get("snapshot")
                            .and_then(|snapshot| snapshot.get("timestamp"))
                            .and_then(|timestamp| timestamp.as_str())
                            .unwrap_or(&created_at)
                            .to_string(),
                        Some("file-history-snapshot".to_string()),
                        file_paths,
                    );
                }
            }
            "attachment" => {
                let attachment = value.get("attachment").unwrap_or(&Value::Null);
                match attachment.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                    "selected_lines_in_ide" => {
                        let ide_name = attachment
                            .get("ideName")
                            .and_then(|v| v.as_str())
                            .unwrap_or("IDE");
                        let line_start = attachment
                            .get("lineStart")
                            .and_then(|v| v.as_i64())
                            .unwrap_or_default();
                        let line_end = attachment
                            .get("lineEnd")
                            .and_then(|v| v.as_i64())
                            .unwrap_or(line_start);
                        let line_count = if line_start > 0 && line_end >= line_start {
                            line_end - line_start + 1
                        } else {
                            0
                        };
                        let display_path = attachment
                            .get("displayPath")
                            .and_then(|v| v.as_str())
                            .or_else(|| attachment.get("filename").and_then(|v| v.as_str()))
                            .unwrap_or("unknown file");
                        let content = attachment
                            .get("content")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .trim();
                        if content.is_empty() {
                            continue;
                        }

                        push_detail_message(
                            &mut messages,
                            &mut seq_no,
                            "system".to_string(),
                            "selection_context".to_string(),
                            format!(
                                "Selected {} lines from {} in {}\n{}",
                                line_count.max(1),
                                display_path,
                                ide_name,
                                content
                            ),
                            created_at,
                            Some(ide_name.to_string()),
                            vec![display_path.to_string()],
                        );
                    }
                    "file" => {
                        let display_path = attachment
                            .get("displayPath")
                            .and_then(|v| v.as_str())
                            .or_else(|| attachment.get("filename").and_then(|v| v.as_str()))
                            .unwrap_or("unknown file");
                        let file = attachment
                            .get("content")
                            .and_then(|content| content.get("file"))
                            .unwrap_or(&Value::Null);
                        let content = file
                            .get("content")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .trim();
                        let num_lines = file
                            .get("numLines")
                            .and_then(|v| v.as_i64())
                            .unwrap_or_else(|| content.lines().count() as i64);
                        if content.is_empty() {
                            continue;
                        }

                        push_detail_message(
                            &mut messages,
                            &mut seq_no,
                            "system".to_string(),
                            "file_context".to_string(),
                            format!("Read {} ({} lines)\n{}", display_path, num_lines, content),
                            created_at,
                            None,
                            vec![display_path.to_string()],
                        );
                    }
                    "nested_memory" => {
                        let display_path = attachment
                            .get("displayPath")
                            .and_then(|v| v.as_str())
                            .or_else(|| attachment.get("path").and_then(|v| v.as_str()))
                            .unwrap_or("CLAUDE.md");

                        push_detail_message(
                            &mut messages,
                            &mut seq_no,
                            "system".to_string(),
                            "memory_context".to_string(),
                            format!("Loaded {}", display_path),
                            created_at,
                            None,
                            vec![display_path.to_string()],
                        );
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }

    Ok(messages)
}

fn extract_codex_message_text(payload: &Value) -> String {
    if let Some(text) = payload.get("text").and_then(|v| v.as_str()) {
        return text.to_string();
    }

    let content = payload.get("content").and_then(|v| v.as_array());
    extract_text_items(content)
}

fn extract_codex_user_prompt(payload: &Value) -> Option<String> {
    if let Some(text) = payload.get("text").and_then(|v| v.as_str()) {
        return normalize_codex_user_prompt(text);
    }

    match payload.get("content").unwrap_or(&Value::Null) {
        Value::Array(items) => {
            let parts = items
                .iter()
                .filter_map(|item| {
                    if item.get("type").and_then(|v| v.as_str()) != Some("input_text") {
                        return None;
                    }
                    item.get("text")
                        .and_then(|v| v.as_str())
                        .and_then(normalize_codex_user_prompt)
                })
                .collect::<Vec<_>>();

            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\n\n"))
            }
        }
        _ => None,
    }
}

fn extract_claude_text_content(content: Option<&Vec<Value>>) -> String {
    extract_text_items(content)
}

fn extract_claude_user_prompt(value: &Value, message: &Value) -> Option<String> {
    if value.get("isMeta").and_then(|v| v.as_bool()) == Some(true) {
        return None;
    }

    match message.get("content").unwrap_or(&Value::Null) {
        Value::String(text) => normalize_claude_user_prompt(text),
        Value::Array(items) => {
            let parts = items
                .iter()
                .filter_map(|item| {
                    if item.get("type").and_then(|v| v.as_str()) != Some("input_text") {
                        return None;
                    }
                    item.get("text")
                        .and_then(|v| v.as_str())
                        .and_then(normalize_claude_user_prompt)
                })
                .collect::<Vec<_>>();

            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\n\n"))
            }
        }
        _ => None,
    }
}

fn normalize_claude_user_prompt(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty()
        || trimmed.contains("<local-command-caveat>")
        || trimmed.contains("<command-name>")
        || trimmed.contains("<command-message>")
    {
        return None;
    }

    Some(trimmed.to_string())
}

fn normalize_codex_user_prompt(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("# AGENTS.md instructions for ")
        || trimmed.starts_with("<environment_context>")
        || trimmed.starts_with("<permissions instructions>")
    {
        return None;
    }

    Some(trimmed.to_string())
}

fn extract_text_items(content: Option<&Vec<Value>>) -> String {
    let parts = content
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
            match item_type {
                "input_text" | "output_text" | "text" => item
                    .get("text")
                    .and_then(|v| v.as_str())
                    .map(|v| v.trim().to_string()),
                _ => None,
            }
        })
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>();

    parts.join("\n\n")
}

fn push_detail_message(
    messages: &mut Vec<DetailMessageRecord>,
    seq_no: &mut i64,
    role: String,
    kind: String,
    content_text: String,
    created_at: String,
    tool_name: Option<String>,
    file_paths: Vec<String>,
) {
    messages.push(DetailMessageRecord {
        role,
        kind,
        content_text,
        created_at,
        seq_no: *seq_no,
        tool_name,
        file_paths,
    });
    *seq_no += 1;
}

fn read_jsonl_values(path: &Path) -> Result<Vec<Value>> {
    let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
    let reader = BufReader::new(file);
    let mut values = Vec::new();

    for (index, line) in reader.lines().enumerate() {
        let line_no = index + 1;
        let line = line.with_context(|| format!("read line {line_no} from {}", path.display()))?;
        if line.trim().is_empty() {
            continue;
        }

        let value = serde_json::from_str::<Value>(&line)
            .with_context(|| format!("parse json line {line_no} from {}", path.display()))?;
        values.push(value);
    }

    Ok(values)
}

fn build_file_summary_text(tool_name: Option<&str>, count: usize) -> String {
    match tool_name {
        Some("apply_patch") | Some("Write") | Some("Edit") | Some("MultiEdit") => {
            format!("修改了 {count} 个文件")
        }
        _ => format!("关联了 {count} 个文件"),
    }
}

fn extract_file_paths_from_value(value: &Value) -> Vec<String> {
    match value {
        Value::Null => Vec::new(),
        Value::String(text) => {
            let mut out = extract_file_paths_from_text(text);
            if let Ok(parsed) = serde_json::from_str::<Value>(text) {
                out.extend(extract_file_paths_from_value(&parsed));
            }
            dedupe_paths(out)
        }
        Value::Array(items) => dedupe_paths(
            items
                .iter()
                .flat_map(extract_file_paths_from_value)
                .collect::<Vec<_>>(),
        ),
        Value::Object(map) => {
            let mut out = Vec::new();

            for key in ["file_path", "filePath", "path"] {
                if let Some(path) = map.get(key).and_then(|v| v.as_str()) {
                    out.push(path.to_string());
                }
            }

            for key in ["paths", "filenames", "files"] {
                if let Some(items) = map.get(key).and_then(|v| v.as_array()) {
                    for item in items {
                        if let Some(path) = item.as_str() {
                            out.push(path.to_string());
                        }
                    }
                }
            }

            for value in map.values() {
                out.extend(extract_file_paths_from_value(value));
            }

            dedupe_paths(out)
        }
        _ => Vec::new(),
    }
}

fn extract_file_paths_from_text(text: &str) -> Vec<String> {
    let mut out = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(path) = trimmed
            .strip_prefix("A ")
            .or_else(|| trimmed.strip_prefix("M "))
            .or_else(|| trimmed.strip_prefix("D "))
            .or_else(|| trimmed.strip_prefix("R "))
            .or_else(|| trimmed.strip_prefix("U "))
        {
            if looks_like_file_path(path) {
                out.push(path.trim().to_string());
            }
            continue;
        }

        if looks_like_file_path(trimmed) {
            out.push(trimmed.to_string());
        }
    }

    dedupe_paths(out)
}

fn looks_like_file_path(value: &str) -> bool {
    let candidate = value.trim();
    if candidate.is_empty() || candidate.contains("Chunk ID:") || candidate.contains("Wall time:") {
        return false;
    }

    if candidate.starts_with('{') || candidate.starts_with('[') {
        return false;
    }

    candidate.contains('/')
        || candidate.ends_with(".md")
        || candidate.ends_with(".ts")
        || candidate.ends_with(".tsx")
        || candidate.ends_with(".js")
        || candidate.ends_with(".jsx")
        || candidate.ends_with(".json")
        || candidate.ends_with(".rs")
        || candidate.ends_with(".css")
}

fn dedupe_paths(paths: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !out.iter().any(|existing| existing == trimmed) {
            out.push(trimmed.to_string());
        }
    }
    out
}

fn sorted_paths(paths: Vec<String>) -> Vec<String> {
    let mut out = dedupe_paths(paths);
    out.sort();
    out
}
