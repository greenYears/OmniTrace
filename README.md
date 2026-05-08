# OmniTrace

OmniTrace 是一个面向 `macOS` 首发的本地桌面工具，用来统一查看 `Claude Code`、`Codex` 等 AI Coding TUI 工具的历史会话。

默认文档为中文。英文版本请阅读 [English README](README.en.md)。

## 项目定位

OmniTrace 不是聊天客户端，也不是实时监听器。它的第一版目标很明确：扫描本机已有的 TUI 历史记录，将不同工具的会话统一建模，并用三栏桌面界面快速浏览。

当前重点支持：

- `Claude Code` 历史会话
- `Codex` 历史会话
- 项目、来源、时间范围（含自定义日期区间）过滤
- 会话详情中的用户消息、AI 回复、工具调用和文件信息展示
- Token 消耗统计（按来源、模型、时间维度分析）
- 复制 resume 命令，便于回到原 TUI 工具继续会话

## 功能特性

- **统一历史视图**：把 Claude Code 和 Codex 的本地历史整合到一个桌面界面中。
- **三栏布局**：左侧项目与过滤，中间会话列表，右侧会话详情。
- **TUI 风格界面**：深色终端风格，适合阅读长会话和工具调用记录。
- **Token 消耗统计**：按来源、模型、时间维度分析 Token 用量，支持柱状图和折线图。
- **自定义日期区间**：日历面板选择任意起止日期，精确筛选历史范围。
- **项目路径管理**：项目路径显示在左侧项目项下，支持 `~` 缩写和点击复制完整路径。
- **Resume 命令复制**：会话卡片支持复制 `claude --resume <id>` 或 `codex resume <id>`。
- **真实历史扫描**：读取本机真实 `~/.claude` 与 `~/.codex` 历史目录。

## 技术栈

### 前端

- `React 19`
- `TypeScript`
- `Vite`
- `Zustand`
- `Vitest + Testing Library`
- 纯 CSS

### 后端

- `Tauri v2`
- `Rust`
- `rusqlite`
- `serde / serde_json`
- `chrono`

## 架构概览

OmniTrace 采用“前端展示 + Rust 扫描/归档”的分层结构。

- `src/`：React 前端，负责三栏布局、过滤、会话列表、详情展示和 Token 统计。
- `src-tauri/src/commands.rs`：Tauri command 入口，暴露 `scan_all_data`、`list_sessions`、`get_session_detail`、`get_token_report` 等。
- `src-tauri/src/ingest/`：扫描真实历史目录并聚合会话。
- `src-tauri/src/adapters/`：适配 Claude Code / Codex 原始历史格式。
- `src-tauri/src/db/`：SQLite schema、查询和写入逻辑。
- `docs/agents/`：给后续 Agent 使用的按需加载协作文档。

核心数据流：

1. 前端启动后从 SQLite 加载已扫描的会话列表。
2. 用户在设置页点击扫描，Rust 扫描本机历史目录。
3. 原始记录被归一化为统一 session / message 模型。
4. 数据写入 SQLite。
5. 前端渲染会话列表，并按需调用 `get_session_detail` 加载详情。

## 当前扫描来源

默认读取当前用户 `HOME` 下的历史文件：

- `~/.claude/history.jsonl`
- `~/.claude/projects/*/sessions/*.json`
- `~/.codex/history.jsonl`
- `~/.codex/session_index.jsonl`

## 本地运行

### 环境要求

- macOS
- Node.js 20+
- `pnpm`
- Rust / Cargo
- Xcode Command Line Tools

### 安装依赖

```bash
pnpm install
```

### 启动桌面应用

```bash
pnpm tauri dev
```

应用启动后会自动加载已扫描的会话。在设置页中可以手动触发扫描。

### 使用自定义 HOME 调试

```bash
OMNITRACE_HOME_DIR=/path/to/mock-home pnpm tauri dev
```

此时程序会读取：

- `/path/to/mock-home/.claude/...`
- `/path/to/mock-home/.codex/...`

## 常用命令

```bash
pnpm vitest run
```

运行前端测试。

```bash
pnpm exec tsc --noEmit
```

执行 TypeScript 类型检查。

```bash
pnpm build
```

构建前端产物。

```bash
pnpm tauri build
```

打包桌面应用。

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

运行 Rust 后端测试。macOS Homebrew 环境中也可以使用 `/opt/homebrew/bin/cargo`。

## 项目结构

```text
OmniTrace/
├── src/                    # React 前端
│   ├── features/layout/    # 三栏布局
│   ├── features/sidebar/   # 过滤栏与项目列表
│   ├── features/sessions/  # 会话列表与会话详情
│   ├── features/settings/  # 设置与扫描
│   ├── features/timeRange/ # 时间范围与自定义日期选择
│   ├── lib/                # Tauri 调用封装
│   └── types/              # 前端 DTO 类型
├── src-tauri/              # Tauri + Rust 后端
│   └── src/
│       ├── adapters/       # 历史格式适配
│       ├── db/             # SQLite 存储
│       ├── domain/         # 领域模型
│       ├── ingest/         # 扫描聚合
│       └── commands.rs     # Tauri 命令
└── docs/agents/            # Agent 协作与项目说明文档
```

## 开发说明

- 前端只消费统一 DTO，不直接理解 Claude Code / Codex 的原始历史格式。
- 不同工具的历史差异应优先收敛在 Rust adapter 层。
- 真实历史数据不要提交到仓库，测试数据需要脱敏。
- 修改扫描、路径、fixture 或真实历史解析时，请先阅读 `docs/agents/security-and-data.md`。
- 给后续 Agent 协作时，入口文档是 `AGENTS.md`，专题文档位于 `docs/agents/`。

## 当前边界

已完成：

- 真实历史扫描
- Claude Code / Codex 会话统一展示
- 来源 / 项目 / 时间过滤（含自定义日期区间）
- 会话详情展示 AI 回复、工具调用和文件信息
- Token 消耗统计（按来源、模型、时间维度）
- Resume 命令复制
- 项目路径展示与复制
- 设置页面与扫描进度

暂未完成：

- 全文搜索
- 会话标签与 AI 摘要
- 实时监听历史变化
- Windows / Linux 兼容
