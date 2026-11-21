use crate::engines::lopdf_crypto::{sanitize_pdf_metadata, SecurityExecutionResult};
use crate::engines::resolver::{build_sidecar_command, EnginePaths};
use crate::error::AppError;
use crate::utils::atomic_fs::PartFileGuard;
use crate::utils::naming::expand_naming_pattern;
use crate::utils::process_control::ProcessRegistry;
use lopdf::Document;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Instant;
use uuid::Uuid;

fn run_monitored_sidecar(
    mut cmd: std::process::Command,
    job_id: Option<&str>,
    process_registry: Option<&ProcessRegistry>,
    engine_label: &str,
    allow_exit_3: bool,
) -> Result<(i32, String), AppError> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let child = cmd
        .spawn()
        .map_err(|e| AppError::EngineError(format!("Failed to launch {engine_label}: {e}")))?;

    if let (Some(id), Some(reg)) = (job_id, process_registry) {
        let _ = reg.register_child(id, child.id());
    }

    let output = child
        .wait_with_output()
        .map_err(|e| AppError::EngineError(format!("Failed waiting for {engine_label}: {e}")))?;

    let was_cancelled = match (job_id, process_registry) {
        (Some(id), Some(reg)) => {
            let cancelled = reg.is_cancelled(id);
            reg.unregister(id);
            cancelled
        }
        _ => false,
    };

    if was_cancelled {
        return Err(AppError::EngineError(format!(
            "{engine_label} job cancelled by user"
        )));
    }

    let code = output.status.code().unwrap_or(-1);
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let combined = if stderr.trim().is_empty() { stdout } else { stderr };

    if code != 0 && !(allow_exit_3 && code == 3) {
        return Err(AppError::EngineError(format!(
            "{engine_label} failed (code {code}): {combined}"
        )));
    }

    Ok((code, combined))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressOptions {
    pub input_paths: Vec<String>,
    pub profile: String,
    pub custom_dpi: Option<u32>,
    pub custom_jpeg_quality: Option<u8>,
    pub linearize_fast_web: bool,
    pub sanitize_metadata: bool,
    pub output_dir: String,
    pub naming_pattern: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressExecutionResult {
    pub input_path: String,
    pub output_path: String,
    pub original_bytes: u64,
    pub output_bytes: u64,
    pub reduction_percent: f64,
    pub page_count: u32,
    pub duration_ms: u64,
    pub gs_command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairExecutionResult {
    pub output_path: String,
    pub recovered_pages: u32,
    pub fixed_xref_entries: usize,
    pub original_bytes: u64,
    pub output_bytes: u64,
    pub duration_ms: u64,
    pub command_log: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeSingleResult {
    pub output_path: String,
    pub original_bytes: u64,
    pub output_bytes: u64,
    pub page_count: u32,
    pub duration_ms: u64,
    pub command_log: String,
}

pub fn compress_pdf_file(
    paths: &EnginePaths,
    input_path: &Path,
    options: &CompressOptions,
    temp_cache_dir: &Path,
) -> Result<CompressExecutionResult, AppError> {
    compress_pdf_file_with_control(paths, input_path, options, temp_cache_dir, None, None)
}

pub fn compress_pdf_file_with_control(
    paths: &EnginePaths,
    input_path: &Path,
    options: &CompressOptions,
    temp_cache_dir: &Path,
    job_id: Option<&str>,
    process_registry: Option<&ProcessRegistry>,
) -> Result<CompressExecutionResult, AppError> {
    let start = Instant::now();
    if !input_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "PDF file not found: {}",
            input_path.display()
        )));
    }

    let original_bytes = std::fs::metadata(input_path)?.len();
    let input_pages = Document::load(input_path)
        .map(|d| d.get_pages().len() as u32)
        .unwrap_or(1);

    let (target_dpi, jpeg_quality) = match options.profile.as_str() {
        "screen" => (72_u32, 50_u8),
        "ebook" => (150_u32, 70_u8),
        "printer" => (300_u32, 85_u8),
        "prepress" => (300_u32, 95_u8),
        "custom" => (
            options.custom_dpi.unwrap_or(150).clamp(72, 600),
            options.custom_jpeg_quality.unwrap_or(75).clamp(10, 100),
        ),
        _ => (150_u32, 75_u8),
    };

    let base_name = input_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("document.pdf");

    let out_dir = PathBuf::from(&options.output_dir);
    std::fs::create_dir_all(&out_dir)?;

    let prelim_name = expand_naming_pattern(
        &options.naming_pattern,
        base_name,
        Some(-25),
        input_pages as usize,
    );
    let out_path = out_dir.join(prelim_name);
    let guard = PartFileGuard::new(temp_cache_dir, &out_path, "compress")?;

    let gs_stage_path = if options.linearize_fast_web {
        temp_cache_dir.join(format!("gs_stage_{}.pdf", Uuid::new_v4()))
    } else {
        guard.part_path().to_path_buf()
    };

    let mut cmd = build_sidecar_command(&paths.gs_bin, paths);
    cmd.arg("-sDEVICE=pdfwrite")
        .arg("-dCompatibilityLevel=1.7")
        .arg("-dNOPAUSE")
        .arg("-dBATCH")
        .arg("-dQUIET");

    let gs_command = if options.profile == "custom" {
        cmd.arg("-dDownsampleColorImages=true")
            .arg("-dDownsampleGrayImages=true")
            .arg("-dDownsampleMonoImages=true")
            .arg(format!("-dColorImageResolution={target_dpi}"))
            .arg(format!("-dGrayImageResolution={target_dpi}"))
            .arg("-dAutoFilterColorImages=false")
            .arg("-dColorImageFilter=/DCTEncode")
            .arg(format!("-dJPEGQ={jpeg_quality}"));
        format!(
            "{} -sDEVICE=pdfwrite -dCompatibilityLevel=1.7 -dDownsampleColorImages=true -dColorImageResolution={} -dJPEGQ={} -dNOPAUSE -dBATCH -sOutputFile=\"{}\" \"{}\"",
            paths.gs_bin.display(),
            target_dpi,
            jpeg_quality,
            out_path.display(),
            input_path.display()
        )
    } else {
        let profile_arg = match options.profile.as_str() {
            "screen" | "ebook" | "printer" | "prepress" => options.profile.as_str(),
            _ => "ebook",
        };
        cmd.arg(format!("-dPDFSETTINGS=/{profile_arg}"));
        format!(
            "{} -sDEVICE=pdfwrite -dCompatibilityLevel=1.7 -dPDFSETTINGS=/{} -dNOPAUSE -dBATCH -sOutputFile=\"{}\" \"{}\"",
            paths.gs_bin.display(),
            profile_arg,
            out_path.display(),
            input_path.display()
        )
    };

    cmd.arg(format!("-sOutputFile={}", gs_stage_path.display()))
        .arg(input_path);

    let gs_res = run_monitored_sidecar(cmd, job_id, process_registry, "Ghostscript", false);
    if let Err(err) = gs_res {
        if options.linearize_fast_web {
            let _ = std::fs::remove_file(&gs_stage_path);
        }
        return Err(err);
    }

    if options.linearize_fast_web {
        let mut qcmd = build_sidecar_command(&paths.qpdf_bin, paths);
        qcmd.arg("--linearize")
            .arg(&gs_stage_path)
            .arg(guard.part_path());
        let lin_res = run_monitored_sidecar(qcmd, job_id, process_registry, "QPDF", true);
        let _ = std::fs::remove_file(&gs_stage_path);
        lin_res?;
    }

    let output_bytes = guard.commit()?;

    if options.sanitize_metadata {
        let _ = sanitize_pdf_metadata(&out_path, &out_path, temp_cache_dir);
    }

    let final_bytes = std::fs::metadata(&out_path)
        .map(|m| m.len())
        .unwrap_or(output_bytes);
    let page_count = Document::load(&out_path)
        .map(|d| d.get_pages().len() as u32)
        .unwrap_or(input_pages);

    let reduction_percent = if original_bytes > 0 && final_bytes <= original_bytes {
        (((original_bytes - final_bytes) as f64) / (original_bytes as f64)) * 100.0
    } else {
        0.0
    };

    Ok(CompressExecutionResult {
        input_path: input_path.to_string_lossy().to_string(),
        output_path: out_path.to_string_lossy().to_string(),
        original_bytes,
        output_bytes: final_bytes,
        reduction_percent: (reduction_percent * 10.0).round() / 10.0,
        page_count,
        duration_ms: start.elapsed().as_millis() as u64,
        gs_command,
    })
}

