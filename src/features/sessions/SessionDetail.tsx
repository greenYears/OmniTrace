import type { SessionDetail as SessionDetailType } from "../../types/session";

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

  return (
    <section className="session-detail" aria-label="Session detail">
      <header className="session-detail-header">
        <h2 className="session-detail-title">{detail.title}</h2>
        <p className="session-detail-path">{detail.projectPath}</p>
      </header>

      <ol className="session-message-list" aria-label="Messages">
        {detail.messages.map((msg) => (
          <li key={msg.id} className="session-message">
            <div className="session-message-role">{msg.role}</div>
            <div className="session-message-content">{msg.contentText}</div>
          </li>
        ))}
      </ol>
    </section>
  );
}
