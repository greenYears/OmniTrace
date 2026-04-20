import { SidebarFilters } from "../sidebar/SidebarFilters";
import type { SessionDetail, SessionListItem } from "../../types/session";
import { SessionDetail as SessionDetailPane } from "../sessions/SessionDetail";
import { SessionList } from "../sessions/SessionList";

type ThreePaneShellProps = {
  sessions: SessionListItem[];
  selectedId: string | null;
  detail: SessionDetail | null;
  sourceFilter: string;
  onSourceChange: (source: string) => void;
  onSelect: (id: string) => void;
};

export function ThreePaneShell({
  sessions,
  selectedId,
  detail,
  sourceFilter,
  onSourceChange,
  onSelect,
}: ThreePaneShellProps) {
  const filteredSessions =
    sourceFilter === "all"
      ? sessions
      : sessions.filter((session) => session.sourceId === sourceFilter);
  const selectedDetail =
    detail && filteredSessions.some((session) => session.id === detail.id)
      ? detail
      : null;

  return (
    <div className="three-pane-shell" aria-label="Session viewer">
      <SidebarFilters
        sources={["all", "claude_code", "codex"]}
        source={sourceFilter}
        onSourceChange={onSourceChange}
      />

      {filteredSessions.length === 0 ? (
        <section className="viewer-empty-state" aria-label="Empty state">
          <p>No sessions found for this filter.</p>
        </section>
      ) : (
        <>
          <section className="three-pane three-pane-middle" aria-label="Session list">
            <SessionList
              sessions={filteredSessions}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          </section>

          <section className="three-pane three-pane-right" aria-label="Session detail">
            <SessionDetailPane detail={selectedDetail} />
          </section>
        </>
      )}
    </div>
  );
}
