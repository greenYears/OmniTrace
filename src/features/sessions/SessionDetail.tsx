import { useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";

import claudeCodeIcon from "../../assets/claude-code.svg";
import codexIcon from "../../assets/codex.svg";
import type { SessionDetail as SessionDetailType, SessionMessage } from "../../types/session";

const COLLAPSED_MAX = 140;
const LONG_TRANSCRIPT_THRESHOLD = 120;
const INITIAL_RENDER_COUNT = 100;
const LOAD_MORE_COUNT = 80;
const LOAD_MORE_SCROLL_TOP = 120;
const CONTENT_REVEAL_DURATION = 360;
const STAGGER_REVEAL_COUNT = 8;

type SourceMeta = {
  label: string;
  iconSrc: string;
  iconClass: string;
};

function getSourceMeta(sourceId: string): SourceMeta {
  if (sourceId === "codex") {
    return { label: "Codex", iconSrc: codexIcon, iconClass: "is-codex" };
  }
  return { label: "Claude", iconSrc: claudeCodeIcon, iconClass: "is-claude-code" };
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={clsx("msg-chevron", open && "is-open")}
      width="12" height="12" viewBox="0 0 12 12" fill="none"
      aria-hidden="true"
    >
      <path d="M4 2.5L7.5 6L4 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function CollapsibleContent({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > COLLAPSED_MAX;

  return (
    <div className="msg-collapsible-wrap">
      <div
        className={clsx("msg-collapsible", className, !open && long && "is-collapsed")}
      >
        {text}
      </div>
      {long && (
        <button
          type="button"
          className="msg-toggle"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "收起" : "展开全部"}
        </button>
      )}
    </div>
  );
}

function UserMessage({ msg, isLatest, className }: { msg: SessionMessage; isLatest?: boolean; className?: string }) {
  const text = msg.contentText.trim();
  if (!text) return null;
  return (
    <div className={clsx("msg-card msg-user-card", isLatest && "is-latest", className)}>
      <div className="msg-block msg-user">
        <div className="msg-user-header">
          <div className="msg-user-icon" aria-hidden="true">⟩</div>
          <span className="msg-user-label">用户</span>
          {isLatest && <span className="msg-latest-badge">最新</span>}
        </div>
        <CollapsibleContent text={text} />
      </div>
    </div>
  );
}

function AssistantMessage({
  msg,
  sourceMeta,
  isLatest,
  className,
}: {
  msg: SessionMessage;
  sourceMeta: SourceMeta;
  isLatest?: boolean;
  className?: string;
}) {
  const text = msg.contentText.trim();
  if (!text) return null;
  return (
    <div className={clsx("msg-card msg-assistant-card", isLatest && "is-latest", className)}>
      <div className="msg-block msg-assistant">
        <div className="msg-assistant-header">
          <div className={clsx("msg-source-icon", sourceMeta.iconClass)} aria-hidden="true">
            <img src={sourceMeta.iconSrc} alt="" width="10" height="10" />
          </div>
          <span className="msg-source-label">{sourceMeta.label}</span>
          {isLatest && <span className="msg-latest-badge">最新</span>}
        </div>
        <CollapsibleContent text={text} />
      </div>
    </div>
  );
}

function basename(p: string) {
  const segs = p.replace(/\/+$/, "").split("/");
  return segs[segs.length - 1] || p;
}