pub fn repair_pdf(
    paths: &EnginePaths,
    input_path: &Path,
    output_path: &Path,
    temp_cache_dir: &Path,
) -> Result<RepairExecutionResult, AppError> {
    repair_pdf_with_control(paths, input_path, output_path, temp_cache_dir, None, None)
}

pub fn repair_pdf_with_control(
    paths: &EnginePaths,
    input_path: &Path,
    output_path: &Path,
    temp_cache_dir: &Path,
    job_id: Option<&str>,
    process_registry: Option<&ProcessRegistry>,
) -> Result<RepairExecutionResult, AppError> {
    let start = Instant::now();
    if !input_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "PDF file not found: {}",
            input_path.display()
        )));
    }
    let original_bytes = std::fs::metadata(input_path)?.len();
    let guard = PartFileGuard::new(temp_cache_dir, output_path, "repair")?;

    let mut cmd = build_sidecar_command(&paths.qpdf_bin, paths);
    cmd.arg(input_path).arg(guard.part_path());
    run_monitored_sidecar(cmd, job_id, process_registry, "QPDF", true)?;

    let output_bytes = guard.commit()?;
    let doc = Document::load(output_path)
        .map_err(|e| AppError::EngineError(format!("Unable to verify repaired PDF: {e}")))?;
    let recovered_pages = doc.get_pages().len() as u32;
    let fixed_xref_entries = doc.objects.len();

    Ok(RepairExecutionResult {
        output_path: output_path.to_string_lossy().to_string(),
        recovered_pages,
        fixed_xref_entries,
        original_bytes,
        output_bytes,
        duration_ms: start.elapsed().as_millis() as u64,
        command_log: format!(
            "{} \"{}\" \"{}\"",
            paths.qpdf_bin.display(),
            input_path.display(),
            output_path.display()
        ),
    })
}

