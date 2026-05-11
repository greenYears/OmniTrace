use anyhow::{Context, Result};
use tokio::sync::mpsc;

use super::llm_client::{ChatMessage, LlmClient};
use super::models::{DocType, KnowledgeDocument, KnowledgeEvidence, ProgressEvent};
use super::prompts;

pub struct SynthesisPipeline {
    client: LlmClient,
}

impl SynthesisPipeline {
    pub fn new(client: LlmClient) -> Self {
        Self { client }
    }

    pub async fn synthesize_document(
        &self,
        run_id: &str,
        project_id: &str,
        doc_type: DocType,
        evidence: &[KnowledgeEvidence],
        progress_tx: &mpsc::Sender<ProgressEvent>,
    ) -> Result<(KnowledgeDocument, u64, u64)> {
        let (type_name, template) = match doc_type {
            DocType::CommonTasks => ("常见任务指南", prompts::COMMON_TASKS_TEMPLATE),
            DocType::DomainRules => ("领域知识与业务规则", prompts::DOMAIN_RULES_TEMPLATE),
            DocType::Pitfalls => ("踩坑记录", prompts::PITFALLS_TEMPLATE),
        };

        let _ = progress_tx
            .send(ProgressEvent {
                run_id: run_id.to_string(),
                phase: "synthesizing".to_string(),
                current_step: match doc_type {
                    DocType::CommonTasks => 1,
                    DocType::DomainRules => 2,
                    DocType::Pitfalls => 3,
                },
                total_steps: 3,
                message: format!("正在生成{type_name}文档..."),
            })
            .await;

        let system_prompt = prompts::synthesis_system_prompt(type_name, template);
        let evidence_json = serialize_evidence_for_prompt(evidence);

        let messages = vec![
            ChatMessage {
                role: "system".to_string(),
                content: system_prompt,
            },
            ChatMessage {
                role: "user".to_string(),
                content: evidence_json,
            },
        ];

        let response = self
            .client
            .chat_completion(messages)
            .await
            .with_context(|| format!("synthesize {type_name}"))?;

        let markdown = response.content().unwrap_or("").to_string();
        let (input_tokens, output_tokens) = response
            .usage
            .map(|u| (u.prompt_tokens, u.completion_tokens))
            .unwrap_or((0, 0));

        let now = chrono::Utc::now().to_rfc3339();
        let doc = KnowledgeDocument {
            id: uuid::Uuid::new_v4().to_string(),
            run_id: run_id.to_string(),
            project_id: project_id.to_string(),
            doc_type,
            title: type_name.to_string(),
            markdown,
            version: 1,
            edited: false,
            export_path: None,
            exported_at: None,
            created_at: now.clone(),
            updated_at: now,
        };

        Ok((doc, input_tokens, output_tokens))
    }
}

fn serialize_evidence_for_prompt(evidence: &[KnowledgeEvidence]) -> String {
    let items: Vec<serde_json::Value> = evidence
        .iter()
        .map(|ev| {
            serde_json::json!({
                "type": ev.evidence_type.as_str(),
                "title": ev.title,
                "summary": ev.content.summary,
                "details": ev.content.details,
                "recommended_action": ev.content.recommended_action,
                "related_files": ev.content.related_files,
                "confidence": ev.confidence,
                "source_refs": ev.source_refs.iter().map(|r| {
                    serde_json::json!({
                        "session_title": r.session_title,
                        "timestamp": r.timestamp,
                        "excerpt": r.excerpt,
                    })
                }).collect::<Vec<_>>(),
            })
        })
        .collect();

    serde_json::to_string_pretty(&items).unwrap_or_else(|_| "[]".to_string())
}
