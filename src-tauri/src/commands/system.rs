use crate::db::history_repo::{self, DashboardMetrics, JobTickEvent};
use crate::db::settings_repo::{self, AppSettings};
use crate::db::DatabaseState;
use crate::engines::pdfium_engine::PdfEngineRegistry;
use crate::engines::resolver::{self, EngineDiagnosticStatus, EnginePaths, EngineTestResult};
use crate::error::AppError;
use crate::utils::atomic_fs;
use crate::utils::telemetry::{self, HardwareTelemetry};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineLogEntry {
    pub id: String,
    pub timestamp: String,
    pub level: String,
    pub engine: String,
    pub message: String,
}

#[derive(Clone)]
pub struct LogBufferState {
    pub entries: Arc<Mutex<Vec<EngineLogEntry>>>,
}

impl LogBufferState {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn push(&self, level: &str, engine: &str, message: impl Into<String>) -> EngineLogEntry {
        let entry = EngineLogEntry {
            id: uuid::Uuid::new_v4().to_string(),
            timestamp: formatted_hms_millis(),
            level: level.to_string(),
            engine: engine.to_string(),
            message: message.into(),
        };
        let mut guard = self.entries.lock();
        guard.push(entry.clone());
        if guard.len() > 500 {
            let excess = guard.len() - 500;
            guard.drain(0..excess);
        }
        entry
    }
}

fn formatted_hms_millis() -> String {
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let total_secs = dur.as_secs() % 86_400;
    let h = total_secs / 3_600;
    let m = (total_secs % 3_600) / 60;
    let s = total_secs % 60;
    let ms = dur.subsec_millis();
    format!("{h:02}:{m:02}:{s:02}.{ms:03}")
}

pub fn push_and_emit_log(
    app: &AppHandle,
    logs: &LogBufferState,
    level: &str,
    engine: &str,
    message: impl Into<String>,
) {
    let entry = logs.push(level, engine, message);
    let _ = app.emit("engine-log-line", &entry);
}

#[tauri::command]
pub fn get_hardware_telemetry(db: State<'_, DatabaseState>) -> Result<HardwareTelemetry, AppError> {
    let settings = settings_repo::get_settings(&db)?;
    let cache_dir = PathBuf::from(&settings.temp_cache_dir);
    Ok(telemetry::collect_hardware_telemetry(
        settings.worker_threads,
        settings.memory_cache_limit_mb,
        &cache_dir,
    ))
}

#[tauri::command]
pub fn get_dashboard_metrics(db: State<'_, DatabaseState>) -> Result<DashboardMetrics, AppError> {
    history_repo::get_dashboard_metrics(&db)
}

#[tauri::command]
pub fn verify_engines(
    app: AppHandle,
    logs: State<'_, LogBufferState>,
) -> Result<Vec<EngineDiagnosticStatus>, AppError> {
    let resource_dir = app.path().resource_dir().ok();
    let paths = EnginePaths::resolve(resource_dir.as_deref());
    push_and_emit_log(
        &app,
        &logs,
        "CMD",
        "tauri",
        "Running SHA-256 integrity suite across all 4 bundled PDF engines...",
    );

    let results = resolver::verify_all_engines(&paths);
    for diag in &results {
        let level = if diag.sha256_verified { "INFO" } else { "ERR" };
        let short_hash = if diag.sha256.len() >= 16 {
            &diag.sha256[..16]
        } else {
            &diag.sha256
        };
        push_and_emit_log(
            &app,
            &logs,
            level,
            &diag.name,
            format!(
                "{} [{}] sha256={}... verified={}",
                diag.display_name, diag.status, short_hash, diag.sha256_verified
            ),
        );
    }

    Ok(results)
}

