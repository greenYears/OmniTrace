import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import App from "./App";
import { useSessionStore } from "./stores/useSessionStore";

describe("App", () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: [],
      selectedId: null,
      detail: null,
    });
  });

  it("renders the OmniTrace shell header with an empty viewer shell", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "OmniTrace" })).toBeInTheDocument();
    expect(screen.getByText(/Unified local history viewer/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan / Refresh" })).toBeInTheDocument();
    expect(screen.getByText("Sources, projects, and time ranges.")).toBeInTheDocument();
    expect(
      screen.getByText("Select a session to inspect its full history."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Codex: project-a" }),
    ).not.toBeInTheDocument();
  });
});
