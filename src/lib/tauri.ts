import { invoke } from "@tauri-apps/api/core";

import type { SessionListItem } from "../types/session";

type ScanSourcesDto = {
  source_id: string;
  title: string;
  updated_at: string;
  project_name: string;
  message_count: number;
};

export async function scanSources(): Promise<SessionListItem[]> {
  const sessions = await invoke<ScanSourcesDto[]>("scan_sources");

  return sessions.map((session, index) => ({
    id: `${session.source_id}:${session.updated_at}:${index}`,
    sourceId: session.source_id,
    title: session.title,
    updatedAt: session.updated_at,
    projectName: session.project_name,
    messageCount: session.message_count,
  }));
}
