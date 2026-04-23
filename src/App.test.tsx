import { StrictMode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/tauri", () => ({
  scanSources: vi.fn(),
  getSessionDetail: vi.fn(),
}));

import App from "./App";
import { getSessionDetail, scanSources } from "./lib/tauri";
import { useSessionStore } from "./stores/useSessionStore";

describe("App", () => {
  const getSessionDetailMock = vi.mocked(getSessionDetail);
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
    expect(screen.getByRole("button", { name: "↻ Scan" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "all" })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "codex" })).toBeInTheDocument();
    expect(await screen.findByText("No sessions found for this filter.")).toBeInTheDocument();

    await waitFor(() => {
      expect(scanSourcesMock).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText(/0 sessions/)).toBeInTheDocument();

    expect(
      screen.queryByRole("button", { name: "Codex: project-a" }),
    ).not.toBeInTheDocument();
  });

  it("loads session detail on demand after scan selects a session", async () => {
    scanSourcesMock.mockResolvedValue([
      {
        id: "session:codex:abc",
        sourceId: "codex",
        title: "Codex: project-b",
        updatedAt: "2026-04-20T10:00:00Z",
        projectName: "project-b",
        messageCount: 2,
        preview: "Open this session.",
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
      expect(screen.getByText("/tmp/project-b")).toBeInTheDocument();
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
        messageCount: 2,
        preview: "First session.",
      },
      {
        id: "session:codex:bbb",
        sourceId: "codex",
        title: "Codex: project-b",
        updatedAt: "2026-04-20T11:00:00Z",
        projectName: "project-b",
        messageCount: 2,
        preview: "Second session.",
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

    expect(await screen.findByText("/tmp/project-a")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Codex: project-b" }));

    const loadingStatus = screen.getByRole("status", { name: "Loading session detail" });
    expect(loadingStatus).toBeInTheDocument();
    expect(within(loadingStatus).getAllByText("project-b").length).toBeGreaterThan(0);
    expect(within(loadingStatus).getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("/tmp/project-a")).toBeInTheDocument();

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
      expect(screen.getByText("/tmp/project-b")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.queryByRole("status", { name: "Loading session detail" })).not.toBeInTheDocument();
    });
  });
});
