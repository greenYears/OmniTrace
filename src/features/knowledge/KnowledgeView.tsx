import { useEffect, useMemo, useState } from "react";

import { handleWindowDragPointerDown } from "../../lib/windowDrag";
import { useKnowledgeStore, initKnowledgeEventListeners } from "../../stores/useKnowledgeStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { KnowledgeRunPanel } from "./KnowledgeRunPanel";
import { KnowledgeDocPreview } from "./KnowledgeDocPreview";
import type { KnowledgeDocument, LlmProvider } from "../../types/knowledge";

type Props = {
  onNavigateSettings?: () => void;
};

type ProjectCard = {
  name: string;
  path: string;
  sessionCount: number;
  lastActivity: string;
};

function formatTimeAgo(dateStr: string): string {
  const ms = Date.now() - Date.parse(dateStr);
  if (Number.isNaN(ms)) return "";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}小时前`;
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function truncatePath(path: string, maxLen = 40): string {
  if (path.length <= maxLen) return path;
  return "…" + path.slice(path.length - maxLen + 1);
}

export function KnowledgeView({ onNavigateSettings }: Props) {
  const providers = useKnowledgeStore((s) => s.providers);
  const loadProviders = useKnowledgeStore((s) => s.loadProviders);
  const loadRuns = useKnowledgeStore((s) => s.loadRuns);
  const loadDocuments = useKnowledgeStore((s) => s.loadDocuments);
  const loadExportSettings = useKnowledgeStore((s) => s.loadExportSettings);
  const sessions = useSessionStore((s) => s.sessions);
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDocument | null>(null);
  const [eventsInitialized, setEventsInitialized] = useState(false);

  const projects = useMemo(() => {
    const map = new Map<string, ProjectCard>();
    for (const s of sessions) {
      const existing = map.get(s.projectPath);
      if (!existing || s.updatedAt > existing.lastActivity) {
        map.set(s.projectPath, {
          name: s.projectName,
          path: s.projectPath,
          sessionCount: (existing?.sessionCount ?? 0) + 1,
          lastActivity: s.updatedAt,
        });
      } else {
        existing.sessionCount += 1;
      }
    }
    return [...map.values()].sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  }, [sessions]);

  const enabledProvider: LlmProvider | undefined = providers.find((p) => p.enabled && p.hasApiKey);
  const selectedProject = projects.find((p) => p.path === selectedProjectPath);

  useEffect(() => {
    loadProviders().catch(console.error);
    if (!eventsInitialized) {
      initKnowledgeEventListeners().catch(console.error);
      setEventsInitialized(true);
    }
  }, [loadProviders, eventsInitialized]);

  useEffect(() => {
    if (selectedProjectPath) {
      setSelectedDoc(null);
      const projectId = btoa(selectedProjectPath);
      loadRuns(projectId).catch(console.error);
      loadDocuments(projectId).catch(console.error);
      loadExportSettings(projectId).catch(console.error);
    }
  }, [selectedProjectPath, loadRuns, loadDocuments, loadExportSettings]);

  return (
    <section className="knowledge-view" aria-label="项目知识">
      <header className="view-toolbar" data-tauri-drag-region onPointerDown={handleWindowDragPointerDown}>
        <div className="view-toolbar-left" data-tauri-drag-region>
          {selectedProjectPath ? (
            <button
              className="knowledge-back-btn"
              type="button"
              onClick={() => {
                setSelectedProjectPath(null);
                setSelectedDoc(null);
              }}
            >
              ← 返回
            </button>
          ) : null}
          <h2 className="view-toolbar-title" data-tauri-drag-region>知识</h2>
          {selectedProject && (
            <span className="knowledge-toolbar-project">{selectedProject.name}</span>
          )}
        </div>
      </header>

      {!selectedProjectPath ? (
        <div className="knowledge-empty-state">
          <div className="knowledge-card-grid">
            {projects.length === 0 ? (
              <p className="knowledge-empty-hint">请先扫描会话以获取项目列表</p>
            ) : (
              projects.map((proj) => (
                <button
                  key={proj.path}
                  className="knowledge-project-card"
                  type="button"
                  onClick={() => setSelectedProjectPath(proj.path)}
                >
                  <div className="knowledge-project-card-name">{proj.name}</div>
                  <div className="knowledge-project-card-path" title={proj.path}>
                    {truncatePath(proj.path)}
                  </div>
                  <div className="knowledge-project-card-meta">
                    <span>{proj.sessionCount} 个会话</span>
                    <span>{formatTimeAgo(proj.lastActivity)}</span>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="knowledge-empty-footer">
            {enabledProvider ? (
              <span className="knowledge-provider-ok">
                {enabledProvider.name} / {enabledProvider.model}
              </span>
            ) : (
              <span className="knowledge-provider-missing">
                未配置 LLM Provider
                {onNavigateSettings && (
                  <button className="knowledge-provider-link" type="button" onClick={onNavigateSettings}>
                    去设置
                  </button>
                )}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="knowledge-columns">
          <div className="knowledge-col-left">
            <div className="knowledge-info-card">
              <h4 className="knowledge-info-name">{selectedProject?.name}</h4>
              <p className="knowledge-info-path">{selectedProject?.path}</p>
              <p className="knowledge-info-sessions">{selectedProject?.sessionCount} 个会话</p>
            </div>

            <div className="knowledge-info-section">
              <h5 className="knowledge-info-label">Provider</h5>
              {enabledProvider ? (
                <span className="knowledge-provider-ok">
                  {enabledProvider.name} / {enabledProvider.model}
                </span>
              ) : (
                <span className="knowledge-provider-missing">
                  未配置
                  {onNavigateSettings && (
                    <button className="knowledge-provider-link" type="button" onClick={onNavigateSettings}>
                      设置
                    </button>
                  )}
                </span>
              )}
            </div>
          </div>

          <div className="knowledge-col-center">
            <KnowledgeRunPanel
              projectPath={selectedProjectPath}
              projectName={selectedProject?.name ?? ""}
              hasEnabledProvider={!!enabledProvider}
              onSelectDoc={setSelectedDoc}
            />
          </div>

          <div className="knowledge-col-right">
            {selectedDoc ? (
              <KnowledgeDocPreview document={selectedDoc} />
            ) : (
              <div className="knowledge-placeholder">
                <p>选择一个文档预览</p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
