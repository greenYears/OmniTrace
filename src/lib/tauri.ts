import { invoke } from "@tauri-apps/api/core";

import type { SessionDetail, SessionListItem, SessionMessage } from "../types/session";

type SessionListItemDto = {
  id: string;
  resume_id: string;
  source_id: string;
  title: string;
  updated_at: string;
  project_name: string;
  project_path: string;
  message_count: number;
  preview: string;
  file_size: number;
  model_id: string;
};

type SessionMessageDto = {
  id: string;
  role: string;
  kind: string;
  content_text: string;
  created_at: string;
  tool_name?: string | null;
  file_paths?: string[];
};

type SessionDetailDto = SessionListItemDto & {
  started_at: string;
  ended_at: string;
  project_path: string;
  messages: SessionMessageDto[];
};

function mapMessageRole(role: string): SessionMessage["role"] {
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") {
    return role;
  }

  return "assistant";
}

function mapMessageKind(kind: string): SessionMessage["kind"] {
  if (
    kind === "message" ||
    kind === "tool_call" ||
    kind === "tool_result" ||
    kind === "file_summary"
  ) {
    return kind;
  }

  return "message";
}

export async function scanSources(): Promise<SessionListItem[]> {
  const sessions = await invoke<SessionListItemDto[]>("scan_sources");

  return sessions.map((session) => ({
    id: session.id,
    resumeId: session.resume_id,
    sourceId: session.source_id,
    title: session.title,
    updatedAt: session.updated_at,
    projectName: session.project_name,
    projectPath: session.project_path,
    messageCount: session.message_count,
    preview: session.preview,
    fileSize: session.file_size,
    modelId: session.model_id,
  }));
}

export async function getSessionDetail(id: string): Promise<SessionDetail | null> {
  const session = await invoke<SessionDetailDto | null>("get_session_detail", { id });

  if (!session) {
    return null;
  }

  return {
    id: session.id,
    resumeId: session.resume_id,
    sourceId: session.source_id,
    title: session.title,
    updatedAt: session.updated_at,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    projectName: session.project_name,
    projectPath: session.project_path,
    messageCount: session.message_count,
    preview: session.preview,
    fileSize: session.file_size,
    modelId: session.model_id,
    messages: session.messages.map((message) => ({
      id: message.id,
      role: mapMessageRole(message.role),
      kind: mapMessageKind(message.kind),
      contentText: message.content_text,
      createdAt: message.created_at,
      toolName: message.tool_name ?? undefined,
      filePaths: message.file_paths ?? [],
    })),
  };
}

export async function deleteSession(id: string): Promise<void> {
  await invoke("delete_session", { id });
}
