import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/tauri", () => ({
  scanSources: vi.fn(),
}));

import App from "./App";
import { scanSources } from "./lib/tauri";
import { useSessionStore } from "./stores/useSessionStore";

describe("App", () => {
  const scanSourcesMock = vi.mocked(scanSources);

  beforeEach(() => {
    useSessionStore.setState({
      sessions: [],
      selectedId: null,
      detail: null,
      sourceFilter: "all",
      lastScannedAt: null,
    });
    scanSourcesMock.mockResolvedValue([]);
  });

  it("renders the OmniTrace shell header with the scanned empty state", async () => {
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    expect(screen.getByRole("heading", { name: "OmniTrace" })).toBeInTheDocument();
    expect(screen.getByText(/Unified local history viewer/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan / Refresh" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "all" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "codex" })).toBeInTheDocument();
    expect(await screen.findByText("No sessions found for this filter.")).toBeInTheDocument();

    await waitFor(() => {
      expect(scanSourcesMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/Status: Idle/)).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: "Codex: project-a" }),
    ).not.toBeInTheDocument();
  });
});
