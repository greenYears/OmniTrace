import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

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

function stripTitle(title: string): string {
  return title.replace(/^(Claude Code|Codex):\s*/, "");
}

export function SessionList({ sessions, selectedId, onSelect }: SessionListProps) {
  const prevSelectedIdRef = useRef<string | null>(selectedId);
  const activateTimerRef = useRef<number | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId || prevSelectedIdRef.current === selectedId) {
      prevSelectedIdRef.current = selectedId;
      return;
    }

    prevSelectedIdRef.current = selectedId;
    setActivatingId(selectedId);

    if (activateTimerRef.current) {
      window.clearTimeout(activateTimerRef.current);
    }

    activateTimerRef.current = window.setTimeout(() => {
      setActivatingId((current) => (current === selectedId ? null : current));
      activateTimerRef.current = null;
    }, 260);
  }, [selectedId]);

  useEffect(() => () => {
    if (activateTimerRef.current) {
      window.clearTimeout(activateTimerRef.current);
    }
  }, []);

  return (
    <div className="session-list" aria-label="Sessions">
      {sessions.map((session) => {
        const isSelected = session.id === selectedId;
        const isActivating = session.id === activatingId;
        const displayTitle = stripTitle(session.title);
        const showProjectName = session.projectName !== displayTitle;
        const sourceIcon = getSourceIcon(session.sourceId);

        return (
          <button
            key={session.id}
            type="button"
            className={clsx("session-list-item", isSelected && "is-selected", isActivating && "is-activating")}
            aria-label={session.title}
            aria-current={isSelected ? "true" : undefined}
            onClick={() => onSelect(session.id)}
          >
            <div className="session-list-item-top">
              <span className="session-list-item-title">{displayTitle}</span>
              <span className="session-list-source-chip">
                <span
                  className={clsx("source-icon", "session-list-source-icon", sourceIcon.cls)}
                  aria-label={session.sourceId}
                >
                  {sourceIcon.text}
                </span>
              </span>
            </div>
            <div className="session-list-item-meta">
              {showProjectName && <span>{session.projectName}</span>}
              <span>{formatTimeAgo(session.updatedAt)}</span>
            </div>
            {session.preview && (
              <div className="session-list-item-preview">{session.preview}</div>
            )}
          </button>
        );
      })}
    </div>
  );
}
