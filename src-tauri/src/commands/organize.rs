use crate::commands::system::{push_and_emit_log, LogBufferState};
use crate::db::history_repo::{self, JobTickEvent};
use crate::db::settings_repo;
use crate::db::DatabaseState;
use crate::engines::pdfium_engine::{self, PdfEngineRegistry};
use crate::engines::qpdf_engine::{
    self, OrganizeExecutionResult, OrganizeOptions, PageReorderSpec, SplitOptions,
};
use crate::engines::resolver::EnginePaths;
use crate::error::AppError;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

fn emit_tick(
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
        category: "organize".to_string(),
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

#[tauri::command]
pub fn execute_organize_pdf(
    app: AppHandle,
    db: State<'_, DatabaseState>,
    registry: State<'_, PdfEngineRegistry>,
    logs: State<'_, LogBufferState>,
    options: OrganizeOptions,
) -> Result<OrganizeExecutionResult, AppError> {
    let settings = settings_repo::get_settings(&db)?;
    let cache_dir = PathBuf::from(&settings.temp_cache_dir);
    let resource_dir = app.path().resource_dir().ok();
    let paths = EnginePaths::resolve(resource_dir.as_deref());

    let out_name = PathBuf::from(&options.output_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Organized.pdf")
        .to_string();
    let job_id = format!("job-{}", Uuid::new_v4());

    emit_tick(&app, &job_id, &out_name, "Organize & Reorder", 2, "processing", 0, None, None);

    let result = qpdf_engine::execute_organize(
        &registry,
        &paths,
        &options,
        &cache_dir,
        settings.preserve_modification_timestamp,
    )?;

    push_and_emit_log(&app, &logs, "CMD", "qpdf", &result.qpdf_command);
    push_and_emit_log(
        &app,
        &logs,
        "INFO",
        "qpdf",
        format!(
            "Exported '{}' ({} pages, {} bytes) in {} ms",
            out_name, result.page_count, result.output_bytes, result.duration_ms
        ),
    );

    let op_label = format!("Organize ({} pages)", result.page_count);
    history_repo::insert_completed_job(
        &db,
        &out_name,
        "organize",
        &op_label,
        result.original_bytes,
        result.output_bytes,
        false,
        result.duration_ms,
        &result.output_path,
    )?;

    emit_tick(
        &app,
        &job_id,
        &out_name,
        &op_label,
        10,
        "completed",
        result.original_bytes,
        Some(result.output_bytes),
        Some(result.output_path.clone()),
    );

    Ok(result)
}

#[tauri::command]
pub fn execute_merge_pdfs(
    app: AppHandle,
    db: State<'_, DatabaseState>,
    registry: State<'_, PdfEngineRegistry>,
    logs: State<'_, LogBufferState>,
    input_paths: Vec<String>,
    retain_bookmarks_toc: bool,
    standardize_to_a4: bool,
    pdf_version_profile: String,
    output_path: String,
) -> Result<OrganizeExecutionResult, AppError> {
    if input_paths.is_empty() {
        return Err(AppError::InvalidInput(
            "Select at least 1 PDF file to merge".to_string(),
        ));
    }

    let settings = settings_repo::get_settings(&db)?;
    let cache_dir = PathBuf::from(&settings.temp_cache_dir);
    let resource_dir = app.path().resource_dir().ok();
    let paths = EnginePaths::resolve(resource_dir.as_deref());

    let mut pages = Vec::new();
    for path_str in &input_paths {
        let dto = registry.open_document(&PathBuf::from(path_str), None)?;
        for page in dto.pages {
            pages.push(PageReorderSpec {
                source_doc_id: dto.doc_id.clone(),
                original_page_number: page.page_number,
                rotation_delta: 0,
                crop_box: None,
            });
        }
    }

    let options = OrganizeOptions {
        pages,
        retain_bookmarks_toc,
        standardize_to_a4,
        pdf_version_profile,
        preserve_password: true,
        output_path: output_path.clone(),
    };

    let result = qpdf_engine::execute_organize(
        &registry,
        &paths,
        &options,
        &cache_dir,
        settings.preserve_modification_timestamp,
    )?;

    let out_name = PathBuf::from(&output_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Merged.pdf")
        .to_string();

    push_and_emit_log(&app, &logs, "CMD", "qpdf", &result.qpdf_command);
    push_and_emit_log(
        &app,
        &logs,
        "INFO",
        "qpdf",
        format!(
            "Merged {} files -> '{}' ({} pages, {} bytes)",
            input_paths.len(),
            out_name,
            result.page_count,
            result.output_bytes
        ),
    );

    let op_label = format!("Merge ({} files)", input_paths.len());
    history_repo::insert_completed_job(
        &db,
        &out_name,
        "organize",
        &op_label,
        result.original_bytes,
        result.output_bytes,
        false,
        result.duration_ms,
        &result.output_path,
    )?;

    Ok(result)
}

#[tauri::command]
pub fn execute_split_pdf(
    app: AppHandle,
    db: State<'_, DatabaseState>,
    registry: State<'_, PdfEngineRegistry>,
    logs: State<'_, LogBufferState>,
    options: SplitOptions,
) -> Result<Vec<OrganizeExecutionResult>, AppError> {
    pdfium_engine::ensure_pdf_unlocked(std::path::Path::new(&options.input_path))?;
    let settings = settings_repo::get_settings(&db)?;
    let cache_dir = PathBuf::from(&settings.temp_cache_dir);
    let resource_dir = app.path().resource_dir().ok();
    let paths = EnginePaths::resolve(resource_dir.as_deref());

    let results = qpdf_engine::execute_split(
        &registry,
        &paths,
        &options,
        &cache_dir,
        settings.preserve_modification_timestamp,
    )?;

    if let Some(first) = results.first() {
        push_and_emit_log(&app, &logs, "CMD", "qpdf", &first.qpdf_command);
    }
    push_and_emit_log(
        &app,
        &logs,
        "INFO",
        "qpdf",
        format!(
            "Split completed: generated {} PDF file(s) in '{}'",
            results.len(),
            options.output_dir
        ),
    );

    let in_name = PathBuf::from(&options.input_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Split_Output.pdf")
        .to_string();
    let total_out_bytes: u64 = results.iter().map(|r| r.output_bytes).sum();
    let total_orig_bytes = results.first().map(|r| r.original_bytes).unwrap_or(0);
    let total_ms: u64 = results.iter().map(|r| r.duration_ms).sum();

    history_repo::insert_completed_job(
        &db,
        &in_name,
        "organize",
        &format!("Split ({} parts)", results.len()),
        total_orig_bytes,
        total_out_bytes,
        false,
        total_ms,
        &options.output_dir,
    )?;

    Ok(results)
}
