import { SidebarFilters, type ProjectFilterOption } from "../sidebar/SidebarFilters";
import type {
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
  onFilterChange: (next: {
    sourceFilter?: SourceFilter;
    projectFilter?: string;
    timeRange?: TimeRange;
  }) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
};

type PendingSessionMeta = {
  title: string;
  projectName: string;
  sourceId: string;
};

export function ThreePaneShell({
  sessions,
  selectedId,
  detail,
  detailLoading,
  sourceFilter,
  projectFilter,
  timeRange,
  onFilterChange,
  onSelect,
  onDelete,
}: ThreePaneShellProps) {
  const now = Date.now();
  const filteredSessions = sessions.filter((session) => {
    const matchesSource =
      sourceFilter === "all" || session.sourceId === sourceFilter;
    const matchesProject =
      projectFilter === "all" || session.projectName === projectFilter;

    if (!matchesSource || !matchesProject) {
      return false;
    }

    if (timeRange === "all") {
      return true;
    }

    const updatedAtMs = Date.parse(session.updatedAt);
    if (Number.isNaN(updatedAtMs)) {
      return false;
    }

    const ageMs = now - updatedAtMs;
    const maxAgeMs =
      timeRange === "7d"
        ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
    return ageMs <= maxAgeMs;
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
    detail && filteredSessions.some((session) => session.id === detail.id)
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
    <div className="three-pane-shell" aria-label="Session viewer">
      <SidebarFilters
        sources={["all", "claude_code", "codex"]}
        projects={projects}
        timeRanges={["all", "7d", "30d"]}
        source={sourceFilter}
        project={projectFilter}
        timeRange={timeRange}
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
            <SessionDetailPane detail={selectedDetail} isLoading={detailLoading} pendingSession={pendingSession} />
          </section>
        </>
      )}
    </div>
  );
}