#[tauri::command]
pub fn test_engine_binary(
    app: AppHandle,
    logs: State<'_, LogBufferState>,
    name: String,
) -> Result<EngineTestResult, AppError> {
    let resource_dir = app.path().resource_dir().ok();
    let paths = EnginePaths::resolve(resource_dir.as_deref());
    push_and_emit_log(
        &app,
        &logs,
        "CMD",
        &name,
        format!("Executing binary self-test for '{name}'..."),
    );

    match resolver::test_engine_binary(&paths, &name) {
        Ok(res) => {
            push_and_emit_log(
                &app,
                &logs,
                "INFO",
                &name,
                format!("{} ({} ms)", res.output, res.latency_ms),
            );
            Ok(res)
        }
        Err(err) => {
            push_and_emit_log(&app, &logs, "ERR", &name, err.to_string());
            Err(err)
        }
    }
}

#[tauri::command]
pub fn get_app_settings(db: State<'_, DatabaseState>) -> Result<AppSettings, AppError> {
    settings_repo::get_settings(&db)
}

#[tauri::command]
pub fn save_app_settings(
    app: AppHandle,
    db: State<'_, DatabaseState>,
    registry: State<'_, PdfEngineRegistry>,
    logs: State<'_, LogBufferState>,
    settings: AppSettings,
) -> Result<AppSettings, AppError> {
    settings_repo::save_settings(&db, &settings)?;
    registry.set_cache_limit_mb(settings.memory_cache_limit_mb);
    push_and_emit_log(
        &app,
        &logs,
        "INFO",
        "sqlite",
        format!(
            "Saved settings: {} threads, {} MB tile cache, encryption={}",
            settings.worker_threads, settings.memory_cache_limit_mb, settings.default_encryption_level
        ),
    );
    Ok(settings)
}

#[tauri::command]
pub fn restore_default_settings(
    app: AppHandle,
    db: State<'_, DatabaseState>,
    logs: State<'_, LogBufferState>,
) -> Result<AppSettings, AppError> {
    let defaults = settings_repo::restore_defaults(&db)?;
    push_and_emit_log(
        &app,
        &logs,
        "WARN",
        "sqlite",
        "Restored XENON preferences to factory defaults.",
    );
    Ok(defaults)
}

#[tauri::command]
pub fn clear_temp_cache(
    app: AppHandle,
    db: State<'_, DatabaseState>,
    logs: State<'_, LogBufferState>,
) -> Result<u64, AppError> {
    let settings = settings_repo::get_settings(&db)?;
    let freed = atomic_fs::clear_cache_dir(&PathBuf::from(&settings.temp_cache_dir))?;
    push_and_emit_log(
        &app,
        &logs,
        "INFO",
        "tauri",
        format!(
            "Cleared temporary cache directory ({} bytes freed).",
            freed
        ),
    );
    Ok(freed)
}

#[tauri::command]
pub fn get_engine_logs(logs: State<'_, LogBufferState>) -> Vec<EngineLogEntry> {
    logs.entries.lock().clone()
}

#[tauri::command]
pub fn clear_engine_logs(logs: State<'_, LogBufferState>) {
    logs.entries.lock().clear();
    logs.push("INFO", "tauri", "Log buffer cleared by user.");
}

#[tauri::command]
pub fn cancel_recent_job(
    app: AppHandle,
    db: State<'_, DatabaseState>,
    logs: State<'_, LogBufferState>,
    job_id: String,
) -> Result<DashboardMetrics, AppError> {
    history_repo::cancel_job(&db, &job_id)?;
    push_and_emit_log(
        &app,
        &logs,
        "WARN",
        "tauri",
        format!("Cancelled active job '{job_id}' and updated SQLite history."),
    );
    history_repo::get_dashboard_metrics(&db)
}

#[tauri::command]
pub fn rerun_recent_job(
    app: AppHandle,
    db: State<'_, DatabaseState>,
    logs: State<'_, LogBufferState>,
    job_id: String,
) -> Result<JobTickEvent, AppError> {
    let job = history_repo::rerun_job(&db, &job_id)?;
    push_and_emit_log(
        &app,
        &logs,
        "INFO",
        "sqlite",
        format!(
            "Re-ran '{}' ({}) -> {}",
            job.document_name, job.operation_label, job.status
        ),
    );
    Ok(job)
}

