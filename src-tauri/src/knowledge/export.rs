use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

use super::models::{KnowledgeDocument, OverwriteStrategy, ProjectExportSettings};

#[derive(Debug, Clone)]
pub struct ExportDiff {
    pub target_path: PathBuf,
    pub exists: bool,
    pub old_content: Option<String>,
    pub new_content: String,
    pub unified_diff: String,
}

#[derive(Debug, Clone)]
pub struct ExportResult {
    pub target_path: PathBuf,
    pub written: bool,
    pub message: String,
}

pub fn validate_export_path(project_root: &Path, relative_path: &str) -> Result<PathBuf> {
    if relative_path.is_empty() {
        bail!("export path cannot be empty");
    }

    let candidate = project_root.join(relative_path);

    let project_canonical = project_root
        .canonicalize()
        .with_context(|| "canonicalize project root")?;

    // For existing paths, canonicalize directly
    if candidate.exists() {
        let canonical = candidate
            .canonicalize()
            .with_context(|| "canonicalize export path")?;
        if !canonical.starts_with(&project_canonical) {
            bail!("export path escapes project root");
        }
        return Ok(canonical);
    }

    // For non-existing paths, canonicalize the parent
    let parent = candidate.parent().unwrap_or(project_root);
    std::fs::create_dir_all(parent)
        .with_context(|| format!("create export directory: {}", parent.display()))?;

    let parent_canonical = parent
        .canonicalize()
        .with_context(|| "canonicalize export parent")?;

    if !parent_canonical.starts_with(&project_canonical) {
        bail!("export path escapes project root");
    }

    let file_name = candidate
        .file_name()
        .with_context(|| "export path has no filename")?;

    Ok(parent_canonical.join(file_name))
}

pub fn generate_export_diffs(
    project_root: &Path,
    settings: &ProjectExportSettings,
    documents: &[KnowledgeDocument],
) -> Result<Vec<ExportDiff>> {
    let mut diffs = Vec::new();

    for doc in documents {
        let filename = match doc.doc_type {
            super::models::DocType::CommonTasks => &settings.common_tasks_filename,
            super::models::DocType::DomainRules => &settings.domain_rules_filename,
            super::models::DocType::Pitfalls => &settings.pitfalls_filename,
        };

        let relative = format!("{}{}", settings.export_dir, filename);
        let target_path = validate_export_path(project_root, &relative)?;

        let (exists, old_content) = if target_path.exists() {
            let content = std::fs::read_to_string(&target_path)
                .with_context(|| format!("read existing file: {}", target_path.display()))?;
            (true, Some(content))
        } else {
            (false, None)
        };

        let unified_diff = generate_unified_diff(
            old_content.as_deref().unwrap_or(""),
            &doc.markdown,
            &relative,
        );

        diffs.push(ExportDiff {
            target_path,
            exists,
            old_content,
            new_content: doc.markdown.clone(),
            unified_diff,
        });
    }

    Ok(diffs)
}

pub fn execute_export(diffs: &[ExportDiff], strategy: OverwriteStrategy) -> Result<Vec<ExportResult>> {
    let mut results = Vec::new();

    for diff in diffs {
        if diff.exists {
            match strategy {
                OverwriteStrategy::Cancel => {
                    results.push(ExportResult {
                        target_path: diff.target_path.clone(),
                        written: false,
                        message: "cancelled: file already exists".to_string(),
                    });
                    continue;
                }
                OverwriteStrategy::VersionedSuffix => {
                    let versioned_path = generate_versioned_path(&diff.target_path);
                    std::fs::write(&versioned_path, &diff.new_content)
                        .with_context(|| format!("write versioned file: {}", versioned_path.display()))?;
                    results.push(ExportResult {
                        target_path: versioned_path,
                        written: true,
                        message: "written as versioned file".to_string(),
                    });
                    continue;
                }
                OverwriteStrategy::Overwrite => {
                    // Fall through to write
                }
            }
        }

        if let Some(parent) = diff.target_path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("create directory: {}", parent.display()))?;
        }

        std::fs::write(&diff.target_path, &diff.new_content)
            .with_context(|| format!("write file: {}", diff.target_path.display()))?;

        results.push(ExportResult {
            target_path: diff.target_path.clone(),
            written: true,
            message: if diff.exists {
                "overwritten".to_string()
            } else {
                "created".to_string()
            },
        });
    }

    Ok(results)
}

