use crate::db::DatabaseState;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sysinfo::System;

const SETTINGS_ROW_KEY: &str = "user_preferences";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub sandbox_worker_threads: bool,
    pub worker_threads: usize,
    pub memory_cache_limit_mb: usize,
    pub temp_cache_dir: String,
    pub hardware_acceleration_gpu: bool,
    pub default_encryption_level: String,
    pub p12_keystore_path: String,
    pub p12_keystore_subject: String,
    pub auto_flatten_on_save: bool,
    pub sanitize_metadata_xmp: bool,
    pub output_naming_pattern: String,
    pub primary_destination_folder: String,
    pub preserve_modification_timestamp: bool,
    pub desktop_notification_on_complete: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        let physical_cores = System::new().physical_core_count().unwrap_or(8).max(1);
        let default_threads = physical_cores.min(8).max(1);
        let temp_dir = std::env::temp_dir()
            .join("xenon_cache")
            .to_string_lossy()
            .to_string();
        let exports_dir = std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .map(std::path::PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join("Documents")
            .join("XENON_Exports")
            .to_string_lossy()
            .to_string();

        Self {
            sandbox_worker_threads: true,
            worker_threads: default_threads,
            memory_cache_limit_mb: 2048,
            temp_cache_dir: temp_dir,
            hardware_acceleration_gpu: true,
            default_encryption_level: "AES-256 bit (Acrobat 9.0+)".to_string(),
            p12_keystore_path: String::new(),
            p12_keystore_subject: "No certificate loaded".to_string(),
            auto_flatten_on_save: true,
            sanitize_metadata_xmp: true,
            output_naming_pattern: "{filename}_xenon_{date}".to_string(),
            primary_destination_folder: exports_dir,
            preserve_modification_timestamp: true,
            desktop_notification_on_complete: true,
        }
    }
}

pub fn get_settings(db: &DatabaseState) -> Result<AppSettings, AppError> {
    let conn = db.conn.lock();
    let row: Result<String, rusqlite::Error> = conn.query_row(
        "SELECT value_json FROM app_settings WHERE key = ?1",
        rusqlite::params![SETTINGS_ROW_KEY],
        |r| r.get(0),
    );

    match row {
        Ok(json) => {
            let parsed: AppSettings = serde_json::from_str(&json)?;
            Ok(parsed)
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            let defaults = AppSettings::default();
            let json = serde_json::to_string(&defaults)?;
            conn.execute(
                "INSERT INTO app_settings (key, value_json) VALUES (?1, ?2)",
                rusqlite::params![SETTINGS_ROW_KEY, json],
            )?;
            Ok(defaults)
        }
        Err(e) => Err(AppError::Database(e.to_string())),
    }
}

pub fn save_settings(db: &DatabaseState, settings: &AppSettings) -> Result<(), AppError> {
    let json = serde_json::to_string(settings)?;
    let conn = db.conn.lock();
    conn.execute(
        "INSERT INTO app_settings (key, value_json) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
        rusqlite::params![SETTINGS_ROW_KEY, json],
    )?;
    Ok(())
}

pub fn restore_defaults(db: &DatabaseState) -> Result<AppSettings, AppError> {
    let defaults = AppSettings::default();
    save_settings(db, &defaults)?;
    Ok(defaults)
}
