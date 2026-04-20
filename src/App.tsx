import "./styles.css";

import { ThreePaneShell } from "./features/layout/ThreePaneShell";
import { useSessionStore } from "./stores/useSessionStore";

function App() {
  const sessions = useSessionStore((s) => s.sessions);
  const selectedId = useSessionStore((s) => s.selectedId);
  const detail = useSessionStore((s) => s.detail);
  const selectSession = useSessionStore((s) => s.selectSession);

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
