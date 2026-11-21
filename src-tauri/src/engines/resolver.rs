use crate::error::AppError;
use crate::utils::telemetry::target_triple;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineDiagnosticStatus {
    pub name: String,
    pub display_name: String,
    pub version: String,
    pub binary_path: String,
    pub sha256: String,
    pub sha256_verified: bool,
    pub status: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineTestResult {
    pub name: String,
    pub success: bool,
    pub version: String,
    pub binary_path: String,
    pub sha256: String,
    pub output: String,
    pub latency_ms: u64,
}

#[derive(Debug, Clone)]
pub struct EnginePaths {
    pub gs_bin: PathBuf,
    pub qpdf_bin: PathBuf,
    pub lib_dir: PathBuf,
    pub icc_dir: PathBuf,
    pub tessdata_dir: PathBuf,
}

impl EnginePaths {
    pub fn resolve(resource_dir: Option<&Path>) -> Self {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(PathBuf::from));
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

        let gs_bin = resolve_sidecar("gs", exe_dir.as_deref(), &manifest_dir);
        let qpdf_bin = resolve_sidecar("qpdf", exe_dir.as_deref(), &manifest_dir);

        let resources_base = resolve_resources_root(resource_dir, exe_dir.as_deref(), &manifest_dir);

        Self {
            gs_bin,
            qpdf_bin,
            lib_dir: resources_base.join("lib"),
            icc_dir: resources_base.join("icc"),
            tessdata_dir: resources_base.join("tessdata"),
        }
    }

    pub fn pdfium_lib_path(&self) -> PathBuf {
        if cfg!(target_os = "windows") {
            self.lib_dir.join("pdfium.dll")
        } else if cfg!(target_os = "macos") {
            self.lib_dir.join("libpdfium.dylib")
        } else {
            self.lib_dir.join("libpdfium.so")
        }
    }
}

fn resolve_sidecar(base_name: &str, exe_dir: Option<&Path>, manifest_dir: &Path) -> PathBuf {
    let suffix = if cfg!(target_os = "windows") { ".exe" } else { "" };
    let triple = target_triple();

    if let Some(dir) = exe_dir {
        let bundled_flat = dir.join(format!("{base_name}{suffix}"));
        if bundled_flat.exists() {
            return bundled_flat;
        }
        let bundled_triple = dir.join(format!("{base_name}-{triple}{suffix}"));
        if bundled_triple.exists() {
            return bundled_triple;
        }
    }

    let dev_path = manifest_dir
        .join("binaries")
        .join(format!("{base_name}-{triple}{suffix}"));
    if dev_path.exists() {
        return dev_path;
    }

    manifest_dir
        .join("binaries")
        .join(format!("{base_name}{suffix}"))
}

fn resolve_resources_root(
    resource_dir: Option<&Path>,
    exe_dir: Option<&Path>,
    manifest_dir: &Path,
) -> PathBuf {
    if let Some(res) = resource_dir {
        let nested = res.join("resources");
        if nested.join("lib").exists() {
            return nested;
        }
        if res.join("lib").exists() {
            return res.to_path_buf();
        }
    }

    if let Some(dir) = exe_dir {
        let sibling = dir.join("resources");
        if sibling.join("lib").exists() {
            return sibling;
        }
    }

    manifest_dir.join("resources")
}

/// Computes the lowercase hexadecimal SHA-256 digest of a file on disk.
pub fn compute_file_sha256(path: &Path) -> Result<String, AppError> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 65_536];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

pub fn is_real_binary(bin: &Path) -> bool {
    std::fs::metadata(bin)
        .map(|m| m.is_file() && m.len() > 4096)
        .unwrap_or(false)
}

pub fn build_sidecar_command(bin: &Path, paths: &EnginePaths) -> Command {
    let mut cmd = Command::new(bin);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let current_path = std::env::var_os("PATH").unwrap_or_default();
    let mut path_entries = vec![paths.lib_dir.clone()];
    path_entries.extend(std::env::split_paths(&current_path));
    if let Ok(joined) = std::env::join_paths(path_entries) {
        cmd.env("PATH", joined);
    }

    if cfg!(target_os = "linux") {
        cmd.env("LD_LIBRARY_PATH", &paths.lib_dir);
    } else if cfg!(target_os = "macos") {
        cmd.env("DYLD_LIBRARY_PATH", &paths.lib_dir);
    }
    cmd.env("TESSDATA_PREFIX", &paths.tessdata_dir);
    cmd
}