#[tauri::command]
pub fn get_demo_showcase_mode(db: State<'_, DatabaseState>) -> bool {
    db.is_demo_showcase_enabled()
}

#[tauri::command]
pub fn set_demo_showcase_mode(
    app: AppHandle,
    db: State<'_, DatabaseState>,
    logs: State<'_, LogBufferState>,
    enabled: bool,
) -> Result<DashboardMetrics, AppError> {
    db.set_demo_showcase_data(enabled)?;
    push_and_emit_log(
        &app,
        &logs,
        "INFO",
        "sqlite",
        if enabled {
            "Demo Showcase Mode enabled (loaded screenshot sample metrics & documents)."
        } else {
            "Demo Showcase Mode disabled (cleared sample data; real job history preserved)."
        },
    );
    history_repo::get_dashboard_metrics(&db)
}

#[tauri::command]
pub fn check_existing_paths(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|p| !p.trim().is_empty() && std::path::Path::new(p).exists())
        .collect()
}

#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), AppError> {
    let target = std::path::PathBuf::from(&path);
    if !target.exists() {
        return Err(AppError::InvalidInput(format!(
            "Path does not exist: {}",
            target.display()
        )));
    }
    #[cfg(target_os = "windows")]
    {
        if target.is_dir() {
            std::process::Command::new("explorer.exe")
                .arg(&target)
                .spawn()?;
        } else {
            std::process::Command::new("explorer.exe")
                .arg(format!("/select,{}", target.display()))
                .spawn()?;
        }
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&target)
            .spawn()?;
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let dir = if target.is_dir() {
            target
        } else {
            target.parent().unwrap_or(&target).to_path_buf()
        };
        std::process::Command::new("xdg-open").arg(dir).spawn()?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_file_in_os(path: String) -> Result<(), AppError> {
    let target = std::path::PathBuf::from(&path);
    if !target.exists() {
        return Err(AppError::InvalidInput(format!(
            "File does not exist: {}",
            target.display()
        )));
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd.exe")
            .args(["/c", "start", ""])
            .arg(&target)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(&target).spawn()?;
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(&target).spawn()?;
    }
    Ok(())
}

#[tauri::command]
pub fn pause_batch_job(
    app: AppHandle,
    proc_reg: State<'_, crate::utils::process_control::ProcessRegistry>,
    logs: State<'_, LogBufferState>,
    job_id: String,
) -> Result<bool, AppError> {
    let ok = proc_reg
        .pause_job(&job_id)
        .map_err(AppError::EngineError)?;
    if ok {
        push_and_emit_log(
            &app,
            &logs,
            "WARN",
            "tauri",
            format!("Suspended OS process for job '{job_id}' via Win32 Job Control."),
        );
    }
    Ok(ok)
}

#[tauri::command]
pub fn resume_batch_job(
    app: AppHandle,
    proc_reg: State<'_, crate::utils::process_control::ProcessRegistry>,
    logs: State<'_, LogBufferState>,
    job_id: String,
) -> Result<bool, AppError> {
    let ok = proc_reg
        .resume_job(&job_id)
        .map_err(AppError::EngineError)?;
    if ok {
        push_and_emit_log(
            &app,
            &logs,
            "INFO",
            "tauri",
            format!("Resumed OS process for job '{job_id}'."),
        );
    }
    Ok(ok)
}

#[tauri::command]
pub fn cancel_batch_job(
    app: AppHandle,
    db: State<'_, DatabaseState>,
    proc_reg: State<'_, crate::utils::process_control::ProcessRegistry>,
    logs: State<'_, LogBufferState>,
    job_id: String,
) -> Result<bool, AppError> {
    let ok = proc_reg
        .cancel_job(&job_id)
        .map_err(AppError::EngineError)?;
    let _ = history_repo::cancel_job(&db, &job_id);
    push_and_emit_log(
        &app,
        &logs,
        "WARN",
        "tauri",
        format!("Terminated job '{job_id}' process tree (terminated={ok})."),
    );
    Ok(ok)
}