pub fn linearize_pdf(
    paths: &EnginePaths,
    input_path: &Path,
    output_path: &Path,
    temp_cache_dir: &Path,
) -> Result<OptimizeSingleResult, AppError> {
    linearize_pdf_with_control(paths, input_path, output_path, temp_cache_dir, None, None)
}

pub fn linearize_pdf_with_control(
    paths: &EnginePaths,
    input_path: &Path,
    output_path: &Path,
    temp_cache_dir: &Path,
    job_id: Option<&str>,
    process_registry: Option<&ProcessRegistry>,
) -> Result<OptimizeSingleResult, AppError> {
    let start = Instant::now();
    if !input_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "PDF file not found: {}",
            input_path.display()
        )));
    }
    let original_bytes = std::fs::metadata(input_path)?.len();
    let guard = PartFileGuard::new(temp_cache_dir, output_path, "linearize")?;

    let mut cmd = build_sidecar_command(&paths.qpdf_bin, paths);
    cmd.arg("--linearize")
        .arg(input_path)
        .arg(guard.part_path());
    run_monitored_sidecar(cmd, job_id, process_registry, "QPDF", true)?;

    let output_bytes = guard.commit()?;
    let page_count = Document::load(output_path)
        .map(|d| d.get_pages().len() as u32)
        .unwrap_or(0);

    Ok(OptimizeSingleResult {
        output_path: output_path.to_string_lossy().to_string(),
        original_bytes,
        output_bytes,
        page_count,
        duration_ms: start.elapsed().as_millis() as u64,
        command_log: format!(
            "{} --linearize \"{}\" \"{}\"",
            paths.qpdf_bin.display(),
            input_path.display(),
            output_path.display()
        ),
    })
}

