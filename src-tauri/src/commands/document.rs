use crate::commands::system::{push_and_emit_log, LogBufferState};
use crate::db::settings_repo;
use crate::db::DatabaseState;
use crate::engines::pdfium_engine::{OpenedDocumentDto, PdfEngineRegistry};
use crate::engines::qpdf_engine;
use crate::error::AppError;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgressEvent {
    pub file_name: String,
    pub stage: String,
    pub current: usize,
    pub total: usize,
    pub percentage: u8,
}

fn emit_import_progress(
    app: &AppHandle,
    file_name: &str,
    stage: &str,
    current: usize,
    total: usize,
    percentage: u8,
) {
    let _ = app.emit(
        "import-progress",
        ImportProgressEvent {
            file_name: file_name.to_string(),
            stage: stage.to_string(),
            current,
            total,
            percentage,
        },
    );
}

#[tauri::command]
pub async fn open_pdf(
    app: AppHandle,
    path: String,
    password: Option<String>,
) -> Result<OpenedDocumentDto, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let registry = app.state::<PdfEngineRegistry>();
        let logs = app.state::<LogBufferState>();
        let path_buf = PathBuf::from(&path);
        let file_name = path_buf
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Document.pdf")
            .to_string();

        emit_import_progress(&app, &file_name, "Parsing PDF structure...", 0, 1, 25);
        push_and_emit_log(
            &app,
            &logs,
            "CMD",
            "pdfium",
            format!("Opening PDF document '{}'", path_buf.display()),
        );

        match registry.open_document(&path_buf, password.as_deref()) {
            Ok(dto) => {
                emit_import_progress(
                    &app,
                    &dto.file_name,
                    &format!("Loaded {} page(s)", dto.page_count),
                    1,
                    1,
                    100,
                );
                push_and_emit_log(
                    &app,
                    &logs,
                    "INFO",
                    "pdfium",
                    format!(
                        "Loaded '{}' ({} pages, PDF {}, {} bytes)",
                        dto.file_name, dto.page_count, dto.pdf_version, dto.file_size_bytes
                    ),
                );
                Ok(dto)
            }
            Err(err) => {
                push_and_emit_log(&app, &logs, "WARN", "pdfium", err.to_string());
                Err(err)
            }
        }
    })
    .await
    .map_err(|e| AppError::EngineError(format!("Task join error: {e}")))?
}

#[tauri::command]
pub fn get_initial_sample_pdf(
    db: State<'_, DatabaseState>,
    registry: State<'_, PdfEngineRegistry>,
) -> Result<OpenedDocumentDto, AppError> {
    let settings = settings_repo::get_settings(&db)?;
    let cache_dir = PathBuf::from(&settings.temp_cache_dir);
    registry.ensure_sample_pdf(&cache_dir)
}

#[tauri::command]
pub async fn insert_images_or_pdf(
    app: AppHandle,
    paths: Vec<String>,
) -> Result<Vec<OpenedDocumentDto>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = app.state::<DatabaseState>();
        let registry = app.state::<PdfEngineRegistry>();
        let logs = app.state::<LogBufferState>();

        let settings = settings_repo::get_settings(&db)?;
        let cache_dir = PathBuf::from(&settings.temp_cache_dir);
        let total = paths.len().max(1);
        let mut opened = Vec::with_capacity(paths.len());

        for (idx, raw_path) in paths.into_iter().enumerate() {
            let path = PathBuf::from(&raw_path);
            let file_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("File")
                .to_string();
            let pct = (((idx as f64) / (total as f64)) * 90.0).round() as u8 + 5;
            emit_import_progress(
                &app,
                &file_name,
                "Importing into workspace...",
                idx + 1,
                total,
                pct.min(95),
            );

            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
                .unwrap_or_default();

            let target_pdf = if matches!(
                ext.as_str(),
                "jpg" | "jpeg" | "png" | "webp" | "tiff" | "tif" | "bmp"
            ) {
                push_and_emit_log(
                    &app,
                    &logs,
                    "CMD",
                    "lopdf_crypto",
                    format!("Wrapping image '{}' into single-page PDF...", path.display()),
                );
                qpdf_engine::image_to_single_page_pdf(&path, &cache_dir)?
            } else {
                path
            };

            let dto = registry.open_document(&target_pdf, None)?;
            push_and_emit_log(
                &app,
                &logs,
                "INFO",
                "pdfium",
                format!(
                    "Inserted '{}' ({} page(s)) into grid",
                    dto.file_name, dto.page_count
                ),
            );
            opened.push(dto);
        }

        emit_import_progress(&app, "Import complete", "Ready", total, total, 100);
        Ok(opened)
    })
    .await
    .map_err(|e| AppError::EngineError(format!("Task join error: {e}")))?
}

#[tauri::command]
pub fn get_page_tile_svg(
    registry: State<'_, PdfEngineRegistry>,
    doc_id: String,
    page_number: u32,
    width: u32,
    rotate: u16,
) -> Result<String, AppError> {
    let bytes = registry.render_page_tile(&doc_id, page_number, width, rotate)?;
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Ok(format!(
            "data:image/jpeg;base64,{}",
            crate::engines::pdfium_ffi::encode_base64(&bytes)
        ));
    }
    String::from_utf8(bytes).map_err(|e| AppError::EngineError(e.to_string()))
}
