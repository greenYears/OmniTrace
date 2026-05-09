import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const eventMock = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  listen: vi.fn(),
}));
const windowMock = vi.hoisted(() => ({
  startDragging: vi.fn(),
  getCurrentWindow: vi.fn(),
}));

vi.mock("./lib/tauri", () => ({
  listSessions: vi.fn(),
  getSessionDetail: vi.fn(),
  getTokenReport: vi.fn(),
  deleteSession: vi.fn(),
  getScanStats: vi.fn(),
  scanAllData: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventMock.listen,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: windowMock.getCurrentWindow,
}));

import App, {
  buildHourlySeries,
  filterVisibleTokenDetailBuckets,
  getSmoothTokenLinePath,
  getTokenLineHoverIndex,
  getTokenLinePointX,
} from "./App";
import { getSessionDetail, getScanStats, listSessions, getTokenReport, scanAllData } from "./lib/tauri";
import { useSessionStore } from "./stores/useSessionStore";

describe("App", () => {
  const getSessionDetailMock = vi.mocked(getSessionDetail);
  const listSessionsMock = vi.mocked(listSessions);
  const getTokenReportMock = vi.mocked(getTokenReport);
  const getScanStatsMock = vi.mocked(getScanStats);
  const scanAllDataMock = vi.mocked(scanAllData);

  function getBeijingDateForTest(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const valueOf = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
    return `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}`;
  }

  beforeEach(() => {
    listSessionsMock.mockReset();
    getSessionDetailMock.mockReset();
    getTokenReportMock.mockReset();
    getScanStatsMock.mockReset();
    scanAllDataMock.mockReset();
    eventMock.listeners.clear();
    eventMock.listen.mockReset();
    eventMock.listen.mockImplementation((eventName, handler) => {
      eventMock.listeners.set(eventName, handler);
      return Promise.resolve(() => {
        eventMock.listeners.delete(eventName);
      });
    });
    windowMock.startDragging.mockReset();
    windowMock.startDragging.mockResolvedValue(undefined);
    windowMock.getCurrentWindow.mockReset();
    windowMock.getCurrentWindow.mockReturnValue({
      startDragging: windowMock.startDragging,
    });
    useSessionStore.setState({
      sessions: [],
      selectedId: null,
      detail: null,
      detailLoading: false,
      sourceFilter: "all",
      projectFilter: "all",
      detailRefreshKey: 0,
    });
    localStorage.setItem("omnitrace-auto-scan", "false");
    listSessionsMock.mockResolvedValue([]);
    getSessionDetailMock.mockResolvedValue(null);
    getTokenReportMock.mockResolvedValue(null);
    scanAllDataMock.mockResolvedValue({
      sessionCount: 0,
      messageCount: 0,
      filesScanned: 0,
      recordsScanned: 0,
      recordsWithUsage: 0,
      lastScannedAt: "2026-05-08T10:00:00",
    });
    getScanStatsMock.mockResolvedValue({
      sessionCount: 0,
      messageCount: 0,
      lastScannedAt: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("no longer renders scan progress in session view (moved to settings)", async () => {
    render(<App />);

    // Scan progress is now shown only in SettingsView, not in the session shell
    expect(eventMock.listeners.has("session-scan-progress")).toBe(false);
  });

  it("loads sessions from SQLite on mount", async () => {
    listSessionsMock.mockResolvedValue([
      {
        id: "session:codex:abc",
        sourceId: "codex",
        title: "Codex: project-b",
        updatedAt: "2026-04-27T10:00:00Z",
        projectName: "project-b",
        projectPath: "/tmp/project-b",
        messageCount: 2,
        preview: "Open this session.",
        fileSize: 0,
        modelId: "",
      },
    ]);

    render(<App />);

    await waitFor(() => {
      expect(listSessionsMock).toHaveBeenCalled();
    });
  });

  it("defaults session and token time ranges to today", async () => {
    render(<App />);

    expect(screen.getByRole("button", { name: "今天" })).toHaveClass("is-selected");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Token" }));

    expect(await screen.findByRole("button", { name: "今天" })).toHaveClass("is-selected");
  });

  it("filters session list from the top time range toolbar", async () => {
    listSessionsMock.mockResolvedValue([
      {
        id: "session:codex:today",
        sourceId: "codex",
        title: "Codex: today-project",
        updatedAt: new Date().toISOString(),
        projectName: "today-project",
        projectPath: "/tmp/today-project",
        messageCount: 2,
        preview: "Today session.",
        fileSize: 0,
        modelId: "",
      },
      {
        id: "session:codex:old",
        sourceId: "codex",
        title: "Codex: old-project",
        updatedAt: "2026-01-01T10:00:00Z",
        projectName: "old-project",
        projectPath: "/tmp/old-project",
        messageCount: 2,
        preview: "Old session.",
        fileSize: 0,
        modelId: "",
      },
    ]);

    render(<App />);

    expect(await screen.findByRole("button", { name: "Codex: today-project" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Codex: old-project" })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "全部" })[0]);

    expect(screen.getByRole("button", { name: "Codex: old-project" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "今天" }));

    expect(screen.getByRole("button", { name: "Codex: today-project" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Codex: old-project" })).not.toBeInTheDocument();
  });

  it("marks non-interactive titlebar areas as Tauri drag regions", async () => {
    const { container } = render(<App />);

    expect(container.querySelector(".app-sidebar-top")).toHaveAttribute("data-tauri-drag-region");
    expect(container.querySelector(".app-sidebar-logo")).toHaveAttribute("data-tauri-drag-region");
    expect(container.querySelector(".three-pane-shell")).toHaveAttribute("data-tauri-drag-region");
  });

  it("starts window dragging from session viewer blank space", () => {
    const { container } = render(<App />);

    fireEvent.pointerDown(container.querySelector(".three-pane-shell")!, { button: 0 });

    expect(windowMock.startDragging).toHaveBeenCalledTimes(1);
  });

  it("switches to token usage view and loads report", async () => {
    getTokenReportMock.mockResolvedValue({
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
      ],
      byModel: [],
      byModelByDay: [],
      hours: [],
      byModelByHour: [],
      samples: [],
    });

    render(<App />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Token" }));

    await waitFor(() => {
      expect(getTokenReportMock).toHaveBeenCalled();
    });

    expect(screen.getByText("3 个文件 · 20 条记录 · 4 条 usage")).toBeInTheDocument();
  });

  it("filters token usage from the top time range toolbar", async () => {
    getTokenReportMock.mockResolvedValue({
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
          date: "2026-01-01",
          sourceId: "",
          modelId: "",
          inputTokens: 200,
          outputTokens: 100,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cacheTokens: 0,
          reasoningTokens: 0,
          totalTokens: 300,
          recordsWithUsage: 1,
        },
      ],
      byModel: [
        {
          date: "",
          sourceId: "codex",
          modelId: "gpt-5",
          inputTokens: 1300,
          outputTokens: 700,
          cacheCreationTokens: 30,
          cacheReadTokens: 150,
          cacheTokens: 180,
          reasoningTokens: 90,
          totalTokens: 2270,
          recordsWithUsage: 3,
        },
      ],
      byModelByDay: [
        {
          date: "2026-04-20",
          sourceId: "codex",
          modelId: "gpt-5",
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
          date: "2026-01-01",
          sourceId: "codex",
          modelId: "gpt-5",
          inputTokens: 200,
          outputTokens: 100,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cacheTokens: 0,
          reasoningTokens: 0,
          totalTokens: 300,
          recordsWithUsage: 1,
        },
      ],
      hours: [],
      byModelByHour: [],
      samples: [],
    });

    render(<App />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Token" }));
    await screen.findByRole("button", { name: "Token" });
    await user.click(screen.getAllByRole("button", { name: "全部" })[0]);

    expect(await screen.findByText("2026-04-20")).toBeInTheDocument();
    expect(screen.getByText("2026-01-01")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "最近 30 天" }));

    expect(screen.getByText("2026-04-20")).toBeInTheDocument();
    expect(screen.queryByText("2026-01-01")).not.toBeInTheDocument();
  });

  it("uses an hourly line chart when token time range is under 24 hours", async () => {
    const today = getBeijingDateForTest();
    getTokenReportMock.mockResolvedValue({
      filesScanned: 3,
      recordsScanned: 20,
      recordsWithUsage: 4,
      days: [
        {
          date: today,
          sourceId: "",
          modelId: "",
          inputTokens: 300,
          outputTokens: 150,
          cacheCreationTokens: 20,
          cacheReadTokens: 30,
          cacheTokens: 50,
          reasoningTokens: 40,
          totalTokens: 540,
          recordsWithUsage: 2,
        },
      ],
      byModel: [
        {
          date: "",
          sourceId: "codex",
          modelId: "gpt-5",
          inputTokens: 300,
          outputTokens: 150,
          cacheCreationTokens: 20,
          cacheReadTokens: 30,
          cacheTokens: 50,
          reasoningTokens: 40,
          totalTokens: 540,
          recordsWithUsage: 2,
        },
      ],
      byModelByDay: [
        {
          date: today,
          sourceId: "codex",
          modelId: "gpt-5",
          inputTokens: 300,
          outputTokens: 150,
          cacheCreationTokens: 20,
          cacheReadTokens: 30,
          cacheTokens: 50,
          reasoningTokens: 40,
          totalTokens: 540,
          recordsWithUsage: 2,
        },
      ],
      hours: [
        {
          date: `${today} 09:00`,
          sourceId: "",
          modelId: "",
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: 10,
          cacheReadTokens: 10,
          cacheTokens: 20,
          reasoningTokens: 10,
          totalTokens: 180,
          recordsWithUsage: 1,
        },
        {
          date: `${today} 10:00`,
          sourceId: "",
          modelId: "",
          inputTokens: 200,
          outputTokens: 100,
          cacheCreationTokens: 10,
          cacheReadTokens: 20,
          cacheTokens: 30,
          reasoningTokens: 30,
          totalTokens: 360,
          recordsWithUsage: 1,
        },
      ],
      byModelByHour: [],
      samples: [],
    });

    render(<App />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Token" }));
    await user.click(await screen.findByRole("button", { name: "今天" }));

    expect(screen.getByLabelText("按小时 token 消耗曲线图")).toBeInTheDocument();
    expect(screen.queryByLabelText("按天 token 消耗柱状图")).not.toBeInTheDocument();
    expect(screen.getByText("按小时消耗")).toBeInTheDocument();
  });

  it("refreshes the loaded token report after a settings scan completes", async () => {
    const today = getBeijingDateForTest();
    const oldReport = {
      filesScanned: 3,
      recordsScanned: 20,
      recordsWithUsage: 1,
      days: [
        {
          date: today,
          sourceId: "",
          modelId: "",
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: 10,
          cacheReadTokens: 10,
          cacheTokens: 20,
          reasoningTokens: 10,
          totalTokens: 180,
          recordsWithUsage: 1,
        },
      ],
      byModel: [],
      byModelByDay: [],
      hours: [
        {
          date: `${today} 10:00`,
          sourceId: "",
          modelId: "",
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: 10,
          cacheReadTokens: 10,
          cacheTokens: 20,
          reasoningTokens: 10,
          totalTokens: 180,
          recordsWithUsage: 1,
        },
      ],
      byModelByHour: [],
      samples: [],
    };
    const newReport = {
      ...oldReport,
      recordsScanned: 22,
      recordsWithUsage: 2,
      days: [
        {
          date: today,
          sourceId: "",
          modelId: "",
          inputTokens: 300,
          outputTokens: 150,
          cacheCreationTokens: 20,
          cacheReadTokens: 30,
          cacheTokens: 50,
          reasoningTokens: 40,
          totalTokens: 540,
          recordsWithUsage: 2,
        },
      ],
      hours: [
        ...oldReport.hours,
        {
          date: `${today} 11:00`,
          sourceId: "",
          modelId: "",
          inputTokens: 200,
          outputTokens: 100,
          cacheCreationTokens: 10,
          cacheReadTokens: 20,
          cacheTokens: 30,
          reasoningTokens: 30,
          totalTokens: 360,
          recordsWithUsage: 1,
        },
      ],
    };
    getTokenReportMock
      .mockResolvedValueOnce(oldReport)
      .mockResolvedValueOnce(newReport);
    scanAllDataMock.mockResolvedValue({
      sessionCount: 1,
      messageCount: 3,
      filesScanned: 1,
      recordsScanned: 22,
      recordsWithUsage: 2,
      lastScannedAt: `${today}T11:25:00`,
    });

    render(<App />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Token" }));
    await user.click(await screen.findByRole("button", { name: "今天" }));

    expect(await screen.findByText(`${today} 10:00`)).toBeInTheDocument();
    expect(screen.queryByText(`${today} 11:00`)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "扫描全部数据" }));

    await waitFor(() => {
      expect(getTokenReportMock).toHaveBeenCalledTimes(2);
    });

    await user.click(screen.getByRole("button", { name: "Token" }));

    expect(await screen.findByText(`${today} 11:00`)).toBeInTheDocument();
    expect(screen.getByText(/22\s*条记录/)).toBeInTheDocument();
  });

  it("switches to settings view", async () => {
    render(<App />);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "设置" }));

    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
  });

  it("loads session detail on demand after scan selects a session", async () => {
    const todayIso = new Date().toISOString();
    listSessionsMock.mockResolvedValue([
      {
        id: "session:codex:abc",
        sourceId: "codex",
        title: "Codex: project-b",
        updatedAt: todayIso,
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
      updatedAt: "2026-04-27T10:00:00Z",
      startedAt: "2026-04-27T09:55:00Z",
      endedAt: "2026-04-27T10:00:00Z",
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
          createdAt: "2026-04-27T09:56:00Z",
          filePaths: [],
        },
      ],
    });

    render(<App />);

    await waitFor(() => {
      expect(getSessionDetailMock).toHaveBeenCalledWith("session:codex:abc");
      expect(screen.getAllByText("/tmp/project-b").length).toBeGreaterThan(0);
    });
  });

  it("reloads detail when the selected session is clicked again", async () => {
    const todayIso = new Date().toISOString();
    listSessionsMock.mockResolvedValue([
      {
        id: "session:codex:abc",
        sourceId: "codex",
        title: "Codex: project-b",
        updatedAt: todayIso,
        projectName: "project-b",
        projectPath: "/tmp/project-b",
        messageCount: 2,
        preview: "Open this session.",
        fileSize: 0,
        modelId: "",
      },
    ]);
    getSessionDetailMock
      .mockResolvedValueOnce({
        id: "session:codex:abc",
        sourceId: "codex",
        title: "Codex: project-b",
        updatedAt: "2026-04-27T10:00:00Z",
        startedAt: "2026-04-27T09:55:00Z",
        endedAt: "2026-04-27T10:00:00Z",
        projectName: "project-b",
        projectPath: "/tmp/project-b",
        messageCount: 2,
        preview: "Open this session.",
        fileSize: 0,
        modelId: "",
        messages: [
          {
            id: "message:old",
            role: "user",
            kind: "message",
            contentText: "旧会话内容",
            createdAt: "2026-04-27T09:56:00Z",
            filePaths: [],
          },
        ],
      })
      .mockResolvedValueOnce({
        id: "session:codex:abc",
        sourceId: "codex",
        title: "Codex: project-b",
        updatedAt: "2026-04-27T10:05:00Z",
        startedAt: "2026-04-27T09:55:00Z",
        endedAt: "2026-04-27T10:05:00Z",
        projectName: "project-b",
        projectPath: "/tmp/project-b",
        messageCount: 3,
        preview: "Open this session.",
        fileSize: 0,
        modelId: "",
        messages: [
          {
            id: "message:new",
            role: "assistant",
            kind: "message",
            contentText: "最新会话内容",
            createdAt: "2026-04-27T10:05:00Z",
            filePaths: [],
          },
        ],
      });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("旧会话内容")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Codex: project-b" }));

    await waitFor(() => {
      expect(getSessionDetailMock).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("最新会话内容")).toBeInTheDocument();
  });

  it("refreshes sessions and selected detail after a settings scan completes", async () => {
    const todayIso = new Date().toISOString();
    listSessionsMock
      .mockResolvedValueOnce([
        {
          id: "session:codex:abc",
          sourceId: "codex",
          title: "Codex: project-b",
          updatedAt: todayIso,
          projectName: "project-b",
          projectPath: "/tmp/project-b",
          messageCount: 2,
          preview: "Old preview.",
          fileSize: 0,
          modelId: "",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "session:codex:abc",
          sourceId: "codex",
          title: "Codex: project-b",
          updatedAt: todayIso,
          projectName: "project-b",
          projectPath: "/tmp/project-b",
          messageCount: 3,
          preview: "New preview.",
          fileSize: 0,
          modelId: "",
        },
      ]);
    getSessionDetailMock
      .mockResolvedValueOnce({
        id: "session:codex:abc",
        sourceId: "codex",
        title: "Codex: project-b",
        updatedAt: "2026-04-27T10:00:00Z",
        startedAt: "2026-04-27T09:55:00Z",
        endedAt: "2026-04-27T10:00:00Z",
        projectName: "project-b",
        projectPath: "/tmp/project-b",
        messageCount: 2,
        preview: "Old preview.",
        fileSize: 0,
        modelId: "",
        messages: [
          {
            id: "message:old",
            role: "user",
            kind: "message",
            contentText: "扫描前的内容",
            createdAt: "2026-04-27T09:56:00Z",
            filePaths: [],
          },
        ],
      })
      .mockResolvedValueOnce({
        id: "session:codex:abc",
        sourceId: "codex",
        title: "Codex: project-b",
        updatedAt: "2026-04-27T10:05:00Z",
        startedAt: "2026-04-27T09:55:00Z",
        endedAt: "2026-04-27T10:05:00Z",
        projectName: "project-b",
        projectPath: "/tmp/project-b",
        messageCount: 3,
        preview: "New preview.",
        fileSize: 0,
        modelId: "",
        messages: [
          {
            id: "message:new",
            role: "assistant",
            kind: "message",
            contentText: "扫描后的最新内容",
            createdAt: "2026-04-27T10:05:00Z",
            filePaths: [],
          },
        ],
      });
    scanAllDataMock.mockResolvedValue({
      sessionCount: 1,
      messageCount: 3,
      filesScanned: 1,
      recordsScanned: 1,
      recordsWithUsage: 0,
      lastScannedAt: "2026-05-08T10:00:00",
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("扫描前的内容")).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "扫描全部数据" }));

    await waitFor(() => {
      expect(listSessionsMock).toHaveBeenCalledTimes(2);
      expect(getSessionDetailMock).toHaveBeenCalledTimes(2);
    });

    await user.click(screen.getByRole("button", { name: "会话" }));

    expect(await screen.findByText("扫描后的最新内容")).toBeInTheDocument();
  });

  it("limits today's hourly series to the current hour and hides zero detail rows", () => {
    const hourlySeries = buildHourlySeries(
      [
        {
          date: "2026-04-28 09:00",
          sourceId: "",
          modelId: "",
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cacheTokens: 0,
          reasoningTokens: 0,
          totalTokens: 150,
          recordsWithUsage: 1,
        },
        {
          date: "2026-04-28 13:00",
          sourceId: "",
          modelId: "",
          inputTokens: 200,
          outputTokens: 100,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cacheTokens: 0,
          reasoningTokens: 0,
          totalTokens: 300,
          recordsWithUsage: 1,
        },
      ],
      "2026-04-28",
      new Date("2026-04-28T11:26:00+08:00"),
    );

    expect(hourlySeries.map((bucket) => bucket.date)).toContain("2026-04-28 11:00");
    expect(hourlySeries.map((bucket) => bucket.date)).not.toContain("2026-04-28 12:00");
    expect(hourlySeries.map((bucket) => bucket.date)).not.toContain("2026-04-28 13:00");
    expect(filterVisibleTokenDetailBuckets(hourlySeries, true).map((bucket) => bucket.date)).toEqual([
      "2026-04-28 09:00",
    ]);
  });

  it("uses Beijing time when limiting today's hourly token series", () => {
    const hourlySeries = buildHourlySeries(
      [
        {
          date: "2026-04-28 07:00",
          sourceId: "",
          modelId: "",
          inputTokens: 80,
          outputTokens: 20,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cacheTokens: 0,
          reasoningTokens: 0,
          totalTokens: 100,
          recordsWithUsage: 1,
        },
        {
          date: "2026-04-28 08:00",
          sourceId: "",
          modelId: "",
          inputTokens: 80,
          outputTokens: 20,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          cacheTokens: 0,
          reasoningTokens: 0,
          totalTokens: 100,
          recordsWithUsage: 1,
        },
      ],
      "2026-04-28",
      new Date("2026-04-27T23:26:00Z"),
    );

    expect(hourlySeries.map((bucket) => bucket.date)).toContain("2026-04-28 07:00");
    expect(hourlySeries.map((bucket) => bucket.date)).not.toContain("2026-04-28 08:00");
  });

  it("maps token line hover positions to the matching hour column", () => {
    expect(getTokenLineHoverIndex(0, 0, 240, 24)).toBe(0);
    expect(getTokenLineHoverIndex(9, 0, 240, 24)).toBe(0);
    expect(getTokenLineHoverIndex(10, 0, 240, 24)).toBe(1);
    expect(getTokenLineHoverIndex(119, 0, 240, 24)).toBe(11);
    expect(getTokenLineHoverIndex(120, 0, 240, 24)).toBe(12);
    expect(getTokenLineHoverIndex(239, 0, 240, 24)).toBe(23);
    expect(getTokenLineHoverIndex(280, 40, 240, 24)).toBe(23);
    expect(getTokenLineHoverIndex(100, 0, 0, 24)).toBeNull();
  });

  it("positions token line points at the center of each hour column", () => {
    expect(getTokenLinePointX(0, 11)).toBeCloseTo(100 / 22);
    expect(getTokenLinePointX(10, 11)).toBeCloseTo((10.5 / 11) * 100);
    expect(getTokenLinePointX(0, 1)).toBe(50);
    expect(getTokenLinePointX(0, 0)).toBe(50);
  });

  it("creates smooth token line paths while preserving single-point charts", () => {
    expect(getSmoothTokenLinePath([
      { x: 5, y: 90 },
      { x: 50, y: 60 },
      { x: 95, y: 20 },
    ])).toContain(" C ");
    expect(getSmoothTokenLinePath([{ x: 50, y: 20 }])).toBe("M 50 20");
  });

  it("keeps smooth token line controls within each segment y range", () => {
    const path = getSmoothTokenLinePath([
      { x: 5, y: 92 },
      { x: 50, y: 92 },
      { x: 95, y: 20 },
    ]);

    expect(path).not.toContain("104");
    expect(path).toContain("C");
  });
});
