import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "../../styles.css";
import { SidebarFilters } from "./SidebarFilters";

describe("SidebarFilters", () => {
  it("changes source, project, and time filters", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <SidebarFilters
        sources={["all", "claude_code", "codex"]}
        projects={[{ name: "all" }, { name: "project-a" }, { name: "project-b" }]}
        timeRanges={["all", "7d", "30d"]}
        source="all"
        project="all"
        timeRange="all"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "project-b" }));
    await user.click(screen.getByRole("button", { name: "最近 30 天" }));

    expect(onChange).toHaveBeenCalledWith({ projectFilter: "project-b" });
    expect(onChange).toHaveBeenCalledWith({ timeRange: "30d" });
  });

  it("shows project paths in the project filter and copies the full path", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <SidebarFilters
        sources={["all", "claude_code", "codex"]}
        projects={[
          { name: "all" },
          { name: "OmniTrace", path: "/Users/test/workspace/OmniTrace" },
        ]}
        timeRanges={["all", "7d", "30d"]}
        source="all"
        project="all"
        timeRange="all"
        onChange={onChange}
      />,
    );

    expect(screen.getByText("~/workspace/OmniTrace")).toHaveClass("sidebar-project-path");

    await user.click(screen.getByRole("button", { name: "复制路径 /Users/test/workspace/OmniTrace" }));

    expect(onChange).not.toHaveBeenCalledWith({ projectFilter: "OmniTrace" });
    expect(screen.getByRole("button", { name: "已复制路径 /Users/test/workspace/OmniTrace" })).toBeInTheDocument();
  });

  it("uses normal block flow so project options sit directly below the project title", () => {
    render(
      <SidebarFilters
        sources={["all", "claude_code", "codex"]}
        projects={[{ name: "all" }, { name: "OmniTrace", path: "/Users/test/workspace/OmniTrace" }]}
        timeRanges={["all", "7d", "30d"]}
        source="all"
        project="all"
        timeRange="all"
        onChange={vi.fn()}
      />,
    );

    expect(getComputedStyle(screen.getByLabelText("筛选")).display).toBe("block");
    expect(screen.getByText("项目").nextElementSibling).toHaveClass("sidebar-filter-list");
  });
});
