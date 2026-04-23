import { create } from "zustand";

import type {
  SessionDetail,
  SessionListItem,
  SourceFilter,
  TimeRange,
} from "../types/session";

type SessionStore = {
  sessions: SessionListItem[];
  selectedId: string | null;
  detail: SessionDetail | null;
  detailLoading: boolean;
  sourceFilter: SourceFilter;
  projectFilter: string;
  timeRange: TimeRange;
  lastScannedAt: string | null;
  setSessions: (sessions: SessionListItem[]) => void;
  selectSession: (id: string) => void;
  setDetail: (detail: SessionDetail | null) => void;
  setDetailLoading: (loading: boolean) => void;
  updateFilters: (
    next: Partial<Pick<SessionStore, "sourceFilter" | "projectFilter" | "timeRange">>,
  ) => void;
  markScannedNow: () => void;
};

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  selectedId: null,
  detail: null,
  detailLoading: false,
  sourceFilter: "all",
  projectFilter: "all",
  timeRange: "7d",
  lastScannedAt: null,
  setSessions: (sessions) =>
    set(() => ({
      sessions,
      selectedId: sessions.length > 0 ? sessions[0]?.id ?? null : null,
      detailLoading: sessions.length > 0,
    })),
  selectSession: (id) =>
    set((state) => {
      if (state.selectedId === id) {
        return state;
      }

      return {
        selectedId: id,
        detail: null,
        detailLoading: true,
      };
    }),
  setDetail: (detail) => set(() => ({ detail })),
  setDetailLoading: (detailLoading) => set(() => ({ detailLoading })),
  updateFilters: (next) =>
    set(() => ({
      ...next,
    })),
  markScannedNow: () => set(() => ({ lastScannedAt: new Date().toISOString() })),
}));
