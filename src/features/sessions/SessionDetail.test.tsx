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

  it("renders tool/file summaries behind the owning message card", async () => {
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
              toolName: "exec_command",
              contentText: "pnpm vitest run",
              createdAt: "2026-04-21T09:58:48Z",
              filePaths: [],
            },
            {
              id: "message:4",
              role: "tool",
              kind: "tool_call",
              toolName: "Read",
              contentText: "读取文件",
              createdAt: "2026-04-21T09:58:50Z",
              filePaths: ["src/features/sessions/SessionDetail.tsx"],
            },
            {
              id: "message:5",
              role: "tool",
              kind: "file_summary",
              contentText: "修改了 2 个文件",
              createdAt: "2026-04-21T09:59:10Z",
              filePaths: ["src/App.tsx", "src/styles.css"],
            },
            {
              id: "message:6",
              role: "assistant",
              kind: "message",
              contentText: "接下来我会运行测试。",
              createdAt: "2026-04-21T09:59:20Z",
              filePaths: [],
            },
            {
              id: "message:7",
              role: "tool",
              kind: "tool_call",
              toolName: "write_stdin",
              contentText: "输入确认",
              createdAt: "2026-04-21T09:59:30Z",
              filePaths: [],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("我先查看当前详情面板的结构。")).toBeInTheDocument();
    expect(screen.getByText("接下来我会运行测试。")).toBeInTheDocument();
    expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
    expect(screen.queryByText("exec_command")).not.toBeInTheDocument();
    expect(screen.queryByText("pnpm vitest run")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "显示工具调用 4" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "工具调用 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "工具调用 1" })).toBeInTheDocument();
    expect(screen.queryByText("Read")).not.toBeInTheDocument();
    expect(screen.queryByText("SessionDetail.tsx")).not.toBeInTheDocument();
    expect(screen.queryByText("App.tsx, styles.css")).not.toBeInTheDocument();
    expect(screen.queryByText("write_stdin")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "工具调用 3" }));
    expect(screen.getByText("exec_command")).toBeInTheDocument();
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("SessionDetail.tsx")).toBeInTheDocument();
    expect(screen.getByText("App.tsx, styles.css")).toBeInTheDocument();
    expect(screen.queryByText("write_stdin")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /exec_command/ }));
    expect(screen.getByText("pnpm vitest run")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /App\.tsx, styles\.css/ }));

    expect(screen.getByText("修改了 2 个文件")).toBeInTheDocument();
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
    expect(screen.getByText("src/styles.css")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "工具调用 1" }));
    expect(screen.getByText("write_stdin")).toBeInTheDocument();
  });

  it("renders Claude tool-only turns as a separate action block instead of inside the user message", async () => {
    render(
      <SessionDetail
        detail={{
          id: "session:claude:tool-only",
          sourceId: "claude_code",
          title: "Claude: OmniTrace",
          updatedAt: "2026-04-21T10:00:00Z",
          startedAt: "2026-04-21T09:58:00Z",
          endedAt: "2026-04-21T10:00:00Z",
          projectName: "OmniTrace",
          projectPath: "/Users/test/workspace/OmniTrace",
          messageCount: 4,
          preview: "还是加一个判断吧",
          fileSize: 0,
          modelId: "",
          messages: [
            {
              id: "message:1",
              role: "user",
              kind: "message",
              contentText: "还是加一个判断吧",
              createdAt: "2026-04-21T09:58:30Z",
              filePaths: [],
            },
            {
              id: "message:2",
              role: "tool",
              kind: "tool_call",
              toolName: "Edit",
              contentText: "编辑 Java 文件",
              createdAt: "2026-04-21T09:58:40Z",
              filePaths: ["MgtIncomeRecordCqqRollingMatchHandler.java"],
            },
            {
              id: "message:3",
              role: "tool",
              kind: "file_summary",
              contentText: "修改了 1 个文件",
              createdAt: "2026-04-21T09:58:45Z",
              filePaths: ["MgtIncomeRecordCqqRollingMatchHandler.java"],
            },
            {
              id: "message:4",
              role: "assistant",
              kind: "message",
              contentText: "已加回。现在两层都有防护。",
              createdAt: "2026-04-21T09:59:00Z",
              filePaths: [],
            },
          ],
        }}
      />,
    );

    const userCard = screen.getByText("还是加一个判断吧").closest(".msg-user-card");
    expect(userCard).toBeInTheDocument();
    expect(userCard).not.toHaveTextContent("工具调用 2");
    expect(screen.getByText(/Claude · 执行动作/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "工具调用 2" })).toBeInTheDocument();
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
  });

  it("shows Beijing timestamps on visible transcript records", () => {
    render(
      <SessionDetail
        detail={{
          id: "session:codex:time",
          sourceId: "codex",
          title: "Codex: OmniTrace",
          updatedAt: "2026-04-21T10:00:00Z",
          startedAt: "2026-04-21T09:58:00Z",
          endedAt: "2026-04-21T10:00:00Z",
          projectName: "OmniTrace",
          projectPath: "/Users/test/workspace/OmniTrace",
          messageCount: 3,
          preview: "什么时候发生的",
          fileSize: 0,
          modelId: "",
          messages: [
            {
              id: "message:1",
              role: "user",
              kind: "message",
              contentText: "什么时候发生的",
              createdAt: "2026-04-21T09:58:30Z",
              filePaths: [],
            },
            {
              id: "message:2",
              role: "assistant",
              kind: "message",
              contentText: "我会显示时间。",
              createdAt: "2026-04-21T09:59:20Z",
              filePaths: [],
            },
            {
              id: "message:3",
              role: "tool",
              kind: "tool_call",
              toolName: "Read",
              contentText: "读取文件",
              createdAt: "2026-04-21T10:00:00Z",
              filePaths: [],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("2026-04-21 17:58")).toBeInTheDocument();
    expect(screen.getByText("2026-04-21 17:59")).toBeInTheDocument();
  });

  it("renders Claude selected IDE lines as compact context under the related user message", async () => {
    render(
      <SessionDetail
        detail={{
          id: "session:claude:selection",
          sourceId: "claude_code",
          title: "Claude: OmniTrace",
          updatedAt: "2026-04-21T10:00:00Z",
          startedAt: "2026-04-21T09:58:00Z",
          endedAt: "2026-04-21T10:00:00Z",
          projectName: "OmniTrace",
          projectPath: "/Users/test/workspace/OmniTrace",
          messageCount: 2,
          preview: "还是加一个判断吧",
          fileSize: 0,
          modelId: "",
          messages: [
            {
              id: "message:1",
              role: "user",
              kind: "message",
              contentText: "还是加一个判断吧",
              createdAt: "2026-04-21T09:58:30Z",
              filePaths: [],
            },
            {
              id: "message:2",
              role: "system",
              kind: "selection_context",
              toolName: "IntelliJ IDEA",
              contentText: [
                "Selected 1 lines from src/Handler.java in IntelliJ IDEA",
                "stepDays",
              ].join("\n"),
              createdAt: "2026-04-21T09:58:31Z",
              filePaths: ["src/Handler.java"],
            },
          ],
        }}
      />,
    );

    const userCard = screen.getByText("还是加一个判断吧").closest(".msg-user-card");
    expect(userCard).toBeInTheDocument();
    expect(userCard).toHaveTextContent("选区上下文");
    expect(userCard).toHaveTextContent("Selected 1 lines from src/Handler.java in IntelliJ IDEA");
    expect(userCard).not.toHaveTextContent("stepDays");
    expect(screen.queryByRole("button", { name: /工具调用/ })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /选区上下文/ }));
    expect(userCard).toHaveTextContent("stepDays");
  });

  it("renders Claude @file references and loaded memories as compact context under the related user message", async () => {
    render(
      <SessionDetail
        detail={{
          id: "session:claude:file-reference",
          sourceId: "claude_code",
          title: "Claude: OmniTrace",
          updatedAt: "2026-04-21T10:00:00Z",
          startedAt: "2026-04-21T09:58:00Z",
          endedAt: "2026-04-21T10:00:00Z",
          projectName: "OmniTrace",
          projectPath: "/Users/test/workspace/OmniTrace",
          messageCount: 3,
          preview: "@src/Handler.java#L101-122 请解释 stepDays",
          fileSize: 0,
          modelId: "",
          messages: [
            {
              id: "message:1",
              role: "user",
              kind: "message",
              contentText: "@src/Handler.java#L101-122 请解释 stepDays",
              createdAt: "2026-04-21T09:58:30Z",
              filePaths: [],
            },
            {
              id: "message:2",
              role: "system",
              kind: "file_context",
              contentText: [
                "Read src/Handler.java (22 lines)",
                "LocalDate cursorStart = param.getStartDate();",
              ].join("\n"),
              createdAt: "2026-04-21T09:58:31Z",
              filePaths: ["src/Handler.java"],
            },
            {
              id: "message:3",
              role: "system",
              kind: "memory_context",
              contentText: "Loaded finance-center/CLAUDE.md",
              createdAt: "2026-04-21T09:58:32Z",
              filePaths: ["finance-center/CLAUDE.md"],
            },
          ],
        }}
      />,
    );

    const userCard = screen.getByText("@src/Handler.java#L101-122 请解释 stepDays").closest(".msg-user-card");
    expect(userCard).toBeInTheDocument();
    expect(userCard).toHaveTextContent("文件上下文");
    expect(userCard).toHaveTextContent("Read src/Handler.java (22 lines)");
    expect(userCard).not.toHaveTextContent("LocalDate cursorStart");
    expect(userCard).toHaveTextContent("项目记忆");
    expect(userCard).toHaveTextContent("Loaded finance-center/CLAUDE.md");
    expect(screen.queryByRole("button", { name: /工具调用/ })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /文件上下文/ }));
    expect(userCard).toHaveTextContent("LocalDate cursorStart");
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

  it("uses the terminal-inspired detail theme for transcripts", () => {
    render(
      <SessionDetail
        detail={{
          id: "session:codex:theme",
          sourceId: "codex",
          title: "Codex: OmniTrace",
          updatedAt: "2026-04-21T10:00:00Z",
          startedAt: "2026-04-21T09:58:00Z",
          endedAt: "2026-04-21T10:00:00Z",
          projectName: "OmniTrace",
          projectPath: "/Users/test/workspace/OmniTrace",
          messageCount: 1,
          preview: "terminal theme",
          fileSize: 0,
          modelId: "",
          messages: [
            {
              id: "message:theme",
              role: "assistant",
              kind: "message",
              contentText: "terminal theme",
              createdAt: "2026-04-21T09:58:30Z",
              filePaths: [],
            },
          ],
        }}
      />,
    );

    expect(screen.getByLabelText("Session detail")).toHaveClass("is-terminal-theme");
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
