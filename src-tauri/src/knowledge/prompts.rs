pub const EVIDENCE_EXTRACTION_SYSTEM: &str = r#"你是一个代码项目分析助手。根据以下 AI 编程助手的历史对话片段，抽取结构化知识证据。只输出 JSON 数组，不要输出其他内容。

证据类型：
- task_pattern: 反复出现的开发任务模式
- domain_rule: 项目特有的业务规则或技术约束
- pitfall: 曾经遇到的问题、错误和解决方案
- verification: 验证和测试相关的命令或流程
- file_area: 关键文件区域和职责说明

每条证据格式：
{
  "type": "task_pattern|domain_rule|pitfall|verification|file_area",
  "title": "简短标题",
  "summary": "一句话总结",
  "details": "详细说明",
  "recommended_action": "建议做法",
  "related_files": ["路径"],
  "source_refs": [{"session_title": "...", "timestamp": "...", "excerpt": "关键片段"}],
  "confidence": 0.0到1.0之间的数值
}

要求：
- 只输出 JSON 数组
- 每条证据必须有明确的来源依据
- confidence 反映证据的确定程度
- 不要编造对话中没有的信息
- 优先抽取可操作的、对后续开发有帮助的知识"#;

pub const EVIDENCE_EXTRACTION_FIX: &str = "你的上一次回复不是合法的 JSON。请只输出一个 JSON 数组，不要包含 markdown 代码块、注释或其他文本。";

pub fn synthesis_system_prompt(doc_type: &str, template: &str) -> String {
    format!(
        "你是一个技术文档撰写助手。根据以下结构化证据，生成一份 Markdown 文档。\n\n\
         文档正文要简洁、可操作，适合 AI 编程助手直接参考。\n\
         来源引用放在文档末尾的「## 附录: 来源」章节。\n\
         不要编造证据中没有的信息。\n\
         如果某条证据的 confidence 较低，在附录中标注「待验证」。\n\n\
         文档类型: {doc_type}\n\
         文档结构:\n{template}"
    )
}

pub const COMMON_TASKS_TEMPLATE: &str = "## 适用范围\n## 常见任务类型\n## 修改前应阅读的文件\n## 推荐实现步骤\n## 常用验证命令\n## 需要避免的做法\n## 附录: 来源";

pub const DOMAIN_RULES_TEMPLATE: &str = "## 核心概念\n## 关键数据流\n## 业务约束\n## 用户偏好\n## 不应破坏的行为\n## 仍不确定的信息\n## 附录: 来源";

pub const PITFALLS_TEMPLATE: &str = "## 问题现象\n## 根因\n## 正确处理方式\n## 预防规则\n## 验证方式\n## 附录: 来源";
