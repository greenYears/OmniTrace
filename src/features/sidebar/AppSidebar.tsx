import { handleWindowDragPointerDown } from "../../lib/windowDrag";

type AppView = "sessions" | "tokenUsage" | "knowledge" | "settings";

type AppSidebarProps = {
  activeView: AppView;
  onViewChange: (view: AppView) => void;
};

function ChatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function BarChartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 20V10" />
      <path d="M12 20V4" />
      <path d="M6 20v-6" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.32 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function AppSidebar({ activeView, onViewChange }: AppSidebarProps) {
  return (
    <nav className="app-sidebar" aria-label="主导航">
      <div className="app-sidebar-top" data-tauri-drag-region onPointerDown={handleWindowDragPointerDown}>
        <div className="app-sidebar-logo" aria-label="OmniTrace" data-tauri-drag-region>O</div>
      </div>
      <div className="app-sidebar-nav">
        <button
          className={`app-sidebar-item${activeView === "sessions" ? " is-active" : ""}`}
          type="button"
          onClick={() => onViewChange("sessions")}
          aria-label="会话"
          title="会话"
        >
          <ChatIcon />
          <span className="app-sidebar-label">会话</span>
        </button>
        <button
          className={`app-sidebar-item${activeView === "tokenUsage" ? " is-active" : ""}`}
          type="button"
          onClick={() => onViewChange("tokenUsage")}
          aria-label="Token"
          title="Token"
        >
          <BarChartIcon />
          <span className="app-sidebar-label">Token</span>
        </button>
        <button
          className={`app-sidebar-item${activeView === "knowledge" ? " is-active" : ""}`}
          type="button"
          onClick={() => onViewChange("knowledge")}
          aria-label="知识"
          title="知识"
        >
          <BookIcon />
          <span className="app-sidebar-label">知识</span>
        </button>
      </div>
      <div className="app-sidebar-bottom">
        <button
          className={`app-sidebar-item${activeView === "settings" ? " is-active" : ""}`}
          type="button"
          onClick={() => onViewChange("settings")}
          aria-label="设置"
          title="设置"
        >
          <GearIcon />
          <span className="app-sidebar-label">设置</span>
        </button>
      </div>
    </nav>
  );
}
