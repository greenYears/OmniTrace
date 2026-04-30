import { ToolbarRangeSelector } from "../../components/TimeRangeSelector";
import { SidebarFilters, type ProjectFilterOption } from "../sidebar/SidebarFilters";
import type {
  CustomDateRange,
  SessionDetail,
  SessionListItem,
  SessionScanProgress,
  SourceFilter,
  TimeRange,
} from "../../types/session";
import { SessionDetail as SessionDetailPane } from "../sessions/SessionDetail";
import { SessionList } from "../sessions/SessionList";

type ThreePaneShellProps = {
  sessions: SessionListItem[];
  selectedId: string | null;
  detail: SessionDetail | null;
  detailLoading: boolean;
  sourceFilter: SourceFilter;
  projectFilter: string;
  scanProgress: SessionScanProgress | null;
  onDismissScanProgress: () => void;
  onFilterChange: (next: {
    sourceFilter?: SourceFilter;
    projectFilter?: string;
  }) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  timeRange: TimeRange;
  customRange: CustomDateRange;
  onTimeRangeChange: (range: TimeRange) => void;
  onCustomRangeChange: (range: CustomDateRange) => void;
  rangeOptions: Array<{ value: TimeRange; label: string }>;
  onScan: () => void;
  scanLoading: boolean;
  canScan: boolean;
};

type PendingSessionMeta = {
  title: string;
  projectName: string;
  sourceId: string;
};

function isProgressDone(phase: string) {
  return phase.startsWith("完成");
}

export function ThreePaneShell({
  sessions,
  selectedId,
  detail,
  detailLoading,
  sourceFilter,
  projectFilter,
  scanProgress,
  onDismissScanProgress,
  onFilterChange,
  onSelect,
  onDelete,
  timeRange,
  customRange,
  onTimeRangeChange,
  onCustomRangeChange,
  rangeOptions,
  onScan,
  scanLoading,
  canScan,
}: ThreePaneShellProps) {
  const filteredSessions = sessions.filter((session) => {
    const matchesSource =
      sourceFilter === "all" || session.sourceId === sourceFilter;
    const matchesProject =
      projectFilter === "all" || session.projectName === projectFilter;
    return matchesSource && matchesProject;
  });
  const projects: ProjectFilterOption[] = [
    { name: "all" },
    ...Array.from(
      sessions.reduce((byName, session) => {
        if (!byName.has(session.projectName)) {
          byName.set(session.projectName, {
            name: session.projectName,
            path: session.projectPath,
          });
        }
        return byName;
      }, new Map<string, ProjectFilterOption>()).values(),
    ),
  ];
  const selectedDetail =
    detail && detail.id === selectedId && filteredSessions.some((session) => session.id === detail.id)
      ? detail
      : null;
  const selectedSession = filteredSessions.find((session) => session.id === selectedId) ?? null;
  const pendingSession: PendingSessionMeta | null = selectedSession
    ? {
        title: selectedSession.title,
        projectName: selectedSession.projectName,
        sourceId: selectedSession.sourceId,
      }
    : null;

  return (
    <div className={`three-pane-shell${scanProgress ? " has-progress" : ""}`} aria-label="Session viewer">
      <header className="view-toolbar" data-tauri-drag-region>
        <div className="view-toolbar-left">
          <ToolbarRangeSelector
            ariaLabel="会话扫描时间范围"
            options={rangeOptions}
            value={timeRange}
            onChange={onTimeRangeChange}
            customRange={customRange}
            onCustomRangeChange={onCustomRangeChange}
          />
        </div>
        <div className="view-toolbar-right">
          <button
            className="scan-button"
            type="button"
            onClick={onScan}
            disabled={scanLoading || !canScan}
          >
            {scanLoading ? "◷ 扫描中" : "↻ 扫描"}
          </button>
        </div>
      </header>
      {scanProgress ? (
        <div
          className={`scan-progress-strip${isProgressDone(scanProgress.phase) ? " is-complete" : ""}`}
          role="status"
          aria-label="扫描进度"
        >
          <div className="scan-progress-main">
            {isProgressDone(scanProgress.phase) ? (
              <span className="scan-progress-complete" aria-hidden="true">✓</span>
            ) : (
              <span className="scan-progress-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            )}
            <strong>{scanProgress.sourceId === "claude_code" ? "Claude Code" : "Codex"}</strong>
            <span>{scanProgress.phase}</span>
          </div>
          <div className="scan-progress-path">
            {scanProgress.path.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~")}
          </div>
          <div className="scan-progress-meta">
            {scanProgress.filesScanned} 个文件 · {scanProgress.sessionsFound} 个会话
          </div>
          {isProgressDone(scanProgress.phase) ? (
            <button
              className="scan-progress-close"
              type="button"
              aria-label="关闭扫描进度"
              onClick={onDismissScanProgress}
            >
              ×
            </button>
          ) : null}
        </div>
      ) : null}
      <SidebarFilters
        sources={["all", "claude_code", "codex"]}
        projects={projects}
        source={sourceFilter}
        project={projectFilter}
        onChange={onFilterChange}
      />

      {filteredSessions.length === 0 ? (
        <section className="viewer-empty-state" aria-label="Empty state">
          <p>未找到符合条件的会话</p>
        </section>
      ) : (
        <>
          <section className="three-pane three-pane-middle" aria-label="Session list">
            <SessionList
              sessions={filteredSessions}
              selectedId={selectedId}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          </section>

          <section className="three-pane three-pane-right" aria-label="Session detail">
            <SessionDetailPane
              detail={selectedDetail}
              isLoading={detailLoading || Boolean(selectedSession && !selectedDetail)}
              pendingSession={pendingSession}
            />
          </section>
        </>
      )}
    </div>
  );
}
