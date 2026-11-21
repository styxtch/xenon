use crate::commands::system::{push_and_emit_log, LogBufferState};
use crate::db::history_repo::{self, JobTickEvent};
use crate::db::settings_repo;
use crate::db::DatabaseState;
use crate::engines::gs_engine::{
    self, CompressExecutionResult, CompressOptions, OptimizeSingleResult, RepairExecutionResult,
};
use crate::engines::lopdf_crypto::{self, SanitizeResult, SizeEstimateResult};
use crate::engines::resolver::EnginePaths;
use crate::error::AppError;
use crate::utils::process_control::ProcessRegistry;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

fn emit_optimize_tick(
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
        category: "optimize".to_string(),
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
pub fn estimate_compressed_size(
    input_path: String,
    profile: String,
    custom_dpi: Option<u32>,
    custom_jpeg_quality: Option<u8>,
) -> Result<SizeEstimateResult, AppError> {
    lopdf_crypto::estimate_compressed_size(
        &PathBuf::from(input_path),
        &profile,
        custom_dpi,
        custom_jpeg_quality,
    )
}

#[tauri::command]
pub async fn compress_pdf(
    app: AppHandle,
    options: CompressOptions,
) -> Result<Vec<CompressExecutionResult>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        if options.input_paths.is_empty() {
            return Err(AppError::InvalidInput(
                "Select at least 1 PDF file to compress".to_string(),
            ));
        }

        let db = app.state::<DatabaseState>();
        let logs = app.state::<LogBufferState>();
        let proc_reg = app.state::<ProcessRegistry>();

        let settings = settings_repo::get_settings(&db)?;
        let cache_dir = PathBuf::from(&settings.temp_cache_dir);
        let resource_dir = app.path().resource_dir().ok();
        let paths = EnginePaths::resolve(resource_dir.as_deref());

        let mut results = Vec::with_capacity(options.input_paths.len());
        for raw_in in &options.input_paths {
            let in_path = PathBuf::from(raw_in);
            let doc_name = in_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Document.pdf")
                .to_string();
            let job_id = format!("job-{}", Uuid::new_v4());
            let op_label = format!("Compress ({})", options.profile);

            emit_optimize_tick(
                &app,
                &job_id,
                &doc_name,
                &op_label,
                3,
                "processing",
                0,
                None,
                None,
            );

            let res = gs_engine::compress_pdf_file_with_control(
                &paths,
                &in_path,
                &options,
                &cache_dir,
                Some(&job_id),
                Some(proc_reg.inner()),
            )?;

            push_and_emit_log(&app, &logs, "CMD", "ghostscript", &res.gs_command);
            push_and_emit_log(
                &app,
                &logs,
                "INFO",
                "ghostscript",
                format!(
                    "Compressed '{}' ({} -> {} bytes, -{:.1}%) in {} ms",
                    doc_name,
                    res.original_bytes,
                    res.output_bytes,
                    res.reduction_percent,
                    res.duration_ms
                ),
            );

            history_repo::insert_completed_job(
                &db,
                &doc_name,
                "optimize",
                &op_label,
                res.original_bytes,
                res.output_bytes,
                false,
                res.duration_ms,
                &res.output_path,
            )?;

            emit_optimize_tick(
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

            results.push(res);
        }

        Ok(results)
    })
    .await
    .map_err(|e| AppError::EngineError(format!("Task join error: {e}")))?
}

