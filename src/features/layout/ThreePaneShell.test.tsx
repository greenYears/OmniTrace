import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging: vi.fn(),
    toggleMaximize: vi.fn(),
  }),
}));

import { ThreePaneShell } from "./ThreePaneShell";

describe("ThreePaneShell", () => {
  it("renders filters, list, and detail as sibling grid panes", () => {
    const { container } = render(
      <ThreePaneShell
        sessions={[
          {
            id: "session-1",
            sourceId: "codex",
            title: "Codex: OmniTrace",
            updatedAt: "2026-05-07T10:00:00Z",
            projectName: "OmniTrace",
            projectPath: "/tmp/work-a/OmniTrace",
            messageCount: 1,
            preview: "from project a",
            fileSize: 0,
            modelId: "",
          },
        ]}
        selectedId={null}
        detail={null}
        detailLoading={false}
        sourceFilter="all"
        projectFilter="all"
        timeRange="all"
        onFilterChange={vi.fn()}
        onTimeRangeChange={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const shell = container.querySelector(".three-pane-shell");

    expect(shell?.querySelector(":scope > .three-pane-left")).toBeInTheDocument();
    expect(shell?.querySelector(":scope > .three-pane-middle")).toBeInTheDocument();
    expect(shell?.querySelector(":scope > .three-pane-right")).toBeInTheDocument();
    expect(shell?.querySelector(":scope > .view-toolbar .three-pane-left")).not.toBeInTheDocument();
  });

  it("limits source and project filter options to the selected time range", () => {
    const today = new Date().toISOString();

    render(
      <ThreePaneShell
        sessions={[
          {
            id: "session-today",
            sourceId: "codex",
            title: "Codex: today-project",
            updatedAt: today,
            projectName: "today-project",
            projectPath: "/tmp/today-project",
            messageCount: 1,
            preview: "from today",
            fileSize: 0,
            modelId: "",
          },
          {
            id: "session-old",
            sourceId: "claude_code",
            title: "Claude Code: old-project",
            updatedAt: "2026-01-01T10:00:00Z",
            projectName: "old-project",
            projectPath: "/tmp/old-project",
            messageCount: 1,
            preview: "from old",
            fileSize: 0,
            modelId: "",
          },
        ]}
        selectedId={null}
        detail={null}
        detailLoading={false}
        sourceFilter="all"
        projectFilter="all"
        timeRange="today"
        onFilterChange={vi.fn()}
        onTimeRangeChange={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const filters = within(screen.getByLabelText("筛选"));
    expect(filters.getByRole("button", { name: "Codex" })).toBeInTheDocument();
    expect(filters.queryByRole("button", { name: "Claude Code" })).not.toBeInTheDocument();
    expect(filters.getByText("today-project")).toBeInTheDocument();
    expect(filters.queryByText("old-project")).not.toBeInTheDocument();
  });

  it("filters sessions by project path so duplicate project names still show their sessions", async () => {
    const onFilterChange = vi.fn();

    render(
      <ThreePaneShell
        sessions={[
          {
            id: "session-1",
            sourceId: "codex",
            title: "Codex: OmniTrace",
            updatedAt: "2026-05-07T10:00:00Z",
            projectName: "OmniTrace",
            projectPath: "/tmp/work-a/OmniTrace",
            messageCount: 1,
            preview: "from project a",
            fileSize: 0,
            modelId: "",
          },
          {
            id: "session-2",
            sourceId: "claude_code",
            title: "Claude Code: OmniTrace",
            updatedAt: "2026-05-07T11:00:00Z",
            projectName: "OmniTrace",
            projectPath: "/tmp/work-b/OmniTrace",
            messageCount: 2,
            preview: "from project b",
            fileSize: 0,
            modelId: "",
          },
        ]}
        selectedId={null}
        detail={null}
        detailLoading={false}
        sourceFilter="all"
        projectFilter="/tmp/work-b/OmniTrace"
        timeRange="all"
        onFilterChange={onFilterChange}
        onTimeRangeChange={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.queryByText("from project a")).not.toBeInTheDocument();
    expect(screen.getByText("from project b")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByText("/tmp/work-a/OmniTrace"));

    expect(onFilterChange).toHaveBeenCalledWith({
      sourceFilter: "all",
      projectFilter: "/tmp/work-a/OmniTrace",
    });
  });
});
