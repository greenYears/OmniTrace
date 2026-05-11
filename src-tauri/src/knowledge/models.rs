use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmProvider {
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
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Draft,
    AwaitingConfirmation,
    Extracting,
    Synthesizing,
    Completed,
    Failed,
    Cancelled,
}

impl RunStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::AwaitingConfirmation => "awaiting_confirmation",
            Self::Extracting => "extracting",
            Self::Synthesizing => "synthesizing",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "draft" => Some(Self::Draft),
            "awaiting_confirmation" => Some(Self::AwaitingConfirmation),
            "extracting" => Some(Self::Extracting),
            "synthesizing" => Some(Self::Synthesizing),
            "completed" => Some(Self::Completed),
            "failed" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScopeType {
    Recent30d,
    All,
    Manual,
}

impl ScopeType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Recent30d => "recent_30d",
            Self::All => "all",
            Self::Manual => "manual",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "recent_30d" => Some(Self::Recent30d),
            "all" => Some(Self::All),
            "manual" => Some(Self::Manual),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeRun {
    pub id: String,
    pub project_id: String,
    pub provider_id: String,
    pub model: String,
    pub scope_type: ScopeType,
    pub started_at_filter: Option<String>,
    pub ended_at_filter: Option<String>,
    pub selected_session_ids: Vec<String>,
    pub status: RunStatus,
    pub estimated_input_tokens: u64,
    pub estimated_output_tokens: u64,
    pub actual_input_tokens: u64,
    pub actual_output_tokens: u64,
    pub actual_cost: f64,
    pub last_session_updated_at: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceType {
    TaskPattern,
    DomainRule,
    Pitfall,
    Verification,
    FileArea,
}

impl EvidenceType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::TaskPattern => "task_pattern",
            Self::DomainRule => "domain_rule",
            Self::Pitfall => "pitfall",
            Self::Verification => "verification",
            Self::FileArea => "file_area",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "task_pattern" => Some(Self::TaskPattern),
            "domain_rule" => Some(Self::DomainRule),
            "pitfall" => Some(Self::Pitfall),
            "verification" => Some(Self::Verification),
            "file_area" => Some(Self::FileArea),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceContent {
    pub summary: String,
    pub details: String,
    pub recommended_action: String,
    pub related_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceRef {
    pub session_title: String,
    pub timestamp: String,
    pub excerpt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeEvidence {
    pub id: String,
    pub run_id: String,
    pub project_id: String,
    pub evidence_type: EvidenceType,
    pub title: String,
    pub content: EvidenceContent,
    pub confidence: f64,
    pub source_refs: Vec<SourceRef>,
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocType {
    CommonTasks,
    DomainRules,
    Pitfalls,
}

impl DocType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::CommonTasks => "common_tasks",
            Self::DomainRules => "domain_rules",
            Self::Pitfalls => "pitfalls",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "common_tasks" => Some(Self::CommonTasks),
            "domain_rules" => Some(Self::DomainRules),
            "pitfalls" => Some(Self::Pitfalls),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnowledgeDocument {
    pub id: String,
    pub run_id: String,
    pub project_id: String,
    pub doc_type: DocType,
    pub title: String,
    pub markdown: String,
    pub version: u32,
    pub edited: bool,
    pub export_path: Option<String>,
    pub exported_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectExportSettings {
    pub project_id: String,
    pub export_dir: String,
    pub common_tasks_filename: String,
    pub domain_rules_filename: String,
    pub pitfalls_filename: String,
    pub overwrite_strategy: OverwriteStrategy,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OverwriteStrategy {
    Overwrite,
    VersionedSuffix,
    Cancel,
}

impl OverwriteStrategy {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Overwrite => "overwrite",
            Self::VersionedSuffix => "versioned_suffix",
            Self::Cancel => "cancel",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "overwrite" => Some(Self::Overwrite),
            "versioned_suffix" => Some(Self::VersionedSuffix),
            "cancel" => Some(Self::Cancel),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub run_id: String,
    pub phase: String,
    pub current_step: u32,
    pub total_steps: u32,
    pub message: String,
}
