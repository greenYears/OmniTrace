import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import type { SessionListItem } from "../../types/session";

type SessionListProps = {
  sessions: SessionListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
};

const COPY_FEEDBACK_MS = 1400;

function formatTimeAgo(dateStr: string): string {
  const ms = Date.now() - Date.parse(dateStr);
  if (Number.isNaN(ms)) return "";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const d = new Date(dateStr);
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${MM}-${dd} ${HH}:${mm}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatModelId(modelId: string): string {
  if (!modelId) return "";
  const parts = modelId.split("-");
  if (parts.length <= 2) return modelId;
  const family = parts[0];
  const version = parts.slice(1, -2).join("-");
  return version ? `${family}-${version}` : family;
}

function getSourceIcon(sourceId: string): { text: string; cls: string } {
  if (sourceId === "codex") return { text: "CX", cls: "is-codex" };
  return { text: "C", cls: "is-claude-code" };
}

function stripTitle(title: string): string {
  return title.replace(/^(Claude Code|Codex):\s*/, "");
}

export function getResumeCommand(session: SessionListItem) {
  const resumeId = session.resumeId ?? session.id;

  if (session.sourceId === "codex") {
    return `codex resume ${resumeId}`;
  }

  return `claude --resume ${resumeId}`;
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function SessionList({ sessions, selectedId, onSelect, onDelete }: SessionListProps) {
  const prevSelectedIdRef = useRef<string | null>(selectedId);
  const activateTimerRef = useRef<number | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const confirmTimerRef = useRef<number | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

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
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
    if (confirmTimerRef.current) {
      window.clearTimeout(confirmTimerRef.current);
    }
  }, []);

  return (
    <div className="session-list" aria-label="Sessions">
      {sessions.map((session) => {
        const isSelected = session.id === selectedId;
        const isActivating = session.id === activatingId;
        const isCopied = session.id === copiedId;
        const displayTitle = stripTitle(session.title);
        const showProjectName = session.projectName !== displayTitle;
        const sourceIcon = getSourceIcon(session.sourceId);
        const copyLabel = isCopied
          ? `已复制 ${displayTitle} 的 Resume 命令`
          : `复制 ${displayTitle} 的 Resume 命令`;

        return (
          <div key={session.id} className={clsx("session-list-item-wrap", `source-${session.sourceId}`)}>
            <div
              role="button"
              tabIndex={0}
              className={clsx("session-list-item", isSelected && "is-selected", isActivating && "is-activating")}
              aria-label={session.title}
              aria-current={isSelected ? "true" : undefined}
              onClick={() => onSelect(session.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(session.id);
                }
              }}
            >
              <div className="session-list-item-top">
                <span
                  className={clsx("source-icon", "session-list-source-icon", sourceIcon.cls)}
                  aria-label={session.sourceId}
                >
                  {sourceIcon.text}
                </span>
                <span className="session-list-item-title">{displayTitle}</span>
              </div>
              <div className="session-list-item-meta">
                {showProjectName && <span>{session.projectName}</span>}
                {session.modelId && (
                  <span className="session-list-model-badge">{formatModelId(session.modelId)}</span>
                )}
                <span>{formatTimeAgo(session.updatedAt)}</span>
                {session.fileSize > 0 && <span>{formatFileSize(session.fileSize)}</span>}
              </div>
              {session.preview && (
                <div className="session-list-item-preview">{session.preview}</div>
              )}
              <div className="session-list-item-actions">
                <button
                  type="button"
                  className={clsx("session-list-copy-button", isCopied && "is-copied")}
                  aria-label={copyLabel}
                  onClick={async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    await copyText(getResumeCommand(session));
                    setCopiedId(session.id);

                    if (copiedTimerRef.current) {
                      window.clearTimeout(copiedTimerRef.current);
                    }

                    copiedTimerRef.current = window.setTimeout(() => {
                      setCopiedId((current) => (current === session.id ? null : current));
                      copiedTimerRef.current = null;
                    }, COPY_FEEDBACK_MS);
                  }}
                >
                  {isCopied ? "已复制" : "Resume"}
                </button>
                <button
                  type="button"
                  className={clsx("session-list-delete-button", confirmingId === session.id && "is-confirming")}
                  aria-label={confirmingId === session.id ? `确认删除 ${displayTitle}` : `删除 ${displayTitle}`}
                  onClick={async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (confirmingId === session.id) {
                      onDelete(session.id);
                      setConfirmingId(null);
                      if (confirmTimerRef.current) {
                        window.clearTimeout(confirmTimerRef.current);
                        confirmTimerRef.current = null;
                      }
                    } else {
                      setConfirmingId(session.id);
                      if (confirmTimerRef.current) {
                        window.clearTimeout(confirmTimerRef.current);
                      }
                      confirmTimerRef.current = window.setTimeout(() => {
                        setConfirmingId(null);
                        confirmTimerRef.current = null;
                      }, 2000);
                    }
                  }}
                >
                  {confirmingId === session.id ? "确认?" : "删除"}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
