import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
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
      sourceFilter: "all",
      projectFilter: "all",
      timeRange: "7d",
      lastScannedAt: null,
    });
    scanSourcesMock.mockResolvedValue([]);
    getSessionDetailMock.mockResolvedValue(null);
  });

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
          contentText: "Open this session.",
          createdAt: "2026-04-20T09:56:00Z",
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
});
