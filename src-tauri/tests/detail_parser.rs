use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use tmpomnitrace_bootstrapmpul84appomnitrace_lib::domain::detail::{
    parse_detail_messages, DetailMessageRecord,
};

fn temp_path(name: &str) -> std::path::PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("omnitrace-{name}-{stamp}.jsonl"))
}

fn find_by_kind<'a>(messages: &'a [DetailMessageRecord], kind: &str) -> &'a DetailMessageRecord {
    messages
        .iter()
        .find(|message| message.kind == kind)
        .expect("message kind should exist")
}

#[test]
fn parse_codex_detail_messages_includes_assistant_and_file_summary() {
    let path = temp_path("codex-detail");
    fs::write(
        &path,
        concat!(
            "{\"timestamp\":\"2026-04-20T05:13:20Z\",\"type\":\"session_meta\",\"payload\":{\"id\":\"codex-1\",\"cwd\":\"/Users/test/workspace/bravo\"}}\n",
            "{\"timestamp\":\"2026-04-20T05:13:21Z\",\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"检查 AGENTS.md\"}]}}\n",
            "{\"timestamp\":\"2026-04-20T05:13:22Z\",\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"我先查看项目文档。\"}]}}\n",
            "{\"timestamp\":\"2026-04-20T05:13:23Z\",\"type\":\"response_item\",\"payload\":{\"type\":\"function_call\",\"name\":\"exec_command\",\"arguments\":\"{\\\"cmd\\\":\\\"rg --files -g 'AGENTS.md'\\\"}\",\"call_id\":\"call_1\"}}\n",
            "{\"timestamp\":\"2026-04-20T05:13:24Z\",\"type\":\"response_item\",\"payload\":{\"type\":\"function_call_output\",\"call_id\":\"call_1\",\"output\":\"Chunk ID: a\\nOutput:\\nAGENTS.md\\nsrc/App.tsx\\n\"}}\n",
            "{\"timestamp\":\"2026-04-20T05:13:25Z\",\"type\":\"response_item\",\"payload\":{\"type\":\"custom_tool_call\",\"name\":\"apply_patch\",\"call_id\":\"call_2\",\"status\":\"completed\",\"input\":\"*** Begin Patch\\n*** Update File: src/App.tsx\\n*** End Patch\\n\"}}\n",
            "{\"timestamp\":\"2026-04-20T05:13:26Z\",\"type\":\"response_item\",\"payload\":{\"type\":\"custom_tool_call_output\",\"call_id\":\"call_2\",\"output\":\"{\\\"output\\\":\\\"Success. Updated the following files:\\\\nM src/App.tsx\\\\nA src/features/sessions/SessionDetail.tsx\\\\n\\\"}\"}}\n"
        ),
    )
    .expect("codex detail fixture should be written");

    let messages = parse_detail_messages("codex", &path).expect("codex detail should parse");

    assert!(
        messages.iter().any(|message| {
            message.role == "assistant"
                && message.kind == "message"
                && message.content_text.contains("我先查看项目文档")
        }),
        "assistant message should be parsed"
    );

    let tool_call = find_by_kind(&messages, "tool_call");
    assert_eq!(tool_call.role, "tool");
    assert_eq!(tool_call.tool_name.as_deref(), Some("exec_command"));

    let file_summary = messages
        .iter()
        .find(|message| {
            message.kind == "file_summary"
                && message
                    .file_paths
                    .iter()
                    .any(|path| path == "src/features/sessions/SessionDetail.tsx")
        })
        .expect("file summary for modified files should exist");
    assert_eq!(file_summary.role, "tool");
    assert!(file_summary
        .file_paths
        .iter()
        .any(|path| path == "src/App.tsx"));
    assert!(file_summary
        .file_paths
        .iter()
        .any(|path| path == "src/features/sessions/SessionDetail.tsx"));

    let _ = fs::remove_file(path);
}

