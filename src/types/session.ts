export type TimeRange = "today" | "all" | "7d" | "30d";

export type SourceFilter = "all" | "claude_code" | "codex";

export type SessionListItem = {
  id: string;
  resumeId?: string;
  sourceId: string;
  title: string;
  updatedAt: string;
  projectName: string;
  projectPath: string;
  messageCount: number;
  preview: string;
  fileSize: number;
  modelId: string;
};

export type SessionMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  kind:
    | "message"
    | "tool_call"
    | "tool_result"
    | "file_summary"
    | "selection_context"
    | "file_context"
    | "memory_context";
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

export type TokenUsageBucket = {
  date: string;
  sourceId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cacheTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  recordsWithUsage: number;
};

export type TokenUsageSample = {
  sourceId: string;
  modelId: string;
  date: string;
  path: string;
  rawUsageJson: string;
};

export type TokenUsageProbeReport = {
  filesScanned: number;
  recordsScanned: number;
  recordsWithUsage: number;
  days: TokenUsageBucket[];
  hours: TokenUsageBucket[];
  byModel: TokenUsageBucket[];
  byModelByDay: TokenUsageBucket[];
  byModelByHour: TokenUsageBucket[];
  samples: TokenUsageSample[];
};
