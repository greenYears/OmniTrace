import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { scanAllData } from "../../lib/tauri";
import { ScanCard } from "./ScanCard";
import type {
  ScanAllResult,
  SessionScanProgress,
  TokenProbeProgress,
} from "../../types/session";
import type { ScanCardPhase } from "./ScanCard";

type StartupScanViewProps = {
  onComplete: (result: ScanAllResult) => void;
  onSkip: () => void;
};

export function StartupScanView({ onComplete, onSkip }: StartupScanViewProps) {
  const [scanProgress, setScanProgress] = useState<SessionScanProgress | null>(null);
  const [tokenProgress, setTokenProgress] = useState<TokenProbeProgress | null>(null);
  const [phase, setPhase] = useState<ScanCardPhase>("scanning");
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

  return (
    <div className={`startup-scan-view${phase === "done" ? " is-done" : ""}`}>
      <ScanCard
        phase={phase}
        scanProgress={scanProgress}
        tokenProgress={tokenProgress}
        result={result}
        onCancel={handleSkip}
      />
    </div>
  );
}
