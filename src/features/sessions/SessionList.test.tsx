import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SessionList } from "./SessionList";

describe("SessionList", () => {
  it('renders two sessions and calls onSelect("2") after clicking Codex: project-b', async () => {
    const onSelect = vi.fn();

    render(
      <SessionList
        sessions={[
          {
            id: "1",
            sourceId: "codex",
            title: "Claude Code: project-a",
            updatedAt: "2026-04-20T12:00:00Z",
            projectName: "project-a",
            messageCount: 3,
            preview: "",
          },
          {
            id: "2",
            sourceId: "codex",
            title: "Codex: project-b",
            updatedAt: "2026-04-20T12:01:00Z",
            projectName: "project-b",
            messageCount: 7,
            preview: "Open this session.",
          },
        ]}
        selectedId="1"
        onSelect={onSelect}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Claude Code: project-a" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Codex: project-b" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("project-b").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CX").length).toBeGreaterThan(0);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Codex: project-b" }));

    expect(onSelect).toHaveBeenCalledWith("2");
  });
});
