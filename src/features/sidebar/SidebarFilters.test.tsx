import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "../../styles.css";
import { SidebarFilters } from "./SidebarFilters";

describe("SidebarFilters", () => {
  it("changes source and project filters", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <SidebarFilters
        sources={["all", "claude_code", "codex"]}
        projects={[{ name: "all" }, { name: "project-a" }, { name: "project-b" }]}
        source="all"
        project="all"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Codex" }));
    await user.click(screen.getByRole("button", { name: "project-b" }));

    expect(onChange).toHaveBeenCalledWith({ sourceFilter: "codex" });
    expect(onChange).toHaveBeenCalledWith({ sourceFilter: "all", projectFilter: "project-b" });
    expect(screen.queryByText("时间范围")).not.toBeInTheDocument();
  });

  it("selects the project when clicking its path text and copies only from the copy button", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <SidebarFilters
        sources={["all", "claude_code", "codex"]}
        projects={[
          { name: "all" },
          { name: "OmniTrace", value: "/Users/test/workspace/OmniTrace", path: "/Users/test/workspace/OmniTrace" },
        ]}
        source="all"
        project="all"
        onChange={onChange}
      />,
    );

    expect(screen.getByText("~/workspace/OmniTrace")).toHaveClass("sidebar-project-path");

    await user.click(screen.getByText("~/workspace/OmniTrace"));

    expect(onChange).toHaveBeenCalledWith({
      sourceFilter: "all",
      projectFilter: "/Users/test/workspace/OmniTrace",
    });

    await user.click(screen.getByRole("button", { name: "复制路径 /Users/test/workspace/OmniTrace" }));

    expect(onChange).not.toHaveBeenCalledWith({ projectFilter: "OmniTrace" });
    expect(screen.getByRole("button", { name: "已复制路径 /Users/test/workspace/OmniTrace" })).toBeInTheDocument();
  });

  it("clears the source filter when selecting a project so the project session list is not empty", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <SidebarFilters
        sources={["all", "claude_code", "codex"]}
        projects={[
          { name: "all" },
          { name: "OmniTrace", value: "/Users/test/workspace/OmniTrace", path: "/Users/test/workspace/OmniTrace" },
        ]}
        source="codex"
        project="all"
        onChange={onChange}
      />,
    );

    await user.click(screen.getByText("OmniTrace"));

    expect(onChange).toHaveBeenCalledWith({
      sourceFilter: "all",
      projectFilter: "/Users/test/workspace/OmniTrace",
    });
  });

  it("uses normal block flow so project options sit directly below the project title", () => {
    render(
      <SidebarFilters
        sources={["all", "claude_code", "codex"]}
        projects={[{ name: "all" }, { name: "OmniTrace", path: "/Users/test/workspace/OmniTrace" }]}
        source="all"
        project="all"
        onChange={vi.fn()}
      />,
    );

    expect(getComputedStyle(screen.getByLabelText("筛选")).display).toBe("block");
    expect(screen.getByText("项目").nextElementSibling).toHaveClass("sidebar-filter-list");
  });
});
