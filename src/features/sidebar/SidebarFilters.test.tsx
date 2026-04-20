import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SidebarFilters } from "./SidebarFilters";

describe("SidebarFilters", () => {
  it("calls back when source filter changes", async () => {
    const user = userEvent.setup();
    const onSourceChange = vi.fn();

    render(
      <SidebarFilters
        sources={["all", "claude_code", "codex"]}
        source="all"
        onSourceChange={onSourceChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: "codex" }));

    expect(onSourceChange).toHaveBeenCalledWith("codex");
  });
});
