import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { scanAllData } from "../../lib/tauri";
import type {
  ScanAllResult,
  SessionScanProgress,
  TokenProbeProgress,
} from "../../types/session";

type StartupScanViewProps = {
  onComplete: (result: ScanAllResult) => void;
  onSkip: () => void;
};

function ActivityDots() {
  return (
    <span className="scan-progress-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function compactPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

function sourceLabel(sourceId: string) {
  if (sourceId === "claude_code") return "Claude Code";
  if (sourceId === "codex") return "Codex";
  return sourceId;
}

export function StartupScanView({ onComplete, onSkip }: StartupScanViewProps) {
  const [scanProgress, setScanProgress] = useState<SessionScanProgress | null>(null);
  const [tokenProgress, setTokenProgress] = useState<TokenProbeProgress | null>(null);
  const [phase, setPhase] = useState<"scanning" | "probing" | "done">("scanning");
  const [result, setResult] = useState<ScanAllResult | null>(null);
  const skippedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let cleanupSession: (() => void) | null = null;
    let cleanupToken: (() => void) | null = null;

    void listen<SessionScanProgress>("session-scan-progress", (event) => {
      setScanProgress(event.payload);
    }).then((unlisten) => {
      if (cancelled) { unlisten(); return; }
      cleanupSession = unlisten;
    });

    void listen<TokenProbeProgress>("token-probe-progress", (event) => {
      setTokenProgress(event.payload);
      setPhase("probing");
    }).then((unlisten) => {
      if (cancelled) { unlisten(); return; }
      cleanupToken = unlisten;
    });

    void scanAllData()
      .then((res) => {
        if (cancelled) return;
        setResult(res);
        setPhase("done");
      })
      .catch((err) => {
        console.error("Startup scan failed:", err);
        if (!cancelled) onSkip();
      });

    return () => {
      cancelled = true;
      cleanupSession?.();
      cleanupToken?.();
    };
  }, [onSkip]);

  useEffect(() => {
    if (phase !== "done" || !result || skippedRef.current) return;
    const timer = setTimeout(() => onComplete(result), 600);
    return () => clearTimeout(timer);
  }, [phase, result, onComplete]);

  function handleSkip() {
    skippedRef.current = true;
    onSkip();
  }

  const activeProgress = scanProgress ?? tokenProgress;

  return (
    <div className={`startup-scan-view${phase === "done" ? " is-done" : ""}`}>
      <div className="startup-scan-card">
        <div className="startup-scan-logo">
          <span>O</span>
        </div>
        <h2 className="startup-scan-title">
          {phase === "done" ? "扫描完成" : "正在扫描数据"}
        </h2>

        {phase !== "done" && activeProgress ? (
          <div className="startup-scan-progress" role="status">
            <div className="startup-scan-progress-main">
              <ActivityDots />
              <strong>
                {scanProgress ? sourceLabel(scanProgress.sourceId) : "Token 探测"}
              </strong>
              <span>{activeProgress.phase}</span>
            </div>
            <div className="startup-scan-progress-path">
              {compactPath(activeProgress.path)}
            </div>
            <div className="startup-scan-progress-meta">
              {scanProgress
                ? `${scanProgress.filesScanned} 个文件 · ${scanProgress.sessionsFound} 个会话`
                : `${tokenProgress?.filesScanned ?? 0} 个文件 · ${tokenProgress?.recordsWithUsage ?? 0} 条 usage`}
            </div>
          </div>
        ) : phase !== "done" ? (
          <div className="startup-scan-progress" role="status">
            <div className="startup-scan-progress-main">
              <ActivityDots />
              <strong>准备扫描</strong>
            </div>
          </div>
        ) : result ? (
          <div className="startup-scan-summary">
            <span>{result.sessionCount} 个会话 · {result.messageCount} 条消息 · {result.filesScanned} 个文件</span>
          </div>
        ) : null}

        {phase !== "done" && (
          <button
            type="button"
            className="startup-scan-skip"
            onClick={handleSkip}
          >
            跳过
          </button>
        )}
      </div>
    </div>
  );
}
