use anyhow::{bail, Context, Result};
use serde::Deserialize;
use tokio::sync::mpsc;

use super::chunking::Chunk;
use super::llm_client::{ChatMessage, LlmClient};
use super::models::{EvidenceContent, EvidenceType, KnowledgeEvidence, ProgressEvent, SourceRef};
use super::prompts;

#[derive(Debug, Clone, Deserialize)]
pub struct RawEvidence {
    #[serde(rename = "type")]
    pub evidence_type: String,
    pub title: String,
    pub summary: String,
    pub details: String,
    pub recommended_action: String,
    #[serde(default)]
    pub related_files: Vec<String>,
    #[serde(default)]
    pub source_refs: Vec<RawSourceRef>,
    #[serde(default = "default_confidence")]
    pub confidence: f64,
}

fn default_confidence() -> f64 {
    0.5
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawSourceRef {
    #[serde(default)]
    pub session_title: String,
    #[serde(default)]
    pub timestamp: String,
    #[serde(default)]
    pub excerpt: String,
}

pub struct ExtractionPipeline {
    client: LlmClient,
}

impl ExtractionPipeline {
    pub fn new(client: LlmClient) -> Self {
        Self { client }
    }

    pub async fn extract_evidence(
        &self,
        run_id: &str,
        project_id: &str,
        chunks: &[Chunk],
        progress_tx: &mpsc::Sender<ProgressEvent>,
        cancel_rx: &tokio::sync::watch::Receiver<bool>,
    ) -> Result<(Vec<KnowledgeEvidence>, u64, u64)> {
        let mut all_evidence = Vec::new();
        let mut total_input_tokens: u64 = 0;
        let mut total_output_tokens: u64 = 0;
        let total_steps = chunks.len() as u32;

        for (i, chunk) in chunks.iter().enumerate() {
            if *cancel_rx.borrow() {
                break;
            }

            let _ = progress_tx
                .send(ProgressEvent {
                    run_id: run_id.to_string(),
                    phase: "extracting".to_string(),
                    current_step: i as u32 + 1,
                    total_steps,
                    message: format!("正在分析第 {}/{} 批内容...", i + 1, total_steps),
                })
                .await;

            let user_content = format_chunk_for_prompt(chunk);
            let messages = vec![
                ChatMessage {
                    role: "system".to_string(),
                    content: prompts::EVIDENCE_EXTRACTION_SYSTEM.to_string(),
                },
                ChatMessage {
                    role: "user".to_string(),
                    content: user_content.clone(),
                },
            ];

            let response = self
                .client
                .chat_completion(messages)
                .await
                .with_context(|| format!("LLM call for chunk {}", i + 1))?;

            if let Some(usage) = &response.usage {
                total_input_tokens += usage.prompt_tokens;
                total_output_tokens += usage.completion_tokens;
            }

            let content = response.content().unwrap_or("");
            let raw_evidence = match parse_evidence_response(content) {
                Ok(ev) => ev,
                Err(_) => {
                    // Retry with fix prompt
                    let fix_messages = vec![
                        ChatMessage {
                            role: "system".to_string(),
                            content: prompts::EVIDENCE_EXTRACTION_SYSTEM.to_string(),
                        },
                        ChatMessage {
                            role: "user".to_string(),
                            content: user_content,
                        },
                        ChatMessage {
                            role: "assistant".to_string(),
                            content: content.to_string(),
                        },
                        ChatMessage {
                            role: "user".to_string(),
                            content: prompts::EVIDENCE_EXTRACTION_FIX.to_string(),
                        },
                    ];

                    let retry_response = self
                        .client
                        .chat_completion(fix_messages)
                        .await
                        .with_context(|| format!("LLM retry for chunk {}", i + 1))?;

                    if let Some(usage) = &retry_response.usage {
                        total_input_tokens += usage.prompt_tokens;
                        total_output_tokens += usage.completion_tokens;
                    }

                    let retry_content = retry_response.content().unwrap_or("");
                    parse_evidence_response(retry_content)
                        .unwrap_or_default()
                }
            };

            for raw in raw_evidence {
                if let Some(evidence) = convert_raw_evidence(raw, run_id, project_id) {
                    all_evidence.push(evidence);
                }
            }
        }

        Ok((all_evidence, total_input_tokens, total_output_tokens))
    }
}

fn format_chunk_for_prompt(chunk: &Chunk) -> String {
    let mut parts = Vec::new();
    for msg in &chunk.messages {
        parts.push(format!(
            "[{}] [{}] {}\n{}",
            msg.timestamp, msg.session_title, msg.role, msg.content
        ));
    }
    parts.join("\n---\n")
}

pub fn parse_evidence_response(content: &str) -> Result<Vec<RawEvidence>> {
    let trimmed = content.trim();

    // Try direct parse
    if let Ok(evidence) = serde_json::from_str::<Vec<RawEvidence>>(trimmed) {
        return Ok(evidence);
    }

    // Try extracting from markdown code block
    if let Some(start) = trimmed.find("```json") {
        let after_marker = &trimmed[start + 7..];
        if let Some(end) = after_marker.find("```") {
            let json_str = &after_marker[..end].trim();
            if let Ok(evidence) = serde_json::from_str::<Vec<RawEvidence>>(json_str) {
                return Ok(evidence);
            }
        }
    }

    // Try extracting from generic code block
    if let Some(start) = trimmed.find("```") {
        let after_marker = &trimmed[start + 3..];
        // Skip optional language tag on same line
        let content_start = after_marker.find('\n').unwrap_or(0) + 1;
        let after_newline = &after_marker[content_start..];
        if let Some(end) = after_newline.find("```") {
            let json_str = &after_newline[..end].trim();
            if let Ok(evidence) = serde_json::from_str::<Vec<RawEvidence>>(json_str) {
                return Ok(evidence);
            }
        }
    }

    bail!("failed to parse evidence JSON from LLM response")
}

fn convert_raw_evidence(raw: RawEvidence, run_id: &str, project_id: &str) -> Option<KnowledgeEvidence> {
    let evidence_type = EvidenceType::from_str(&raw.evidence_type)?;

    Some(KnowledgeEvidence {
        id: uuid::Uuid::new_v4().to_string(),
        run_id: run_id.to_string(),
        project_id: project_id.to_string(),
        evidence_type,
        title: raw.title,
        content: EvidenceContent {
            summary: raw.summary,
            details: raw.details,
            recommended_action: raw.recommended_action,
            related_files: raw.related_files,
        },
        confidence: raw.confidence.clamp(0.0, 1.0),
        source_refs: raw
            .source_refs
            .into_iter()
            .map(|r| SourceRef {
                session_title: r.session_title,
                timestamp: r.timestamp,
                excerpt: r.excerpt,
            })
            .collect(),
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_valid_json_array() {
        let input = r#"[{"type":"pitfall","title":"Test","summary":"s","details":"d","recommended_action":"a","related_files":[],"source_refs":[],"confidence":0.8}]"#;
        let result = parse_evidence_response(input).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].title, "Test");
    }

    #[test]
    fn parse_json_in_code_block() {
        let input = "Here is the result:\n```json\n[{\"type\":\"domain_rule\",\"title\":\"Rule\",\"summary\":\"s\",\"details\":\"d\",\"recommended_action\":\"a\",\"related_files\":[],\"source_refs\":[],\"confidence\":0.9}]\n```";
        let result = parse_evidence_response(input).unwrap();
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn parse_invalid_json_returns_error() {
        let input = "This is not JSON at all";
        assert!(parse_evidence_response(input).is_err());
    }

    #[test]
    fn convert_raw_evidence_with_invalid_type_returns_none() {
        let raw = RawEvidence {
            evidence_type: "invalid_type".to_string(),
            title: "test".to_string(),
            summary: "s".to_string(),
            details: "d".to_string(),
            recommended_action: "a".to_string(),
            related_files: vec![],
            source_refs: vec![],
            confidence: 0.5,
        };
        assert!(convert_raw_evidence(raw, "run1", "proj1").is_none());
    }

    #[test]
    fn convert_raw_evidence_clamps_confidence() {
        let raw = RawEvidence {
            evidence_type: "pitfall".to_string(),
            title: "test".to_string(),
            summary: "s".to_string(),
            details: "d".to_string(),
            recommended_action: "a".to_string(),
            related_files: vec![],
            source_refs: vec![],
            confidence: 1.5,
        };
        let result = convert_raw_evidence(raw, "run1", "proj1").unwrap();
        assert_eq!(result.confidence, 1.0);
    }
}
