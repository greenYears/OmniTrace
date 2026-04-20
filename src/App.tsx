import "./styles.css";

function App() {
  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>OmniTrace</h1>
          <p className="app-subtitle">
            Unified local history viewer for AI coding TUIs.
          </p>
        </div>
        <button className="scan-button" type="button">
          Scan / Refresh
        </button>
      </header>
    </main>
  );
}

export default App;
