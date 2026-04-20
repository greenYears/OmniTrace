# 2026-04-20 History Sources (Claude Code, Codex)

目标：为 OmniTrace 后续 adapter 提供“真实字段形状”的稳定 fixture（可脱敏，但字段名与整体结构尽量贴近本机真实来源）。

## 1. 本机候选目录定位

执行命令（按 Task 2 要求）：

```sh
find "$HOME" -maxdepth 4 \( -name ".claude*" -o -name ".codex*" \) -print
```

说明：
- macOS 上部分目录会因为 TCC/权限导致 `Operation not permitted`，属于预期现象，不影响定位目标目录。

本机观测到的候选路径（用 `$HOME` 表示用户主目录，避免把用户名写进 repo）：
- `$HOME/.claude`
- `$HOME/.claude.json`（以及若干 backup 文件）
- `$HOME/.codex`
- `$HOME/.config/opencode/superpowers/.claude-plugin`（插件/脚本，不是主要 history）
- `$HOME/.config/opencode/superpowers/.codex`（插件/脚本，不是主要 history）

## 2. Claude Code（`$HOME/.claude`）字段形状记录

### 2.1 输入历史：`$HOME/.claude/history.jsonl`

文件格式：JSONL（一行一个 JSON 对象）

本机抽样观测到的字段形状：

```json
{
  "display": "string (用户输入/命令展示文本)",
  "pastedContents": "object (本机抽样中多为 {})",
  "timestamp": "number (epoch 毫秒)",
  "project": "string (cwd/项目路径)",
  "sessionId": "string (uuid)"
}
```

备注：
- `timestamp` 为毫秒（ms），不是秒（s）。
- `project` 是绝对路径，fixture 需要彻底脱敏，但保留“像路径”的结构以覆盖解析逻辑。
- 同一个 `sessionId` 通常对应同一段交互期内多条记录。

### 2.2 会话元信息：`$HOME/.claude/sessions/*.json`

本机抽样观测到的字段形状（单行 JSON）：

```json
{
  "pid": "number",
  "sessionId": "string (uuid)",
  "cwd": "string (绝对路径)",
  "startedAt": "number (epoch 毫秒)",
  "version": "string (例如 2.1.114)",
  "kind": "string (例如 interactive)",
  "entrypoint": "string (例如 cli)"
}
```

备注：本任务 fixture 目标是 JSONL，优先对齐 `history.jsonl` 的 shape；`sessions/*.json` 作为补充来源记录在本文档中。

## 3. Codex（`$HOME/.codex`）字段形状记录

### 3.1 输入历史：`$HOME/.codex/history.jsonl`

文件格式：JSONL

本机抽样观测到的字段形状：

```json
{
  "session_id": "string (类似 uuid/ulid 的 id)",
  "ts": "number (epoch 秒)",
  "text": "string (用户输入文本)"
}
```

备注：`ts` 为秒（s），与 Claude Code 的 `timestamp`（ms）不同。

### 3.2 会话索引：`$HOME/.codex/session_index.jsonl`

文件格式：JSONL

本机抽样观测到的字段形状：

```json
{
  "id": "string (session id)",
  "thread_name": "string",
  "updated_at": "string (RFC3339, 例如 2026-03-09T02:16:09.239231Z)"
}
```

### 3.3 其他存储

本机还存在 SQLite 文件（例如 `$HOME/.codex/logs_2.sqlite`、`$HOME/.codex/state_5.sqlite`）。本 Task 2 不做深入读取，只记录其存在性，后续如需覆盖更多真实字段可再补充 fixture。

## 4. Fixture 约定

本次在仓库内新增的 fixture：
- `src-tauri/tests/fixtures/claude_code/sample-session.jsonl`
- `src-tauri/tests/fixtures/codex/sample-session.jsonl`

脱敏策略：
- 绝对路径统一替换为 `/Users/REDACTED/...` 形态，保留路径分隔与层级。
- 文本内容替换为无业务敏感信息的占位文本，但保留中英文混合与命令形态（如 `/help`、`/exit`）以覆盖解析分支。

