import { create } from "zustand";

import type {
  SessionDetail,
  SessionListItem,
  SourceFilter,
} from "../types/session";

type SessionStore = {
  sessions: SessionListItem[];
  selectedId: string | null;
  detail: SessionDetail | null;
  detailLoading: boolean;
  detailRefreshKey: number;
  sourceFilter: SourceFilter;
  projectFilter: string;
  setSessions: (sessions: SessionListItem[]) => void;
  selectSession: (id: string) => void;
  setDetail: (detail: SessionDetail | null) => void;
  setDetailLoading: (loading: boolean) => void;
  updateFilters: (
    next: Partial<Pick<SessionStore, "sourceFilter" | "projectFilter">>,
  ) => void;
};

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  selectedId: null,
  detail: null,
  detailLoading: false,
  detailRefreshKey: 0,
  sourceFilter: "all",
  projectFilter: "all",
  setSessions: (sessions) =>
    set((state) => ({
      sessions,
      selectedId: sessions.some((session) => session.id === state.selectedId)
        ? state.selectedId
        : sessions[0]?.id ?? null,
      detailRefreshKey: state.detailRefreshKey + 1,
    })),
  selectSession: (id) =>
    set((state) => ({
      selectedId: id,
      detailRefreshKey: state.detailRefreshKey + 1,
    })),
  setDetail: (detail) => set(() => ({ detail })),
  setDetailLoading: (detailLoading) => set(() => ({ detailLoading })),
  updateFilters: (next) =>
    set(() => ({
      ...next,
    })),
}));
