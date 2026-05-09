# 项目知识生成设计文档

## 1. 背景与目标

OmniTrace 当前已经能够扫描并浏览本机 `Claude Code`、`Codex` 等 AI Coding TUI 的历史会话。下一阶段希望把这些历史会话进一步沉淀为项目级知识，让后续 Agent 进入某个项目时，可以先读取稳定、结构化、可追溯的文档，从而减少重复沟通、重复排查和重复踩坑。

本功能新增“项目知识生成”能力：用户选择一个项目后，OmniTrace 基于该项目历史会话，通过 LLM 分析内容，并生成一组适合后续 Agent 工作时参考的 Markdown 文档。

第一版默认生成三类文档：

- `common-tasks.md`：常见任务指南
- `domain-rules.md`：领域知识与业务规则
- `pitfalls.md`：踩坑记录

生成结果先保存在 OmniTrace 内部，用户可以预览、编辑、重新生成，并在确认后导出到项目仓库中自定义目录。

## 2. 产品范围

### 2.1 包含范围

- 支持用户配置 OpenAI-compatible LLM Provider
- 支持按项目选择历史会话
- 支持最近 30 天、全量、手动选择三种分析范围
- 默认对发送给 LLM 的内容做脱敏
- 调用 LLM 前展示确认页，包括会话数量、时间范围、预计 token、预计费用、风险提示
- 使用“两阶段流水线”：先抽取结构化证据，再合成 Markdown 文档
- 在 OmniTrace 内保存生成记录、证据和文档版本
- 支持用户配置导出目录和文件名
- 导出到项目仓库前展示 diff，并由用户确认覆盖
- 文档正文保持干净，附录保留来源引用

### 2.2 不包含范围

第一版不做以下能力：

- 实时监听并自动生成文档
- 跨项目知识合并
- 图片理解或多模态分析
- Agent 问答聊天
- 自动写入根目录 `AGENTS.md`
- 云同步
- 多人协作
- 复杂权限系统

这些能力可以作为后续版本在当前数据模型上继续扩展。

## 3. 核心设计决策

### 3.1 使用两阶段流水线

不采用“一次性把整个项目历史发给 LLM”的方式。历史会话可能非常长，且包含大量重复日志、工具输出和文件内容，直接发送容易触发请求体限制，也难以追溯总结来源。

推荐流程：

1. 读取项目历史会话
2. 本地脱敏和裁剪
3. 分批调用 LLM 抽取结构化证据
4. 将证据写入 SQLite
5. 对证据去重、合并和排序
6. 调用 LLM 合成三类 Markdown 文档
7. 保存文档版本
8. 用户预览、编辑、导出

### 3.2 正文干净，附录可追溯

生成文档的正文要适合 Agent 直接读取，不在每条规则旁边堆叠大量来源信息。来源引用放到文档附录中，记录结论来自哪些会话、时间和摘要片段，方便人类复核。

### 3.3 生成和导出解耦

LLM 生成结果先进入 OmniTrace 内部知识库，不直接写入项目仓库。导出是用户显式触发的操作，并且可以配置目标目录和覆盖策略。

这样可以避免不成熟的 LLM 输出直接污染项目仓库，也便于未来支持版本对比、重新生成和人工编辑。

## 4. 用户流程

### 4.1 配置 LLM Provider

用户在设置页配置：

- Provider 名称
- Base URL
- API Key
- Model
- Temperature
- Max output tokens
- 是否启用

第一版采用 OpenAI-compatible 接口格式，便于兼容 OpenAI、GLM 兼容网关、Claude 兼容网关、本地 OpenAI-compatible 服务等。

### 4.2 选择项目和分析范围

用户进入“知识”页面后选择项目。

范围选项：

- 默认：最近 30 天
- 全量：项目所有历史会话
- 手动选择：用户从会话列表中勾选参与分析的会话

后续可以基于 `project_knowledge_runs` 增加增量更新，只分析上次生成后新增的会话。

### 4.3 发送前确认

调用 LLM 前必须展示确认页：

- 项目名称和路径
- 会话数量
- 时间范围
- 文档类型
- 预计 input tokens
- 预计 output tokens
- 预计费用
- 脱敏规则状态
- 风险提示

用户确认后才允许发起 LLM 请求。

### 4.4 生成、预览和编辑

生成过程分为：

1. 准备内容
2. 抽取证据
3. 合并证据
4. 合成文档
5. 保存版本

完成后用户可以在 OmniTrace 内预览三份文档，并可进行轻量编辑。编辑后的版本仍保存到 OmniTrace 数据库中。

### 4.5 导出到项目仓库

