import clsx from "clsx";

import type { SessionDetail as SessionDetailType } from "../../types/session";

type SourceMeta = {
  label: string;
  icon: string;
  iconClass: string;
};

function stripTitle(title: string): string {
  return title.replace(/^(Claude Code|Codex):\s*/, "");
}

function getSourceMeta(sourceId: string): SourceMeta {
  if (sourceId === "codex") {
    return { label: "Codex", icon: "CX", iconClass: "is-codex" };
  }
  return { label: "Claude", icon: "C", iconClass: "is-claude-code" };
}

type SessionDetailProps = {
  detail: SessionDetailType | null;
};

export function SessionDetail({ detail }: SessionDetailProps) {
  if (!detail) {
    return (
      <section className="session-detail session-detail-empty" aria-label="Session detail">
        <p>Select a session to inspect its full history.</p>
      </section>
    );
  }

  const sourceMeta = getSourceMeta(detail.sourceId);

  return (
    <section className="session-detail" aria-label="Session detail">
      <div className="session-detail-meta-bar">
        <span className="session-detail-path">{detail.projectPath}</span>
        <span className="session-detail-source-badge">{sourceMeta.label}</span>
      </div>

      <ol className="session-message-list" aria-label="Messages">
        {detail.messages.map((msg) => (
          <li key={msg.id} className={clsx("session-message-row", `is-${msg.role}`)}>
            <div className={clsx("session-message", `is-${msg.role}`)}>
              <div className="session-message-role">{msg.role}</div>
              {msg.role === "assistant" && (
                <div className="session-message-source">
                  <div className={clsx("source-icon", sourceMeta.iconClass)} aria-hidden="true">
                    {sourceMeta.icon}
                  </div>
                  <span className="source-label">{sourceMeta.label}</span>
                </div>
              )}
              <div className="session-message-content">{msg.contentText}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
