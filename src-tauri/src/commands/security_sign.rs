use crate::commands::system::{push_and_emit_log, LogBufferState};
use crate::db::history_repo;
use crate::db::settings_repo;
use crate::db::DatabaseState;
use crate::engines::lopdf_crypto::{
    self, KeystoreInfoDto, SecurityExecutionResult, SecuritySignOptions,
};
use crate::engines::pdfium_engine;
use crate::engines::qpdf_engine;
use crate::engines::resolver::EnginePaths;
use crate::error::AppError;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn encrypt_pdf(
    app: AppHandle,
    db: State<'_, DatabaseState>,
    logs: State<'_, LogBufferState>,
    options: SecuritySignOptions,
) -> Result<SecurityExecutionResult, AppError> {
    let enc = options.encryption.ok_or_else(|| {
        AppError::InvalidInput("Missing encryption configuration".to_string())
    })?;
    let settings = settings_repo::get_settings(&db)?;
    let cache_dir = PathBuf::from(&settings.temp_cache_dir);
    let resource_dir = app.path().resource_dir().ok();
    let paths = EnginePaths::resolve(resource_dir.as_deref());

    let in_buf = PathBuf::from(&options.input_path);
    let out_buf = PathBuf::from(&options.output_path);
    let res = qpdf_engine::encrypt_pdf_aes(&paths, &in_buf, &out_buf, &enc, &cache_dir)?;

    push_and_emit_log(&app, &logs, "CMD", "qpdf", &res.command_log);
    push_and_emit_log(&app, &logs, "INFO", "qpdf", &res.summary);

    let doc_name = out_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Protected.pdf");
    history_repo::insert_completed_job(
        &db,
        doc_name,
        "security",
        &format!("Encrypt ({})", enc.level.to_uppercase()),
        res.original_bytes,
        res.output_bytes,
        true,
        res.duration_ms,
        &res.output_path,
    )?;

    Ok(res)
}

#[tauri::command]
pub fn decrypt_pdf(
    app: AppHandle,
    db: State<'_, DatabaseState>,
    logs: State<'_, LogBufferState>,
    input_path: String,
    password: String,
    output_path: String,
) -> Result<SecurityExecutionResult, AppError> {
    let settings = settings_repo::get_settings(&db)?;
    let cache_dir = PathBuf::from(&settings.temp_cache_dir);
    let resource_dir = app.path().resource_dir().ok();
    let paths = EnginePaths::resolve(resource_dir.as_deref());

    let in_buf = PathBuf::from(&input_path);
    let out_buf = PathBuf::from(&output_path);
    let res =
        qpdf_engine::decrypt_pdf_password(&paths, &in_buf, &password, &out_buf, &cache_dir)?;

    push_and_emit_log(&app, &logs, "CMD", "qpdf", &res.command_log);
    push_and_emit_log(&app, &logs, "INFO", "qpdf", &res.summary);

    let doc_name = out_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unlocked.pdf");
    history_repo::insert_completed_job(
        &db,
        doc_name,
        "security",
        "Unlock PDF",
        res.original_bytes,
        res.output_bytes,
        false,
        res.duration_ms,
        &res.output_path,
    )?;

    Ok(res)
}

#[tauri::command]
pub fn generate_demo_p12(
    app: AppHandle,
    db: State<'_, DatabaseState>,
    logs: State<'_, LogBufferState>,
    common_name: String,
    passphrase: String,
) -> Result<KeystoreInfoDto, AppError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("xenon-pdf"));
    let safe_name: String = common_name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let cert_path = app_data_dir
        .join("certs")
        .join(format!("{safe_name}.p12"));

    let info = lopdf_crypto::generate_self_signed_p12(&cert_path, &common_name, &passphrase)?;

    let mut settings = settings_repo::get_settings(&db)?;
    settings.p12_keystore_path = info.p12_path.clone();
    settings.p12_keystore_subject = info.subject.clone();
    settings_repo::save_settings(&db, &settings)?;

    push_and_emit_log(
        &app,
        &logs,
        "INFO",
        "lopdf_crypto",
        format!(
            "Generated local PKCS#12 keystore '{}' (sha256={}...)",
            info.p12_path,
            &info.fingerprint_sha256[..12]
        ),
    );

    Ok(info)
}