用户可以为每个项目配置导出目录，例如：

- `docs/agents/`
- `.agents/`
- `.claude/`
- `docs/ai-context/`
- 自定义相对路径

导出前展示目标文件和 diff。若目标文件已存在，默认要求用户确认覆盖。第一版提供三种策略：

- 覆盖原文件
- 生成带版本后缀的新文件
- 取消导出

## 5. 数据模型

### 5.1 llm_providers

保存 LLM Provider 配置。

建议字段：

- `id`
- `name`
- `base_url`
- `model`
- `temperature`
- `max_output_tokens`
- `enabled`
- `created_at`
- `updated_at`

API Key 不建议明文存 SQLite。优先使用系统 Keychain。若第一版先使用本机配置文件，需要在 UI 明确提示风险，并避免把 key 写入项目仓库。

### 5.2 project_knowledge_runs

记录一次项目知识生成任务。

建议字段：

- `id`
- `project_id`
- `provider_id`
- `model`
- `scope_type`
- `started_at_filter`
- `ended_at_filter`
- `selected_session_ids_json`
- `status`
- `estimated_input_tokens`
- `estimated_output_tokens`
- `actual_input_tokens`
- `actual_output_tokens`
- `error_message`
- `created_at`
- `finished_at`

`status` 可取值：

- `draft`
- `awaiting_confirmation`
- `extracting`
- `synthesizing`
- `completed`
- `failed`
- `cancelled`

### 5.3 knowledge_evidence

保存 LLM 从历史会话中抽取出的结构化证据。

建议字段：

- `id`
- `run_id`
- `project_id`
- `evidence_type`
- `title`
- `content_json`
- `confidence`
- `source_refs_json`
- `created_at`

`evidence_type` 可取值：

- `task_pattern`
- `domain_rule`
- `pitfall`
- `verification`
- `file_area`

`source_refs_json` 记录来源会话、时间、消息摘要，不保存超长原文。

### 5.4 knowledge_documents

保存生成出的 Markdown 文档。

建议字段：

- `id`
- `run_id`
- `project_id`
- `doc_type`
- `title`
- `markdown`
- `version`
- `edited`
- `export_path`
- `exported_at`
- `created_at`
- `updated_at`

`doc_type` 可取值：

- `common_tasks`
- `domain_rules`
- `pitfalls`

### 5.5 project_export_settings

保存每个项目的导出偏好。

建议字段：

- `project_id`
- `export_dir`
- `common_tasks_filename`
- `domain_rules_filename`
- `pitfalls_filename`
- `overwrite_strategy`
- `updated_at`

`export_dir` 使用项目内相对路径，默认不允许写到项目根目录之外。

## 6. LLM 分批策略

### 6.1 分块原则

输入不能按整个项目一次性发送。第一版按 session 聚合，再按 token 预算切块。

建议默认预算：

- 单批 input 上限：约 20k tokens
- 单批 output 上限：按 Provider 配置控制
- 超长 session 单独切块

### 6.2 本地裁剪规则

对历史消息进行本地裁剪，优先保留：

- 用户需求
- Assistant 的最终结论
- 关键设计说明
- 错误信息
- 验证命令和结果
- 文件路径和模块名
- 工具调用摘要

优先移除或压缩：

- 超长构建日志
- 重复工具输出
- 大段文件全文
- 大量无意义空白
- 图片原始内容

第一版不把图片作为 LLM 输入，只保留“该会话包含图片附件”的元信息。

### 6.3 证据 JSON 输出

证据抽取阶段要求 LLM 返回结构化 JSON。每条证据至少包含：

- `type`
- `title`
- `summary`
- `details`
- `recommended_action`
- `related_files`
- `source_refs`
- `confidence`

Rust 层必须校验 JSON 可解析。如果解析失败，可以重试一次，并使用更严格的“只输出 JSON”修复提示。

## 7. 脱敏策略

第一版默认启用脱敏。

规则包括：

- `/Users/<name>/...` 替换为 `~/...`
- 疑似 API key、token、secret 替换为 `[REDACTED_SECRET]`
- 邮箱替换为 `[REDACTED_EMAIL]`
- 手机号替换为 `[REDACTED_PHONE]`
- 过长文件片段替换为摘要说明

脱敏发生在调用 LLM 前。数据库中仍保留原始会话解析结果，知识生成任务保存的是脱敏后摘要和 LLM 生成结果。

## 8. 文档模板

### 8.1 common-tasks.md

用途：告诉后续 Agent 做常见任务时如何下手。

建议结构：

