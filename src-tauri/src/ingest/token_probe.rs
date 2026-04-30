use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use chrono::{DateTime, FixedOffset};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct TokenUsageProbeReport {
    pub files_scanned: usize,
    pub records_scanned: usize,
    pub records_with_usage: usize,
    pub days: Vec<TokenUsageBucket>,
    pub hours: Vec<TokenUsageBucket>,
    pub by_model: Vec<TokenUsageBucket>,
    pub by_model_by_day: Vec<TokenUsageBucket>,
    pub by_model_by_hour: Vec<TokenUsageBucket>,
    pub samples: Vec<TokenUsageSample>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct TokenUsageBucket {
    pub date: String,
    pub source_id: String,
    pub model_id: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_tokens: i64,
    pub reasoning_tokens: i64,
    pub total_tokens: i64,
    pub records_with_usage: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TokenUsageSample {
    pub source_id: String,
    pub model_id: String,
    pub date: String,
    pub path: String,
    pub raw_usage_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenProbeProgress {
    pub source_id: String,
    pub phase: String,
    pub path: String,
    pub files_scanned: usize,
    pub records_scanned: usize,
    pub records_with_usage: usize,
}

#[derive(Debug, Clone)]
struct UsageRecord {
    source_id: String,
    model_id: String,
    date: String,
    hour: String,
    path: String,
    usage: TokenUsage,
    raw_usage_json: String,
}

#[derive(Debug, Clone, Default)]
struct TokenUsage {
    input_tokens: i64,
    output_tokens: i64,
    cache_creation_tokens: i64,
    cache_read_tokens: i64,
    cache_tokens: i64,
    reasoning_tokens: i64,
    total_tokens: i64,
}

pub fn probe_token_usage(home: &Path) -> Result<TokenUsageProbeReport> {
    probe_token_usage_with_progress(home, |_event| {})
}

pub fn probe_token_usage_with_progress<F>(
    home: &Path,
    mut on_progress: F,
) -> Result<TokenUsageProbeReport>
where
    F: FnMut(TokenProbeProgress),
{
    let mut report = TokenUsageProbeReport::default();
    let mut records = Vec::new();

    for (source_id, root) in [
        ("claude_code", home.join(".claude")),
        ("codex", home.join(".codex")),
    ] {
        on_progress(TokenProbeProgress {
            source_id: source_id.to_string(),
            phase: "扫描目录".to_string(),
            path: root.display().to_string(),
            files_scanned: report.files_scanned,
            records_scanned: report.records_scanned,
            records_with_usage: records.len(),
        });
        for path in discover_jsonl_files(&root)? {
            on_progress(TokenProbeProgress {
                source_id: source_id.to_string(),
                phase: "读取 usage".to_string(),
                path: path.display().to_string(),
                files_scanned: report.files_scanned + 1,
                records_scanned: report.records_scanned,
                records_with_usage: records.len(),
            });
            report.files_scanned += 1;
            inspect_jsonl_file(source_id, &path, &mut report, &mut records)?;
            on_progress(TokenProbeProgress {
                source_id: source_id.to_string(),
                phase: "读取 usage".to_string(),
                path: path.display().to_string(),
                files_scanned: report.files_scanned,
                records_scanned: report.records_scanned,
                records_with_usage: records.len(),
            });
        }
    }

    report.records_with_usage = records.len();
    report.days = aggregate_by_day(&records);
    report.hours = aggregate_by_hour(&records);
    report.by_model = aggregate_by_model(&records);
    report.by_model_by_day = aggregate_by_model_by_day(&records);
    report.by_model_by_hour = aggregate_by_model_by_hour(&records);
    report.samples = records
        .iter()
        .take(12)
        .map(|record| TokenUsageSample {
            source_id: record.source_id.clone(),
            model_id: record.model_id.clone(),
            date: record.date.clone(),
            path: record.path.clone(),
            raw_usage_json: record.raw_usage_json.clone(),
        })
        .collect();

    Ok(report)
}

fn inspect_jsonl_file(
    source_id: &str,
    path: &Path,
    report: &mut TokenUsageProbeReport,
    records: &mut Vec<UsageRecord>,
) -> Result<()> {
    let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
    let reader = BufReader::new(file);
    let mut current_model_id: Option<String> = None;

    for (index, line) in reader.lines().enumerate() {
        let line =
            line.with_context(|| format!("read line {} from {}", index + 1, path.display()))?;
        if line.trim().is_empty() {
            continue;
        }
        report.records_scanned += 1;

        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(model_id) = extract_model_id(&value) {
            current_model_id = Some(model_id);
        }
        let Some(usage_value) = find_usage_value(&value) else {
            continue;
        };
        let usage = parse_usage(usage_value);
        if usage.total_tokens <= 0 {
            continue;
        }

        records.push(UsageRecord {
            source_id: source_id.to_string(),
            model_id: current_model_id
                .clone()
                .unwrap_or_else(|| "unknown".to_string()),
            date: extract_date(&value).unwrap_or_else(|| "unknown".to_string()),
            hour: extract_hour(&value).unwrap_or_else(|| "unknown".to_string()),
            path: path.display().to_string(),
            raw_usage_json: usage_value.to_string(),
            usage,
        });
    }

    Ok(())
}

fn discover_jsonl_files(root: &Path) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    if !root.exists() {
        return Ok(out);
    }
    collect_jsonl_files(root, &mut out)?;
    out.sort();
    Ok(out)
}

fn collect_jsonl_files(path: &Path, out: &mut Vec<PathBuf>) -> Result<()> {
    if path.is_file() {
        if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
            out.push(path.to_path_buf());
        }
        return Ok(());
    }

    for entry in std::fs::read_dir(path).with_context(|| format!("read_dir {}", path.display()))? {
        let entry = entry.with_context(|| format!("read entry in {}", path.display()))?;
        let child = entry.path();
        if child.is_dir() || child.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
            collect_jsonl_files(&child, out)?;
        }
    }

    Ok(())
}