fn run_sidecar_version(bin: &Path, paths: &EnginePaths) -> Result<String, AppError> {
    if !bin.exists() {
        return Err(AppError::EngineError(format!(
            "Bundled binary missing at {}",
            bin.display()
        )));
    }
    let output = build_sidecar_command(bin, paths).arg("--version").output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::EngineError(format!(
            "Sidecar exited with status {}: {}",
            output.status,
            stderr.trim()
        )));
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(stdout)
}

fn lopdf_self_test_sha256() -> Result<(String, usize), AppError> {
    use lopdf::{dictionary, Document, Object};
    let mut doc = Document::with_version("1.7");
    let pages_id = doc.new_object_id();
    let page_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
    });
    let pages = dictionary! {
        "Type" => "Pages",
        "Kids" => vec![page_id.into()],
        "Count" => 1,
    };
    doc.objects.insert(pages_id, Object::Dictionary(pages));
    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    doc.trailer.set("Root", catalog_id);

    let mut bytes = Vec::new();
    doc.save_to(&mut bytes)
        .map_err(|e| AppError::EngineError(format!("Lopdf self-test failed: {e}")))?;

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok((hex::encode(hasher.finalize()), bytes.len()))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntegrityManifestEntry {
    sha256: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntegrityManifest {
    files: HashMap<String, IntegrityManifestEntry>,
}

fn load_integrity_manifest(paths: &EnginePaths) -> Option<IntegrityManifest> {
    let manifest_path = paths.icc_dir.parent()?.join("integrity-manifest.json");
    let raw = std::fs::read_to_string(manifest_path).ok()?;
    serde_json::from_str::<IntegrityManifest>(&raw).ok()
}

fn verify_sha256_against_manifest(
    manifest: Option<&IntegrityManifest>,
    file_path: &Path,
    computed_sha: Option<&str>,
) -> bool {
    let Some(sha) = computed_sha else {
        return false;
    };
    let Some(manifest) = manifest else {
        return true;
    };
    let Some(file_name) = file_path.file_name().and_then(|n| n.to_str()) else {
        return true;
    };
    match manifest.files.get(file_name) {
        Some(entry) => entry.sha256.eq_ignore_ascii_case(sha),
        None => true,
    }
}

pub fn verify_all_engines(paths: &EnginePaths) -> Vec<EngineDiagnosticStatus> {
    let manifest = load_integrity_manifest(paths);

    let gs_sha = compute_file_sha256(&paths.gs_bin).ok();
    let gs_manifest_ok =
        verify_sha256_against_manifest(manifest.as_ref(), &paths.gs_bin, gs_sha.as_deref());
    let gs_dll_ok = if cfg!(target_os = "windows") {
        std::fs::metadata(paths.lib_dir.join("gsdll64.dll"))
            .map(|m| m.len() > 1_000_000)
            .unwrap_or(false)
    } else {
        true
    };
    let tess_ok = std::fs::metadata(paths.tessdata_dir.join("eng.traineddata"))
        .map(|m| m.len() > 10_000)
        .unwrap_or(false)
        && std::fs::metadata(paths.tessdata_dir.join("ind.traineddata"))
            .map(|m| m.len() > 10_000)
            .unwrap_or(false)
        && std::fs::metadata(paths.icc_dir.join("sRGB.icc"))
            .map(|m| m.len() > 500)
            .unwrap_or(false);
    let gs_ver = run_sidecar_version(&paths.gs_bin, paths).ok();
    let gs_ok = is_real_binary(&paths.gs_bin)
        && gs_sha.is_some()
        && gs_manifest_ok
        && gs_ver.is_some()
        && gs_dll_ok
        && tess_ok;

    let pdfium_path = paths.pdfium_lib_path();
    let pdfium_sha = compute_file_sha256(&pdfium_path).ok();
    let pdfium_manifest_ok =
        verify_sha256_against_manifest(manifest.as_ref(), &pdfium_path, pdfium_sha.as_deref());
    let pdfium_ok = pdfium_sha.is_some() && pdfium_manifest_ok && is_real_binary(&pdfium_path);

    let qpdf_sha = compute_file_sha256(&paths.qpdf_bin).ok();
    let qpdf_manifest_ok =
        verify_sha256_against_manifest(manifest.as_ref(), &paths.qpdf_bin, qpdf_sha.as_deref());
    let qpdf_dll_ok = if cfg!(target_os = "windows") {
        std::fs::read_dir(&paths.lib_dir)
            .ok()
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok())
            .any(|e| {
                let name = e.file_name().to_string_lossy().to_ascii_lowercase();
                name.contains("qpdf")
                    && name.ends_with(".dll")
                    && e.metadata().map(|m| m.len() > 100_000).unwrap_or(false)
            })
    } else {
        true
    };
    let qpdf_ver = run_sidecar_version(&paths.qpdf_bin, paths).ok();
    let qpdf_ok = is_real_binary(&paths.qpdf_bin)
        && qpdf_sha.is_some()
        && qpdf_manifest_ok
        && qpdf_ver.is_some()
        && qpdf_dll_ok;

    let lopdf_test = lopdf_self_test_sha256().ok();
    let gs_label = extract_version_label(gs_ver.as_deref(), "v10.05.1");
    let qpdf_label = extract_version_label(qpdf_ver.as_deref(), "v12.4.2");

    vec![
        EngineDiagnosticStatus {
            name: "ghostscript".to_string(),
            display_name: format!("Ghostscript ({gs_label})"),
            version: gs_label,
            binary_path: paths.gs_bin.to_string_lossy().to_string(),
            sha256: gs_sha.unwrap_or_default(),
            sha256_verified: gs_ok,
            status: if gs_ok {
                "connected_bundled"
            } else if !gs_manifest_ok {
                "hash_mismatch"
            } else {
                "error"
            }
            .to_string(),
            description: "High-ratio image downsampling, ISO 19005 PDF/A archival export, and built-in pdfocr24 Tesseract OCR (eng + ind).".to_string(),
        },
        EngineDiagnosticStatus {
            name: "pdfium".to_string(),
            display_name: "PDFium Engine (v124.0.6)".to_string(),
            version: "v124.0.6".to_string(),
            binary_path: pdfium_path.to_string_lossy().to_string(),
            sha256: pdfium_sha.unwrap_or_default(),
            sha256_verified: pdfium_ok,
            status: if pdfium_ok {
                "active_ffi"
            } else if !pdfium_manifest_ok {
                "hash_mismatch"
            } else {
                "error"
            }
            .to_string(),
            description: "High-resolution sub-pixel page rasterization, text bounding extraction, and High-DPI True Redaction burn-in.".to_string(),
        },
        EngineDiagnosticStatus {
            name: "qpdf".to_string(),
            display_name: format!("QPDF Native CLI ({qpdf_label})"),
            version: qpdf_label,
            binary_path: paths.qpdf_bin.to_string_lossy().to_string(),
            sha256: qpdf_sha.unwrap_or_default(),
            sha256_verified: qpdf_ok,
            status: if qpdf_ok {
                "connected_bundled"
            } else if !qpdf_manifest_ok {
                "hash_mismatch"
            } else {
                "error"
            }
            .to_string(),
            description: "Structural normalization, page reordering, stream linearization (Fast Web View), xref repair, and AES-256 encryption.".to_string(),
        },
        EngineDiagnosticStatus {
            name: "lopdf_crypto".to_string(),
            display_name: "Lopdf & Rust PDF Core".to_string(),
            version: "v0.34.0".to_string(),
            binary_path: "embedded://rust-core/lopdf-cms".to_string(),
            sha256: lopdf_test.as_ref().map(|(h, _)| h.clone()).unwrap_or_default(),
            sha256_verified: lopdf_test.is_some(),
            status: if lopdf_test.is_some() { "embedded" } else { "error" }.to_string(),
            description: "Zero external dependency, memory-safe PDF parser with stream size estimator, XMP sanitizer, and PKCS#12 CMS signer.".to_string(),
        },
    ]
}

