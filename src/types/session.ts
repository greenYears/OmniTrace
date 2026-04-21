export type TimeRange = "all" | "7d" | "30d";

export type SourceFilter = "all" | "claude_code" | "codex";

export type SessionListItem = {
  id: string;
  sourceId: string;
  title: string;
  updatedAt: string;
  projectName: string;
  messageCount: number;
  preview: string;
};

export type SessionMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  contentText: string;
  createdAt: string;
};

export type SessionDetail = SessionListItem & {
  projectPath: string;
  startedAt: string;
  endedAt: string;
  messages: SessionMessage[];
};