#[tauri::command]
pub async fn repair_pdf(
    app: AppHandle,
    input_path: String,
    output_path: String,
) -> Result<RepairExecutionResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<DatabaseState>();
        let logs = app.state::<LogBufferState>();
        let proc_reg = app.state::<ProcessRegistry>();

        let settings = settings_repo::get_settings(&db)?;
        let cache_dir = PathBuf::from(&settings.temp_cache_dir);
        let resource_dir = app.path().resource_dir().ok();
        let paths = EnginePaths::resolve(resource_dir.as_deref());

        let in_buf = PathBuf::from(&input_path);
        let out_buf = PathBuf::from(&output_path);
        let doc_name = out_buf
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Repaired.pdf")
            .to_string();
        let job_id = format!("job-{}", Uuid::new_v4());

        emit_optimize_tick(&app, &job_id, &doc_name, "Repair Xref", 3, "processing", 0, None, None);

        let res = gs_engine::repair_pdf_with_control(
            &paths,
            &in_buf,
            &out_buf,
            &cache_dir,
            Some(&job_id),
            Some(proc_reg.inner()),
        )?;

        push_and_emit_log(&app, &logs, "CMD", "qpdf", &res.command_log);
        push_and_emit_log(
            &app,
            &logs,
            "INFO",
            "qpdf",
            format!(
                "Repaired xref ({} objects checked, {} pages recovered)",
                res.fixed_xref_entries, res.recovered_pages
            ),
        );

        history_repo::insert_completed_job(
            &db,
            &doc_name,
            "optimize",
            "Repair Xref",
            res.original_bytes,
            res.output_bytes,
            false,
            res.duration_ms,
            &res.output_path,
        )?;

        emit_optimize_tick(
            &app,
            &job_id,
            &doc_name,
            "Repair Xref",
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
pub async fn linearize_pdf(
    app: AppHandle,
    input_path: String,
    output_path: String,
) -> Result<OptimizeSingleResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<DatabaseState>();
        let logs = app.state::<LogBufferState>();
        let proc_reg = app.state::<ProcessRegistry>();

        let settings = settings_repo::get_settings(&db)?;
        let cache_dir = PathBuf::from(&settings.temp_cache_dir);
        let resource_dir = app.path().resource_dir().ok();
        let paths = EnginePaths::resolve(resource_dir.as_deref());

        let in_buf = PathBuf::from(&input_path);
        let out_buf = PathBuf::from(&output_path);
        let doc_name = out_buf
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Linearized.pdf")
            .to_string();
        let job_id = format!("job-{}", Uuid::new_v4());

        emit_optimize_tick(
            &app,
            &job_id,
            &doc_name,
            "Linearize Fast Web",
            3,
            "processing",
            0,
            None,
            None,
        );

        let res = gs_engine::linearize_pdf_with_control(
            &paths,
            &in_buf,
            &out_buf,
            &cache_dir,
            Some(&job_id),
            Some(proc_reg.inner()),
        )?;

        push_and_emit_log(&app, &logs, "CMD", "qpdf", &res.command_log);
        push_and_emit_log(
            &app,
            &logs,
            "INFO",
            "qpdf",
            format!(
                "Linearized '{}' ({} pages, Fast Web View ready)",
                out_buf.display(),
                res.page_count
            ),
        );

        history_repo::insert_completed_job(
            &db,
            &doc_name,
            "optimize",
            "Linearize Fast Web",
            res.original_bytes,
            res.output_bytes,
            false,
            res.duration_ms,
            &res.output_path,
        )?;

        emit_optimize_tick(
            &app,
            &job_id,
            &doc_name,
            "Linearize Fast Web",
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
pub async fn sanitize_metadata(
    app: AppHandle,
    input_path: String,
    output_path: String,
) -> Result<SanitizeResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<DatabaseState>();
        let logs = app.state::<LogBufferState>();

        let settings = settings_repo::get_settings(&db)?;
        let cache_dir = PathBuf::from(&settings.temp_cache_dir);
        let in_buf = PathBuf::from(&input_path);
        let out_buf = PathBuf::from(&output_path);

        let res = lopdf_crypto::sanitize_pdf_metadata(&in_buf, &out_buf, &cache_dir)?;

        push_and_emit_log(
            &app,
            &logs,
            "INFO",
            "lopdf_crypto",
            format!(
                "Sanitized metadata: removed {} XMP stream(s), {} Info key(s), pruned {} orphan object(s)",
                res.removed_metadata_streams, res.stripped_info_keys, res.pruned_orphan_objects
            ),
        );

        let doc_name = out_buf
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Sanitized.pdf");
        history_repo::insert_completed_job(
            &db,
            doc_name,
            "optimize",
            "Sanitize XMP",
            res.original_bytes,
            res.output_bytes,
            false,
            res.duration_ms,
            &res.output_path,
        )?;

        Ok(res)
    })
    .await
    .map_err(|e| AppError::EngineError(format!("Task join error: {e}")))?
}
