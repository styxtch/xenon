use crate::commands::system::{push_and_emit_log, LogBufferState};
use crate::db::history_repo::{self, JobTickEvent};
use crate::db::settings_repo;
use crate::db::DatabaseState;
use crate::engines::diff_engine::{self, PageDiffSummary};
use crate::engines::gs_engine;
use crate::engines::lopdf_crypto::SecurityExecutionResult;
use crate::engines::pdfium_engine;
use crate::engines::resolver::EnginePaths;
use crate::error::AppError;
use crate::utils::process_control::ProcessRegistry;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State};

fn emit_convert_tick(
    app: &AppHandle,
    job_id: &str,
    document_name: &str,
    operation_label: &str,
    completed_ticks: u8,
    status: &str,
    original_bytes: u64,
    output_bytes: Option<u64>,
    output_path: Option<String>,
) {
    let event = JobTickEvent {
        job_id: job_id.to_string(),
        document_name: document_name.to_string(),
        category: "convert".to_string(),
        operation_label: operation_label.to_string(),
        completed_ticks,
        percentage: completed_ticks.saturating_mul(10).min(100),
        status: status.to_string(),
        original_bytes,
        output_bytes,
        output_path,
        error: None,
        created_label: Some("Just now".to_string()),
    };
    let _ = app.emit("job-tick-progress", &event);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfToImagesOptions {
    pub input_path: String,
    pub format: String,
    pub dpi: u32,
    pub page_range: Option<String>,
    pub output_dir: String,
    pub filename_prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImagesToPdfOptions {
    pub image_paths: Vec<String>,
    pub paper_size: String,
    pub orientation: String,
    pub margin_pts: f32,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrPdfOptions {
    pub input_path: String,
    pub languages: Vec<String>,
    pub dpi: u32,
    pub output_to_pdf_a: bool,
    pub pdf_a_conformance: Option<String>,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparePdfsOptions {
    pub left_pdf_path: String,
    pub right_pdf_path: String,
    pub dpi: u32,
}

#[tauri::command]
pub fn pdf_to_images(
    app: AppHandle,
    db: State<'_, DatabaseState>,
    logs: State<'_, LogBufferState>,
    options: PdfToImagesOptions,
) -> Result<Vec<String>, AppError> {
    let start = std::time::Instant::now();
    let in_buf = PathBuf::from(&options.input_path);
    pdfium_engine::ensure_pdf_unlocked(&in_buf)?;
    let out_dir = PathBuf::from(&options.output_dir);
    let orig_bytes = std::fs::metadata(&in_buf).map(|m| m.len()).unwrap_or(0);

    let files = pdfium_engine::export_pdf_to_images_with_prefix(
        &in_buf,
        &options.format,
        options.dpi,
        options.page_range.as_deref(),
        &out_dir,
        options.filename_prefix.as_deref(),
    )?;
    let exported_bytes: u64 = files
        .iter()
        .filter_map(|p| std::fs::metadata(p).ok())
        .map(|m| m.len())
        .sum();
    let duration_ms = start.elapsed().as_millis() as u64;

    push_and_emit_log(
        &app,
        &logs,
        "INFO",
        "pdfium",
        format!(
            "Exported {} {} image(s) @ {} DPI into '{}'",
            files.len(),
            options.format.to_uppercase(),
            options.dpi,
            out_dir.display()
        ),
    );

    let doc_name = in_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Exported.pdf");
    history_repo::insert_completed_job(
        &db,
        doc_name,
        "convert",
        &format!("PDF -> {} ({} DPI)", options.format.to_uppercase(), options.dpi),
        orig_bytes,
        exported_bytes,
        false,
        duration_ms,
        &options.output_dir,
    )?;

    Ok(files)
}

#[tauri::command]
pub fn images_to_pdf(
    app: AppHandle,
    db: State<'_, DatabaseState>,
    logs: State<'_, LogBufferState>,
    options: ImagesToPdfOptions,
) -> Result<SecurityExecutionResult, AppError> {
    let settings = settings_repo::get_settings(&db)?;
    let cache_dir = PathBuf::from(&settings.temp_cache_dir);
    let out_buf = PathBuf::from(&options.output_path);

    let res = pdfium_engine::convert_images_to_pdf(
        &options.image_paths,
        &options.paper_size,
        &options.orientation,
        options.margin_pts,
        &out_buf,
        &cache_dir,
    )?;

    push_and_emit_log(&app, &logs, "CMD", "pdfium", &res.command_log);
    push_and_emit_log(&app, &logs, "INFO", "pdfium", &res.summary);

    let doc_name = out_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Images_Combined.pdf");
    history_repo::insert_completed_job(
        &db,
        doc_name,
        "convert",
        &format!("Images -> PDF ({}p)", res.page_count),
        res.original_bytes,
        res.output_bytes,
        false,
        res.duration_ms,
        &res.output_path,
    )?;

    Ok(res)
}

#[tauri::command]
pub async fn ocr_pdf(
    app: AppHandle,
    options: OcrPdfOptions,
) -> Result<SecurityExecutionResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<DatabaseState>();
        let logs = app.state::<LogBufferState>();
        let proc_reg = app.state::<ProcessRegistry>();

        let settings = settings_repo::get_settings(&db)?;
        let cache_dir = PathBuf::from(&settings.temp_cache_dir);
        let resource_dir = app.path().resource_dir().ok();
        let paths = EnginePaths::resolve(resource_dir.as_deref());

        let in_buf = PathBuf::from(&options.input_path);
        pdfium_engine::ensure_pdf_unlocked(&in_buf)?;
        let out_buf = PathBuf::from(&options.output_path);
        let doc_name = out_buf
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("OCR_Searchable.pdf")
            .to_string();
        let op_label = format!("OCR ({})", options.languages.join("+"));
        let job_id = format!("job-{}", uuid::Uuid::new_v4());

        emit_convert_tick(&app, &job_id, &doc_name, &op_label, 3, "processing", 0, None, None);

        let res = gs_engine::ocr_pdf_file_with_control(
            &paths,
            &in_buf,
            &options.languages,
            options.dpi,
            options.output_to_pdf_a,
            options.pdf_a_conformance.as_deref(),
            &out_buf,
            &cache_dir,
            Some(&job_id),
            Some(proc_reg.inner()),
        )?;

        push_and_emit_log(&app, &logs, "CMD", "ghostscript", &res.command_log);
        push_and_emit_log(&app, &logs, "INFO", "ghostscript", &res.summary);

        history_repo::insert_completed_job(
            &db,
            &doc_name,
            "convert",
            &op_label,
            res.original_bytes,
            res.output_bytes,
            false,
            res.duration_ms,
            &res.output_path,
        )?;

        emit_convert_tick(
            &app,
            &job_id,
            &doc_name,
            &op_label,
            10,
            "completed",
            res.original_bytes,
            Some(res.output_bytes),
            Some(res.output_path.clone()),
        );

        Ok(res)
    })
    .await
    .map_err(|e| AppError::EngineError(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn convert_pdfa(
    app: AppHandle,
    input_path: String,
    conformance: String,
    output_path: String,
) -> Result<SecurityExecutionResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<DatabaseState>();
        let logs = app.state::<LogBufferState>();
        let proc_reg = app.state::<ProcessRegistry>();

        let settings = settings_repo::get_settings(&db)?;
        let cache_dir = PathBuf::from(&settings.temp_cache_dir);
        let resource_dir = app.path().resource_dir().ok();
        let paths = EnginePaths::resolve(resource_dir.as_deref());

        let in_buf = PathBuf::from(&input_path);
        pdfium_engine::ensure_pdf_unlocked(&in_buf)?;
        let out_buf = PathBuf::from(&output_path);
        let doc_name = out_buf
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Archival_PDFA.pdf")
            .to_string();
        let op_label = conformance.to_uppercase();
        let job_id = format!("job-{}", uuid::Uuid::new_v4());

        emit_convert_tick(&app, &job_id, &doc_name, &op_label, 3, "processing", 0, None, None);

        let res = gs_engine::convert_to_pdfa_with_control(
            &paths,
            &in_buf,
            &conformance,
            &out_buf,
            &cache_dir,
            Some(&job_id),
            Some(proc_reg.inner()),
        )?;

        push_and_emit_log(&app, &logs, "CMD", "ghostscript", &res.command_log);
        push_and_emit_log(&app, &logs, "INFO", "ghostscript", &res.summary);

        history_repo::insert_completed_job(
            &db,
            &doc_name,
            "convert",
            &op_label,
            res.original_bytes,
            res.output_bytes,
            false,
            res.duration_ms,
            &res.output_path,
        )?;

        emit_convert_tick(
            &app,
            &job_id,
            &doc_name,
            &op_label,
            10,
            "completed",
            res.original_bytes,
            Some(res.output_bytes),
            Some(res.output_path.clone()),
        );

        Ok(res)
    })
    .await
    .map_err(|e| AppError::EngineError(format!("Task join error: {e}")))?
}

#[tauri::command]
pub fn compare_pdfs(
    app: AppHandle,
    logs: State<'_, LogBufferState>,
    options: ComparePdfsOptions,
) -> Result<Vec<PageDiffSummary>, AppError> {
    let left = PathBuf::from(&options.left_pdf_path);
    let right = PathBuf::from(&options.right_pdf_path);
    pdfium_engine::ensure_pdf_unlocked(&left)?;
    pdfium_engine::ensure_pdf_unlocked(&right)?;
    let summaries = diff_engine::compare_pdf_documents(&left, &right, options.dpi)?;

    push_and_emit_log(
        &app,
        &logs,
        "INFO",
        "pdfium",
        format!(
            "Compared '{}' vs '{}' across {} page(s) @ {} DPI",
            left.display(),
            right.display(),
            summaries.len(),
            options.dpi
        ),
    );

    Ok(summaries)
}
