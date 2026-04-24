import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionDetail } from "./SessionDetail";

describe("SessionDetail", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return 640;
      },
    });

    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return 400;
      },
    });
  });

  it("renders assistant replies and tool/file summaries", async () => {
    render(
      <SessionDetail
        detail={{
          id: "session:codex:abc",
          sourceId: "codex",
          title: "Codex: OmniTrace",
          updatedAt: "2026-04-21T10:00:00Z",
          startedAt: "2026-04-21T09:58:00Z",
          endedAt: "2026-04-21T10:00:00Z",
          projectName: "OmniTrace",
          projectPath: "/Users/test/workspace/OmniTrace",
          messageCount: 4,
          preview: "请优化详情面板",
          fileSize: 0,
          modelId: "",
          messages: [
            {
              id: "message:1",
              role: "user",
              kind: "message",
              contentText: "请优化详情面板",
              createdAt: "2026-04-21T09:58:30Z",
              filePaths: [],
            },
            {
              id: "message:2",
              role: "assistant",
              kind: "message",
              contentText: "我先查看当前详情面板的结构。",
              createdAt: "2026-04-21T09:58:45Z",
              filePaths: [],
            },
            {
              id: "message:3",
              role: "tool",
              kind: "tool_call",
              toolName: "Read",
              contentText: "读取文件",
              createdAt: "2026-04-21T09:58:50Z",
              filePaths: ["src/features/sessions/SessionDetail.tsx"],
            },
            {
              id: "message:4",
              role: "tool",
              kind: "file_summary",
              contentText: "修改了 2 个文件",
              createdAt: "2026-04-21T09:59:10Z",
              filePaths: ["src/App.tsx", "src/styles.css"],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("我先查看当前详情面板的结构。")).toBeInTheDocument();
    expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("SessionDetail.tsx")).toBeInTheDocument();
    expect(screen.getByText("App.tsx, styles.css")).toBeInTheDocument();

    const user = userEvent.setup();
    const toolButtons = screen.getAllByRole("button");
    await user.click(toolButtons[1]!);

    expect(screen.getByText("修改了 2 个文件")).toBeInTheDocument();
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
    expect(screen.getByText("src/styles.css")).toBeInTheDocument();
  });

  it("renders markdown replies in a compact TUI-like flow", () => {
    render(
      <SessionDetail
        detail={{
          id: "session:codex:markdown",
          sourceId: "codex",
          title: "Codex: OmniTrace",
          updatedAt: "2026-04-21T10:00:00Z",
          startedAt: "2026-04-21T09:58:00Z",
          endedAt: "2026-04-21T10:00:00Z",
          projectName: "OmniTrace",
          projectPath: "/Users/test/workspace/OmniTrace",
          messageCount: 1,
          preview: "compact markdown",
          fileSize: 0,
          modelId: "",
          messages: [
            {
              id: "message:markdown",
              role: "assistant",
              kind: "message",
              contentText: [
                "# 输出格式",
                "",
                "整体风格接近终端 TUI。",
                "",
                "- 段落不换行",
                "- 标题转为加粗",
              ].join("\n"),
              createdAt: "2026-04-21T09:58:30Z",
              filePaths: [],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("输出格式").tagName).toBe("STRONG");
    expect(screen.getByText("输出格式")).toHaveClass("md-flow-block");
    expect(screen.getByText("输出格式").closest(".md-compact")).toBeInTheDocument();
    expect(screen.getByText("整体风格接近终端 TUI。")).toHaveClass("md-flow-block");
    expect(screen.getByText(/段落不换行/).parentElement).toHaveClass("md-flow-block");
    expect(screen.getByText(/段落不换行/)).toHaveClass("md-list-item");
    expect(screen.getByText(/标题转为加粗/)).toHaveClass("md-list-item");
  });

  it("scrolls the detail pane to the latest message when a session loads", () => {
    render(
      <SessionDetail
        detail={{
          id: "session:claude:abc",
          sourceId: "claude_code",
          title: "Claude: OmniTrace",
          updatedAt: "2026-04-21T10:00:00Z",
          startedAt: "2026-04-21T09:58:00Z",
          endedAt: "2026-04-21T10:00:00Z",
          projectName: "OmniTrace",
          projectPath: "/Users/test/workspace/OmniTrace",
          messageCount: 2,
          preview: "hello",
          fileSize: 0,
          modelId: "",
          messages: [
            {
              id: "message:1",
              role: "user",
              kind: "message",
              contentText: "hello",
              createdAt: "2026-04-21T09:58:30Z",
              filePaths: [],
            },
            {
              id: "message:2",
              role: "assistant",
              kind: "message",
              contentText: "world",
              createdAt: "2026-04-21T09:59:00Z",
              filePaths: [],
            },
          ],
        }}
      />,
    );

    const detailPane = screen.getByLabelText("Session detail");
    expect(detailPane.scrollTop).toBe(640);
  });

  it("virtualizes long transcripts and keeps the newest messages in view", () => {
    render(
      <SessionDetail
        detail={{
          id: "session:codex:long",
          sourceId: "codex",
          title: "Codex: OmniTrace",
          updatedAt: "2026-04-21T10:30:00Z",
          startedAt: "2026-04-21T09:00:00Z",
          endedAt: "2026-04-21T10:30:00Z",
          projectName: "OmniTrace",
          projectPath: "/Users/test/workspace/OmniTrace",
          messageCount: 240,
          preview: "message 239",
          fileSize: 0,
          modelId: "",
          messages: Array.from({ length: 240 }, (_, index) => ({
            id: `message:${index}`,
            role: "user" as const,
            kind: "message" as const,
            contentText: `message ${index}`,
            createdAt: `2026-04-21T09:${String(index % 60).padStart(2, "0")}:00Z`,
            filePaths: [],
          })),
        }}
      />,
    );

    expect(screen.queryByText("message 0")).not.toBeInTheDocument();
    expect(screen.getByText("message 239")).toBeInTheDocument();
  });

  it("loads older messages when scrolling near the top of a long transcript", () => {
    render(
      <SessionDetail
        detail={{
          id: "session:codex:long",
          sourceId: "codex",
          title: "Codex: OmniTrace",
          updatedAt: "2026-04-21T10:30:00Z",
          startedAt: "2026-04-21T09:00:00Z",
          endedAt: "2026-04-21T10:30:00Z",
          projectName: "OmniTrace",
          projectPath: "/Users/test/workspace/OmniTrace",
          messageCount: 240,
          preview: "message 239",
          fileSize: 0,
          modelId: "",
          messages: Array.from({ length: 240 }, (_, index) => ({
            id: `message:${index}`,
            role: "user" as const,
            kind: "message" as const,
            contentText: `message ${index}`,
            createdAt: `2026-04-21T09:${String(index % 60).padStart(2, "0")}:00Z`,
            filePaths: [],
          })),
        }}
      />,
    );

    const detailPane = screen.getByLabelText("Session detail");
    detailPane.scrollTop = 0;
    fireEvent.scroll(detailPane);

    expect(screen.getByText("message 60")).toBeInTheDocument();
    expect(screen.queryByText("message 0")).not.toBeInTheDocument();
  });

  it("enters a brief reveal state when fresh detail content mounts", () => {
    vi.useFakeTimers();

    render(
      <SessionDetail
        detail={{
          id: "session:codex:reveal",
          sourceId: "codex",
          title: "Codex: OmniTrace",
          updatedAt: "2026-04-21T10:00:00Z",
          startedAt: "2026-04-21T09:58:00Z",
          endedAt: "2026-04-21T10:00:00Z",
          projectName: "OmniTrace",
          projectPath: "/Users/test/workspace/OmniTrace",
          messageCount: 2,
          preview: "hello",
          fileSize: 0,
          modelId: "",
          messages: [
            {
              id: "message:1",
              role: "assistant",
              kind: "message",
              contentText: "hello",
              createdAt: "2026-04-21T09:58:30Z",
              filePaths: [],
            },
            {
              id: "message:2",
              role: "tool",
              kind: "tool_call",
              contentText: "read file",
              toolName: "Read",
              createdAt: "2026-04-21T09:59:00Z",
              filePaths: ["src/App.tsx"],
            },
          ],
        }}
      />,
    );

    const detailPane = screen.getByLabelText("Session detail");
    expect(detailPane).toHaveClass("is-content-revealing");

    act(() => {
      vi.advanceTimersByTime(420);
    });

    expect(detailPane).not.toHaveClass("is-content-revealing");
  });

  it("does not retrigger title sync or stage enter when loading resolves into fresh detail", () => {
    vi.useFakeTimers();

    const { rerender } = render(
      <SessionDetail
        detail={{
          id: "session:codex:old",
          sourceId: "codex",
          title: "Codex: Old",
          updatedAt: "2026-04-21T10:00:00Z",
          startedAt: "2026-04-21T09:58:00Z",
          endedAt: "2026-04-21T10:00:00Z",
          projectName: "Old",
          projectPath: "/Users/test/workspace/Old",
          messageCount: 1,
          preview: "old",
          fileSize: 0,
          modelId: "",
          messages: [
            {
              id: "message:old",
              role: "assistant",
              kind: "message",
              contentText: "old",
              createdAt: "2026-04-21T09:58:30Z",
              filePaths: [],
            },
          ],
        }}
        isLoading
        pendingSession={{
          title: "Codex: New",
          projectName: "New",
          sourceId: "codex",
        }}
      />,
    );

    rerender(
      <SessionDetail
        detail={{
          id: "session:codex:new",
          sourceId: "codex",
          title: "Codex: New",
          updatedAt: "2026-04-21T10:01:00Z",
          startedAt: "2026-04-21T09:59:00Z",
          endedAt: "2026-04-21T10:01:00Z",
          projectName: "New",
          projectPath: "/Users/test/workspace/New",
          messageCount: 1,
          preview: "new",
          fileSize: 0,
          modelId: "",
          messages: [
            {
              id: "message:new",
              role: "assistant",
              kind: "message",
              contentText: "new",
              createdAt: "2026-04-21T10:00:30Z",
              filePaths: [],
            },
          ],
        }}
        pendingSession={{
          title: "Codex: New",
          projectName: "New",
          sourceId: "codex",
        }}
      />,
    );

    const detailPane = screen.getByLabelText("Session detail");
    expect(detailPane).toHaveClass("is-content-revealing");
    expect(detailPane).not.toHaveClass("is-title-syncing");
    expect(detailPane).not.toHaveClass("is-detail-entering");
  });
});
