pub mod history_repo;
pub mod settings_repo;

use crate::error::AppError;
use parking_lot::Mutex;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Arc;

const DEMO_MODE_KEY: &str = "demo_showcase_mode";

#[derive(Clone)]
pub struct DatabaseState {
    pub conn: Arc<Mutex<Connection>>,
}

impl DatabaseState {
    pub fn open_at(db_path: &Path) -> Result<Self, AppError> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(db_path)?;
        let state = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        state.migrate_and_seed()?;
        Ok(state)
    }

    pub fn open_in_memory() -> Result<Self, AppError> {
        let conn = Connection::open_in_memory()?;
        let state = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        state.migrate_and_seed()?;
        Ok(state)
    }

    fn migrate_and_seed(&self) -> Result<(), AppError> {
        {
            let conn = self.conn.lock();
            conn.execute_batch(
                "
                PRAGMA journal_mode = WAL;
                PRAGMA synchronous = NORMAL;

                CREATE TABLE IF NOT EXISTS job_history (
                    id TEXT PRIMARY KEY,
                    document_name TEXT NOT NULL,
                    category TEXT NOT NULL,
                    operation_label TEXT NOT NULL,
                    original_bytes INTEGER NOT NULL,
                    output_bytes INTEGER NOT NULL,
                    is_secured INTEGER NOT NULL DEFAULT 0,
                    duration_ms INTEGER NOT NULL DEFAULT 0,
                    output_path TEXT NOT NULL,
                    status TEXT NOT NULL,
                    completed_ticks INTEGER NOT NULL DEFAULT 10,
                    percentage INTEGER NOT NULL DEFAULT 100,
                    created_label TEXT NOT NULL DEFAULT 'Just now',
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS weekly_throughput (
                    day_order INTEGER PRIMARY KEY,
                    day_label TEXT NOT NULL,
                    count INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL
                );
                ",
            )?;

            let existing_days: i64 =
                conn.query_row("SELECT COUNT(*) FROM weekly_throughput", [], |row| row.get(0))?;
            if existing_days == 0 {
                for (ord, label) in [(1_i64, "Mon"), (2, "Tue"), (3, "Wed"), (4, "Thu"), (5, "Fri")] {
                    conn.execute(
                        "INSERT INTO weekly_throughput (day_order, day_label, count) VALUES (?1, ?2, 0)",
                        rusqlite::params![ord, label],
                    )?;
                }
            }

            let demo_mode_row: Result<String, rusqlite::Error> = conn.query_row(
                "SELECT value_json FROM app_settings WHERE key = ?1",
                rusqlite::params![DEMO_MODE_KEY],
                |r| r.get(0),
            );

            // Disable demo showcase data by default and clean up any previously seeded rows.
            if demo_mode_row.is_err() {
                conn.execute("DELETE FROM job_history WHERE id LIKE 'job-seed-%'", [])?;
                conn.execute("UPDATE weekly_throughput SET count = 0", [])?;
                conn.execute(
                    "INSERT INTO app_settings (key, value_json) VALUES (?1, 'false')",
                    rusqlite::params![DEMO_MODE_KEY],
                )?;
            }
        }

        Ok(())
    }

    pub fn is_demo_showcase_enabled(&self) -> bool {
        let conn = self.conn.lock();
        let val: Result<String, rusqlite::Error> = conn.query_row(
            "SELECT value_json FROM app_settings WHERE key = ?1",
            rusqlite::params![DEMO_MODE_KEY],
            |r| r.get(0),
        );
        matches!(val.as_deref(), Ok("true"))
    }

    /// Enables or disables the screenshot/showcase dummy dataset in SQLite without removing real jobs.
    pub fn set_demo_showcase_data(&self, enabled: bool) -> Result<(), AppError> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO app_settings (key, value_json) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
            rusqlite::params![DEMO_MODE_KEY, if enabled { "true" } else { "false" }],
        )?;

        if enabled {
            let seed_jobs = [
                (
                    "job-seed-1",
                    "Annual_Financial_Audit_2024.pdf",
                    "optimize",
                    "Compress (Medium)",
                    48_797_794_i64,
                    12_687_769_i64,
                    0_i64,
                    1_420_i64,
                    "Exports/Annual_Financial_Audit_2024_xenon.pdf",
                    "completed",
                    10_i64,
                    100_i64,
                    "12 Mins ago",
                    0_i64,
                ),
                (
                    "job-seed-2",
                    "Company_Legal_Contracts_Signed.pdf",
                    "security",
                    "Sign & Flatten",
                    8_808_038_i64,
                    8_808_038_i64,
                    1_i64,
                    680_i64,
                    "Exports/Company_Legal_Contracts_Signed.pdf",
                    "completed",
                    10_i64,
                    100_i64,
                    "1 Hour ago",
                    0_i64,
                ),
                (
                    "job-seed-3",
                    "Engineering_Blueprints_Scan.pdf",
                    "convert",
                    "Split & OCR (PDF/A)",
                    130_023_424_i64,
                    0_i64,
                    0_i64,
                    2_100_i64,
                    "Exports/Engineering_Blueprints_Scan_ocr.pdf",
                    "processing",
                    7_i64,
                    70_i64,
                    "Just now",
                    0_i64,
                ),
                (
                    "job-seed-4",
                    "Batch_HR_Employee_Forms.pdf",
                    "organize",
                    "Merge (18 files)",
                    36_280_729_i64,
                    36_280_729_i64,
                    0_i64,
                    410_i64,
                    "Exports/Batch_HR_Employee_Forms.pdf",
                    "completed",
                    10_i64,
                    100_i64,
                    "Yesterday",
                    -1_i64,
                ),
            ];

            for job in seed_jobs {
                let modifier = if job.13 == 0 {
                    "+0 days".to_string()
                } else {
                    format!("{} days", job.13)
                };
                conn.execute(
                    "INSERT OR REPLACE INTO job_history (
                        id, document_name, category, operation_label,
                        original_bytes, output_bytes, is_secured, duration_ms,
                        output_path, status, completed_ticks, percentage,
                        created_label, created_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, datetime('now', ?14))",
                    rusqlite::params![
                        job.0,
                        job.1,
                        job.2,
                        job.3,
                        job.4,
                        job.5,
                        job.6,
                        job.7,
                        job.8,
                        job.9,
                        job.10,
                        job.11,
                        job.12,
                        modifier,
                    ],
                )?;
            }

            let days = [
                (1_i64, "Mon", 82_i64),
                (2_i64, "Tue", 51_i64),
                (3_i64, "Wed", 86_i64),
                (4_i64, "Thu", 45_i64),
                (5_i64, "Fri", 94_i64),
            ];
            for (ord, label, count) in days {
                conn.execute(
                    "INSERT OR REPLACE INTO weekly_throughput (day_order, day_label, count) VALUES (?1, ?2, ?3)",
                    rusqlite::params![ord, label, count],
                )?;
            }
        } else {
            conn.execute("DELETE FROM job_history WHERE id LIKE 'job-seed-%'", [])?;
            conn.execute("UPDATE weekly_throughput SET count = 0", [])?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::history_repo;
    use crate::db::settings_repo;

    #[test]
    fn sqlite_initializes_seed_metrics_and_persists_settings() {
        let db = DatabaseState::open_in_memory().expect("open in-memory db");
        let clean = history_repo::get_dashboard_metrics(&db).expect("fetch clean metrics");
        assert_eq!(clean.recent_documents.len(), 0);
        assert_eq!(clean.processed_today_count, 0);
        assert!(!db.is_demo_showcase_enabled());

        db.set_demo_showcase_data(true).expect("enable showcase demo");
        assert!(db.is_demo_showcase_enabled());
        let demo = history_repo::get_dashboard_metrics(&db).expect("fetch showcase metrics");
        assert_eq!(demo.recent_documents.len(), 4);
        assert!(demo.processed_today_count >= 3);
        assert!(demo.total_space_saved_bytes > 0);
        assert_eq!(demo.secured_files_count, 1);
        assert_eq!(demo.weekly_throughput.len(), 5);

        db.set_demo_showcase_data(false).expect("disable showcase demo");
        assert!(!db.is_demo_showcase_enabled());
        let after_disable = history_repo::get_dashboard_metrics(&db).expect("fetch cleared");
        assert_eq!(after_disable.recent_documents.len(), 0);

        let mut settings = settings_repo::get_settings(&db).expect("get default settings");
        settings.memory_cache_limit_mb = 4096;
        settings.output_naming_pattern = "{filename}_secure_{date}".to_string();
        settings_repo::save_settings(&db, &settings).expect("save updated settings");

        let reloaded = settings_repo::get_settings(&db).expect("reload settings");
        assert_eq!(reloaded.memory_cache_limit_mb, 4096);
        assert_eq!(reloaded.output_naming_pattern, "{filename}_secure_{date}");
    }
}
