pub mod claude_code;
pub mod codex;

use std::io;
use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::domain::models::NormalizedSession;

pub trait SessionAdapter {
    fn source_id(&self) -> &'static str;
    fn discover_sessions(&self) -> io::Result<Vec<PathBuf>>;
    fn parse_session(&self, path: &Path) -> Result<NormalizedSession>;
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
