use crate::commands::system::{push_and_emit_log, LogBufferState};
use crate::db::history_repo;
use crate::db::settings_repo;
use crate::db::DatabaseState;
use crate::engines::lopdf_crypto::{self, FormFieldSpec, SecurityExecutionResult};
use crate::error::AppError;
use std::path::PathBuf;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_form_fields(input_path: String) -> Result<Vec<FormFieldSpec>, AppError> {
    lopdf_crypto::get_pdf_form_fields(&PathBuf::from(input_path))
}

#[tauri::command]
pub fn save_form_fields(
    app: AppHandle,
    db: State<'_, DatabaseState>,
    logs: State<'_, LogBufferState>,
    input_path: String,
    output_path: String,
    fields: Vec<FormFieldSpec>,
    flatten_on_save: bool,
) -> Result<SecurityExecutionResult, AppError> {
    let settings = settings_repo::get_settings(&db)?;
    let cache_dir = PathBuf::from(&settings.temp_cache_dir);

    let in_buf = PathBuf::from(&input_path);
    let out_buf = PathBuf::from(&output_path);
    let res = lopdf_crypto::save_pdf_form_fields(
        &in_buf,
        &out_buf,
        &fields,
        flatten_on_save,
        &cache_dir,
    )?;

    push_and_emit_log(&app, &logs, "CMD", "lopdf_crypto", &res.command_log);
    push_and_emit_log(&app, &logs, "INFO", "lopdf_crypto", &res.summary);

    let doc_name = out_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("AcroForm.pdf");
    history_repo::insert_completed_job(
        &db,
        doc_name,
        "convert",
        if flatten_on_save {
            "AcroForm Flatten"
        } else {
            "AcroForm Save"
        },
        res.original_bytes,
        res.output_bytes,
        false,
        res.duration_ms,
        &res.output_path,
    )?;

    Ok(res)
}
