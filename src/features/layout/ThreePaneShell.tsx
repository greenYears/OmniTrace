import type { SessionDetail, SessionListItem } from "../../types/session";
import { SessionDetail as SessionDetailPane } from "../sessions/SessionDetail";
import { SessionList } from "../sessions/SessionList";

type ThreePaneShellProps = {
  sessions: SessionListItem[];
  selectedId: string | null;
  detail: SessionDetail | null;
  onSelect: (id: string) => void;
};

export function ThreePaneShell({
  sessions,
  selectedId,
  detail,
  onSelect,
}: ThreePaneShellProps) {
  return (
    <div className="three-pane-shell" aria-label="Session viewer">
      <aside className="three-pane three-pane-left" aria-label="Filters">
        <p className="three-pane-placeholder">Sources, projects, and time ranges.</p>
      </aside>

      <section className="three-pane three-pane-middle" aria-label="Session list">
        <SessionList sessions={sessions} selectedId={selectedId} onSelect={onSelect} />
      </section>

      <section className="three-pane three-pane-right" aria-label="Session detail">
        <SessionDetailPane detail={detail} />
      </section>
    </div>
  );
}

