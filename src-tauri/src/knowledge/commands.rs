use serde::{Deserialize, Serialize};
use rusqlite::OptionalExtension;
use tauri::Emitter;

use super::chunking::{self, MessageForAnalysis};
use super::evidence;
use super::extraction::ExtractionPipeline;
use super::llm_client::LlmClient;
use super::models::*;
use super::provider;
use super::redaction::RedactionEngine;
use super::synthesis::SynthesisPipeline;
use crate::db;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmProviderDto {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub model: String,
    pub temperature: f64,
    pub max_output_tokens: u32,
    pub max_cost_per_run: Option<f64>,
    pub input_price_per_1k: Option<f64>,
    pub output_price_per_1k: Option<f64>,
    pub enabled: bool,
    pub has_api_key: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProviderInput {
    pub id: Option<String>,
    pub name: String,
    pub base_url: String,
    pub model: String,
    pub temperature: f64,
    pub max_output_tokens: u32,
    pub max_cost_per_run: Option<f64>,
    pub input_price_per_1k: Option<f64>,
    pub output_price_per_1k: Option<f64>,
    pub enabled: bool,
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeRunDto {
    pub id: String,
    pub project_id: String,
    pub provider_id: String,
    pub model: String,
    pub scope_type: String,
    pub status: String,
    pub estimated_input_tokens: u64,
    pub estimated_output_tokens: u64,
    pub actual_input_tokens: u64,
    pub actual_output_tokens: u64,
    pub actual_cost: f64,
    pub error_message: Option<String>,
    pub created_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeDocumentDto {
    pub id: String,
    pub run_id: String,
    pub project_id: String,
    pub doc_type: String,
    pub title: String,
    pub markdown: String,
    pub version: u32,
    pub edited: bool,
    pub export_path: Option<String>,
    pub exported_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEstimateDto {
    pub session_count: u32,
    pub estimated_input_tokens: u64,
    pub estimated_output_tokens: u64,
    pub estimated_cost: f64,
    pub time_range: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDiffDto {
    pub target_path: String,
    pub exists: bool,
    pub unified_diff: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSettingsDto {
    pub project_id: String,
    pub export_dir: String,
    pub common_tasks_filename: String,
    pub domain_rules_filename: String,
    pub pitfalls_filename: String,
    pub overwrite_strategy: String,
}

// --- Tauri Commands ---

#[tauri::command]
pub async fn list_llm_providers(
    state: tauri::State<'_, db::AppState>,
) -> Result<Vec<LlmProviderDto>, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
        let providers = provider::list_providers(&conn).map_err(|e| format!("{e:#}"))?;
        Ok(providers
            .into_iter()
            .map(|p| {
                let has_api_key = provider::load_api_key(&p.id).is_ok();
                LlmProviderDto {
                    id: p.id,
                    name: p.name,
                    base_url: p.base_url,
                    model: p.model,
                    temperature: p.temperature,
                    max_output_tokens: p.max_output_tokens,
                    max_cost_per_run: p.max_cost_per_run,
                    input_price_per_1k: p.input_price_per_1k,
                    output_price_per_1k: p.output_price_per_1k,
                    enabled: p.enabled,
                    has_api_key,
                    created_at: p.created_at,
                    updated_at: p.updated_at,
                }
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_llm_provider(
    input: SaveProviderInput,
    state: tauri::State<'_, db::AppState>,
) -> Result<LlmProviderDto, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
        let now = chrono::Utc::now().to_rfc3339();
        let id = input.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        let p = LlmProvider {
            id: id.clone(),
            name: input.name,
            base_url: input.base_url,
            model: input.model,
            temperature: input.temperature,
            max_output_tokens: input.max_output_tokens,
            max_cost_per_run: input.max_cost_per_run,
            input_price_per_1k: input.input_price_per_1k,
            output_price_per_1k: input.output_price_per_1k,
            enabled: input.enabled,
            created_at: now.clone(),
            updated_at: now,
        };

        provider::save_provider(&conn, &p, &input.api_key).map_err(|e| format!("{e:#}"))?;

        let has_api_key = !input.api_key.is_empty();
        Ok(LlmProviderDto {
            id: p.id,
            name: p.name,
            base_url: p.base_url,
            model: p.model,
            temperature: p.temperature,
            max_output_tokens: p.max_output_tokens,
            max_cost_per_run: p.max_cost_per_run,
            input_price_per_1k: p.input_price_per_1k,
            output_price_per_1k: p.output_price_per_1k,
            enabled: p.enabled,
            has_api_key,
            created_at: p.created_at,
            updated_at: p.updated_at,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_llm_provider(
    id: String,
    state: tauri::State<'_, db::AppState>,
) -> Result<(), String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
        provider::delete_provider(&conn, &id).map_err(|e| format!("{e:#}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_knowledge_runs(
    project_id: String,
    state: tauri::State<'_, db::AppState>,
) -> Result<Vec<KnowledgeRunDto>, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, project_id, provider_id, model, scope_type, status, estimated_input_tokens, estimated_output_tokens, actual_input_tokens, actual_output_tokens, actual_cost, error_message, created_at, finished_at FROM project_knowledge_runs WHERE project_id = ?1 ORDER BY created_at DESC LIMIT 20",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([&project_id], |row| {
                Ok(KnowledgeRunDto {
                    id: row.get(0)?,
                    project_id: row.get(1)?,
                    provider_id: row.get(2)?,
                    model: row.get(3)?,
                    scope_type: row.get(4)?,
                    status: row.get(5)?,
                    estimated_input_tokens: row.get::<_, i64>(6)? as u64,
                    estimated_output_tokens: row.get::<_, i64>(7)? as u64,
                    actual_input_tokens: row.get::<_, i64>(8)? as u64,
                    actual_output_tokens: row.get::<_, i64>(9)? as u64,
                    actual_cost: row.get(10)?,
                    error_message: row.get(11)?,
                    created_at: row.get(12)?,
                    finished_at: row.get(13)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_knowledge_documents(
    project_id: String,
    state: tauri::State<'_, db::AppState>,
) -> Result<Vec<KnowledgeDocumentDto>, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, run_id, project_id, doc_type, title, markdown, version, edited, export_path, exported_at, created_at, updated_at FROM knowledge_documents WHERE project_id = ?1 ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([&project_id], |row| {
                Ok(KnowledgeDocumentDto {
                    id: row.get(0)?,
                    run_id: row.get(1)?,
                    project_id: row.get(2)?,
                    doc_type: row.get(3)?,
                    title: row.get(4)?,
                    markdown: row.get(5)?,
                    version: row.get(6)?,
                    edited: row.get::<_, i32>(7)? != 0,
                    export_path: row.get(8)?,
                    exported_at: row.get(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn update_knowledge_document(
    id: String,
    markdown: String,
    state: tauri::State<'_, db::AppState>,
) -> Result<(), String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE knowledge_documents SET markdown = ?1, edited = 1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![markdown, now, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_export_settings(
    project_id: String,
    state: tauri::State<'_, db::AppState>,
) -> Result<ExportSettingsDto, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
        let result: Option<ExportSettingsDto> = conn
            .query_row(
                "SELECT project_id, export_dir, common_tasks_filename, domain_rules_filename, pitfalls_filename, overwrite_strategy FROM project_export_settings WHERE project_id = ?1",
                [&project_id],
                |row| {
                    Ok(ExportSettingsDto {
                        project_id: row.get(0)?,
                        export_dir: row.get(1)?,
                        common_tasks_filename: row.get(2)?,
                        domain_rules_filename: row.get(3)?,
                        pitfalls_filename: row.get(4)?,
                        overwrite_strategy: row.get(5)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;

        Ok(result.unwrap_or(ExportSettingsDto {
            project_id: project_id.clone(),
            export_dir: "docs/agents/".to_string(),
            common_tasks_filename: "common-tasks.md".to_string(),
            domain_rules_filename: "domain-rules.md".to_string(),
            pitfalls_filename: "pitfalls.md".to_string(),
            overwrite_strategy: "confirm".to_string(),
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_export_settings(
    settings: ExportSettingsDto,
    state: tauri::State<'_, db::AppState>,
) -> Result<(), String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO project_export_settings (project_id, export_dir, common_tasks_filename, domain_rules_filename, pitfalls_filename, overwrite_strategy, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(project_id) DO UPDATE SET export_dir = excluded.export_dir, common_tasks_filename = excluded.common_tasks_filename, domain_rules_filename = excluded.domain_rules_filename, pitfalls_filename = excluded.pitfalls_filename, overwrite_strategy = excluded.overwrite_strategy, updated_at = excluded.updated_at",
            rusqlite::params![
                settings.project_id,
                settings.export_dir,
                settings.common_tasks_filename,
                settings.domain_rules_filename,
                settings.pitfalls_filename,
                settings.overwrite_strategy,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn start_knowledge_run(
    project_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, db::AppState>,
) -> Result<KnowledgeRunDto, String> {
    let db = state.db.clone();
    let run_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // 1. Get enabled provider
    let (prov, api_key) = {
        let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
        let providers = provider::list_providers(&conn).map_err(|e| format!("{e:#}"))?;
        let p = providers
            .into_iter()
            .find(|p| p.enabled)
            .ok_or("No enabled LLM provider found")?;
        let key = provider::load_api_key(&p.id).map_err(|e| format!("Failed to load API key: {e}"))?;
        (p, key)
    };

    // 2. Create run record
    {
        let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
        conn.execute(
            "INSERT INTO project_knowledge_runs (id, project_id, provider_id, model, scope_type, status, estimated_input_tokens, estimated_output_tokens, actual_input_tokens, actual_output_tokens, actual_cost, error_message, created_at, finished_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, 0, 0, 0, NULL, ?7, NULL)",
            rusqlite::params![run_id, project_id, prov.id, prov.model, "recent_30d", "extracting", now],
        )
        .map_err(|e| e.to_string())?;
    }

    // 3. Load messages for sessions in this project
    let messages = {
        let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
        load_project_messages(&conn, &project_id)?
    };

    if messages.is_empty() {
        let conn = db.lock().map_err(|_| "db lock poisoned".to_string())?;
        let now2 = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE project_knowledge_runs SET status = 'failed', error_message = 'No sessions found for this project', finished_at = ?1 WHERE id = ?2",
            rusqlite::params![now2, run_id],
        ).map_err(|e| e.to_string())?;
        return Err("No sessions found for this project".to_string());
    }

    // 4. Emit initial progress
    let _ = app.emit(
        "knowledge-run-progress",
        ProgressEvent {
            run_id: run_id.clone(),
            phase: "extracting".to_string(),
            current_step: 0,
            total_steps: 1,
            message: "Preparing data...".to_string(),
        },
    );

    // 5. Spawn pipeline in background
    let db_bg = db.clone();
    let app_bg = app.clone();
    let run_id_bg = run_id.clone();
    let project_id_bg = project_id.clone();
    let provider_id = prov.id.clone();
    let provider_model = prov.model.clone();

    tauri::async_runtime::spawn(async move {
        let result = run_pipeline(
            &db_bg,
            &app_bg,
            &run_id_bg,
            &project_id_bg,
            &prov,
            &api_key,
            messages,
        )
        .await;

        if let Err(e) = result {
            eprintln!("Knowledge pipeline error: {e}");
            let conn = db_bg.lock().ok();
            if let Some(conn) = conn {
                let now = chrono::Utc::now().to_rfc3339();
                let _ = conn.execute(
                    "UPDATE project_knowledge_runs SET status = 'failed', error_message = ?1, finished_at = ?2 WHERE id = ?3",
                    rusqlite::params![e.to_string(), now, run_id_bg],
                );
            }
            let _ = app_bg.emit(
                "knowledge-run-progress",
                ProgressEvent {
                    run_id: run_id_bg,
                    phase: "failed".to_string(),
                    current_step: 0,
                    total_steps: 0,
                    message: e.to_string(),
                },
            );
        }
    });

    Ok(KnowledgeRunDto {
        id: run_id,
        project_id,
        provider_id,
        model: provider_model,
        scope_type: "recent_30d".to_string(),
        status: "extracting".to_string(),
        estimated_input_tokens: 0,
        estimated_output_tokens: 0,
        actual_input_tokens: 0,
        actual_output_tokens: 0,
        actual_cost: 0.0,
        error_message: None,
        created_at: now,
        finished_at: None,
    })
}

fn load_project_messages(
    conn: &rusqlite::Connection,
    project_id: &str,
) -> Result<Vec<MessageForAnalysis>, String> {
    let sql = r#"
        SELECT m.role, m.content_text, m.created_at, s.title, s.id
        FROM messages m
        JOIN sessions s ON m.session_id = s.id
        JOIN projects p ON s.project_id = p.id
        WHERE p.id = ?1
        ORDER BY m.created_at ASC
    "#;

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![project_id], |row| {
            Ok(MessageForAnalysis {
                role: row.get(0)?,
                content: row.get(1)?,
                timestamp: row.get(2)?,
                session_title: row.get(3)?,
                session_id: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

async fn run_pipeline(
    db: &std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
    app: &tauri::AppHandle,
    run_id: &str,
    project_id: &str,
    prov: &LlmProvider,
    api_key: &str,
    messages: Vec<MessageForAnalysis>,
) -> anyhow::Result<()> {
    let (progress_tx, mut progress_rx) = tokio::sync::mpsc::channel::<ProgressEvent>(32);
    let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);

    let app_fwd = app.clone();
    let forward_handle = tauri::async_runtime::spawn(async move {
        while let Some(evt) = progress_rx.recv().await {
            let _ = app_fwd.emit("knowledge-run-progress", &evt);
        }
    });

    // Redact & chunk
    let redaction = RedactionEngine::with_default_rules();
    let redacted: Vec<MessageForAnalysis> = messages
        .into_iter()
        .map(|m| MessageForAnalysis {
            content: redaction.redact(&m.content),
            ..m
        })
        .collect();

    // Group by session
    let mut session_map: std::collections::HashMap<String, Vec<MessageForAnalysis>> =
        std::collections::HashMap::new();
    for m in redacted {
        session_map
            .entry(m.session_id.clone())
            .or_default()
            .push(m);
    }
    let grouped_sessions: Vec<Vec<MessageForAnalysis>> = session_map.into_values().collect();
    let chunks = chunking::chunk_sessions(grouped_sessions, None);

    let client = LlmClient::new(
        prov.base_url.clone(),
        api_key.to_string(),
        prov.model.clone(),
        prov.temperature,
        prov.max_output_tokens,
    )?;

    // Phase 1: Extract
    let extractor = ExtractionPipeline::new(client);
    let (raw_evidence, ext_input, ext_output) = extractor
        .extract_evidence(run_id, project_id, &chunks, &progress_tx, &cancel_rx)
        .await?;

    let deduped = evidence::deduplicate_evidence(raw_evidence);
    let filtered = evidence::filter_by_confidence(deduped, 0.4);
    let grouped = evidence::group_by_doc_type(filtered);

    // Save evidence
    {
        let conn = db.lock().map_err(|_| anyhow::anyhow!("db lock poisoned"))?;
        for ev in grouped.values().flatten() {
            let content_json = serde_json::to_string(&ev.content).unwrap_or_default();
            let refs_json = serde_json::to_string(&ev.source_refs).unwrap_or_default();
            conn.execute(
                "INSERT INTO knowledge_evidence (id, run_id, project_id, evidence_type, title, content_json, confidence, source_refs_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![ev.id, ev.run_id, ev.project_id, ev.evidence_type.as_str(), ev.title, content_json, ev.confidence, refs_json, ev.created_at],
            )?;
        }
    }

    // Phase 2: Synthesize
    let synth_client = LlmClient::new(
        prov.base_url.clone(),
        api_key.to_string(),
        prov.model.clone(),
        prov.temperature,
        prov.max_output_tokens,
    )?;
    let synthesizer = SynthesisPipeline::new(synth_client);

    let doc_types = [DocType::CommonTasks, DocType::DomainRules, DocType::Pitfalls];
    let mut total_input = ext_input;
    let mut total_output = ext_output;

    for dt in &doc_types {
        let ev = grouped.get(dt).cloned().unwrap_or_default();
        if ev.is_empty() {
            continue;
        }
        let (doc, in_tok, out_tok) = synthesizer
            .synthesize_document(run_id, project_id, *dt, &ev, &progress_tx)
            .await?;
        total_input += in_tok;
        total_output += out_tok;

        let conn = db.lock().map_err(|_| anyhow::anyhow!("db lock poisoned"))?;
        conn.execute(
            "INSERT INTO knowledge_documents (id, run_id, project_id, doc_type, title, markdown, version, edited, export_path, exported_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 0, NULL, NULL, ?7, ?8)",
            rusqlite::params![doc.id, doc.run_id, doc.project_id, doc.doc_type.as_str(), doc.title, doc.markdown, doc.created_at, doc.updated_at],
        )?;
    }

    // Mark run completed
    {
        let conn = db.lock().map_err(|_| anyhow::anyhow!("db lock poisoned"))?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE project_knowledge_runs SET status = 'completed', actual_input_tokens = ?1, actual_output_tokens = ?2, actual_cost = 0, finished_at = ?3 WHERE id = ?4",
            rusqlite::params![total_input as i64, total_output as i64, now, run_id],
        )?;
    }

    drop(cancel_tx);
    drop(progress_tx);
    let _ = forward_handle.await;

    Ok(())
}
