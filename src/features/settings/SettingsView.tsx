import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { getScanStats, scanAllData } from "../../lib/tauri";
import { handleWindowDragPointerDown } from "../../lib/windowDrag";
import { ScanCard } from "../scanning/ScanCard";
import { ProviderSection } from "../knowledge/ProviderSettings";
import type {
  ScanAllResult,
  ScanStats,
  SessionScanProgress,
  TokenProbeProgress,
} from "../../types/session";
import type { ScanCardPhase } from "../scanning/ScanCard";

function formatScanTime(iso: string | null): string {
  if (!iso) {
    return "从未扫描";
  }
  const date = new Date(iso);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type SettingsViewProps = {
  onScanComplete?: () => void | Promise<void>;
};

export function SettingsView({ onScanComplete }: SettingsViewProps) {
  const [stats, setStats] = useState<ScanStats | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<SessionScanProgress | null>(null);
  const [tokenProgress, setTokenProgress] = useState<TokenProbeProgress | null>(null);
  const [scanPhase, setScanPhase] = useState<ScanCardPhase>("scanning");
  const [scanResult, setScanResult] = useState<ScanAllResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [autoScan, setAutoScan] = useState(() => localStorage.getItem("omnitrace-auto-scan") !== "false");

  useEffect(() => {
    let cancelled = false;
    let cleanupSession: (() => void) | null = null;
    let cleanupToken: (() => void) | null = null;

    void listen<SessionScanProgress>("session-scan-progress", (event) => {
      setScanProgress(event.payload);
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      cleanupSession = unlisten;
    });

    void listen<TokenProbeProgress>("token-probe-progress", (event) => {
      setTokenProgress(event.payload);
      if (!cancelled) setScanPhase("probing");
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      cleanupToken = unlisten;
    });

    return () => {
      cancelled = true;
      cleanupSession?.();
      cleanupToken?.();
    };
  }, []);

  useEffect(() => {
    getScanStats()
      .then(setStats)
      .catch(() => {});
  }, []);

  async function handleScan() {
    setScanning(true);
    setScanProgress(null);
    setTokenProgress(null);
    setScanPhase("scanning");
    setScanResult(null);
    setError(null);
    setSuccess(null);

    try {
      const result = await scanAllData();
      setScanResult(result);
      setScanPhase("done");
      setStats({
        sessionCount: result.sessionCount,
        messageCount: result.messageCount,
        lastScannedAt: result.lastScannedAt,
      });
      setSuccess("扫描完成");
      try {
        await onScanComplete?.();
      } catch (refreshError) {
        console.error(refreshError);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`扫描失败：${message}`);
    } finally {
      setTimeout(() => setScanning(false), 800);
    }
  }

  function handleCancelScan() {
    setScanning(false);
    setScanProgress(null);
    setTokenProgress(null);
    setScanPhase("scanning");
    setScanResult(null);
  }

  return (
    <section className="settings-view" aria-label="设置">
      <header className="view-toolbar" data-tauri-drag-region onPointerDown={handleWindowDragPointerDown}>
        <div className="view-toolbar-left" data-tauri-drag-region>
          <h2 className="view-toolbar-title" data-tauri-drag-region>设置</h2>
        </div>
      </header>

      <div className="settings-content">
        <div className="settings-layout">
          <div className="settings-card">
              <div className="settings-card-header">
                <h3 className="settings-card-title">数据管理</h3>
              </div>
              <div className="settings-card-body">
                {stats ? (
                  <div className="settings-stat-grid">
                    <div className="settings-stat-cell">
                      <span className="settings-stat-value">{stats.sessionCount}</span>
                      <span className="settings-stat-label">会话</span>
                    </div>
                    <div className="settings-stat-cell">
                      <span className="settings-stat-value">{stats.messageCount}</span>
                      <span className="settings-stat-label">消息</span>
                    </div>
                    <div className="settings-stat-cell settings-stat-cell--wide">
                      <span className="settings-stat-label">上次扫描</span>
                      <span className="settings-stat-time">{formatScanTime(stats.lastScannedAt)}</span>
                    </div>
                  </div>
                ) : (
                  <p className="settings-empty">暂无数据</p>
                )}

                <button
                  className="settings-action-btn"
                  type="button"
                  onClick={() => void handleScan()}
                  disabled={scanning}
                >
                  {scanning ? "扫描中..." : "扫描全部数据"}
                </button>

                {error ? <p className="settings-error">{error}</p> : null}
                {success && !scanning ? <p className="settings-success" role="status">{success}</p> : null}
              </div>
            </div>

            <div className="settings-card">
              <div className="settings-card-header">
                <h3 className="settings-card-title">启动设置</h3>
              </div>
              <div className="settings-card-body">
                <div className="settings-toggle-row">
                  <div className="settings-toggle-text">
                    <span className="settings-toggle-label">启动时自动扫描数据</span>
                    <span className="settings-toggle-desc">应用启动时自动扫描所有数据源</span>
                  </div>
                  <button
                    type="button"
                    className={`settings-toggle${autoScan ? " is-on" : ""}`}
                    role="switch"
                    aria-checked={autoScan}
                    onClick={() => {
                      const next = !autoScan;
                      setAutoScan(next);
                      localStorage.setItem("omnitrace-auto-scan", next ? "true" : "false");
                    }}
                  />
                </div>
              </div>
            </div>

            <ProviderSection />
          </div>
        </div>

      {scanning && (
        <div className={`settings-scan-overlay${scanPhase === "done" ? " is-done" : ""}`}>
          <ScanCard
            phase={scanPhase}
            scanProgress={scanProgress}
            tokenProgress={tokenProgress}
            result={scanResult}
            onCancel={handleCancelScan}
          />
        </div>
      )}
    </section>
  );
}
