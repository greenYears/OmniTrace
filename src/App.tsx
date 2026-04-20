import "./styles.css";
import { useEffect, useRef, useState } from "react";

import { ThreePaneShell } from "./features/layout/ThreePaneShell";
import { scanSources } from "./lib/tauri";
import { useSessionStore } from "./stores/useSessionStore";

function App() {
  const sessions = useSessionStore((s) => s.sessions);
  const selectedId = useSessionStore((s) => s.selectedId);
  const detail = useSessionStore((s) => s.detail);
  const sourceFilter = useSessionStore((s) => s.sourceFilter);
  const lastScannedAt = useSessionStore((s) => s.lastScannedAt);
  const setSessions = useSessionStore((s) => s.setSessions);
  const setSourceFilter = useSessionStore((s) => s.setSourceFilter);
  const selectSession = useSessionStore((s) => s.selectSession);
  const markScannedNow = useSessionStore((s) => s.markScannedNow);
  const [status, setStatus] = useState("Ready");
  const hasAutoScanned = useRef(false);

  async function handleRefresh() {
    try {
      setStatus("Scanning...");
      const nextSessions = await scanSources();
      setSessions(nextSessions);
      markScannedNow();
      setStatus("Idle");
    } catch (error) {
      console.error(error);
      setSessions([]);
      setStatus("Scan failed");
    }
  }

  useEffect(() => {
    if (hasAutoScanned.current) {
      return;
    }

    hasAutoScanned.current = true;
    void handleRefresh();
  }, []);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>OmniTrace</h1>
          <p className="app-subtitle">
            Unified local history viewer for AI coding TUIs.
          </p>
          <p className="app-status">
            Status: {status}
            {lastScannedAt ? ` · Last scanned at ${lastScannedAt}` : ""}
          </p>
        </div>
        <button className="scan-button" type="button" onClick={() => void handleRefresh()}>
          Scan / Refresh
        </button>
      </header>

      <div className="viewer-shell">
        <ThreePaneShell
          sessions={sessions}
          selectedId={selectedId}
          detail={detail}
          sourceFilter={sourceFilter}
          onSourceChange={setSourceFilter}
          onSelect={selectSession}
        />
      </div>
    </main>
  );
}

export default App;
