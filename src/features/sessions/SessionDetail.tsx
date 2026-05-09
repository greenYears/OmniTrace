import { useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import Markdown from "react-markdown";

import claudeCodeIcon from "../../assets/claude-code.svg";
import codexIcon from "../../assets/codex.svg";
import type { SessionDetail as SessionDetailType, SessionMessage } from "../../types/session";

const COLLAPSED_LINE_THRESHOLD = 15;
const LONG_TRANSCRIPT_THRESHOLD = 120;
const INITIAL_RENDER_COUNT = 100;
const LOAD_MORE_COUNT = 80;
const LOAD_MORE_SCROLL_TOP = 120;
const CONTENT_REVEAL_DURATION = 360;
const STAGGER_REVEAL_COUNT = 8;
const detailTimeZone = "Asia/Shanghai";

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

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: detailTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

function MessageTime({ value }: { value: string }) {
  const formatted = formatMessageTime(value);
  if (!formatted) {
    return null;
  }

  return (
    <time className="msg-time" dateTime={value} title={value}>
      {formatted}
    </time>
  );
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

function CompactMarkdown({ text }: { text: string }) {
  const normalized = text.replace(/\n{3,}/g, "\n\n");
  return (
    <span className="md-compact">
      <Markdown
        components={{
          p: ({ children }) => <span className="md-line md-flow-block">{children}</span>,
          code: ({ className, children, ...props }) => {
            const isBlock = Boolean(className);
            if (isBlock) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className="md-inline-code" {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre className="md-code-block">{children}</pre>,
          h1: ({ children }) => <strong className="md-heading md-flow-block">{children}</strong>,
          h2: ({ children }) => <strong className="md-heading md-flow-block">{children}</strong>,
          h3: ({ children }) => <strong className="md-heading md-flow-block">{children}</strong>,
          h4: ({ children }) => <strong className="md-heading md-flow-block">{children}</strong>,
          blockquote: ({ children }) => <span className="md-quote md-flow-block">{children}</span>,
          ul: ({ children }) => <span className="md-list md-flow-block">{children}</span>,
          ol: ({ children }) => <span className="md-list md-flow-block">{children}</span>,
          li: ({ children }) => <span className="md-list-item">- {children}</span>,
        }}
      >
        {normalized}
      </Markdown>
    </span>
  );
}

function CollapsibleContent({ text, className, markdown }: { text: string; className?: string; markdown?: boolean }) {
  const [open, setOpen] = useState(false);
  const lineCount = text.split("\n").length;
  const long = lineCount > COLLAPSED_LINE_THRESHOLD;

  return (
    <div className="msg-collapsible-wrap">
      <div
        className={clsx("msg-collapsible", className, !open && long && "is-collapsed")}
      >
        {markdown ? <CompactMarkdown text={text} /> : text}
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

function MessageToolAttachment({ tools }: { tools: SessionMessage[] }) {
  const [open, setOpen] = useState(false);
  if (tools.length === 0) return null;

  return (
    <div className="msg-tool-attachment">
      <button
        type="button"
        className="msg-tool-attachment-toggle"
        aria-label={`工具调用 ${tools.length}`}
        onClick={() => setOpen((current) => !current)}
      >
        <Chevron open={open} />
        <span>工具调用 {tools.length}</span>
      </button>
      {open && (
        <div className="msg-tool-attachment-body">
          {tools.map((tool) => (
            <ToolMessage key={tool.id} msg={tool} embedded />
          ))}
        </div>
      )}
    </div>
  );
}

function SelectionContext({ context }: { context: SessionMessage }) {
  const [open, setOpen] = useState(false);
  const [summary, ...contentLines] = context.contentText.trim().split("\n");
  const content = contentLines.join("\n").trim();
  const label = context.kind === "file_context"
    ? "文件上下文"
    : context.kind === "memory_context"
      ? "项目记忆"
      : "选区上下文";

  return (
    <div className="msg-selection-context">
      <button
        type="button"
        className="msg-selection-context-header"
        onClick={() => content && setOpen((current) => !current)}
      >
        {content && <Chevron open={open} />}
        <span className="msg-selection-context-label">{label}</span>
        <span className="msg-selection-context-summary">{summary}</span>
      </button>
      {open && content && <pre className="msg-selection-context-content">{content}</pre>}
    </div>
  );
}

function MessageSelectionContexts({ contexts }: { contexts: SessionMessage[] }) {
  if (contexts.length === 0) return null;

  return (
    <div className="msg-selection-contexts">
      {contexts.map((context) => (
        <SelectionContext key={context.id} context={context} />
      ))}
    </div>
  );
}

function ToolActionBlock({
  tools,
  sourceMeta,
  modelId,
  className,
}: {
  tools: SessionMessage[];
  sourceMeta: SourceMeta;
  modelId?: string;
  className?: string;
}) {
  if (tools.length === 0) return null;

  return (
    <div className={clsx("msg-card msg-tool-action-card", className)}>
      <div className="msg-block msg-tool-action">
        <div className="msg-tool-action-header">
          <div className={clsx("msg-source-icon", sourceMeta.iconClass)} aria-hidden="true">
            <img src={sourceMeta.iconSrc} alt="" width="10" height="10" />
          </div>
          <span className="msg-source-label">{modelId || sourceMeta.label} · 执行动作</span>
          <MessageTime value={tools[0].createdAt} />
        </div>
        <MessageToolAttachment tools={tools} />
      </div>
    </div>
  );
}

function UserMessage({
  msg,
  contexts,
  tools,
  isLatest,
  className,
}: {
  msg: SessionMessage;
  contexts?: SessionMessage[];
  tools?: SessionMessage[];
  isLatest?: boolean;
  className?: string;
}) {
  const text = msg.contentText.trim();
  if (!text) return null;
  return (
    <div className={clsx("msg-card msg-user-card", isLatest && "is-latest", className)}>
      <div className="msg-block msg-user">
        <div className="msg-user-header">
          <div className="msg-user-icon" aria-hidden="true">⟩</div>
          <span className="msg-user-label">用户</span>
          <MessageTime value={msg.createdAt} />
          {isLatest && <span className="msg-latest-badge">最新</span>}
        </div>
        <CollapsibleContent text={text} markdown />
        <MessageSelectionContexts contexts={contexts ?? []} />
        <MessageToolAttachment tools={tools ?? []} />
      </div>
    </div>
  );
}

function AssistantMessage({
  msg,
  tools,
  sourceMeta,
  modelId,
  isLatest,
  className,
}: {
  msg: SessionMessage;
  tools?: SessionMessage[];
  sourceMeta: SourceMeta;
  modelId?: string;
  isLatest?: boolean;
  className?: string;
}) {
  const text = msg.contentText.trim();
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolCount = tools?.length ?? 0;
  if (!text && toolCount === 0) return null;
  return (
    <div className={clsx("msg-card msg-assistant-card", isLatest && "is-latest", className)}>
      <div className="msg-block msg-assistant">
        <div className="msg-assistant-header">
          <div className={clsx("msg-source-icon", sourceMeta.iconClass)} aria-hidden="true">
            <img src={sourceMeta.iconSrc} alt="" width="10" height="10" />
          </div>
          <span className="msg-source-label">{modelId || sourceMeta.label}</span>
          {toolCount > 0 && (
            <button
              type="button"
              className="msg-tool-count-badge"
              aria-label={`工具调用 ${toolCount}`}
              onClick={() => setToolsOpen((v) => !v)}
            >
              <Chevron open={toolsOpen} />
              工具调用 {toolCount}
            </button>
          )}
          <MessageTime value={msg.createdAt} />
          {isLatest && <span className="msg-latest-badge">最新</span>}
        </div>
        {text && <CollapsibleContent text={text} markdown />}
        {toolsOpen && toolCount > 0 && (
          <div className="msg-tool-inline-list">
            {tools!.map((tool) => (
              <ToolMessage key={tool.id} msg={tool} embedded />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function basename(p: string) {
  const segs = p.replace(/\/+$/, "").split("/");
  return segs[segs.length - 1] || p;
}

function ToolMessage({
  msg,
  isLatest,
  className,
  embedded = false,
}: {
  msg: SessionMessage;
  isLatest?: boolean;
  className?: string;
  embedded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasContent = msg.contentText.trim().length > 0;
  const label = msg.toolName || "工具";
  const summary = msg.filePaths.length > 0
    ? msg.filePaths.map(basename).join(", ")
    : msg.kind.replace(/_/g, " ");

  return (
    <div className={clsx("msg-card msg-tool-card", embedded && "is-embedded", isLatest && "is-latest", className)}>
      <div className="msg-block msg-tool">
        <button
          type="button"
          className="msg-tool-summary"
          onClick={() => hasContent && setOpen((v) => !v)}
        >
          {hasContent && <Chevron open={open} />}
          <span className="msg-tool-name">{label}</span>
          <span className="msg-tool-summary-path">{summary}</span>
          <MessageTime value={msg.createdAt} />
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

function isHiddenToolMessage(msg: SessionMessage) {
  return msg.role === "tool";
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

  if (msg.kind === "selection_context" || msg.kind === "file_context" || msg.kind === "memory_context") {
    return hasText;
  }

  return false;
}

type TranscriptItem =
  | {
      id: string;
      kind: "message";
      msg: SessionMessage;
      contexts: SessionMessage[];
      tools: SessionMessage[];
    }
  | {
      id: string;
      kind: "tools";
      tools: SessionMessage[];
    };

function buildTranscriptItems(messages: SessionMessage[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let currentMessageItem: Extract<TranscriptItem, { kind: "message" }> | null = null;
  let currentToolItem: Extract<TranscriptItem, { kind: "tools" }> | null = null;

  for (const msg of messages) {
    if (msg.kind === "selection_context" || msg.kind === "file_context" || msg.kind === "memory_context") {
      if (currentMessageItem?.msg.role === "user") {
        currentMessageItem.contexts.push(msg);
        continue;
      }
    }

    if (isHiddenToolMessage(msg)) {
      if (currentMessageItem?.msg.role === "assistant") {
        currentMessageItem.tools.push(msg);
        continue;
      }

      if (!currentToolItem) {
        currentToolItem = {
          id: `tools:${msg.id}`,
          kind: "tools",
          tools: [],
        };
        items.push(currentToolItem);
      }
      currentToolItem.tools.push(msg);
      continue;
    }

    currentMessageItem = {
      id: msg.id,
      kind: "message",
      msg,
      contexts: [],
      tools: [],
    };
    currentToolItem = null;
    items.push(currentMessageItem);
  }

  return items;
}

function getLastPrimaryMessageId(items: TranscriptItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "message") {
      return item.msg.id;
    }
  }

  return null;
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
  const transcriptItems = buildTranscriptItems(renderableMessages);
  const lastRenderableMessageId = getLastPrimaryMessageId(transcriptItems);
  const shouldChunk = transcriptItems.length > LONG_TRANSCRIPT_THRESHOLD;
  const initialVisibleStart = shouldChunk
    ? Math.max(transcriptItems.length - INITIAL_RENDER_COUNT, 0)
    : 0;
  const visibleItems = shouldChunk
    ? transcriptItems.slice(visibleStart)
    : transcriptItems;

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

  function renderTranscriptItem(item: TranscriptItem, index: number) {
    if (item.kind === "tools") {
      const shouldStagger = isContentRevealing && index < STAGGER_REVEAL_COUNT;
      return (
        <ToolActionBlock
          key={item.id}
          tools={item.tools}
          sourceMeta={sourceMeta!}
          modelId={contentDetail?.modelId}
          className={shouldStagger ? "is-stagger-enter" : undefined}
        />
      );
    }

    const { msg, contexts, tools } = item;
    const isLatest = msg.id === lastRenderableMessageId;
    const shouldStagger = isContentRevealing && index < STAGGER_REVEAL_COUNT;
    const messageProps = {
      msg,
      contexts,
      tools,
      isLatest,
      className: shouldStagger ? "is-stagger-enter" : undefined,
    };

    switch (msg.role) {
      case "user":
        return <UserMessage key={msg.id} {...messageProps} />;
      case "assistant":
        return <AssistantMessage key={msg.id} {...messageProps} sourceMeta={sourceMeta!} modelId={contentDetail?.modelId} />;
      default:
        return null;
    }
  }

  return (
    <section
      ref={containerRef}
      className={clsx(
        "session-detail",
        "is-terminal-theme",
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
            {visibleItems.map((item, index) => renderTranscriptItem(item, index))}
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
