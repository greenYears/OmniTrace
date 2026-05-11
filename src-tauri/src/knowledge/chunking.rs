use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageForAnalysis {
    pub role: String,
    pub content: String,
    pub timestamp: String,
    pub session_title: String,
    pub session_id: String,
}

#[derive(Debug, Clone)]
pub struct Chunk {
    pub messages: Vec<MessageForAnalysis>,
    pub estimated_tokens: usize,
    pub session_ids: Vec<String>,
}

const DEFAULT_CHUNK_TOKEN_BUDGET: usize = 20_000;
const CHARS_PER_TOKEN: usize = 4;

pub fn estimate_tokens(text: &str) -> usize {
    text.len() / CHARS_PER_TOKEN + 1
}

pub fn trim_message_content(content: &str) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let mut result = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];

        // Collapse consecutive blank lines
        if line.trim().is_empty() {
            result.push("");
            while i < lines.len() && lines[i].trim().is_empty() {
                i += 1;
            }
            continue;
        }

        result.push(line);
        i += 1;
    }

    let joined = result.join("\n");

    // Truncate overly long tool outputs (>2000 chars continuous non-blank)
    if joined.len() > 2000 {
        let head = &joined[..500];
        let tail = &joined[joined.len() - 500..];
        let omitted = joined.len() - 1000;
        format!("{head}\n[... {omitted} chars omitted ...]\n{tail}")
    } else {
        joined
    }
}

pub fn chunk_sessions(
    sessions: Vec<Vec<MessageForAnalysis>>,
    budget: Option<usize>,
) -> Vec<Chunk> {
    let budget = budget.unwrap_or(DEFAULT_CHUNK_TOKEN_BUDGET);
    let mut chunks: Vec<Chunk> = Vec::new();
    let mut current_messages: Vec<MessageForAnalysis> = Vec::new();
    let mut current_tokens: usize = 0;
    let mut current_session_ids: Vec<String> = Vec::new();

    for session_messages in sessions {
        if session_messages.is_empty() {
            continue;
        }

        let session_id = session_messages[0].session_id.clone();
        let session_tokens: usize = session_messages
            .iter()
            .map(|m| estimate_tokens(&m.content))
            .sum();

        // If single session exceeds budget, split it
        if session_tokens > budget {
            // Flush current chunk first
            if !current_messages.is_empty() {
                chunks.push(Chunk {
                    messages: std::mem::take(&mut current_messages),
                    estimated_tokens: current_tokens,
                    session_ids: std::mem::take(&mut current_session_ids),
                });
                current_tokens = 0;
            }

            // Split the large session
            let mut split_messages: Vec<MessageForAnalysis> = Vec::new();
            let mut split_tokens: usize = 0;

            for msg in session_messages {
                let msg_tokens = estimate_tokens(&msg.content);
                if split_tokens + msg_tokens > budget && !split_messages.is_empty() {
                    chunks.push(Chunk {
                        messages: std::mem::take(&mut split_messages),
                        estimated_tokens: split_tokens,
                        session_ids: vec![session_id.clone()],
                    });
                    split_tokens = 0;
                }
                split_tokens += msg_tokens;
                split_messages.push(msg);
            }

            if !split_messages.is_empty() {
                chunks.push(Chunk {
                    messages: split_messages,
                    estimated_tokens: split_tokens,
                    session_ids: vec![session_id],
                });
            }
            continue;
        }

        // If adding this session would exceed budget, flush
        if current_tokens + session_tokens > budget && !current_messages.is_empty() {
            chunks.push(Chunk {
                messages: std::mem::take(&mut current_messages),
                estimated_tokens: current_tokens,
                session_ids: std::mem::take(&mut current_session_ids),
            });
            current_tokens = 0;
        }

        if !current_session_ids.contains(&session_id) {
            current_session_ids.push(session_id);
        }
        current_tokens += session_tokens;
        current_messages.extend(session_messages);
    }

    // Flush remaining
    if !current_messages.is_empty() {
        chunks.push(Chunk {
            messages: current_messages,
            estimated_tokens: current_tokens,
            session_ids: current_session_ids,
        });
    }

    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_msg(content: &str, session_id: &str) -> MessageForAnalysis {
        MessageForAnalysis {
            role: "user".to_string(),
            content: content.to_string(),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
            session_title: "test".to_string(),
            session_id: session_id.to_string(),
        }
    }

    #[test]
    fn estimate_tokens_basic() {
        assert_eq!(estimate_tokens("hello world"), 3); // 11 chars / 4 + 1
    }

    #[test]
    fn empty_input_produces_no_chunks() {
        let chunks = chunk_sessions(vec![], None);
        assert!(chunks.is_empty());
    }

    #[test]
    fn single_small_session_produces_one_chunk() {
        let session = vec![make_msg("hello", "s1")];
        let chunks = chunk_sessions(vec![session], None);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].session_ids, vec!["s1"]);
    }

    #[test]
    fn multiple_small_sessions_merge_into_one_chunk() {
        let s1 = vec![make_msg("hello", "s1")];
        let s2 = vec![make_msg("world", "s2")];
        let chunks = chunk_sessions(vec![s1, s2], None);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].session_ids, vec!["s1", "s2"]);
    }

    #[test]
    fn sessions_exceeding_budget_split_into_multiple_chunks() {
        let big_content = "x".repeat(100_000); // ~25k tokens
        let s1 = vec![make_msg(&big_content, "s1")];
        let s2 = vec![make_msg("small", "s2")];
        let chunks = chunk_sessions(vec![s1, s2], Some(20_000));
        assert!(chunks.len() >= 2);
    }

    #[test]
    fn large_session_is_split_by_message_boundary() {
        let msg_content = "y".repeat(40_000); // ~10k tokens each
        let session = vec![
            make_msg(&msg_content, "s1"),
            make_msg(&msg_content, "s1"),
            make_msg(&msg_content, "s1"),
        ];
        let chunks = chunk_sessions(vec![session], Some(20_000));
        assert!(chunks.len() >= 2);
        for chunk in &chunks {
            assert_eq!(chunk.session_ids, vec!["s1"]);
        }
    }

    #[test]
    fn trim_collapses_blank_lines() {
        let input = "line1\n\n\n\nline2";
        let result = trim_message_content(input);
        assert_eq!(result, "line1\n\nline2");
    }

    #[test]
    fn trim_truncates_long_content() {
        let long = "x".repeat(3000);
        let result = trim_message_content(&long);
        assert!(result.contains("chars omitted"));
        assert!(result.len() < 3000);
    }
}
