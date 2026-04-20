import clsx from "clsx";

import type { SessionListItem } from "../../types/session";

type SessionListProps = {
  sessions: SessionListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export function SessionList({ sessions, selectedId, onSelect }: SessionListProps) {
  return (
    <div className="session-list" aria-label="Sessions">
      {sessions.map((session) => {
        const isSelected = session.id === selectedId;
        const label = session.title;

        return (
          <button
            key={session.id}
            type="button"
            className={clsx("session-list-item", isSelected && "is-selected")}
            aria-label={label}
            aria-current={isSelected ? "true" : undefined}
            onClick={() => onSelect(session.id)}
          >
            <span className="session-list-item-title" aria-hidden="true">
              {label}
            </span>
            <span className="session-list-item-meta" aria-hidden="true">
              {session.projectName}
            </span>
          </button>
        );
      })}
    </div>
  );
}
