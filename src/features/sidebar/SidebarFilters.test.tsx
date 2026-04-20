import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SidebarFilters } from "./SidebarFilters";

describe("SidebarFilters", () => {
  it("changes source, project, and time filters", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <SidebarFilters
        sources={["all", "claude_code", "codex"]}
        projects={["all", "project-a", "project-b"]}
        timeRanges={["all", "7d", "30d"]}
        source="all"
        project="all"
        timeRange="all"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "project-b" }));
    await user.click(screen.getByRole("button", { name: "30d" }));

    expect(onChange).toHaveBeenCalledWith({ project: "project-b" });
    expect(onChange).toHaveBeenCalledWith({ timeRange: "30d" });
  });
});