pub fn ocr_pdf_file(
    paths: &EnginePaths,
    input_path: &Path,
    languages: &[String],
    dpi: u32,
    output_to_pdfa: bool,
    pdfa_conformance: Option<&str>,
    output_path: &Path,
    temp_cache_dir: &Path,
) -> Result<SecurityExecutionResult, AppError> {
    ocr_pdf_file_with_control(
        paths,
        input_path,
        languages,
        dpi,
        output_to_pdfa,
        pdfa_conformance,
        output_path,
        temp_cache_dir,
        None,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn ocr_pdf_file_with_control(
    paths: &EnginePaths,
    input_path: &Path,
    languages: &[String],
    dpi: u32,
    output_to_pdfa: bool,
    pdfa_conformance: Option<&str>,
    output_path: &Path,
    temp_cache_dir: &Path,
    job_id: Option<&str>,
    process_registry: Option<&ProcessRegistry>,
) -> Result<SecurityExecutionResult, AppError> {
    let start = Instant::now();
    if !input_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "PDF file not found: {}",
            input_path.display()
        )));
    }
    let langs: Vec<String> = if languages.is_empty() {
        vec!["eng".to_string()]
    } else {
        languages.to_vec()
    };
    for lang in &langs {
        let model_file = paths.tessdata_dir.join(format!("{lang}.traineddata"));
        if !model_file.exists() {
            return Err(AppError::IntegrityFailed(format!(
                "Missing OCR model file '{}'",
                model_file.display()
            )));
        }
    }

    let original_bytes = std::fs::metadata(input_path)?.len();
    let lang_spec = langs.join("+");
    let ocr_dpi = dpi.clamp(150, 600);
    let guard = PartFileGuard::new(temp_cache_dir, output_path, "ocr")?;

    let ocr_stage_path = if output_to_pdfa {
        temp_cache_dir.join(format!("ocr_stage_{}.pdf", Uuid::new_v4()))
    } else {
        guard.part_path().to_path_buf()
    };

    let mut cmd = build_sidecar_command(&paths.gs_bin, paths);
    cmd.arg("-sDEVICE=pdfocr24")
        .arg(format!("-sOCRLanguage={lang_spec}"))
        .arg(format!("-r{ocr_dpi}"))
        .arg("-dNOPAUSE")
        .arg("-dBATCH")
        .arg("-dQUIET")
        .arg(format!("-sOutputFile={}", ocr_stage_path.display()))
        .arg(input_path);

    let ocr_res = run_monitored_sidecar(cmd, job_id, process_registry, "Ghostscript OCR", false);
    if let Err(err) = ocr_res {
        if output_to_pdfa {
            let _ = std::fs::remove_file(&ocr_stage_path);
        }
        return Err(err);
    }

    if output_to_pdfa {
        let conf = pdfa_conformance.unwrap_or("pdfa-2b");
        let pdfa_res = run_gs_pdfa_stage(
            paths,
            &ocr_stage_path,
            conf,
            guard.part_path(),
            temp_cache_dir,
            job_id,
            process_registry,
        );
        let _ = std::fs::remove_file(&ocr_stage_path);
        pdfa_res?;
    }

    let output_bytes = guard.commit()?;
    let page_count = Document::load(output_path)
        .map(|d| d.get_pages().len() as u32)
        .unwrap_or(1);

    Ok(SecurityExecutionResult {
        output_path: output_path.to_string_lossy().to_string(),
        original_bytes,
        output_bytes,
        page_count,
        duration_ms: start.elapsed().as_millis() as u64,
        command_log: format!(
            "{} -sDEVICE=pdfocr24 -sOCRLanguage=\"{}\" -r{} -dNOPAUSE -dBATCH -sOutputFile=\"{}\" \"{}\"",
            paths.gs_bin.display(),
            lang_spec,
            ocr_dpi,
            output_path.display(),
            input_path.display()
        ),
        summary: format!(
            "Ghostscript pdfocr24 ({lang_spec} @ {ocr_dpi} DPI) processed {page_count} page(s){}",
            if output_to_pdfa { " + PDF/A archival conversion" } else { "" }
        ),
    })
}

pub fn convert_to_pdfa(
    paths: &EnginePaths,
    input_path: &Path,
    conformance: &str,
    output_path: &Path,
    temp_cache_dir: &Path,
) -> Result<SecurityExecutionResult, AppError> {
    convert_to_pdfa_with_control(paths, input_path, conformance, output_path, temp_cache_dir, None, None)
}

