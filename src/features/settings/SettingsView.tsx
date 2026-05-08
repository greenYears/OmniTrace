import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { getScanStats, scanAllData } from "../../lib/tauri";
import { handleWindowDragPointerDown } from "../../lib/windowDrag";
import type {
  ScanStats,
  SessionScanProgress,
  TokenProbeProgress,
} from "../../types/session";

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

function compactPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

function ActivityDots() {
  return (
    <span className="scan-progress-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

type SettingsViewProps = {
  onScanComplete?: () => void | Promise<void>;
};

export function SettingsView({ onScanComplete }: SettingsViewProps) {
  const [stats, setStats] = useState<ScanStats | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<SessionScanProgress | null>(null);
  const [tokenProgress, setTokenProgress] = useState<TokenProbeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
    setError(null);
    setSuccess(null);

    try {
      const result = await scanAllData();
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
      setScanning(false);
    }
  }

  return (
    <section className="settings-view" aria-label="设置">
      <header className="view-toolbar" data-tauri-drag-region onPointerDown={handleWindowDragPointerDown}>
        <div className="view-toolbar-left" data-tauri-drag-region>
          <h2 className="view-toolbar-title" data-tauri-drag-region>设置</h2>
        </div>
      </header>

      <div className="settings-content">
        <div className="settings-section">
          <h3>数据管理</h3>

          {stats ? (
            <div className="settings-stats">
              <div className="settings-stat-row">
                <span>会话</span>
                <strong>{stats.sessionCount} 个</strong>
              </div>
              <div className="settings-stat-row">
                <span>消息</span>
                <strong>{stats.messageCount} 条</strong>
              </div>
              <div className="settings-stat-row">
                <span>上次扫描</span>
                <span>{formatScanTime(stats.lastScannedAt)}</span>
              </div>
            </div>
          ) : (
            <p className="settings-empty">暂无数据</p>
          )}

          <button
            className="settings-scan-button"
            type="button"
            onClick={() => void handleScan()}
            disabled={scanning}
          >
            {scanning ? "扫描中..." : "扫描全部数据"}
          </button>

          {error ? <p className="settings-error">{error}</p> : null}
          {success ? <p className="settings-success" role="status">{success}</p> : null}

          {scanning && scanProgress ? (
            <div className="settings-progress" role="status">
              <div className="settings-progress-main">
                <ActivityDots />
                <strong>{scanProgress.sourceId === "claude_code" ? "Claude Code" : "Codex"}</strong>
                <span>{scanProgress.phase}</span>
              </div>
              <div className="settings-progress-path">{compactPath(scanProgress.path)}</div>
              <div className="settings-progress-meta">
                {scanProgress.filesScanned} 个文件 · {scanProgress.sessionsFound} 个会话
              </div>
            </div>
          ) : null}

          {scanning && tokenProgress && !scanProgress ? (
            <div className="settings-progress" role="status">
              <div className="settings-progress-main">
                <ActivityDots />
                <strong>Token 探测</strong>
                <span>{tokenProgress.phase}</span>
              </div>
              <div className="settings-progress-path">{compactPath(tokenProgress.path)}</div>
              <div className="settings-progress-meta">
                {tokenProgress.filesScanned} 个文件 · {tokenProgress.recordsWithUsage} 条 usage
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