#[tauri::command]
pub fn sign_pdf_pkcs12(
    app: AppHandle,
    db: State<'_, DatabaseState>,
    logs: State<'_, LogBufferState>,
    options: SecuritySignOptions,
) -> Result<SecurityExecutionResult, AppError> {
    let sig = options.pkcs12_signature.ok_or_else(|| {
        AppError::InvalidInput("Missing PKCS#12 signature parameters".to_string())
    })?;
    let settings = settings_repo::get_settings(&db)?;
    let cache_dir = PathBuf::from(&settings.temp_cache_dir);

    let in_buf = PathBuf::from(&options.input_path);
    let out_buf = PathBuf::from(&options.output_path);

    let mut temp_stamped_path: Option<PathBuf> = None;
    let effective_in = if let Some(v) = &sig.visual_stamp {
        if let Some(img_p) = v.signature_image_path.as_deref().filter(|s| !s.trim().is_empty()) {
            let tmp = cache_dir.join(format!("vstamp_{}.pdf", uuid::Uuid::new_v4()));
            lopdf_crypto::apply_visual_image_signature(
                &in_buf,
                &tmp,
                &PathBuf::from(img_p),
                v.page,
                v.x,
                v.y,
                v.w,
                v.h,
                &cache_dir,
            )?;
            temp_stamped_path = Some(tmp.clone());
            tmp
        } else {
            in_buf
        }
    } else {
        in_buf
    };

    let res = lopdf_crypto::sign_pdf_incremental_pkcs12(&effective_in, &out_buf, &sig, &cache_dir);
    if let Some(tmp) = temp_stamped_path {
        let _ = std::fs::remove_file(tmp);
    }
    let res = res?;

    push_and_emit_log(&app, &logs, "CMD", "lopdf_crypto", &res.command_log);
    push_and_emit_log(&app, &logs, "INFO", "lopdf_crypto", &res.summary);

    let doc_name = out_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Signed.pdf");
    history_repo::insert_completed_job(
        &db,
        doc_name,
        "security",
        "Sign PKCS#12",
        res.original_bytes,
        res.output_bytes,
        true,
        res.duration_ms,
        &res.output_path,
    )?;

    Ok(res)
}

#[tauri::command]
pub fn apply_watermark(
    app: AppHandle,
    db: State<'_, DatabaseState>,
    logs: State<'_, LogBufferState>,
    options: SecuritySignOptions,
) -> Result<SecurityExecutionResult, AppError> {
    let wm = options.watermark.ok_or_else(|| {
        AppError::InvalidInput("Missing watermark specification".to_string())
    })?;
    let settings = settings_repo::get_settings(&db)?;
    let cache_dir = PathBuf::from(&settings.temp_cache_dir);

    let in_buf = PathBuf::from(&options.input_path);
    let out_buf = PathBuf::from(&options.output_path);
    let res = lopdf_crypto::apply_watermark_to_pdf(
        &in_buf,
        &out_buf,
        &wm,
        options.flatten_all,
        options.sanitize_xmp,
        &cache_dir,
    )?;

    push_and_emit_log(&app, &logs, "CMD", "lopdf_crypto", &res.command_log);
    push_and_emit_log(&app, &logs, "INFO", "lopdf_crypto", &res.summary);

    let doc_name = out_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Watermarked.pdf");
    history_repo::insert_completed_job(
        &db,
        doc_name,
        "security",
        if options.flatten_all {
            "Watermark & Flatten"
        } else {
            "Watermark Stamp"
        },
        res.original_bytes,
        res.output_bytes,
        false,
        res.duration_ms,
        &res.output_path,
    )?;

    Ok(res)
}

