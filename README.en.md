# OmniTrace

OmniTrace is a local desktop viewer for browsing historical sessions from AI coding TUI tools such as `Claude Code` and `Codex`. The first release targets `macOS`.

Chinese documentation is available in the main [README](README.md).

## Positioning

OmniTrace is not a chat client or a real-time monitor. Its first goal is to scan existing local TUI history, normalize sessions from different tools, and provide a three-pane desktop interface for browsing them.

Currently supported:

- `Claude Code` history sessions
- `Codex` history sessions
- Filtering by project, source, and time range (including custom date ranges)
- Viewing user messages, AI replies, tool calls, and file information
- Token usage statistics (by source, model, and time dimensions)
- Copying resume commands to continue sessions in the original TUI tools

## Features

- **Unified history view**: Browse Claude Code and Codex local histories in one app.
- **Three-pane layout**: Projects and filters on the left, sessions in the middle, details on the right.
- **TUI-inspired interface**: A dark terminal-like UI for reading long transcripts and tool calls.
- **Token usage statistics**: Analyze token consumption by source, model, and time with bar and line charts.
- **Custom date ranges**: Calendar panel for selecting arbitrary start and end dates.
- **Project path management**: Project paths are shown under project items, shortened with `~`, and can be clicked to copy the full path.
- **Resume command copy**: Session cards can copy `claude --resume <id>` or `codex resume <id>`.
- **Real history scanning**: Reads local `~/.claude` and `~/.codex` history directories.

## Tech Stack

Frontend:

- `React 19`
- `TypeScript`
- `Vite`
- `Zustand`
- `Vitest + Testing Library`
- Plain CSS

Backend:

- `Tauri v2`
- `Rust`
- `rusqlite`
- `serde / serde_json`
- `chrono`

## Architecture

OmniTrace uses a layered architecture: React for presentation, Rust for scanning and persistence.

- `src/`: React frontend for layout, filtering, session display, and token statistics.
- `src-tauri/src/commands.rs`: Tauri command entry points, including `scan_all_data`, `list_sessions`, `get_session_detail`, `get_token_report`, etc.
- `src-tauri/src/ingest/`: Scans local history directories and aggregates sessions.
- `src-tauri/src/adapters/`: Parses Claude Code and Codex history formats.
- `src-tauri/src/db/`: SQLite schema, queries, and upserts.
- `docs/agents/`: Contributor and agent-oriented documentation.

Data flow:

1. On startup, the frontend loads previously scanned sessions from SQLite.
2. Users trigger a scan from the Settings page; Rust scans local history directories.
3. Raw records are normalized into unified session and message models.
4. Data is written to SQLite.
5. The frontend renders the session list and loads details through `get_session_detail`.

## Scanned Sources

By default, OmniTrace reads history files under the current user's `HOME` directory:

- `~/.claude/history.jsonl`
- `~/.claude/projects/*/sessions/*.json`
- `~/.codex/history.jsonl`
- `~/.codex/session_index.jsonl`

## Local Development

Requirements:

- macOS
- Node.js 20+
- `pnpm`
- Rust / Cargo
- Xcode Command Line Tools

Install dependencies:

```bash
pnpm install
```

Run the desktop app:

```bash
pnpm tauri dev
```

The app loads previously scanned sessions on startup. Scanning can be triggered manually from the Settings page.

Use a custom HOME directory for debugging:

```bash
OMNITRACE_HOME_DIR=/path/to/mock-home pnpm tauri dev
```

## Common Commands

```bash
pnpm vitest run
```

Run frontend tests.

```bash
pnpm exec tsc --noEmit
```

Run TypeScript type checking.

```bash
pnpm build
```

Build frontend assets.

```bash
pnpm tauri build
```

Package the desktop app.

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Run Rust backend tests.

## Project Structure

```text
OmniTrace/
├── src/                    # React frontend
│   ├── features/layout/    # Three-pane layout
│   ├── features/sidebar/   # Filters and project list
│   ├── features/sessions/  # Session list and detail view
│   ├── features/settings/  # Settings and scanning
│   ├── features/timeRange/ # Time range and custom date picker
│   ├── lib/                # Tauri call wrappers
│   └── types/              # Frontend DTO types
├── src-tauri/              # Tauri + Rust backend
│   └── src/
│       ├── adapters/       # History format adapters
│       ├── db/             # SQLite storage
│       ├── domain/         # Domain models
│       ├── ingest/         # Scanning and aggregation
│       └── commands.rs     # Tauri commands
└── docs/agents/            # Agent collaboration docs
```

## Development Notes

- The frontend consumes unified DTOs and should not parse raw Claude Code or Codex history formats directly.
- Tool-specific differences should be handled in the Rust adapter layer.
- Do not commit real local history data. Test data must be sanitized.
- Read `docs/agents/security-and-data.md` before changing scanning, paths, fixtures, or real-history parsing.
- Agent-oriented contribution docs start at `AGENTS.md` and continue in `docs/agents/`.

## Current Limits

Implemented:

- Real history scanning
- Unified Claude Code / Codex session display
- Source / project / time filtering (including custom date ranges)
- AI replies, tool calls, and file information in details
- Token usage statistics (by source, model, and time dimensions)
- Resume command copying
- Project path display and copy
- Settings page with scan progress

Not implemented yet:

- Full-text search
- Session tags and AI summaries
- Real-time history watching
- Windows / Linux compatibility
