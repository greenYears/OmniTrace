import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionList, getResumeCommand } from "./SessionList";

describe("SessionList", () => {
  const writeTextMock = vi.fn();

  beforeEach(() => {
    writeTextMock.mockReset();
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeTextMock,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("does not render the project name twice when title already equals project name", () => {
    render(
      <SessionList
        sessions={[
          {
            id: "1",
            sourceId: "claude_code",
            title: "OmniTrace",
            updatedAt: "2026-04-21T05:58:49.485Z",
            projectName: "OmniTrace",
            messageCount: 3,
            preview: "请优化一下下面的布局和排版。",
          },
        ]}
        selectedId="1"
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getAllByText("OmniTrace")).toHaveLength(1);
  });

  it("marks the newly selected session as activating for transition handoff", () => {
    const { rerender } = render(
      <SessionList
        sessions={[
          {
            id: "1",
            sourceId: "claude_code",
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
        onSelect={vi.fn()}
      />,
    );

    rerender(
      <SessionList
        sessions={[
          {
            id: "1",
            sourceId: "claude_code",
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
        selectedId="2"
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Codex: project-b" })).toHaveClass("is-activating");
  });

  it("copies the codex resume command without selecting the session", async () => {
    const onSelect = vi.fn();

    render(
      <SessionList
        sessions={[
          {
            id: "session:codex:resume-1",
            resumeId: "resume-1",
            sourceId: "codex",
            title: "Codex: project-b",
            updatedAt: "2026-04-20T12:01:00Z",
            projectName: "project-b",
            messageCount: 7,
            preview: "Open this session.",
          },
        ]}
        selectedId={null}
        onSelect={onSelect}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "复制 project-b 的 Resume 命令" }));

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "已复制 project-b 的 Resume 命令" })).toBeInTheDocument();
  });

  it("builds the correct resume commands for codex and claude", () => {
    expect(getResumeCommand({
      id: "session:codex:resume-1",
      resumeId: "4c6f0f37-275c-4c3b-b190-a76e69f40e8c",
      sourceId: "codex",
      title: "Codex: project-b",
      updatedAt: "2026-04-20T12:01:00Z",
      projectName: "project-b",
      messageCount: 7,
      preview: "Open this session.",
    })).toBe("codex --resume 4c6f0f37-275c-4c3b-b190-a76e69f40e8c");

    expect(getResumeCommand({
      id: "session:claude_code:resume-2",
      resumeId: "4c6f0f37-275c-4c3b-b190-a76e69f40e8c",
      sourceId: "claude_code",
      title: "Claude Code: project-a",
      updatedAt: "2026-04-20T12:00:00Z",
      projectName: "project-a",
      messageCount: 3,
      preview: "",
    })).toBe("claude --resume 4c6f0f37-275c-4c3b-b190-a76e69f40e8c");
  });
});
