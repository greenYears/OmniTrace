import "./styles.css";
import { startTransition, useEffect, useRef } from "react";

import { ThreePaneShell } from "./features/layout/ThreePaneShell";
import { getSessionDetail, scanSources } from "./lib/tauri";
import { useSessionStore } from "./stores/useSessionStore";

function App() {
  const sessions = useSessionStore((s) => s.sessions);
  const selectedId = useSessionStore((s) => s.selectedId);
  const detail = useSessionStore((s) => s.detail);
  const detailLoading = useSessionStore((s) => s.detailLoading);
  const sourceFilter = useSessionStore((s) => s.sourceFilter);
  const projectFilter = useSessionStore((s) => s.projectFilter);
  const timeRange = useSessionStore((s) => s.timeRange);
  const lastScannedAt = useSessionStore((s) => s.lastScannedAt);
  const setSessions = useSessionStore((s) => s.setSessions);
  const setDetail = useSessionStore((s) => s.setDetail);
  const setDetailLoading = useSessionStore((s) => s.setDetailLoading);
  const updateFilters = useSessionStore((s) => s.updateFilters);
  const selectSession = useSessionStore((s) => s.selectSession);
  const markScannedNow = useSessionStore((s) => s.markScannedNow);
  const hasAutoScanned = useRef(false);

  async function handleRefresh() {
    try {
      const nextSessions = await scanSources();
      setSessions(nextSessions);
      markScannedNow();
    } catch (error) {
      console.error(error);
      setSessions([]);
    }
  }

  useEffect(() => {
    let cancelled = false;

    if (!selectedId) {
      setDetail(null);
      setDetailLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setDetailLoading(true);

    void getSessionDetail(selectedId)
      .then((value) => {
        if (!cancelled) {
          startTransition(() => {
            setDetail(value);
            setDetailLoading(false);
          });
        }
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          startTransition(() => {
            setDetail(null);
            setDetailLoading(false);
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId, setDetail]);

  useEffect(() => {
    if (hasAutoScanned.current) {
      return;
    }

    hasAutoScanned.current = true;
    void handleRefresh();
  }, []);

  return (
    <main className="app-shell">
      <header className="app-toolbar">
        <div className="app-toolbar-left">
          <div className="app-logo" aria-hidden="true">O</div>
          <div>
            <h1>OmniTrace</h1>
            <span className="app-status">
              {sessions.length} session{sessions.length !== 1 ? "s" : ""}
              {lastScannedAt ? ` · Last scanned ${lastScannedAt}` : ""}
            </span>
          </div>
        </div>
        <button className="scan-button" type="button" onClick={() => void handleRefresh()}>
          ↻ Scan
        </button>
      </header>

      <div className="viewer-shell">
        <ThreePaneShell
          sessions={sessions}
          selectedId={selectedId}
          detail={detail}
          detailLoading={detailLoading}
          sourceFilter={sourceFilter}
          projectFilter={projectFilter}
          timeRange={timeRange}
          onFilterChange={updateFilters}
          onSelect={selectSession}
        />
      </div>
    </main>
  );
}

export default App;
