use crate::error::AppError;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

/// RAII guard for atomic `.part` writes: writes to `cache_dir/<prefix>_<uuid>.pdf.part`
/// and atomically renames/copies to `final_path` on `commit()`, cleaning up on drop.
pub struct PartFileGuard {
    part_path: PathBuf,
    final_path: PathBuf,
    committed: bool,
}

impl PartFileGuard {
    pub fn new(cache_dir: &Path, final_path: &Path, prefix: &str) -> Result<Self, AppError> {
        fs::create_dir_all(cache_dir)?;
        if let Some(parent) = final_path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent)?;
            }
        }
        let part_path = cache_dir.join(format!("{prefix}_{}.pdf.part", Uuid::new_v4()));
        Ok(Self {
            part_path,
            final_path: final_path.to_path_buf(),
            committed: false,
        })
    }

    pub fn part_path(&self) -> &Path {
        &self.part_path
    }

    pub fn commit(mut self) -> Result<u64, AppError> {
        if fs::rename(&self.part_path, &self.final_path).is_err() {
            fs::copy(&self.part_path, &self.final_path)?;
            let _ = fs::remove_file(&self.part_path);
        }
        self.committed = true;
        Ok(fs::metadata(&self.final_path)?.len())
    }
}

impl Drop for PartFileGuard {
    fn drop(&mut self) {
        if !self.committed && self.part_path.exists() {
            let _ = fs::remove_file(&self.part_path);
        }
    }
}

/// Removes any orphaned `.part` temporary files left behind in `cache_dir` from an unclean shutdown.
pub fn sweep_orphaned_part_files(cache_dir: &Path) -> Result<usize, AppError> {
    if !cache_dir.exists() {
        fs::create_dir_all(cache_dir)?;
        return Ok(0);
    }

    let mut removed = 0;
    for entry in fs::read_dir(cache_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.ends_with(".part")
                    || (name.starts_with("vstamp_") && name.ends_with(".pdf"))
                {
                    fs::remove_file(&path)?;
                    removed += 1;
                }
            }
        }
    }
    Ok(removed)
}

/// Sweeps orphaned `.part` and transient crash artifacts from both `cache_dir` and `output_dir`.
pub fn sweep_startup_crash_artifacts(cache_dir: &Path, output_dir: &Path) -> Result<usize, AppError> {
    let mut removed = sweep_orphaned_part_files(cache_dir)?;
    if output_dir.exists() && output_dir != cache_dir {
        for entry in fs::read_dir(output_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.ends_with(".part") {
                        fs::remove_file(&path)?;
                        removed += 1;
                    }
                }
            }
        }
    }
    Ok(removed)
}

/// Computes total size in bytes of files inside `cache_dir`.
pub fn get_cache_size_bytes(cache_dir: &Path) -> Result<u64, AppError> {
    if !cache_dir.exists() {
        return Ok(0);
    }
    let mut total = 0_u64;
    for entry in fs::read_dir(cache_dir)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        if meta.is_file() {
            total = total.saturating_add(meta.len());
        }
    }
    Ok(total)
}

/// Deletes all temporary files in `cache_dir` and returns the freed byte count.
pub fn clear_cache_dir(cache_dir: &Path) -> Result<u64, AppError> {
    if !cache_dir.exists() {
        fs::create_dir_all(cache_dir)?;
        return Ok(0);
    }
    let mut freed = 0_u64;
    for entry in fs::read_dir(cache_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
            let len = entry.metadata()?.len();
            fs::remove_file(&path)?;
            freed = freed.saturating_add(len);
        }
    }
    Ok(freed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn sweeps_only_orphaned_part_files() {
        let dir = tempdir().expect("create tempdir");
        let part_file = dir.path().join("job-123.pdf.part");
        let regular_file = dir.path().join("keep.pdf");
        fs::write(&part_file, b"partial").expect("write part");
        fs::write(&regular_file, b"%PDF-1.7").expect("write keep");

        let removed = sweep_orphaned_part_files(dir.path()).expect("sweep");
        assert_eq!(removed, 1);
        assert!(!part_file.exists());
        assert!(regular_file.exists());
    }
}
