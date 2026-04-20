import { create } from "zustand";

import type { SessionDetail, SessionListItem } from "../types/session";

type SessionStore = {
  sessions: SessionListItem[];
  selectedId: string | null;
  detail: SessionDetail | null;
  setSessions: (sessions: SessionListItem[]) => void;
  selectSession: (id: string) => void;
  setDetail: (detail: SessionDetail | null) => void;
};

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  selectedId: null,
  detail: null,
  setSessions: (sessions) =>
    set(() => ({
      sessions,
      selectedId: sessions.length > 0 ? sessions[0]?.id ?? null : null,
    })),
  selectSession: (id) => set(() => ({ selectedId: id })),
  setDetail: (detail) => set(() => ({ detail })),
}));