#[test]
fn parse_claude_detail_messages_includes_assistant_and_tool_summary() {
    let path = temp_path("claude-detail");
    fs::write(
        &path,
        concat!(
            "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"请优化 UI\"}]},\"timestamp\":\"2026-04-21T01:39:00.000Z\",\"sessionId\":\"claude-1\"}\n",
            "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"我先查看当前界面代码。\"},{\"type\":\"tool_use\",\"id\":\"call_a\",\"name\":\"Read\",\"input\":{\"file_path\":\"/Users/test/workspace/OmniTrace/src/App.tsx\"}}]},\"timestamp\":\"2026-04-21T01:39:03.000Z\",\"sessionId\":\"claude-1\"}\n",
            "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"tool_result\",\"tool_use_id\":\"call_a\",\"content\":\"src/App.tsx\\nsrc/styles.css\",\"is_error\":false}]},\"toolUseResult\":{\"filenames\":[\"src/App.tsx\",\"src/styles.css\"]},\"timestamp\":\"2026-04-21T01:39:05.000Z\",\"sessionId\":\"claude-1\"}\n"
        ),
    )
    .expect("claude detail fixture should be written");

    let messages = parse_detail_messages("claude_code", &path).expect("claude detail should parse");

    assert!(
        messages.iter().any(|message| {
            message.role == "assistant"
                && message.kind == "message"
                && message.content_text.contains("我先查看当前界面代码")
        }),
        "assistant text should be parsed"
    );

    let tool_call = find_by_kind(&messages, "tool_call");
    assert_eq!(tool_call.tool_name.as_deref(), Some("Read"));

    let file_summary = find_by_kind(&messages, "file_summary");
    assert!(file_summary
        .file_paths
        .iter()
        .any(|path| path == "src/App.tsx"));
    assert!(file_summary
        .file_paths
        .iter()
        .any(|path| path == "src/styles.css"));

    let _ = fs::remove_file(path);
}

#[test]
fn parse_claude_detail_messages_keeps_real_user_prompts_and_skips_meta_noise() {
    let path = temp_path("claude-user-filter");
    fs::write(
        &path,
        concat!(
            "{\"type\":\"user\",\"isMeta\":true,\"message\":{\"role\":\"user\",\"content\":\"<local-command-caveat>ignore</local-command-caveat>\"},\"timestamp\":\"2026-04-21T01:38:21.514Z\",\"sessionId\":\"claude-1\"}\n",
            "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"<command-name>/clear</command-name>\\n<command-message>clear</command-message>\"},\"timestamp\":\"2026-04-21T01:38:21.614Z\",\"sessionId\":\"claude-1\"}\n",
            "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"请优化一下页面的布局和排版，以及色彩。\"},\"timestamp\":\"2026-04-21T01:38:37.930Z\",\"sessionId\":\"claude-1\"}\n",
            "{\"type\":\"assistant\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"id\":\"call_a\",\"name\":\"Read\",\"input\":{\"file_path\":\"/Users/test/workspace/OmniTrace/AGENTS.md\"}}]},\"timestamp\":\"2026-04-21T01:39:03.768Z\",\"sessionId\":\"claude-1\"}\n",
            "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"tool_use_id\":\"call_a\",\"type\":\"tool_result\",\"content\":\"AGENTS.md\"}]},\"toolUseResult\":{\"type\":\"text\",\"file\":{\"filePath\":\"/Users/test/workspace/OmniTrace/AGENTS.md\"}},\"timestamp\":\"2026-04-21T01:39:03.784Z\",\"sessionId\":\"claude-1\"}\n",
            "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"Base directory for this skill: /tmp/skill\\n# Brainstorming\"}]},\"timestamp\":\"2026-04-21T01:39:17.636Z\",\"sessionId\":\"claude-1\"}\n"
        ),
    )
    .expect("claude user filter fixture should be written");

    let messages = parse_detail_messages("claude_code", &path).expect("claude detail should parse");

    let user_messages = messages
        .iter()
        .filter(|message| message.role == "user" && message.kind == "message")
        .collect::<Vec<_>>();
    assert_eq!(user_messages.len(), 1);
    assert_eq!(
        user_messages[0].content_text,
        "请优化一下页面的布局和排版，以及色彩。"
    );

    assert!(
        messages.iter().any(|message| message.kind == "file_summary"
            && message
                .file_paths
                .iter()
                .any(|path| path == "/Users/test/workspace/OmniTrace/AGENTS.md")),
        "tool result should still produce file summary"
    );

    let _ = fs::remove_file(path);
}