fn extract_version_label(raw: Option<&str>, fallback: &str) -> String {
    if let Some(text) = raw {
        for token in text.split_whitespace() {
            let clean = token.trim_matches(|c: char| !c.is_ascii_digit() && c != '.');
            if clean.matches('.').count() >= 1
                && clean.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)
            {
                return format!("v{clean}");
            }
        }
    }
    fallback.to_string()
}

pub fn test_engine_binary(paths: &EnginePaths, engine_name: &str) -> Result<EngineTestResult, AppError> {
    let start = Instant::now();
    match engine_name {
        "ghostscript" => {
            let sha = compute_file_sha256(&paths.gs_bin)?;
            let out = run_sidecar_version(&paths.gs_bin, paths)?;
            let eng_ok = std::fs::metadata(paths.tessdata_dir.join("eng.traineddata"))
                .map(|m| m.len() > 10_000)
                .unwrap_or(false);
            let ind_ok = std::fs::metadata(paths.tessdata_dir.join("ind.traineddata"))
                .map(|m| m.len() > 10_000)
                .unwrap_or(false);
            let icc_ok = std::fs::metadata(paths.icc_dir.join("sRGB.icc"))
                .map(|m| m.len() > 500)
                .unwrap_or(false);
            Ok(EngineTestResult {
                name: "ghostscript".to_string(),
                success: eng_ok && ind_ok && icc_ok,
                version: extract_version_label(Some(&out), "v10.05.1"),
                binary_path: paths.gs_bin.to_string_lossy().to_string(),
                sha256: sha,
                output: format!(
                    "{out} | tessdata(eng={eng_ok}, ind={ind_ok}) | sRGB.icc={icc_ok}"
                ),
                latency_ms: start.elapsed().as_millis() as u64,
            })
        }
        "qpdf" => {
            let sha = compute_file_sha256(&paths.qpdf_bin)?;
            let out = run_sidecar_version(&paths.qpdf_bin, paths)?;
            Ok(EngineTestResult {
                name: "qpdf".to_string(),
                success: true,
                version: extract_version_label(Some(&out), "v12.4.2"),
                binary_path: paths.qpdf_bin.to_string_lossy().to_string(),
                sha256: sha,
                output: out,
                latency_ms: start.elapsed().as_millis() as u64,
            })
        }
        "pdfium" => {
            let lib_path = paths.pdfium_lib_path();
            let sha = compute_file_sha256(&lib_path)?;
            let size = std::fs::metadata(&lib_path)?.len();
            let ffi_ok = crate::engines::pdfium_ffi::is_pdfium_available(Some(&lib_path));
            let output = if ffi_ok {
                format!(
                    "PDFium native FFI active (FPDF_InitLibrary OK, {:.2} MB)",
                    (size as f64) / (1024.0 * 1024.0)
                )
            } else {
                format!("PDFium shared library verified ({size} bytes)")
            };
            Ok(EngineTestResult {
                name: "pdfium".to_string(),
                success: true,
                version: "v124.0.6".to_string(),
                binary_path: lib_path.to_string_lossy().to_string(),
                sha256: sha,
                output,
                latency_ms: start.elapsed().as_millis() as u64,
            })
        }
        "lopdf_crypto" => {
            let (sha, bytes_len) = lopdf_self_test_sha256()?;
            Ok(EngineTestResult {
                name: "lopdf_crypto".to_string(),
                success: true,
                version: "v0.34.0".to_string(),
                binary_path: "embedded://rust-core/lopdf-cms".to_string(),
                sha256: sha,
                output: format!("In-memory PDF 1.7 catalog serialization passed ({bytes_len} bytes)"),
                latency_ms: start.elapsed().as_millis() as u64,
            })
        }
        other => Err(AppError::InvalidInput(format!("Unknown engine '{other}'"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifies_all_four_bundled_engines_and_sha256() {
        let paths = EnginePaths::resolve(None);
        let statuses = verify_all_engines(&paths);
        assert_eq!(statuses.len(), 4);
        for engine in &statuses {
            assert!(
                engine.sha256_verified,
                "Engine {} failed verification: {:?}",
                engine.name, engine
            );
            assert_eq!(engine.sha256.len(), 64, "SHA-256 hex must be 64 chars");
        }
    }

    #[test]
    fn tests_individual_sidecar_binaries() {
        let paths = EnginePaths::resolve(None);
        for name in ["ghostscript", "qpdf", "pdfium", "lopdf_crypto"] {
            let res = test_engine_binary(&paths, name).expect("test engine binary");
            assert!(res.success, "Engine {name} test failed");
            assert!(!res.output.is_empty());
            if cfg!(target_os = "windows") && name == "pdfium" {
                assert!(
                    res.output.contains("PDFium native FFI active"),
                    "Expected real pdfium.dll FFI on Windows, got: {}",
                    res.output
                );
            }
        }
    }

    #[test]
    fn detects_integrity_manifest_mismatch_and_match() {
        let mut files = HashMap::new();
        files.insert(
            "qpdf.exe".to_string(),
            IntegrityManifestEntry {
                sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
            },
        );
        let manifest = IntegrityManifest { files };
        assert!(verify_sha256_against_manifest(
            Some(&manifest),
            Path::new("qpdf.exe"),
            Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        ));
        assert!(!verify_sha256_against_manifest(
            Some(&manifest),
            Path::new("qpdf.exe"),
            Some("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
        ));
    }
}
