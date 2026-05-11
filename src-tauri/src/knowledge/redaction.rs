use regex::Regex;

pub struct RedactionEngine {
    rules: Vec<RedactionRule>,
}

struct RedactionRule {
    pattern: Regex,
    replacement: &'static str,
}

impl RedactionEngine {
    pub fn with_default_rules() -> Self {
        let rules = vec![
            RedactionRule {
                pattern: Regex::new(r"/Users/[^/\s]+/").unwrap(),
                replacement: "~/",
            },
            RedactionRule {
                pattern: Regex::new(
                    r"(?i)(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36,}|gho_[a-zA-Z0-9]{36,}|github_pat_[a-zA-Z0-9_]{22,}|xox[baprs]-[a-zA-Z0-9\-]{10,}|Bearer\s+[a-zA-Z0-9\-._~+/]{20,})"
                ).unwrap(),
                replacement: "[REDACTED_SECRET]",
            },
            RedactionRule {
                pattern: Regex::new(
                    r#"(?i)(?:api[_-]?key|secret|token|password|passwd)\s*[=:]\s*['"]?([a-zA-Z0-9\x2D._~+/]{16,})['"]?"#
                ).unwrap(),
                replacement: "[REDACTED_SECRET]",
            },
            RedactionRule {
                pattern: Regex::new(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}").unwrap(),
                replacement: "[REDACTED_EMAIL]",
            },
            RedactionRule {
                pattern: Regex::new(r"\b1[3-9]\d{9}\b").unwrap(),
                replacement: "[REDACTED_PHONE]",
            },
        ];

        Self { rules }
    }

    pub fn redact(&self, text: &str) -> String {
        let mut result = text.to_string();
        for rule in &self.rules {
            result = rule.pattern.replace_all(&result, rule.replacement).to_string();
        }
        result = truncate_long_blocks(&result);
        result
    }
}

fn truncate_long_blocks(text: &str) -> String {
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() <= 50 {
        return text.to_string();
    }

    let mut result = String::with_capacity(text.len());
    let mut i = 0;
    while i < lines.len() {
        let mut block_len = 0;
        let block_start = i;
        while i < lines.len() && !lines[i].trim().is_empty() {
            block_len += 1;
            i += 1;
        }

        if block_len > 50 {
            for line in &lines[block_start..block_start + 5] {
                result.push_str(line);
                result.push('\n');
            }
            let char_count: usize = lines[block_start..block_start + block_len]
                .iter()
                .map(|l| l.len() + 1)
                .sum();
            result.push_str(&format!(
                "[... TRUNCATED: {char_count} chars, {block_len} lines ...]\n"
            ));
        } else {
            for line in &lines[block_start..block_start + block_len] {
                result.push_str(line);
                result.push('\n');
            }
        }

        // consume blank lines
        while i < lines.len() && lines[i].trim().is_empty() {
            result.push_str(lines[i]);
            result.push('\n');
            i += 1;
        }
    }

    // preserve original trailing newline behavior
    if !text.ends_with('\n') && result.ends_with('\n') {
        result.pop();
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_home_path() {
        let engine = RedactionEngine::with_default_rules();
        let input = "File at /Users/john/Documents/project/src/main.rs";
        let result = engine.redact(input);
        assert_eq!(result, "File at ~/Documents/project/src/main.rs");
    }

    #[test]
    fn redacts_openai_api_key() {
        let engine = RedactionEngine::with_default_rules();
        let input = "Using key sk-abcdefghijklmnopqrstuvwxyz1234567890";
        let result = engine.redact(input);
        assert!(result.contains("[REDACTED_SECRET]"));
        assert!(!result.contains("sk-abcdefghijklmnopqrstuvwxyz1234567890"));
    }

    #[test]
    fn redacts_github_token() {
        let engine = RedactionEngine::with_default_rules();
        let input = "export GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl";
        let result = engine.redact(input);
        assert!(result.contains("[REDACTED_SECRET]"));
    }

    #[test]
    fn redacts_env_var_secrets() {
        let engine = RedactionEngine::with_default_rules();
        let input = "API_KEY=my_super_secret_key_12345678";
        let result = engine.redact(input);
        assert!(result.contains("[REDACTED_SECRET]"));
    }

    #[test]
    fn redacts_email() {
        let engine = RedactionEngine::with_default_rules();
        let input = "Contact user@example.com for details";
        let result = engine.redact(input);
        assert_eq!(result, "Contact [REDACTED_EMAIL] for details");
    }

    #[test]
    fn redacts_phone_number() {
        let engine = RedactionEngine::with_default_rules();
        let input = "Call me at 13812345678";
        let result = engine.redact(input);
        assert_eq!(result, "Call me at [REDACTED_PHONE]");
    }

    #[test]
    fn does_not_redact_normal_code_paths() {
        let engine = RedactionEngine::with_default_rules();
        let input = "import { useState } from 'react';\nconst x = 42;";
        let result = engine.redact(input);
        assert_eq!(result, input);
    }

    #[test]
    fn does_not_false_positive_on_short_numbers() {
        let engine = RedactionEngine::with_default_rules();
        let input = "port 3000 and timeout 12345";
        let result = engine.redact(input);
        assert_eq!(result, input);
    }

    #[test]
    fn handles_empty_input() {
        let engine = RedactionEngine::with_default_rules();
        assert_eq!(engine.redact(""), "");
    }

    #[test]
    fn applies_multiple_rules() {
        let engine = RedactionEngine::with_default_rules();
        let input = "User /Users/alice/proj used key sk-aaaabbbbccccddddeeeeffffgggg with email alice@test.com";
        let result = engine.redact(input);
        assert!(result.contains("~/proj"));
        assert!(result.contains("[REDACTED_SECRET]"));
        assert!(result.contains("[REDACTED_EMAIL]"));
    }
}