#[test]
fn parse_claude_detail_messages_includes_selected_lines_attachment() {
    let path = temp_path("claude-selected-lines");
    fs::write(
        &path,
        concat!(
            "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"还是加一个判断吧\"},\"uuid\":\"user-1\",\"timestamp\":\"2026-04-21T01:38:21.514Z\",\"sessionId\":\"claude-1\"}\n",
            "{\"parentUuid\":\"user-1\",\"attachment\":{\"type\":\"selected_lines_in_ide\",\"ideName\":\"IntelliJ IDEA\",\"lineStart\":58,\"lineEnd\":58,\"filename\":\"/Users/test/project/src/Handler.java\",\"content\":\"stepDays\",\"displayPath\":\"src/Handler.java\"},\"type\":\"attachment\",\"uuid\":\"attach-1\",\"timestamp\":\"2026-04-21T01:38:21.515Z\",\"sessionId\":\"claude-1\"}\n"
        ),
    )
    .expect("claude selected lines fixture should be written");

    let messages = parse_detail_messages("claude_code", &path).expect("claude detail should parse");

    let selection = find_by_kind(&messages, "selection_context");
    assert_eq!(selection.role, "system");
    assert_eq!(selection.tool_name.as_deref(), Some("IntelliJ IDEA"));
    assert!(selection.content_text.contains("Selected 1 lines"));
    assert!(selection.content_text.contains("src/Handler.java"));
    assert!(selection.content_text.contains("stepDays"));
    assert_eq!(selection.file_paths, vec!["src/Handler.java"]);

    let _ = fs::remove_file(path);
}

#[test]
fn parse_claude_detail_messages_includes_file_reference_attachments() {
    let path = temp_path("claude-file-reference");
    fs::write(
        &path,
        concat!(
            "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"@src/Handler.java#L101-122 请解释 stepDays\"},\"uuid\":\"user-1\",\"timestamp\":\"2026-04-21T01:38:21.514Z\",\"sessionId\":\"claude-1\"}\n",
            "{\"parentUuid\":\"user-1\",\"attachment\":{\"type\":\"file\",\"filename\":\"/Users/test/project/src/Handler.java\",\"content\":{\"type\":\"text\",\"file\":{\"filePath\":\"/Users/test/project/src/Handler.java\",\"content\":\"LocalDate cursorStart = param.getStartDate();\\nint windowCount = 0;\",\"numLines\":22,\"startLine\":101,\"totalLines\":134}},\"displayPath\":\"src/Handler.java\"},\"type\":\"attachment\",\"uuid\":\"attach-file\",\"timestamp\":\"2026-04-21T01:38:21.515Z\",\"sessionId\":\"claude-1\"}\n",
            "{\"parentUuid\":\"attach-file\",\"attachment\":{\"type\":\"nested_memory\",\"path\":\"/Users/test/project/CLAUDE.md\",\"content\":{\"path\":\"/Users/test/project/CLAUDE.md\",\"type\":\"Project\",\"content\":\"# Project Guide\"},\"displayPath\":\"CLAUDE.md\"},\"type\":\"attachment\",\"uuid\":\"attach-memory\",\"timestamp\":\"2026-04-21T01:38:21.516Z\",\"sessionId\":\"claude-1\"}\n"
        ),
    )
    .expect("claude file reference fixture should be written");

    let messages = parse_detail_messages("claude_code", &path).expect("claude detail should parse");

    let file_context = find_by_kind(&messages, "file_context");
    assert_eq!(file_context.role, "system");
    assert!(file_context
        .content_text
        .contains("Read src/Handler.java (22 lines)"));
    assert!(file_context.content_text.contains("LocalDate cursorStart"));
    assert_eq!(file_context.file_paths, vec!["src/Handler.java"]);

    let memory_context = find_by_kind(&messages, "memory_context");
    assert_eq!(memory_context.role, "system");
    assert_eq!(memory_context.content_text, "Loaded CLAUDE.md");
    assert_eq!(memory_context.file_paths, vec!["CLAUDE.md"]);

    let _ = fs::remove_file(path);
}

