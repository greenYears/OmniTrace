import { create } from "zustand";

import type { SessionDetail, SessionListItem } from "../types/session";

type SessionStore = {
  sessions: SessionListItem[];
  selectedId: string | null;
  detail: SessionDetail | null;
  sourceFilter: string;
  lastScannedAt: string | null;
  setSessions: (sessions: SessionListItem[]) => void;
  selectSession: (id: string) => void;
  setDetail: (detail: SessionDetail | null) => void;
  setSourceFilter: (source: string) => void;
  markScannedNow: () => void;
};

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  selectedId: null,
  detail: null,
  sourceFilter: "all",
  lastScannedAt: null,
  setSessions: (sessions) =>
    set(() => ({
      sessions,
      detail: null,
      selectedId: sessions.length > 0 ? sessions[0]?.id ?? null : null,
    })),
  selectSession: (id) => set(() => ({ selectedId: id, detail: null })),
  setDetail: (detail) => set(() => ({ detail })),
  setSourceFilter: (source) =>
    set(() => ({
      sourceFilter: source,
      detail: null,
    })),
  markScannedNow: () => set(() => ({ lastScannedAt: new Date().toISOString() })),
}));