fn find_usage_value(value: &Value) -> Option<&Value> {
    if let Some(usage) = value.get("usage").filter(|usage| usage.is_object()) {
        return Some(usage);
    }

    for key in ["message", "payload", "response"] {
        if let Some(usage) = value
            .get(key)
            .and_then(|nested| nested.get("usage"))
            .filter(|usage| usage.is_object())
        {
            return Some(usage);
        }
    }

    if let Some(usage) = value
        .get("payload")
        .and_then(|payload| payload.get("info"))
        .and_then(|info| info.get("last_token_usage"))
        .filter(|usage| usage.is_object())
    {
        return Some(usage);
    }

    None
}

fn parse_usage(value: &Value) -> TokenUsage {
    let input_tokens = sum_keys(value, &["input_tokens", "prompt_tokens"]);
    let output_tokens = sum_keys(value, &["output_tokens", "completion_tokens"]);
    let cache_creation_tokens = sum_keys(value, &["cache_creation_input_tokens"]);
    let cache_read_tokens = sum_keys(
        value,
        &[
            "cache_read_input_tokens",
            "cached_input_tokens",
            "cached_tokens",
        ],
    );
    let cache_tokens = cache_creation_tokens + cache_read_tokens;
    let reasoning_tokens = sum_keys(value, &["reasoning_tokens"])
        + sum_keys(value, &["reasoning_output_tokens"])
        + sum_nested_keys(
            value,
            &["output_tokens_details", "completion_tokens_details"],
            &["reasoning_tokens"],
        );
    let explicit_total = sum_keys(value, &["total_tokens"]);
    let total_tokens = if explicit_total > 0 {
        explicit_total
    } else {
        input_tokens + output_tokens + cache_tokens + reasoning_tokens
    };

    TokenUsage {
        input_tokens,
        output_tokens,
        cache_creation_tokens,
        cache_read_tokens,
        cache_tokens,
        reasoning_tokens,
        total_tokens,
    }
}

fn sum_keys(value: &Value, keys: &[&str]) -> i64 {
    keys.iter()
        .filter_map(|key| value.get(*key).and_then(|token| token.as_i64()))
        .sum()
}

fn sum_nested_keys(value: &Value, parents: &[&str], keys: &[&str]) -> i64 {
    parents
        .iter()
        .filter_map(|parent| value.get(*parent))
        .map(|nested| sum_keys(nested, keys))
        .sum()
}

fn extract_model_id(value: &Value) -> Option<String> {
    for candidate in [
        value.get("model"),
        value.get("model_id"),
        value
            .get("message")
            .and_then(|message| message.get("model")),
        value
            .get("payload")
            .and_then(|payload| payload.get("model")),
        value
            .get("response")
            .and_then(|response| response.get("model")),
    ] {
        if let Some(model) = candidate.and_then(|model| model.as_str()) {
            if !model.is_empty() {
                return Some(model.to_string());
            }
        }
    }

    None
}

fn extract_date(value: &Value) -> Option<String> {
    for key in ["timestamp", "created_at", "updated_at"] {
        if let Some(date) = value
            .get(key)
            .and_then(|timestamp| timestamp.as_str())
            .and_then(date_prefix)
        {
            return Some(date);
        }
    }

    None
}

fn extract_hour(value: &Value) -> Option<String> {
    for key in ["timestamp", "created_at", "updated_at"] {
        if let Some(hour) = value
            .get(key)
            .and_then(|timestamp| timestamp.as_str())
            .and_then(hour_prefix)
        {
            return Some(hour);
        }
    }

    None
}

fn date_prefix(timestamp: &str) -> Option<String> {
    if let Some((date, _hour)) = beijing_timestamp_parts(timestamp) {
        return Some(date);
    }

    raw_date_prefix(timestamp)
}