- 适用范围
- 常见任务类型
- 修改前应阅读的文件
- 推荐实现步骤
- 常用验证命令
- 需要避免的做法
- 附录：来源会话

### 8.2 domain-rules.md

用途：沉淀项目领域知识、业务规则和用户偏好。

建议结构：

- 核心概念
- 关键数据流
- 业务约束
- 用户偏好
- 不应破坏的行为
- 仍不确定的信息
- 附录：来源会话

### 8.3 pitfalls.md

用途：记录历史问题、根因和避免方式。

建议结构：

- 问题现象
- 根因
- 正确处理方式
- 预防规则
- 验证方式
- 附录：来源会话

## 9. UI 设计

新增主导航入口：`知识`。

页面布局建议延续现有三栏桌面结构：

- 左栏：项目列表、范围选择、Provider 状态
- 中栏：生成任务列表和当前 run 状态
- 右栏：文档预览与导出操作

右栏文档预览使用 Tab：

- 任务指南
- 业务规则
- 踩坑记录

主要操作：

- 生成知识
- 重新生成
- 编辑当前文档
- 配置导出目录
- 预览 diff
- 导出到项目

## 10. 后端模块设计

建议新增后端模块：

- `src-tauri/src/knowledge/`
  - `mod.rs`
  - `scope.rs`：项目范围和会话选择
  - `redaction.rs`：脱敏
  - `chunking.rs`：裁剪和分块
  - `evidence.rs`：证据模型和合并
  - `documents.rs`：文档合成和模板
  - `export.rs`：导出和 diff

建议新增 Tauri commands：

- `list_llm_providers`
- `save_llm_provider`
- `estimate_knowledge_run`
- `create_knowledge_run`
- `confirm_knowledge_run`
- `get_knowledge_run`
- `list_knowledge_documents`
- `update_knowledge_document`
- `preview_knowledge_export_diff`
- `export_knowledge_documents`

## 11. 前端模块设计

建议新增前端模块：

- `src/features/knowledge/KnowledgeView.tsx`
- `src/features/knowledge/KnowledgeRunPanel.tsx`
- `src/features/knowledge/KnowledgeDocumentPreview.tsx`
- `src/features/knowledge/KnowledgeExportSettings.tsx`
- `src/features/knowledge/KnowledgeConfirmDialog.tsx`
- `src/stores/useKnowledgeStore.ts`
- `src/types/knowledge.ts`

前端只消费 Tauri DTO，不直接构造 LLM prompt。

## 12. 错误处理

必须处理以下场景：

- API Key 未配置
- Provider 请求失败
- LLM 返回非 JSON
- 单批内容超过预算
- 用户取消任务
- 项目历史为空
- 脱敏后内容不足
- 导出目录不存在
- 导出路径越界
- 目标文件已存在
- 写文件无权限

失败的 run 保留状态和错误信息，支持用户查看原因并重试。

## 13. 测试策略

### 13.1 Rust 测试

覆盖：

- 脱敏规则
- token 估算边界
- session 分块
- 证据 JSON 解析
- 证据合并去重
- 导出路径校验
- diff 生成
- schema migration

### 13.2 前端测试

覆盖：

- Provider 配置表单
- 生成前确认页
- run 状态展示
- 文档 Tab 预览
- 导出目录配置
- diff 确认流程
- 错误状态展示

### 13.3 集成测试

使用 fixture 会话构造一个小项目，验证从会话选择到生成文档 DTO 的主流程。LLM 调用使用 mock provider，不在测试中访问真实网络。

## 14. 分阶段落地建议

### 阶段一：本地结构与 UI 骨架

- 新增 schema
- 新增知识页面
- 新增 Provider 配置
- 新增导出设置
- 不调用真实 LLM，先用 mock 数据打通 UI

### 阶段二：证据抽取

- 实现范围选择
- 实现脱敏和分块
- 接入 OpenAI-compatible Provider
- 保存结构化证据

### 阶段三：文档合成和编辑

- 基于证据生成三类 Markdown
- 支持预览、编辑、版本保存
- 处理 JSON 解析失败和重试

### 阶段四：导出到项目仓库

- 支持自定义导出目录
- 支持 diff 预览
- 支持覆盖或生成版本文件
- 增加路径越界保护

## 15. 关键约束

- 不允许把整个项目历史一次性发送给 LLM
- 不允许默认把 LLM 输出直接写入项目仓库
- 不允许绕过发送前确认
- 不允许导出到项目根目录之外
- 不允许把 API Key 写入项目仓库
- 不允许让前端直接拼接 LLM prompt

这些约束用于保证功能可控、可审计，并避免复现历史中的超大请求问题。
