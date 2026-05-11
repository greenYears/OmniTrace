import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: listenMock,
}));

vi.mock("../../stores/useSessionStore", () => ({
  useSessionStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      sessions: [
        { id: "s1", projectName: "TestProject", projectPath: "/tmp/test", updatedAt: "2026-05-11T10:00:00Z" },
        { id: "s2", projectName: "OtherProject", projectPath: "/tmp/other", updatedAt: "2026-05-11T09:00:00Z" },
      ],
    }),
}));

import { KnowledgeView } from "./KnowledgeView";

describe("KnowledgeView", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    invokeMock.mockResolvedValue([]);
    listenMock.mockResolvedValue(() => {});
  });

  it("renders the knowledge view with title", () => {
    render(<KnowledgeView />);
    expect(screen.getByText("知识")).toBeTruthy();
  });

  it("shows project cards in empty state", () => {
    render(<KnowledgeView />);
    expect(screen.getByText("TestProject")).toBeTruthy();
    expect(screen.getByText("OtherProject")).toBeTruthy();
  });

  it("shows provider status in footer", () => {
    render(<KnowledgeView />);
    expect(screen.getByText("未配置 LLM Provider")).toBeTruthy();
  });

  it("shows navigate-to-settings link when callback provided", () => {
    render(<KnowledgeView onNavigateSettings={() => {}} />);
    expect(screen.getByText("去设置")).toBeTruthy();
  });

  it("does not show back button in empty state", () => {
    render(<KnowledgeView />);
    expect(screen.queryByText("← 返回")).toBeNull();
  });
});