fn generate_versioned_path(path: &Path) -> PathBuf {
    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
    let ext = path.extension().map(|e| e.to_string_lossy().to_string());

    for i in 2..100 {
        let new_name = match &ext {
            Some(e) => format!("{stem}.v{i}.{e}"),
            None => format!("{stem}.v{i}"),
        };
        let candidate = path.with_file_name(new_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    // Fallback with timestamp
    let ts = chrono::Utc::now().format("%Y%m%d%H%M%S");
    let new_name = match &ext {
        Some(e) => format!("{stem}.{ts}.{e}"),
        None => format!("{stem}.{ts}"),
    };
    path.with_file_name(new_name)
}

fn generate_unified_diff(old: &str, new: &str, filename: &str) -> String {
    let old_lines: Vec<&str> = old.lines().collect();
    let new_lines: Vec<&str> = new.lines().collect();

    if old.is_empty() {
        let mut diff = format!("--- /dev/null\n+++ b/{filename}\n@@ -0,0 +1,{} @@\n", new_lines.len());
        for line in &new_lines {
            diff.push_str(&format!("+{line}\n"));
        }
        return diff;
    }

    let mut diff = format!("--- a/{filename}\n+++ b/{filename}\n");

    // Simple line-by-line diff (not optimal but functional)
    let max_len = old_lines.len().max(new_lines.len());
    let mut changes = Vec::new();
    let mut i = 0;

    while i < max_len {
        let old_line = old_lines.get(i).copied();
        let new_line = new_lines.get(i).copied();

        if old_line != new_line {
            let start = i;
            while i < max_len && old_lines.get(i) != new_lines.get(i) {
                i += 1;
            }
            changes.push((start, i));
        } else {
            i += 1;
        }
    }

    for (start, end) in changes {
        let context_start = start.saturating_sub(3);
        let context_end = (end + 3).min(max_len);

        diff.push_str(&format!(
            "@@ -{},{} +{},{} @@\n",
            context_start + 1,
            (end - context_start).min(old_lines.len().saturating_sub(context_start)),
            context_start + 1,
            (context_end - context_start).min(new_lines.len().saturating_sub(context_start)),
        ));

        for j in context_start..context_end {
            let old_line = old_lines.get(j);
            let new_line = new_lines.get(j);
            match (old_line, new_line) {
                (Some(o), Some(n)) if o == n => diff.push_str(&format!(" {o}\n")),
                (Some(o), Some(n)) => {
                    diff.push_str(&format!("-{o}\n"));
                    diff.push_str(&format!("+{n}\n"));
                }
                (Some(o), None) => diff.push_str(&format!("-{o}\n")),
                (None, Some(n)) => diff.push_str(&format!("+{n}\n")),
                (None, None) => {}
            }
        }
    }

    diff
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn validate_path_within_project() {
        let dir = TempDir::new().unwrap();
        let result = validate_export_path(dir.path(), "docs/agents/test.md");
        assert!(result.is_ok());
    }

    #[test]
    fn validate_path_rejects_traversal() {
        let dir = TempDir::new().unwrap();
        let result = validate_export_path(dir.path(), "../../../etc/passwd");
        assert!(result.is_err());
    }

    #[test]
    fn validate_path_rejects_empty() {
        let dir = TempDir::new().unwrap();
        let result = validate_export_path(dir.path(), "");
        assert!(result.is_err());
    }

    #[test]
    fn generate_diff_for_new_file() {
        let diff = generate_unified_diff("", "line1\nline2", "test.md");
        assert!(diff.contains("+line1"));
        assert!(diff.contains("+line2"));
        assert!(diff.contains("--- /dev/null"));
    }

    #[test]
    fn execute_export_creates_new_file() {
        let dir = TempDir::new().unwrap();
        let target = dir.path().join("docs/test.md");

        let diffs = vec![ExportDiff {
            target_path: target.clone(),
            exists: false,
            old_content: None,
            new_content: "# Test\nContent".to_string(),
            unified_diff: String::new(),
        }];

        let results = execute_export(&diffs, OverwriteStrategy::Overwrite).unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].written);
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "# Test\nContent");
    }

    #[test]
    fn execute_export_cancel_skips_existing() {
        let dir = TempDir::new().unwrap();
        let target = dir.path().join("existing.md");
        std::fs::write(&target, "old").unwrap();

        let diffs = vec![ExportDiff {
            target_path: target.clone(),
            exists: true,
            old_content: Some("old".to_string()),
            new_content: "new".to_string(),
            unified_diff: String::new(),
        }];

        let results = execute_export(&diffs, OverwriteStrategy::Cancel).unwrap();
        assert!(!results[0].written);
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "old");
    }

    #[test]
    fn execute_export_versioned_creates_new_file() {
        let dir = TempDir::new().unwrap();
        let target = dir.path().join("test.md");
        std::fs::write(&target, "old").unwrap();

        let diffs = vec![ExportDiff {
            target_path: target.clone(),
            exists: true,
            old_content: Some("old".to_string()),
            new_content: "new".to_string(),
            unified_diff: String::new(),
        }];

        let results = execute_export(&diffs, OverwriteStrategy::VersionedSuffix).unwrap();
        assert!(results[0].written);
        assert!(results[0].target_path.to_string_lossy().contains(".v2."));
        // Original unchanged
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "old");
    }
}
