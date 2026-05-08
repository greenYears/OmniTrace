import { useEffect } from "react";

import { handleWindowDragPointerDown } from "../../lib/windowDrag";
import { TimeRangeToolbar } from "../timeRange/TimeRangeToolbar";
import { isIsoInTimeRange } from "../timeRange/timeRange";
import { SidebarFilters, type ProjectFilterOption } from "../sidebar/SidebarFilters";
import type {
  CustomDateRange,
  SessionDetail,
  SessionListItem,
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
  timeRange: TimeRange;
  customRange?: CustomDateRange;
  onFilterChange: (next: {
    sourceFilter?: SourceFilter;
    projectFilter?: string;
  }) => void;
  onTimeRangeChange: (timeRange: TimeRange, customRange?: CustomDateRange) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
};

export function ThreePaneShell({
  sessions,
  selectedId,
  detail,
  detailLoading,
  sourceFilter,
  projectFilter,
  timeRange,
  customRange,
  onFilterChange,
  onTimeRangeChange,
  onSelect,
  onDelete,
}: ThreePaneShellProps) {
  const timeScopedSessions = sessions.filter((session) => isIsoInTimeRange(session.updatedAt, timeRange, new Date(), customRange));
  const sourceOptions = (["all", "claude_code", "codex"] as SourceFilter[]).filter(
    (sourceId) => sourceId === "all" || timeScopedSessions.some((session) => session.sourceId === sourceId),
  );
  const projects: ProjectFilterOption[] = [
    { name: "all" },
    ...Array.from(
      timeScopedSessions.reduce((byPath, session) => {
        if (!byPath.has(session.projectPath)) {
          byPath.set(session.projectPath, {
            name: session.projectName,
            value: session.projectPath,
            path: session.projectPath,
          });
        }
        return byPath;
      }, new Map<string, ProjectFilterOption>()).values(),
    ),
  ];
  const filteredSessions = timeScopedSessions.filter((session) => {
    const matchesSource =
      sourceFilter === "all" || session.sourceId === sourceFilter;
    const matchesProject =
      projectFilter === "all" || session.projectPath === projectFilter;
    return matchesSource && matchesProject;
  });

  useEffect(() => {
    const next: { sourceFilter?: SourceFilter; projectFilter?: string } = {};
    if (sourceFilter !== "all" && !sourceOptions.includes(sourceFilter)) {
      next.sourceFilter = "all";
    }
    if (projectFilter !== "all" && !projects.some((project) => project.value === projectFilter)) {
      next.projectFilter = "all";
    }
    if (next.sourceFilter || next.projectFilter) {
      onFilterChange(next);
    }
  }, [onFilterChange, projectFilter, projects, sourceFilter, sourceOptions]);
  const selectedDetail =
    detail && detail.id === selectedId && filteredSessions.some((session) => session.id === detail.id)
      ? detail
      : null;
  const selectedSession = filteredSessions.find((session) => session.id === selectedId) ?? null;
  const pendingSession: { title: string; projectName: string; sourceId: string } | null = selectedSession
    ? {
        title: selectedSession.title,
        projectName: selectedSession.projectName,
        sourceId: selectedSession.sourceId,
      }
    : null;

  return (
    <div
      className="three-pane-shell"
      aria-label="Session viewer"
      data-tauri-drag-region
    >
      <header className="view-toolbar" data-tauri-drag-region onPointerDown={handleWindowDragPointerDown}>
        <div className="view-toolbar-left" data-tauri-drag-region>
          <h2 className="view-toolbar-title" data-tauri-drag-region>会话</h2>
        </div>
      </header>
      <div className="time-range-toolbar-row" data-tauri-drag-region onPointerDown={handleWindowDragPointerDown}>
        <TimeRangeToolbar value={timeRange} customRange={customRange} onChange={onTimeRangeChange} />
      </div>

      <SidebarFilters
        sources={sourceOptions}
        projects={projects}
        source={sourceFilter}
        project={projectFilter}
        onChange={onFilterChange}
      />

      {filteredSessions.length === 0 ? (
        <section className="viewer-empty-state" aria-label="Empty state">
          <p>暂无会话数据，请在设置中扫描</p>
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