#[test]
fn parse_claude_detail_messages_compresses_file_history_snapshots() {
    let path = temp_path("claude-snapshot-compress");
    fs::write(
        &path,
        concat!(
            "{\"type\":\"file-history-snapshot\",\"messageId\":\"m1\",\"snapshot\":{\"messageId\":\"m1\",\"trackedFileBackups\":{},\"timestamp\":\"2026-04-21T01:38:21.514Z\"},\"isSnapshotUpdate\":false}\n",
            "{\"type\":\"file-history-snapshot\",\"messageId\":\"m2\",\"snapshot\":{\"messageId\":\"m2\",\"trackedFileBackups\":{\"src/App.tsx\":{\"backupFileName\":\"a\",\"version\":1}},\"timestamp\":\"2026-04-21T01:39:21.514Z\"},\"isSnapshotUpdate\":true}\n",
            "{\"type\":\"file-history-snapshot\",\"messageId\":\"m2\",\"snapshot\":{\"messageId\":\"m2\",\"trackedFileBackups\":{\"src/App.tsx\":{\"backupFileName\":\"a\",\"version\":1}},\"timestamp\":\"2026-04-21T01:39:21.514Z\"},\"isSnapshotUpdate\":false}\n",
            "{\"type\":\"file-history-snapshot\",\"messageId\":\"m3\",\"snapshot\":{\"messageId\":\"m3\",\"trackedFileBackups\":{\"src/App.tsx\":{\"backupFileName\":\"a\",\"version\":1},\"src/styles.css\":{\"backupFileName\":\"b\",\"version\":1}},\"timestamp\":\"2026-04-21T01:40:21.514Z\"},\"isSnapshotUpdate\":true}\n"
        ),
    )
    .expect("claude snapshot fixture should be written");

    let messages = parse_detail_messages("claude_code", &path).expect("claude detail should parse");

    let file_summaries = messages
        .iter()
        .filter(|message| message.kind == "file_summary")
        .collect::<Vec<_>>();
    assert_eq!(file_summaries.len(), 2);
    assert_eq!(file_summaries[0].file_paths, vec!["src/App.tsx"]);
    assert_eq!(file_summaries[1].file_paths, vec!["src/styles.css"]);

    let _ = fs::remove_file(path);
}

#[test]
fn parse_codex_detail_messages_keeps_real_prompts_and_skips_bootstrap_noise() {
    let path = temp_path("codex-user-filter");
    fs::write(
        &path,
        concat!(
            "{\"timestamp\":\"2026-04-20T05:13:20Z\",\"type\":\"session_meta\",\"payload\":{\"id\":\"codex-1\",\"cwd\":\"/Users/test/workspace/bravo\"}}\n",
            "{\"timestamp\":\"2026-04-20T05:13:21Z\",\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"developer\",\"content\":[{\"type\":\"input_text\",\"text\":\"<permissions instructions>ignore</permissions instructions>\"}]}}\n",
            "{\"timestamp\":\"2026-04-20T05:13:22Z\",\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"# AGENTS.md instructions for /Users/test/workspace/bravo\\n<INSTRUCTIONS>...</INSTRUCTIONS>\"},{\"type\":\"input_text\",\"text\":\"<environment_context>...</environment_context>\"}]}}\n",
            "{\"timestamp\":\"2026-04-20T05:13:23Z\",\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"<environment_context>...</environment_context>\"}]}}\n",
            "{\"timestamp\":\"2026-04-20T05:13:24Z\",\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"/init agents.md 作为跳板，直接读取CLAUDE.md中的内容\"}]}}\n",
            "{\"timestamp\":\"2026-04-20T05:13:25Z\",\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"我会先检查仓库。\"}]}}\n",
            "{\"timestamp\":\"2026-04-20T05:13:26Z\",\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"真正的用户问题\"}]}}\n"
        ),
    )
    .expect("codex user filter fixture should be written");

    let messages = parse_detail_messages("codex", &path).expect("codex detail should parse");

    let user_messages = messages
        .iter()
        .filter(|message| message.role == "user" && message.kind == "message")
        .collect::<Vec<_>>();
    assert_eq!(user_messages.len(), 2);
    assert_eq!(
        user_messages[0].content_text,
        "/init agents.md 作为跳板，直接读取CLAUDE.md中的内容"
    );
    assert_eq!(user_messages[1].content_text, "真正的用户问题");

    assert!(
        !messages
            .iter()
            .any(|message| message.content_text.contains("AGENTS.md instructions")),
        "bootstrap user payload should be skipped"
    );
    assert!(
        !messages
            .iter()
            .any(|message| message.content_text.contains("permissions instructions")),
        "developer payload should be skipped"
    );

    let _ = fs::remove_file(path);
}