#[tauri::command]
pub fn flatten_pdf(
    app: AppHandle,
    db: State<'_, DatabaseState>,
    logs: State<'_, LogBufferState>,
    input_path: String,
    output_path: String,
) -> Result<SecurityExecutionResult, AppError> {
    let settings = settings_repo::get_settings(&db)?;
    let cache_dir = PathBuf::from(&settings.temp_cache_dir);

    let in_buf = PathBuf::from(&input_path);
    let out_buf = PathBuf::from(&output_path);
    let res = lopdf_crypto::flatten_pdf_annotations(&in_buf, &out_buf, &cache_dir)?;

    push_and_emit_log(&app, &logs, "CMD", "lopdf_crypto", &res.command_log);
    push_and_emit_log(&app, &logs, "INFO", "lopdf_crypto", &res.summary);

    let doc_name = out_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Flattened.pdf");
    history_repo::insert_completed_job(
        &db,
        doc_name,
        "security",
        "Flatten PDF",
        res.original_bytes,
        res.output_bytes,
        false,
        res.duration_ms,
        &res.output_path,
    )?;

    Ok(res)
}

#[tauri::command]
pub fn true_redact(
    app: AppHandle,
    db: State<'_, DatabaseState>,
    logs: State<'_, LogBufferState>,
    options: SecuritySignOptions,
) -> Result<SecurityExecutionResult, AppError> {
    let redactions = options.redactions.ok_or_else(|| {
        AppError::InvalidInput("Missing redaction box configuration".to_string())
    })?;
    let settings = settings_repo::get_settings(&db)?;
    let cache_dir = PathBuf::from(&settings.temp_cache_dir);

    let in_buf = PathBuf::from(&options.input_path);
    let out_buf = PathBuf::from(&options.output_path);
    let res = pdfium_engine::execute_true_redaction(
        &in_buf,
        &out_buf,
        &redactions,
        options.sanitize_xmp,
        &cache_dir,
    )?;

    push_and_emit_log(&app, &logs, "CMD", "pdfium", &res.command_log);
    push_and_emit_log(&app, &logs, "INFO", "pdfium", &res.summary);

    let doc_name = out_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Redacted.pdf");
    history_repo::insert_completed_job(
        &db,
        doc_name,
        "security",
        &format!("True Redact ({} box)", redactions.boxes.len()),
        res.original_bytes,
        res.output_bytes,
        true,
        res.duration_ms,
        &res.output_path,
    )?;

    Ok(res)
}

#[tauri::command]
pub fn find_text_redaction_boxes(
    input_path: String,
    query: String,
    mode: String,
    case_sensitive: bool,
    fill_color_hex: String,
) -> Result<Vec<lopdf_crypto::RedactionBox>, AppError> {
    pdfium_engine::find_text_redaction_boxes(
        &PathBuf::from(&input_path),
        &query,
        &mode,
        case_sensitive,
        &fill_color_hex,
    )
}

#[tauri::command]
pub fn stamp_visual_signature(
    app: AppHandle,
    db: State<'_, DatabaseState>,
    logs: State<'_, LogBufferState>,
    input_path: String,
    output_path: String,
    image_path: String,
    page: u32,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
) -> Result<SecurityExecutionResult, AppError> {
    let settings = settings_repo::get_settings(&db)?;
    let cache_dir = PathBuf::from(&settings.temp_cache_dir);

    let in_buf = PathBuf::from(&input_path);
    let out_buf = PathBuf::from(&output_path);
    let img_buf = PathBuf::from(&image_path);

    let res = lopdf_crypto::apply_visual_image_signature(
        &in_buf,
        &out_buf,
        &img_buf,
        page,
        x,
        y,
        w,
        h,
        &cache_dir,
    )?;

    push_and_emit_log(&app, &logs, "CMD", "lopdf_crypto", &res.command_log);
    push_and_emit_log(&app, &logs, "INFO", "lopdf_crypto", &res.summary);

    let doc_name = out_buf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Signed.pdf");
    history_repo::insert_completed_job(
        &db,
        doc_name,
        "security",
        "Visual Signature (Image)",
        res.original_bytes,
        res.output_bytes,
        false,
        res.duration_ms,
        &res.output_path,
    )?;

    Ok(res)
}
