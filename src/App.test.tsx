import { StrictMode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/tauri", () => ({
  scanSources: vi.fn(),
  getSessionDetail: vi.fn(),
  probeTokenUsageSources: vi.fn(),
}));

import App from "./App";
import { getSessionDetail, probeTokenUsageSources, scanSources } from "./lib/tauri";
import { useSessionStore } from "./stores/useSessionStore";

describe("App", () => {
  const getSessionDetailMock = vi.mocked(getSessionDetail);
  const probeTokenUsageSourcesMock = vi.mocked(probeTokenUsageSources);
  const scanSourcesMock = vi.mocked(scanSources);

  beforeEach(() => {
    useSessionStore.setState({
      sessions: [],
      selectedId: null,
      detail: null,
      detailLoading: false,
      sourceFilter: "all",
      projectFilter: "all",
      timeRange: "7d",
      lastScannedAt: null,
    });
    scanSourcesMock.mockResolvedValue([]);
    getSessionDetailMock.mockResolvedValue(null);
    probeTokenUsageSourcesMock.mockResolvedValue({
      filesScanned: 0,
      recordsScanned: 0,
      recordsWithUsage: 0,
      days: [],
      hours: [],
      byModel: [],
      byModelByDay: [],
      byModelByHour: [],
      samples: [],
    });
  });

  function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;

    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    return { promise, resolve, reject };
  }

  it("renders the OmniTrace shell header with the scanned empty state", async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    expect(screen.getByRole("heading", { name: "OmniTrace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "↻ 扫描" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "◷ Token 探测" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "全部" })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Codex" })).toBeInTheDocument();
    expect(await screen.findByText("未找到符合条件的会话")).toBeInTheDocument();

    await waitFor(() => {
      expect(scanSourcesMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText(/0 个会话/)).toBeInTheDocument();

    expect(
      screen.queryByRole("button", { name: "Codex: project-a" }),
    ).not.toBeInTheDocument();
  });

  it("opens token usage as a standalone view and returns to sessions", async () => {
    probeTokenUsageSourcesMock.mockResolvedValue({
      filesScanned: 3,
      recordsScanned: 20,
      recordsWithUsage: 4,
      days: [
        {
          date: "2026-04-20",
          sourceId: "",
          modelId: "",
          inputTokens: 1100,
          outputTokens: 600,
          cacheCreationTokens: 30,
          cacheReadTokens: 150,
          cacheTokens: 180,
          reasoningTokens: 90,
          totalTokens: 1970,
          recordsWithUsage: 2,
        },
        {
          date: "2026-04-01",
          sourceId: "",
          modelId: "",
          inputTokens: 20,
          outputTokens: 10,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cacheTokens: 0,
          reasoningTokens: 0,
          totalTokens: 30,
          recordsWithUsage: 1,
        },
      ],
      byModel: [
        {
          date: "",
          sourceId: "claude_code",
          modelId: "claude-sonnet-4",
          inputTokens: 100,
          outputTokens: 200,
          cacheCreationTokens: 30,
          cacheReadTokens: 40,
          cacheTokens: 70,
          reasoningTokens: 90,
          totalTokens: 460,
          recordsWithUsage: 1,
        },
        {
          date: "",
          sourceId: "codex",
          modelId: "gpt-5.4-codex",
          inputTokens: 1000,
          outputTokens: 400,
          cacheCreationTokens: 0,
          cacheReadTokens: 110,
          cacheTokens: 110,
          reasoningTokens: 0,
          totalTokens: 1510,
          recordsWithUsage: 1,
        },
      ],
      byModelByDay: [
        {
          date: "2026-04-20",
          sourceId: "claude_code",
          modelId: "claude-sonnet-4",
          inputTokens: 100,
          outputTokens: 200,
          cacheCreationTokens: 30,
          cacheReadTokens: 40,
          cacheTokens: 70,
          reasoningTokens: 90,
          totalTokens: 460,
          recordsWithUsage: 1,
        },
        {
          date: "2026-04-20",
          sourceId: "codex",
          modelId: "gpt-5.4-codex",
          inputTokens: 1000,
          outputTokens: 400,
          cacheCreationTokens: 0,
          cacheReadTokens: 110,
          cacheTokens: 110,
          reasoningTokens: 0,
          totalTokens: 1510,
          recordsWithUsage: 1,
        },
      ],
      hours: [
        {
          date: "2026-04-20 05:00",
          sourceId: "",
          modelId: "",
          inputTokens: 1000,
          outputTokens: 400,
          cacheCreationTokens: 0,
          cacheReadTokens: 110,
          cacheTokens: 110,
          reasoningTokens: 0,
          totalTokens: 1510,
          recordsWithUsage: 1,
        },
        {
          date: "2026-04-20 09:00",
          sourceId: "",
          modelId: "",
          inputTokens: 100,
          outputTokens: 200,
          cacheCreationTokens: 30,
          cacheReadTokens: 40,
          cacheTokens: 70,
          reasoningTokens: 90,
          totalTokens: 460,
          recordsWithUsage: 1,
        },
      ],
      byModelByHour: [
        {
          date: "2026-04-20 09:00",
          sourceId: "claude_code",
          modelId: "claude-sonnet-4",
          inputTokens: 100,
          outputTokens: 200,
          cacheCreationTokens: 30,
          cacheReadTokens: 40,
          cacheTokens: 70,
          reasoningTokens: 90,
          totalTokens: 460,
          recordsWithUsage: 1,
        },
        {
          date: "2026-04-20 05:00",
          sourceId: "codex",
          modelId: "gpt-5.4-codex",
          inputTokens: 1000,
          outputTokens: 400,
          cacheCreationTokens: 0,
          cacheReadTokens: 110,
          cacheTokens: 110,
          reasoningTokens: 0,
          totalTokens: 1510,
          recordsWithUsage: 1,
        },
      ],
      samples: [],
    });

    render(<App />);

    expect(await screen.findByText("未找到符合条件的会话")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "◷ Token 探测" }));

    expect(await screen.findByText("Token Usage 探测")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← 返回会话" })).toBeInTheDocument();
    expect(screen.queryByText("未找到符合条件的会话")).not.toBeInTheDocument();
    expect(screen.getByText("3 个文件 · 20 条记录 · 4 条 usage")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claude Code" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Codex" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "claude-sonnet-4" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "gpt-5.4-codex" })).toBeInTheDocument();
    expect(screen.getByLabelText("按小时 token 消耗折线图")).toBeInTheDocument();
    expect(screen.getAllByText("00:00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("05:00").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle(/2026-04-20 00:00[\s\S]*总量: 0 tokens/).length).toBeGreaterThan(0);
    expect(screen.getAllByTitle(/2026-04-20 05:00[\s\S]*总量: 1\.5k tokens/).length).toBeGreaterThan(0);
    expect(screen.getByText("2k")).toBeInTheDocument();
    expect(screen.getByText("输入")).toBeInTheDocument();
    expect(screen.getByText("1.1k tokens")).toBeInTheDocument();
    expect(screen.getByText("输出")).toBeInTheDocument();
    expect(screen.getByText("600 tokens")).toBeInTheDocument();
    expect(screen.getByText("缓存")).toBeInTheDocument();
    expect(screen.getByText("180 tokens")).toBeInTheDocument();
    expect(screen.getByText("思考")).toBeInTheDocument();
    expect(screen.getByText("90 tokens")).toBeInTheDocument();
    expect(screen.getByText("codex · gpt-5.4-codex")).toBeInTheDocument();
    expect(screen.getByText("claude_code · claude-sonnet-4")).toBeInTheDocument();
    expect(screen.getAllByText("1.5k tokens").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Codex" }));
    expect(screen.getByText("1.5k")).toBeInTheDocument();
    expect(screen.queryByText("claude_code · claude-sonnet-4")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "gpt-5.4-codex" }));
    expect(screen.getByRole("button", { name: "gpt-5.4-codex" })).toHaveClass("is-selected");
    await user.click(within(screen.getByLabelText("Token usage source filter")).getByRole("button", { name: "全部" }));

    await user.click(screen.getByRole("button", { name: "最近 7 天" }));
    expect(screen.getByText("2026-04-20")).toBeInTheDocument();
    expect(screen.getByText("2k tokens")).toBeInTheDocument();
    expect(screen.getByText("1.1k tokens")).toBeInTheDocument();
    expect(screen.getByText("600 tokens")).toBeInTheDocument();
    expect(screen.getByText("180 tokens")).toBeInTheDocument();
    expect(screen.getByText("90 tokens")).toBeInTheDocument();
    expect(screen.getByLabelText("按天 token 消耗柱状图")).toBeInTheDocument();

    expect(screen.queryByText("2026-04-01")).not.toBeInTheDocument();

    await user.click(within(screen.getByLabelText("Token usage time range")).getByRole("button", { name: "全部" }));
    expect(screen.getByText("2026-04-01")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "← 返回会话" }));

    expect(await screen.findByText("未找到符合条件的会话")).toBeInTheDocument();
  });

  it("loads session detail on demand after scan selects a session", async () => {
    scanSourcesMock.mockResolvedValue([
      {
        id: "session:codex:abc",
        sourceId: "codex",
        title: "Codex: project-b",
        updatedAt: "2026-04-20T10:00:00Z",
        projectName: "project-b",
        projectPath: "/tmp/project-b",
        messageCount: 2,
        preview: "Open this session.",
        fileSize: 0,
        modelId: "",
      },
    ]);
    getSessionDetailMock.mockResolvedValue({
      id: "session:codex:abc",
      sourceId: "codex",
      title: "Codex: project-b",
      updatedAt: "2026-04-20T10:00:00Z",
      startedAt: "2026-04-20T09:55:00Z",
      endedAt: "2026-04-20T10:00:00Z",
      projectName: "project-b",
      projectPath: "/tmp/project-b",
      messageCount: 2,
      preview: "Open this session.",
      fileSize: 0,
      modelId: "",
      messages: [
        {
          id: "message:1",
          role: "user",
          kind: "message",
          contentText: "Open this session.",
          createdAt: "2026-04-20T09:56:00Z",
          filePaths: [],
        },
      ],
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: "Codex: project-b" })).toBeInTheDocument();

    await waitFor(() => {
      expect(getSessionDetailMock).toHaveBeenCalledWith("session:codex:abc");
      expect(screen.getAllByText("/tmp/project-b").length).toBeGreaterThan(0);
    });
  });

  it("shows a loading transition overlay while switching sessions", async () => {
    const secondDetailDeferred = createDeferred<Awaited<ReturnType<typeof getSessionDetail>>>();

    scanSourcesMock.mockResolvedValue([
      {
        id: "session:codex:aaa",
        sourceId: "codex",
        title: "Codex: project-a",
        updatedAt: "2026-04-20T10:00:00Z",
        projectName: "project-a",
        projectPath: "/tmp/project-a",
        messageCount: 2,
        preview: "First session.",
        fileSize: 0,
        modelId: "",
      },
      {
        id: "session:codex:bbb",
        sourceId: "codex",
        title: "Codex: project-b",
        updatedAt: "2026-04-20T11:00:00Z",
        projectName: "project-b",
        projectPath: "/tmp/project-b",
        messageCount: 2,
        preview: "Second session.",
        fileSize: 0,
        modelId: "",
      },
    ]);

    getSessionDetailMock.mockImplementation((id) => {
      if (id === "session:codex:aaa") {
        return Promise.resolve({
          id: "session:codex:aaa",
          sourceId: "codex",
          title: "Codex: project-a",
          updatedAt: "2026-04-20T10:00:00Z",
          startedAt: "2026-04-20T09:55:00Z",
          endedAt: "2026-04-20T10:00:00Z",
          projectName: "project-a",
          projectPath: "/tmp/project-a",
          messageCount: 1,
          preview: "First session.",
          fileSize: 0,
          modelId: "",
          messages: [
            {
              id: "message:a",
              role: "user",
              kind: "message",
              contentText: "First session.",
              createdAt: "2026-04-20T09:56:00Z",
              filePaths: [],
            },
          ],
        });
      }

      return secondDetailDeferred.promise;
    });

    render(<App />);

    expect((await screen.findAllByText("/tmp/project-a")).length).toBeGreaterThan(0);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Codex: project-b" }));

    const loadingStatus = screen.getByRole("status", { name: "Loading session detail" });
    expect(loadingStatus).toBeInTheDocument();
    expect(within(loadingStatus).getAllByText("project-b").length).toBeGreaterThan(0);
    expect(within(loadingStatus).getByText("Codex")).toBeInTheDocument();
    expect(screen.getAllByText("/tmp/project-a").length).toBeGreaterThan(0);

    secondDetailDeferred.resolve({
      id: "session:codex:bbb",
      sourceId: "codex",
      title: "Codex: project-b",
      updatedAt: "2026-04-20T11:00:00Z",
      startedAt: "2026-04-20T10:55:00Z",
      endedAt: "2026-04-20T11:00:00Z",
      projectName: "project-b",
      projectPath: "/tmp/project-b",
      messageCount: 1,
      preview: "Second session.",
      fileSize: 0,
      modelId: "",
      messages: [
        {
          id: "message:b",
          role: "assistant",
          kind: "message",
          contentText: "Second session ready.",
          createdAt: "2026-04-20T10:56:00Z",
          filePaths: [],
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getAllByText("/tmp/project-b").length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.queryByRole("status", { name: "Loading session detail" })).not.toBeInTheDocument();
    });
  });
});
