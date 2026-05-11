import { useEffect } from "react";
import { useKnowledgeStore } from "../../stores/useKnowledgeStore";
import type { KnowledgeDocument, RunStatus } from "../../types/knowledge";

type Props = {
  projectPath: string;
  projectName: string;
  hasEnabledProvider: boolean;
  onSelectDoc: (doc: KnowledgeDocument) => void;
};

function statusLabel(status: RunStatus): string {
  const labels: Record<RunStatus, string> = {
    draft: "草稿",
    awaiting_confirmation: "待确认",
    extracting: "抽取中",
    synthesizing: "合成中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return labels[status] ?? status;
}

function statusClass(status: RunStatus): string {
  if (status === "completed") return "knowledge-run-status--success";
  if (status === "failed" || status === "cancelled") return "knowledge-run-status--error";
  if (status === "extracting" || status === "synthesizing") return "knowledge-run-status--active";
  return "";
}

export function KnowledgeRunPanel({ projectPath, hasEnabledProvider, onSelectDoc }: Props) {
  const runs = useKnowledgeStore((s) => s.runs);
  const documents = useKnowledgeStore((s) => s.documents);
  const progress = useKnowledgeStore((s) => s.progress);
  const startRun = useKnowledgeStore((s) => s.startRun);
  const startError = useKnowledgeStore((s) => s.startError);
  const starting = useKnowledgeStore((s) => s.starting);
  const clearStartError = useKnowledgeStore((s) => s.clearStartError);

  useEffect(() => {
    clearStartError();
  }, [projectPath, clearStartError]);

  const latestCompletedRun = runs.find((r) => r.status === "completed");
  const activeRun = runs.find((r) => ["extracting", "synthesizing", "awaiting_confirmation"].includes(r.status));

  const docsForLatest = latestCompletedRun
    ? documents.filter((d) => d.runId === latestCompletedRun.id)
    : [];

  return (
    <div className="knowledge-run-panel">
      {activeRun && (
        <div className="knowledge-active-task">
          <div className="knowledge-active-task-header">
            <span className="knowledge-run-status knowledge-run-status--active">
              {statusLabel(activeRun.status)}
            </span>
            <span className="knowledge-progress-phase">{progress?.phase ?? activeRun.status}</span>
          </div>
          {progress && (
            <>
              <div className="knowledge-progress-bar">
                <div
                  className="knowledge-progress-fill"
                  style={{ width: `${progress.totalSteps > 0 ? (progress.currentStep / progress.totalSteps) * 100 : 0}%` }}
                />
              </div>
              <p className="knowledge-progress-message">{progress.message}</p>
            </>
          )}
          <button className="knowledge-btn knowledge-btn--danger knowledge-btn--small" type="button">
            取消
          </button>
        </div>
      )}

      {docsForLatest.length > 0 && (
        <div className="knowledge-doc-section">
          <h4 className="knowledge-section-title">生成的文档</h4>
          <div className="knowledge-doc-list">
            {docsForLatest.map((doc) => (
              <button
                key={doc.id}
                className="knowledge-doc-item"
                type="button"
                onClick={() => onSelectDoc(doc)}
              >
                <div className="knowledge-doc-item-left">
                  <span className="knowledge-doc-type-icon">
                    {doc.docType === "common_tasks" ? "📋" : doc.docType === "domain_rules" ? "📐" : "⚠️"}
                  </span>
                  <span className="knowledge-doc-item-title">{doc.title}</span>
                </div>
                <span className="knowledge-doc-meta">
                  v{doc.version}{doc.edited ? " · 已编辑" : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!activeRun && hasEnabledProvider && (
        <div className="knowledge-generate-section">
          <button
            className="knowledge-btn knowledge-btn--primary knowledge-btn--generate"
            type="button"
            disabled={starting}
            onClick={async () => {
              try {
                const projectId = btoa(projectPath);
                await startRun(projectId);
              } catch {
                // error is surfaced via startError in the store
              }
            }}
          >
            {starting ? "启动中..." : "生成知识"}
          </button>
          {startError && (
            <p className="knowledge-start-error">{startError}</p>
          )}
        </div>
      )}

      {runs.length > 0 && (
        <div className="knowledge-history-section">
          <h4 className="knowledge-section-title">历史记录</h4>
          <div className="knowledge-run-history">
            {runs.slice(0, 10).map((run) => (
              <div key={run.id} className="knowledge-run-item">
                <span className={`knowledge-run-status ${statusClass(run.status as RunStatus)}`}>
                  {statusLabel(run.status as RunStatus)}
                </span>
                <span className="knowledge-run-date">
                  {new Date(run.createdAt).toLocaleDateString("zh-CN")}
                </span>
                {run.actualCost > 0 && (
                  <span className="knowledge-run-cost">${run.actualCost.toFixed(4)}</span>
                )}
                {run.errorMessage && (
                  <span className="knowledge-run-error" title={run.errorMessage}>!</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {runs.length === 0 && !activeRun && (
        <div className="knowledge-placeholder">
          <p>暂无知识生成记录</p>
          {!hasEnabledProvider && (
            <p className="knowledge-hint">请先在设置中配置 LLM Provider</p>
          )}
        </div>
      )}
    </div>
  );
}
