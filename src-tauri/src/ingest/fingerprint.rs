use std::path::Path;
use std::time::UNIX_EPOCH;

use anyhow::Result;

pub fn file_fingerprint(path: &Path) -> Result<String> {
    let meta = std::fs::metadata(path)?;
    let mtime = meta.modified()?.duration_since(UNIX_EPOCH)?.as_secs();
    Ok(format!("{}:{}", meta.len(), mtime))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn fingerprint_changes_on_file_content_change() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.jsonl");
        fs::write(&path, "line1\n").unwrap();
        let fp1 = file_fingerprint(&path).unwrap();

        // Ensure mtime changes by writing new content
        fs::write(&path, "line1\nline2\n").unwrap();
        // On some filesystems mtime resolution is 1s, so wait briefly
        std::thread::sleep(std::time::Duration::from_millis(10));
        let _ = fs::metadata(&path).unwrap(); // touch metadata
        let fp2 = file_fingerprint(&path).unwrap();

        // Size differs: "6\n" vs "12\n"
        assert_ne!(fp1, fp2);
    }

    #[test]
    fn fingerprint_format_is_size_colon_mtime() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.txt");
        fs::write(&path, "hello").unwrap();
        let fp = file_fingerprint(&path).unwrap();
        let parts: Vec<&str> = fp.split(':').collect();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0].parse::<u64>().unwrap(), 5);
        assert!(parts[1].parse::<u64>().unwrap() > 0);
    }
}
