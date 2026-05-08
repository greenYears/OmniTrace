import { beforeEach, describe, expect, it } from "vitest";

import { useSessionStore } from "./useSessionStore";

describe("useSessionStore", () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: [],
      selectedId: null,
      detail: null,
      detailLoading: false,
      sourceFilter: "all",
      projectFilter: "all",
      detailRefreshKey: 0,
    });
  });

  it("selects a session without resetting loaded detail state", () => {
    const detail = {
      id: "session:codex:old",
      sourceId: "codex",
      title: "Codex: old",
      updatedAt: "2026-04-27T10:00:00Z",
      startedAt: "2026-04-27T09:55:00Z",
      endedAt: "2026-04-27T10:00:00Z",
      projectName: "old",
      projectPath: "/tmp/old",
      messageCount: 1,
      preview: "old",
      fileSize: 0,
      modelId: "",
      messages: [],
    };

    useSessionStore.setState({
      selectedId: "session:codex:old",
      detail,
      detailLoading: false,
    });

    useSessionStore.getState().selectSession("session:codex:new");

    const state = useSessionStore.getState();
    expect(state.selectedId).toBe("session:codex:new");
    expect(state.detail).toBe(detail);
    expect(state.detailLoading).toBe(false);
  });

  it("requests a detail refresh when the current session is selected again", () => {
    useSessionStore.setState({
      selectedId: "session:codex:old",
      detailRefreshKey: 0,
    });

    useSessionStore.getState().selectSession("session:codex:old");

    expect(useSessionStore.getState().detailRefreshKey).toBe(1);
  });
});
