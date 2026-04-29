use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use tmpomnitrace_bootstrapmpul84appomnitrace_lib::ingest::token_probe::probe_token_usage;

fn temp_path(name: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("omnitrace-{name}-{stamp}"))
}

#[test]
fn probe_token_usage_reports_daily_and_model_totals() {
    let home = temp_path("token-probe");
    let claude_project = home.join(".claude/projects/-Users-test-workspace-alpha");
    let codex_sessions = home.join(".codex/sessions/2026/04/20");
    fs::create_dir_all(&claude_project).expect("claude project dir should be created");
    fs::create_dir_all(&codex_sessions).expect("codex sessions dir should be created");

    fs::write(
        claude_project.join("claude-1.jsonl"),
        concat!(
            "{\"type\":\"assistant\",\"timestamp\":\"2026-04-20T01:00:00Z\",\"message\":{\"model\":\"claude-sonnet-4\",\"usage\":{\"input_tokens\":10,\"output_tokens\":20,\"cache_creation_input_tokens\":3,\"cache_read_input_tokens\":4}}}\n",
            "{\"type\":\"assistant\",\"timestamp\":\"2026-04-21T01:00:00Z\",\"message\":{\"model\":\"claude-sonnet-4\",\"usage\":{\"input_tokens\":5,\"output_tokens\":7,\"output_tokens_details\":{\"reasoning_tokens\":9}}}}\n"
        ),
    )
    .expect("claude usage fixture should be written");

    fs::write(
        codex_sessions.join("rollout-2026-04-20T05-13-20-codex-1.jsonl"),
        concat!(
            "{\"timestamp\":\"2026-04-20T05:13:20Z\",\"type\":\"response_item\",\"payload\":{\"model\":\"gpt-5.4-codex\",\"usage\":{\"input_tokens\":100,\"output_tokens\":40,\"cached_input_tokens\":11}}}\n",
            "{\"timestamp\":\"2026-04-20T17:13:20Z\",\"type\":\"response_item\",\"payload\":{\"model\":\"gpt-5.4-codex\",\"usage\":{\"input_tokens\":1,\"output_tokens\":2}}}\n",
            "{\"timestamp\":\"2026-04-20T05:13:21Z\",\"type\":\"response_item\",\"payload\":{\"role\":\"assistant\",\"content\":[]}}\n"
        ),
    )
    .expect("codex usage fixture should be written");

    let report = probe_token_usage(&home).expect("probe should succeed");

    assert_eq!(report.files_scanned, 2);
    assert_eq!(report.records_scanned, 5);
    assert_eq!(report.records_with_usage, 4);
    assert_eq!(report.days.len(), 2);
    assert_eq!(report.hours.len(), 4);
    assert_eq!(report.by_model.len(), 2);
    assert_eq!(report.by_model_by_day.len(), 4);
    assert_eq!(report.by_model_by_hour.len(), 4);

    let day = report
        .days
        .iter()
        .find(|day| day.date == "2026-04-20")
        .expect("2026-04-20 should exist");
    assert_eq!(day.total_tokens, 188);
    assert_eq!(day.input_tokens, 110);
    assert_eq!(day.output_tokens, 60);
    assert_eq!(day.cache_tokens, 18);
    assert_eq!(day.cache_creation_tokens, 3);
    assert_eq!(day.cache_read_tokens, 15);
    assert_eq!(day.reasoning_tokens, 0);

    let hour = report
        .hours
        .iter()
        .find(|hour| hour.date == "2026-04-20 13:00")
        .expect("2026-04-20 13:00 Beijing time should exist");
    assert_eq!(hour.total_tokens, 151);
    assert_eq!(hour.input_tokens, 100);
    assert_eq!(hour.cache_read_tokens, 11);

    let beijing_next_day_hour = report
        .hours
        .iter()
        .find(|hour| hour.date == "2026-04-21 01:00")
        .expect("2026-04-20T17:13:20Z should be grouped as 2026-04-21 01:00 Beijing time");
    assert_eq!(beijing_next_day_hour.total_tokens, 3);

    let reasoning_day = report
        .days
        .iter()
        .find(|day| day.date == "2026-04-21")
        .expect("2026-04-21 should exist");
    assert_eq!(reasoning_day.reasoning_tokens, 9);
    assert_eq!(reasoning_day.total_tokens, 24);

    let codex_model = report
        .by_model
        .iter()
        .find(|model| model.model_id == "gpt-5.4-codex")
        .expect("codex model should exist");
    assert_eq!(codex_model.source_id, "codex");
    assert_eq!(codex_model.total_tokens, 154);
    assert_eq!(codex_model.records_with_usage, 2);

    assert_eq!(report.samples.len(), 4);

    let _ = fs::remove_dir_all(home);
}

#[test]
fn probe_token_usage_reads_codex_token_count_events() {
    let home = temp_path("codex-token-count");
    let codex_sessions = home.join(".codex/sessions/2026/04/28");
    fs::create_dir_all(&codex_sessions).expect("codex sessions dir should be created");

    fs::write(
        codex_sessions.join("rollout-2026-04-28T11-20-00-codex-1.jsonl"),
        concat!(
            "{\"timestamp\":\"2026-04-28T03:20:00.000Z\",\"type\":\"turn_context\",\"payload\":{\"model\":\"gpt-5.4-codex\",\"cwd\":\"/Users/test/workspace/omnitrace\"}}\n",
            "{\"timestamp\":\"2026-04-28T03:26:00.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"last_token_usage\":{\"input_tokens\":100,\"cached_input_tokens\":20,\"output_tokens\":30,\"reasoning_output_tokens\":5,\"total_tokens\":135},\"total_token_usage\":{\"input_tokens\":1000,\"cached_input_tokens\":200,\"output_tokens\":300,\"reasoning_output_tokens\":50,\"total_tokens\":1350},\"model_context_window\":258400}}}\n"
        ),
    )
    .expect("codex token count fixture should be written");

    let report = probe_token_usage(&home).expect("probe should succeed");

    assert_eq!(report.records_with_usage, 1);

    let hour = report
        .by_model_by_hour
        .iter()
        .find(|bucket| bucket.date == "2026-04-28 11:00")
        .expect("codex token count should be grouped by Beijing hour");
    assert_eq!(hour.source_id, "codex");
    assert_eq!(hour.model_id, "gpt-5.4-codex");
    assert_eq!(hour.input_tokens, 100);
    assert_eq!(hour.output_tokens, 30);
    assert_eq!(hour.cache_read_tokens, 20);
    assert_eq!(hour.reasoning_tokens, 5);
    assert_eq!(hour.total_tokens, 135);

    let _ = fs::remove_dir_all(home);
}
