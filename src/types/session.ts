export type TimeRange = "all" | "7d" | "30d";

export type SourceFilter = "all" | "claude_code" | "codex";

export type SessionListItem = {
  id: string;
  resumeId?: string;
  sourceId: string;
  title: string;
  updatedAt: string;
  projectName: string;
  messageCount: number;
  preview: string;
  fileSize: number;
  modelId: string;
};

export type SessionMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  kind: "message" | "tool_call" | "tool_result" | "file_summary";
  contentText: string;
  createdAt: string;
  toolName?: string;
  filePaths: string[];
};

export type SessionDetail = SessionListItem & {
  projectPath: string;
  startedAt: string;
  endedAt: string;
  messages: SessionMessage[];
};