pub fn convert_to_pdfa_with_control(
    paths: &EnginePaths,
    input_path: &Path,
    conformance: &str,
    output_path: &Path,
    temp_cache_dir: &Path,
    job_id: Option<&str>,
    process_registry: Option<&ProcessRegistry>,
) -> Result<SecurityExecutionResult, AppError> {
    let start = Instant::now();
    if !input_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "PDF file not found: {}",
            input_path.display()
        )));
    }
    let original_bytes = std::fs::metadata(input_path)?.len();
    let guard = PartFileGuard::new(temp_cache_dir, output_path, "pdfa")?;

    run_gs_pdfa_stage(
        paths,
        input_path,
        conformance,
        guard.part_path(),
        temp_cache_dir,
        job_id,
        process_registry,
    )?;

    let output_bytes = guard.commit()?;
    let page_count = Document::load(output_path)
        .map(|d| d.get_pages().len() as u32)
        .unwrap_or(1);

    let level = match conformance {
        "pdfa-1b" => "1",
        "pdfa-3b" => "3",
        _ => "2",
    };

    Ok(SecurityExecutionResult {
        output_path: output_path.to_string_lossy().to_string(),
        original_bytes,
        output_bytes,
        page_count,
        duration_ms: start.elapsed().as_millis() as u64,
        command_log: format!(
            "{} -dPDFA={} -dPDFACompatibilityPolicy=1 -sColorConversionStrategy=RGB -sOutputICCProfile=\"{}\" -sOutputFile=\"{}\" \"{}\"",
            paths.gs_bin.display(),
            level,
            paths.icc_dir.join("sRGB.icc").display(),
            output_path.display(),
            input_path.display()
        ),
        summary: format!(
            "Converted to ISO 19005 {} via Ghostscript with sRGB.icc OutputIntent across {} page(s)",
            conformance.to_uppercase(),
            page_count
        ),
    })
}

