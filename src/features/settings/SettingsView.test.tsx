import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const eventMock = vi.hoisted(() => ({
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventMock.listen,
}));

vi.mock("../../lib/tauri", () => ({
  getScanStats: vi.fn(),
  scanAllData: vi.fn(),
}));

import { getScanStats, scanAllData } from "../../lib/tauri";
import { SettingsView } from "./SettingsView";

describe("SettingsView", () => {
  const getScanStatsMock = vi.mocked(getScanStats);
  const scanAllDataMock = vi.mocked(scanAllData);

  beforeEach(() => {
    getScanStatsMock.mockReset();
    scanAllDataMock.mockReset();
    eventMock.listen.mockReset();
    eventMock.listen.mockResolvedValue(() => {});
    getScanStatsMock.mockResolvedValue({
      sessionCount: 147,
      messageCount: 16121,
      lastScannedAt: null,
    });
  });

  it("shows success feedback and updates last scan time after scanning", async () => {
    scanAllDataMock.mockResolvedValue({
      sessionCount: 148,
      messageCount: 16130,
      filesScanned: 12,
      recordsScanned: 20,
      recordsWithUsage: 6,
      lastScannedAt: "2026-05-07T10:30:00",
    });

    render(<SettingsView />);

    expect(await screen.findByText("从未扫描")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "扫描全部数据" }));

    expect(await screen.findByText("扫描完成")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("从未扫描")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/05\/07.*10:30/)).toBeInTheDocument();
    expect(screen.getByText("148 个")).toBeInTheDocument();
    expect(screen.getByText("16130 条")).toBeInTheDocument();
  });
});
