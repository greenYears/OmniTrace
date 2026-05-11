import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
  LlmProvider,
  SaveProviderInput,
  KnowledgeRun,
  KnowledgeDocument,
  ExportSettings,
  ProgressEvent,
} from "../types/knowledge";

type KnowledgeState = {
  providers: LlmProvider[];
  runs: KnowledgeRun[];
  documents: KnowledgeDocument[];
  exportSettings: ExportSettings | null;
  progress: ProgressEvent | null;
  loading: boolean;
  startError: string | null;
  starting: boolean;

  loadProviders: () => Promise<void>;
  saveProvider: (input: SaveProviderInput) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  loadRuns: (projectId: string) => Promise<void>;
  loadDocuments: (projectId: string) => Promise<void>;
  updateDocument: (id: string, markdown: string) => Promise<void>;
  loadExportSettings: (projectId: string) => Promise<void>;
  saveExportSettings: (settings: ExportSettings) => Promise<void>;
  startRun: (projectId: string) => Promise<KnowledgeRun>;
  setProgress: (progress: ProgressEvent | null) => void;
  clearStartError: () => void;
};

export const useKnowledgeStore = create<KnowledgeState>((set) => ({
  providers: [],
  runs: [],
  documents: [],
  exportSettings: null,
  progress: null,
  loading: false,
  startError: null,
  starting: false,

  loadProviders: async () => {
    const providers = await invoke<LlmProvider[]>("list_llm_providers");
    set({ providers });
  },

  saveProvider: async (input: SaveProviderInput) => {
    await invoke("save_llm_provider", { input });
    const providers = await invoke<LlmProvider[]>("list_llm_providers");
    set({ providers });
  },

  deleteProvider: async (id: string) => {
    await invoke("delete_llm_provider", { id });
    const providers = await invoke<LlmProvider[]>("list_llm_providers");
    set({ providers });
  },

  loadRuns: async (projectId: string) => {
    const runs = await invoke<KnowledgeRun[]>("list_knowledge_runs", {
      projectId,
    });
    set({ runs });
  },

  loadDocuments: async (projectId: string) => {
    const documents = await invoke<KnowledgeDocument[]>(
      "list_knowledge_documents",
      { projectId },
    );
    set({ documents });
  },

  updateDocument: async (id: string, markdown: string) => {
    await invoke("update_knowledge_document", { id, markdown });
  },

  loadExportSettings: async (projectId: string) => {
    const settings = await invoke<ExportSettings>("get_export_settings", {
      projectId,
    });
    set({ exportSettings: settings });
  },

  saveExportSettings: async (settings: ExportSettings) => {
    await invoke("save_export_settings", { settings });
    set({ exportSettings: settings });
  },

  startRun: async (projectId: string) => {
    set({ starting: true, startError: null });
    try {
      const run = await invoke<KnowledgeRun>("start_knowledge_run", { projectId });
      set((state) => ({ runs: [run, ...state.runs], starting: false }));
      return run;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ startError: message, starting: false });
      throw err;
    }
  },

  clearStartError: () => set({ startError: null }),

  setProgress: (progress: ProgressEvent | null) => {
    set({ progress });
  },
}));

let unlistenProgress: (() => void) | null = null;

export async function initKnowledgeEventListeners() {
  if (unlistenProgress) return;

  unlistenProgress = await listen<ProgressEvent>(
    "knowledge-run-progress",
    (event) => {
      const store = useKnowledgeStore.getState();
      store.setProgress(event.payload);

      // Refresh runs & documents when pipeline finishes
      const phase = event.payload.phase;
      if (phase === "synthesizing" || phase === "completed" || phase === "failed") {
        const runId = event.payload.runId;
        const currentRuns = store.runs;
        const currentRun = currentRuns.find((r) => r.id === runId);
        if (currentRun) {
          store.loadRuns(currentRun.projectId).catch(console.error);
          store.loadDocuments(currentRun.projectId).catch(console.error);
        }
      }
    },
  );
}
