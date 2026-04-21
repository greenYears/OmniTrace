import clsx from "clsx";

import type { SessionListItem } from "../../types/session";

type SessionListProps = {
  sessions: SessionListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function formatTimeAgo(dateStr: string): string {
  const ms = Date.now() - Date.parse(dateStr);
  if (Number.isNaN(ms)) return "";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getSourceIcon(sourceId: string): { text: string; cls: string } {
  if (sourceId === "codex") return { text: "CX", cls: "is-codex" };
  return { text: "C", cls: "is-claude-code" };
}

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
            <div className="session-list-item-top">
              <span className="session-list-item-title">{label}</span>
              <span className={clsx("source-icon", getSourceIcon(session.sourceId).cls)} aria-label={session.sourceId}>{getSourceIcon(session.sourceId).text}</span>
            </div>
            <div className="session-list-item-meta">
              <span>{session.projectName}</span>
              <span>{formatTimeAgo(session.updatedAt)}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