fn run_gs_pdfa_stage(
    paths: &EnginePaths,
    input_path: &Path,
    conformance: &str,
    part_output: &Path,
    temp_cache_dir: &Path,
    job_id: Option<&str>,
    process_registry: Option<&ProcessRegistry>,
) -> Result<(), AppError> {
    let icc_path = paths.icc_dir.join("sRGB.icc");
    if !icc_path.exists() {
        return Err(AppError::IntegrityFailed(format!(
            "Bundled ICC profile missing at {}",
            icc_path.display()
        )));
    }
    let level = match conformance {
        "pdfa-1b" => "1",
        "pdfa-3b" => "3",
        _ => "2",
    };

    let icc_ps = icc_path.to_string_lossy().replace('\\', "/");
    let pdfa_def_path = temp_cache_dir.join(format!("pdfa_def_{}.ps", Uuid::new_v4()));
    let pdfa_def_ps = format!(
        r#"[ /_objdef {{icc_PDFA}} /type /stream /OBJ pdfmark
[ {{icc_PDFA}} << /N 3 >> /PUT pdfmark
[ {{icc_PDFA}} ({icc_ps}) (r) file /PUT pdfmark
[ /_objdef {{OutputIntent_PDFA}} /type /dict /OBJ pdfmark
[ {{OutputIntent_PDFA}} <<
  /Type /OutputIntent
  /S /GTS_PDFA1
  /OutputConditionIdentifier (sRGB IEC61966-2.1)
  /Info (ISO 19005 PDF/A-{level}B XENON Bundled sRGB)
  /RegistryName (http://www.color.org)
  /DestOutputProfile {{icc_PDFA}}
>> /PUT pdfmark
[ {{Catalog}} << /OutputIntents [ {{OutputIntent_PDFA}} ] >> /PUT pdfmark
"#
    );
    std::fs::write(&pdfa_def_path, pdfa_def_ps)?;

    let mut cmd = build_sidecar_command(&paths.gs_bin, paths);
    cmd.arg(format!("-dPDFA={level}"))
        .arg("-dPDFACompatibilityPolicy=1")
        .arg("-sDEVICE=pdfwrite")
        .arg("-sColorConversionStrategy=RGB")
        .arg("-sProcessColorModel=DeviceRGB")
        .arg("-dUseCIEColor=false")
        .arg(format!("--permit-file-read={}", icc_path.display()))
        .arg(format!("--permit-file-read={}", pdfa_def_path.display()))
        .arg(format!("-sOutputICCProfile={}", icc_path.display()))
        .arg("-dNOPAUSE")
        .arg("-dBATCH")
        .arg("-dQUIET")
        .arg(format!("-sOutputFile={}", part_output.display()))
        .arg(&pdfa_def_path)
        .arg(input_path);

    let res = run_monitored_sidecar(cmd, job_id, process_registry, "Ghostscript PDF/A", false);
    let _ = std::fs::remove_file(&pdfa_def_path);
    res?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engines::pdfium_engine::create_sample_multi_page_pdf;
    use crate::engines::qpdf_engine::image_to_single_page_pdf;
    use image::{Rgb, RgbImage};
    use tempfile::tempdir;

    #[test]
    fn compresses_image_pdf_and_repairs_or_linearizes() {
        let dir = tempdir().expect("tempdir");
        let cache = dir.path().join("cache");
        let paths = EnginePaths::resolve(None);

        // Create a high-res noisy PNG -> PDF so JPEG downsampling yields real byte reduction
        let img_path = dir.path().join("large_scan.png");
        let mut img = RgbImage::new(1200, 1200);
        for (x, y, px) in img.enumerate_pixels_mut() {
            *px = Rgb([(x % 251) as u8, (y % 241) as u8, ((x + y) % 199) as u8]);
        }
        img.save(&img_path).expect("save png");
        let img_pdf = image_to_single_page_pdf(&img_path, &cache).expect("img pdf");

        let out_dir = dir.path().join("out");
        let comp = compress_pdf_file(
            &paths,
            &img_pdf,
            &CompressOptions {
                input_paths: vec![img_pdf.to_string_lossy().to_string()],
                profile: "screen".into(),
                custom_dpi: None,
                custom_jpeg_quality: None,
                linearize_fast_web: true,
                sanitize_metadata: true,
                output_dir: out_dir.to_string_lossy().to_string(),
                naming_pattern: "{filename}_screen".into(),
            },
            &cache,
        )
        .expect("compress");

        assert!(comp.output_bytes < comp.original_bytes);
        assert!(comp.reduction_percent > 0.0);

        let sample = dir.path().join("sample.pdf");
        create_sample_multi_page_pdf(&sample, 3).expect("sample");
        let repaired = dir.path().join("repaired.pdf");
        let rep = repair_pdf(&paths, &sample, &repaired, &cache).expect("repair");
        assert_eq!(rep.recovered_pages, 3);

        let linearized = dir.path().join("linearized.pdf");
        let lin = linearize_pdf(&paths, &sample, &linearized, &cache).expect("linearize");
        assert_eq!(lin.page_count, 3);
    }

    #[test]
    fn runs_ocr_on_scanned_image_pdf_and_converts_to_pdfa() {
        let dir = tempdir().expect("tempdir");
        let cache = dir.path().join("cache");
        let paths = EnginePaths::resolve(None);

        let img_path = dir.path().join("scanned_invoice.png");
        let img = RgbImage::from_pixel(200, 260, Rgb([245, 245, 245]));
        img.save(&img_path).expect("save png");
        let scan_pdf = image_to_single_page_pdf(&img_path, &cache).expect("scan pdf");

        let ocr_out = dir.path().join("ocr_searchable.pdf");
        let ocr_res = ocr_pdf_file(
            &paths,
            &scan_pdf,
            &["eng".to_string(), "ind".to_string()],
            300,
            true,
            Some("pdfa-2b"),
            &ocr_out,
            &cache,
        )
        .expect("ocr pdf");
        assert_eq!(ocr_res.page_count, 1);
        assert!(ocr_res.output_bytes > 0);

        let reopened = Document::load(&ocr_out).expect("load ocr");
        assert_eq!(reopened.get_pages().len(), 1);

        let root_id = reopened.trailer.get(b"Root").unwrap().as_reference().unwrap();
        let cat = reopened.get_dictionary(root_id).unwrap();
        assert!(cat.has(b"OutputIntents"));
    }
}