function ToolMessage({ msg, isLatest, className }: { msg: SessionMessage; isLatest?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const hasContent = msg.contentText.trim().length > 0;
  const label = msg.toolName || "工具";
  const summary = msg.filePaths.length > 0
    ? msg.filePaths.map(basename).join(", ")
    : msg.kind.replace(/_/g, " ");

  return (
    <div className={clsx("msg-card msg-tool-card", isLatest && "is-latest", className)}>
      <div className="msg-block msg-tool">
        <button
          type="button"
          className="msg-tool-summary"
          onClick={() => hasContent && setOpen((v) => !v)}
        >
          {hasContent && <Chevron open={open} />}
          <span className="msg-tool-name">{label}</span>
          <span className="msg-tool-summary-path">{summary}</span>
          {isLatest && <span className="msg-latest-dot" aria-hidden="true" />}
        </button>
        {open && hasContent && (
          <div className="msg-tool-body">
            <CollapsibleContent text={msg.contentText.trim()} className="msg-tool-content" />
            {msg.filePaths.length > 0 && (
              <div className="msg-tool-paths">
                {msg.filePaths.map((p) => (
                  <span key={`${msg.id}:${p}`} className="msg-tool-path">{p}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function getLastRenderableMessageId(messages: SessionMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const msg = messages[index];
    if (!msg) continue;

    const hasText = msg.contentText.trim().length > 0;
    const hasFiles = msg.filePaths.length > 0;

    if ((msg.role === "user" || msg.role === "assistant") && hasText) {
      return msg.id;
    }

    if (msg.role === "tool" && (hasText || hasFiles)) {
      return msg.id;
    }
  }

  return null;
}

function isRenderableMessage(msg: SessionMessage) {
  const hasText = msg.contentText.trim().length > 0;
  const hasFiles = msg.filePaths.length > 0;

  if (msg.role === "user" || msg.role === "assistant") {
    return hasText;
  }

  if (msg.role === "tool") {
    return hasText || hasFiles;
  }

  return false;
}

type SessionDetailProps = {
  detail: SessionDetailType | null;
  isLoading?: boolean;
  pendingSession?: {
    title: string;
    projectName: string;
    sourceId: string;
  } | null;
};

function stripTitle(title: string) {
  return title.replace(/^(Claude Code|Codex):\s*/, "");
}

export function SessionDetail({ detail, isLoading = false, pendingSession = null }: SessionDetailProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  const prependAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const titleSyncTimerRef = useRef<number | null>(null);
  const revealTimerRef = useRef<number | null>(null);
  const [displayDetail, setDisplayDetail] = useState<SessionDetailType | null>(detail);
  const [isTitleSyncing, setIsTitleSyncing] = useState(false);
  const [isContentRevealing, setIsContentRevealing] = useState(Boolean(detail));
  const [visibleStart, setVisibleStart] = useState(0);
  const contentDetail = detail ?? (isLoading ? displayDetail : null);
  const sourceMeta = contentDetail ? getSourceMeta(contentDetail.sourceId) : null;
  const pendingSourceMeta = pendingSession ? getSourceMeta(pendingSession.sourceId) : null;
  const pendingTitle = pendingSession ? stripTitle(pendingSession.title) : "";
  const renderableMessages = contentDetail ? contentDetail.messages.filter(isRenderableMessage) : [];
  const lastRenderableMessageId = getLastRenderableMessageId(renderableMessages);
  const shouldChunk = renderableMessages.length > LONG_TRANSCRIPT_THRESHOLD;
  const initialVisibleStart = shouldChunk
    ? Math.max(renderableMessages.length - INITIAL_RENDER_COUNT, 0)
    : 0;
  const visibleMessages = shouldChunk
    ? renderableMessages.slice(visibleStart)
    : renderableMessages;

  useEffect(() => {
    if (detail) {
      setDisplayDetail(detail);
      return;
    }

    if (!isLoading) {
      setDisplayDetail(null);
    }
  }, [detail, isLoading]);

  useEffect(() => () => {
    if (titleSyncTimerRef.current) {
      window.clearTimeout(titleSyncTimerRef.current);
    }
    if (revealTimerRef.current) {
      window.clearTimeout(revealTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!isLoading || !pendingSession?.title) {
      setIsTitleSyncing(false);
      return;
    }

    setIsTitleSyncing(true);
    if (titleSyncTimerRef.current) {
      window.clearTimeout(titleSyncTimerRef.current);
    }

    titleSyncTimerRef.current = window.setTimeout(() => {
      setIsTitleSyncing(false);
      titleSyncTimerRef.current = null;
    }, 260);
  }, [isLoading, pendingSession?.title, pendingSession?.sourceId]);

  useEffect(() => {
    if (!detail) {
      if (!isLoading) {
        setIsContentRevealing(false);
      }
      return;
    }

    setIsContentRevealing(true);
    if (revealTimerRef.current) {
      window.clearTimeout(revealTimerRef.current);
    }

    revealTimerRef.current = window.setTimeout(() => {
      setIsContentRevealing(false);
      revealTimerRef.current = null;
    }, CONTENT_REVEAL_DURATION);
  }, [detail?.id, isLoading]);

  useLayoutEffect(() => {
    prependAnchorRef.current = null;
    setVisibleStart(initialVisibleStart);
  }, [contentDetail?.id, initialVisibleStart]);

  useLayoutEffect(() => {
    if (!contentDetail || !containerRef.current) {
      return;
    }

    const anchor = prependAnchorRef.current;
    if (anchor) {
      prependAnchorRef.current = null;
      containerRef.current.scrollTop = containerRef.current.scrollHeight - anchor.scrollHeight + anchor.scrollTop;
      return;
    }

    if (visibleStart === initialVisibleStart) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [contentDetail?.id, visibleStart, initialVisibleStart]);

  if (!contentDetail && !isLoading) {
    return (
      <section className="session-detail session-detail-empty" aria-label="Session detail">
        <p>选择一个会话以查看完整历史</p>
      </section>
    );
  }

  function renderMessage(msg: SessionMessage, index: number) {
    const isLatest = msg.id === lastRenderableMessageId;
    const shouldStagger = isContentRevealing && index < STAGGER_REVEAL_COUNT;
    const messageProps = {
      msg,
      isLatest,
      className: shouldStagger ? "is-stagger-enter" : undefined,
    };

    switch (msg.role) {
      case "user":
        return <UserMessage key={msg.id} {...messageProps} />;
      case "assistant":
        return <AssistantMessage key={msg.id} {...messageProps} sourceMeta={sourceMeta!} />;
      case "tool":
        return <ToolMessage key={msg.id} {...messageProps} />;
      default:
        return null;
    }
  }

  return (
    <section
      ref={containerRef}
      className={clsx(
        "session-detail",
        contentDetail && "has-detail",
        isLoading && "is-loading",
        isTitleSyncing && "is-title-syncing",
        isContentRevealing && "is-content-revealing",
      )}
      aria-label="Session detail"
      onScroll={(event) => {
        if (!shouldChunk || visibleStart === 0) {
          return;
        }

        if (event.currentTarget.scrollTop > LOAD_MORE_SCROLL_TOP) {
          return;
        }

        prependAnchorRef.current = {
          scrollHeight: event.currentTarget.scrollHeight,
          scrollTop: event.currentTarget.scrollTop,
        };

        setVisibleStart((current) => Math.max(0, current - LOAD_MORE_COUNT));
      }}
    >
      {contentDetail && sourceMeta ? (
        <div className="session-detail-stage">
          <div className="session-detail-meta-bar">
            <span className="session-detail-path">{contentDetail.projectPath}</span>
            <span className="session-detail-source-badge">{sourceMeta.label}</span>
          </div>

          <div className="msg-transcript" aria-label="Messages">
            {visibleMessages.map((msg, index) => renderMessage(msg, index))}
          </div>
        </div>
      ) : (
        <div className="session-detail-skeleton-base" aria-hidden="true">
          <div className="session-detail-skeleton-line is-path" />
          <div className="session-detail-skeleton-line is-short" />
          <div className="session-detail-skeleton-bubble is-assistant" />
          <div className="session-detail-skeleton-bubble is-user" />
          <div className="session-detail-skeleton-bubble is-tool" />
        </div>
      )}

      {isLoading && (
        <div className="session-detail-loading-overlay" role="status" aria-label="Loading session detail">
          <div className="session-detail-loading-panel">
            <div className="session-detail-loading-header">
              {pendingSourceMeta && (
                <div className={clsx("msg-source-icon", "session-detail-loading-source", pendingSourceMeta.iconClass)} aria-hidden="true">
                  {pendingSourceMeta.iconSrc && <img src={pendingSourceMeta.iconSrc} alt="" width="10" height="10" />}
                </div>
              )}
              <div className="session-detail-loading-header-copy">
                <div className="session-detail-loading-title">{pendingTitle || "正在切换会话"}</div>
                <div className="session-detail-loading-subtitle">
                  <span>{pendingSourceMeta?.label ?? "会话"}</span>
                  <span className="session-detail-loading-sep" aria-hidden="true">·</span>
                  <span>{pendingSession?.projectName ?? "加载中"}</span>
                </div>
              </div>
              <div className="session-detail-loading-pulse" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
            <div className="session-detail-loading-label">正在读取历史、AI 回复与工具调用</div>
            <div className="session-detail-skeleton-line is-path" />
            <div className="session-detail-skeleton-line is-mid" />
            <div className="session-detail-loading-chat">
              <div className="session-detail-skeleton-bubble is-assistant" />
              <div className="session-detail-skeleton-bubble is-tool" />
              <div className="session-detail-skeleton-bubble is-user" />
            </div>
          </div>
        </div>
      )}
      <div className="session-detail-bottom-fade" aria-hidden="true" />
    </section>
  );
}
