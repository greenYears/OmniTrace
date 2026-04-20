export type SessionListItem = {
  id: string;
  sourceId: string;
  title: string;
  updatedAt: string;
  projectName: string;
  messageCount: number;
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