fn hour_prefix(timestamp: &str) -> Option<String> {
    if let Some((_date, hour)) = beijing_timestamp_parts(timestamp) {
        return Some(hour);
    }

    raw_hour_prefix(timestamp)
}

fn beijing_timestamp_parts(timestamp: &str) -> Option<(String, String)> {
    let parsed = DateTime::parse_from_rfc3339(timestamp).ok()?;
    let beijing = parsed.with_timezone(&FixedOffset::east_opt(8 * 3600)?);
    let date = beijing.format("%Y-%m-%d").to_string();
    let hour = beijing.format("%Y-%m-%d %H:00").to_string();
    Some((date, hour))
}

fn raw_date_prefix(timestamp: &str) -> Option<String> {
    if timestamp.len() >= 10 {
        let prefix = &timestamp[..10];
        if prefix.as_bytes().get(4) == Some(&b'-') && prefix.as_bytes().get(7) == Some(&b'-') {
            return Some(prefix.to_string());
        }
    }
    None
}

fn raw_hour_prefix(timestamp: &str) -> Option<String> {
    if timestamp.len() >= 13 {
        let date = raw_date_prefix(timestamp)?;
        let hour = &timestamp[11..13];
        if hour.as_bytes().iter().all(|byte| byte.is_ascii_digit()) {
            return Some(format!("{date} {hour}:00"));
        }
    }
    None
}

fn aggregate_by_day(records: &[UsageRecord]) -> Vec<TokenUsageBucket> {
    let mut buckets = BTreeMap::<String, TokenUsageBucket>::new();
    for record in records {
        add_to_bucket(
            buckets
                .entry(record.date.clone())
                .or_insert_with(|| TokenUsageBucket {
                    date: record.date.clone(),
                    ..TokenUsageBucket::default()
                }),
            &record.usage,
        );
    }
    buckets.into_values().collect()
}

fn aggregate_by_hour(records: &[UsageRecord]) -> Vec<TokenUsageBucket> {
    let mut buckets = BTreeMap::<String, TokenUsageBucket>::new();
    for record in records {
        add_to_bucket(
            buckets
                .entry(record.hour.clone())
                .or_insert_with(|| TokenUsageBucket {
                    date: record.hour.clone(),
                    ..TokenUsageBucket::default()
                }),
            &record.usage,
        );
    }
    buckets.into_values().collect()
}

fn aggregate_by_model(records: &[UsageRecord]) -> Vec<TokenUsageBucket> {
    let mut buckets = BTreeMap::<(String, String), TokenUsageBucket>::new();
    for record in records {
        add_to_bucket(
            buckets
                .entry((record.source_id.clone(), record.model_id.clone()))
                .or_insert_with(|| TokenUsageBucket {
                    source_id: record.source_id.clone(),
                    model_id: record.model_id.clone(),
                    ..TokenUsageBucket::default()
                }),
            &record.usage,
        );
    }
    buckets.into_values().collect()
}

fn aggregate_by_model_by_day(records: &[UsageRecord]) -> Vec<TokenUsageBucket> {
    let mut buckets = BTreeMap::<(String, String, String), TokenUsageBucket>::new();
    for record in records {
        add_to_bucket(
            buckets
                .entry((
                    record.date.clone(),
                    record.source_id.clone(),
                    record.model_id.clone(),
                ))
                .or_insert_with(|| TokenUsageBucket {
                    date: record.date.clone(),
                    source_id: record.source_id.clone(),
                    model_id: record.model_id.clone(),
                    ..TokenUsageBucket::default()
                }),
            &record.usage,
        );
    }
    buckets.into_values().collect()
}

fn aggregate_by_model_by_hour(records: &[UsageRecord]) -> Vec<TokenUsageBucket> {
    let mut buckets = BTreeMap::<(String, String, String), TokenUsageBucket>::new();
    for record in records {
        add_to_bucket(
            buckets
                .entry((
                    record.hour.clone(),
                    record.source_id.clone(),
                    record.model_id.clone(),
                ))
                .or_insert_with(|| TokenUsageBucket {
                    date: record.hour.clone(),
                    source_id: record.source_id.clone(),
                    model_id: record.model_id.clone(),
                    ..TokenUsageBucket::default()
                }),
            &record.usage,
        );
    }
    buckets.into_values().collect()
}

fn add_to_bucket(bucket: &mut TokenUsageBucket, usage: &TokenUsage) {
    bucket.input_tokens += usage.input_tokens;
    bucket.output_tokens += usage.output_tokens;
    bucket.cache_creation_tokens += usage.cache_creation_tokens;
    bucket.cache_read_tokens += usage.cache_read_tokens;
    bucket.cache_tokens += usage.cache_tokens;
    bucket.reasoning_tokens += usage.reasoning_tokens;
    bucket.total_tokens += usage.total_tokens;
    bucket.records_with_usage += 1;
}
