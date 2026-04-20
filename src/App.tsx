import "./styles.css";
import { useEffect } from "react";

import { ThreePaneShell } from "./features/layout/ThreePaneShell";
import { useSessionStore } from "./stores/useSessionStore";
import type { SessionDetail, SessionListItem } from "./types/session";

function App() {
  const sessions = useSessionStore((s) => s.sessions);
  const selectedId = useSessionStore((s) => s.selectedId);
  const detail = useSessionStore((s) => s.detail);
  const setSessions = useSessionStore((s) => s.setSessions);
  const selectSession = useSessionStore((s) => s.selectSession);
  const setDetail = useSessionStore((s) => s.setDetail);

  useEffect(() => {
    const seedSessions: SessionListItem[] = [
      {
        id: "1",
        sourceId: "codex",
        title: "Codex",
        updatedAt: "2026-04-20T12:00:00Z",
        projectName: "project-a",
        messageCount: 3,
      },
      {
        id: "2",
        sourceId: "codex",
        title: "Codex",
        updatedAt: "2026-04-20T12:01:00Z",
        projectName: "project-b",
        messageCount: 7,
      },
    ];

    setSessions(seedSessions);
  }, [setSessions]);

  useEffect(() => {
    const seedDetails: Record<string, SessionDetail> = {
      "1": {
        id: "1",
        sourceId: "codex",
        title: "Codex",
        updatedAt: "2026-04-20T12:00:00Z",
        projectName: "project-a",
        messageCount: 3,
        projectPath: "/Users/example/project-a",
        startedAt: "2026-04-20T11:50:00Z",
        endedAt: null,
        messages: [
          {
            id: "m1",
            role: "user",
            contentText: "Show me the sessions for this repo.",
            createdAt: "2026-04-20T11:50:10Z",
          },
          {
            id: "m2",
            role: "assistant",
            contentText: "Scanning local history sources...",
            createdAt: "2026-04-20T11:50:12Z",
          },
          {
            id: "m3",
            role: "assistant",
            contentText: "Loaded 2 sessions.",
            createdAt: "2026-04-20T11:50:20Z",
          },
        ],
      },
      "2": {
        id: "2",
        sourceId: "codex",
        title: "Codex",
        updatedAt: "2026-04-20T12:01:00Z",
        projectName: "project-b",
        messageCount: 7,
        projectPath: "/Users/example/project-b",
        startedAt: "2026-04-20T11:55:00Z",
        endedAt: null,
        messages: [
          {
            id: "m4",
            role: "user",
            contentText: "Open session 2.",
            createdAt: "2026-04-20T11:55:05Z",
          },
          {
            id: "m5",
            role: "assistant",
            contentText: "Here are the messages for session 2.",
            createdAt: "2026-04-20T11:55:10Z",
          },
        ],
      },
    };

    if (!selectedId) {
      setDetail(null);
      return;
    }

    setDetail(seedDetails[selectedId] ?? null);
  }, [selectedId, setDetail]);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>OmniTrace</h1>
          <p className="app-subtitle">
            Unified local history viewer for AI coding TUIs.
          </p>
        </div>
        <button className="scan-button" type="button">
          Scan / Refresh
        </button>
      </header>

      <div className="viewer-shell">
        <ThreePaneShell
          sessions={sessions}
          selectedId={selectedId}
          detail={detail}
          onSelect={selectSession}
        />
      </div>
    </main>
  );
}

export default App;
