import type { SessionScanProgress, TokenProbeProgress, ScanAllResult } from "../../types/session";

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

export type ScanCardPhase = "scanning" | "probing" | "done";

type ScanCardProps = {
  phase: ScanCardPhase;
  scanProgress: SessionScanProgress | null;
  tokenProgress: TokenProbeProgress | null;
  result: ScanAllResult | null;
  onCancel?: () => void;
};

export function ScanCard({ phase, scanProgress, tokenProgress, result, onCancel }: ScanCardProps) {
  const activeProgress = scanProgress ?? tokenProgress;

  return (
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

      {phase !== "done" && onCancel && (
        <button
          type="button"
          className="startup-scan-skip"
          onClick={onCancel}
        >
          取消
        </button>
      )}
    </div>
  );
}
