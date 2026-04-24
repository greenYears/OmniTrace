pub mod claude_code;
pub mod codex;

use std::io;
use std::path::{Component, Path, PathBuf};

use anyhow::Result;

use crate::domain::models::NormalizedSession;

pub trait SessionAdapter {
    fn source_id(&self) -> &'static str;
    fn discover_sessions(&self) -> io::Result<Vec<PathBuf>>;
    fn parse_session(&self, path: &Path) -> Result<NormalizedSession>;
}

fn is_subagent_worktree(path: &Path) -> Option<PathBuf> {
    let components: Vec<_> = path.components().collect();

    for index in 0..components.len() {
        let current = components[index];
        let next = components.get(index + 1);
        let after_next = components.get(index + 2);
        let agent = components.get(index + 3);

        let Component::Normal(current_name) = current else {
            continue;
        };

        if !(current_name == ".claude" || current_name == ".codex") {
            continue;
        }
        if next != Some(&Component::Normal("worktrees".as_ref())) {
            continue;
        }
        let Some(Component::Normal(agent_name)) = agent else {
            continue;
        };
        if after_next.is_none() || !agent_name.to_string_lossy().starts_with("agent-") {
            continue;
        }

        let mut base = PathBuf::new();
        for component in &components[..index] {
            base.push(component.as_os_str());
        }
        return Some(base);
    }

    None
}

fn find_repo_root(path: &Path) -> Option<PathBuf> {
    for ancestor in path.ancestors() {
        let git_dir = ancestor.join(".git");
        if git_dir.is_dir() || git_dir.is_file() {
            return Some(ancestor.to_path_buf());
        }
    }

    None
}

pub(crate) fn normalize_project_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "Unknown Project" {
        return "Unknown Project".to_string();
    }

    let path_buf = PathBuf::from(trimmed);

    if let Some(base) = is_subagent_worktree(&path_buf) {
        return base.display().to_string();
    }

    if path_buf
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value == "src-tauri")
    {
        if let Some(parent) = path_buf.parent() {
            return parent.display().to_string();
        }
    }

    if let Some(root) = find_repo_root(&path_buf) {
        return root.display().to_string();
    }

    trimmed.to_string()
}

pub(crate) fn project_display_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Unknown Project")
        .to_string()
}

pub(crate) fn discover_jsonl_sessions(root: &Path) -> io::Result<Vec<PathBuf>> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) -> io::Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if std::fs::symlink_metadata(&path)?.file_type().is_symlink() {
                continue;
            }
            if path.is_dir() {
                if path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value == "subagents")
                {
                    continue;
                }
                walk(&path, out)?;
                continue;
            }

            let is_jsonl = path
                .extension()
                .and_then(|s| s.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("jsonl"));
            if is_jsonl {
                out.push(path);
            }
        }
        Ok(())
    }

    let mut out = Vec::new();
    walk(root, &mut out)?;
    out.sort();
    Ok(out)
}
