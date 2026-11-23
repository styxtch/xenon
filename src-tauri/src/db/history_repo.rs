use crate::db::DatabaseState;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobTickEvent {
    pub job_id: String,
    pub document_name: String,
    pub category: String,
    pub operation_label: String,
    pub completed_ticks: u8,
    pub percentage: u8,
    pub status: String,
    pub original_bytes: u64,
    pub output_bytes: Option<u64>,
    pub output_path: Option<String>,
    pub error: Option<String>,
    pub created_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyThroughputPoint {
    pub day_label: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardMetrics {
    pub processed_today_count: u32,
    pub processed_today_delta: i32,
    pub total_space_saved_bytes: u64,
    pub average_compression_ratio_percent: f64,
    pub secured_files_count: u32,
    pub weekly_throughput: Vec<WeeklyThroughputPoint>,
    pub recent_documents: Vec<JobTickEvent>,
}

pub fn get_dashboard_metrics(db: &DatabaseState) -> Result<DashboardMetrics, AppError> {
    let conn = db.conn.lock();

    let processed_today_count: u32 = conn.query_row(
        "SELECT COUNT(*) FROM job_history WHERE date(created_at, 'localtime') = date('now', 'localtime')",
        [],
        |row| row.get(0),
    )?;

    let yesterday_count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM job_history WHERE date(created_at, 'localtime') = date('now', 'localtime', '-1 day')",
        [],
        |row| row.get(0),
    )?;
    let processed_today_delta = (processed_today_count as i32) - yesterday_count;

    let (total_orig, total_out): (i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(original_bytes), 0), COALESCE(SUM(output_bytes), 0)
         FROM job_history
         WHERE status = 'completed' AND output_bytes > 0 AND original_bytes > output_bytes",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    let total_space_saved_bytes = if total_orig > total_out {
        (total_orig - total_out) as u64
    } else {
        0
    };

    let average_compression_ratio_percent = if total_orig > 0 {
        ((total_orig - total_out) as f64 / total_orig as f64) * 100.0
    } else {
        0.0
    };

    let secured_files_count: u32 = conn.query_row(
        "SELECT COUNT(*) FROM job_history WHERE is_secured = 1 AND status = 'completed'",
        [],
        |row| row.get(0),
    )?;

    let mut weekly_throughput = Vec::with_capacity(7);
    for days_ago in (0..=6).rev() {
        let modifier = format!("-{} days", days_ago);
        let (dow_str, count): (String, u32) = conn.query_row(
            "SELECT
                strftime('%w', 'now', 'localtime', ?1),
                (SELECT COUNT(*) FROM job_history
                 WHERE status = 'completed'
                   AND date(created_at, 'localtime') = date('now', 'localtime', ?1))",
            rusqlite::params![modifier],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let day_label = match dow_str.as_str() {
            "0" => "Sun",
            "1" => "Mon",
            "2" => "Tue",
            "3" => "Wed",
            "4" => "Thu",
            "5" => "Fri",
            "6" => "Sat",
            _ => "Day",
        }
        .to_string();
        weekly_throughput.push(WeeklyThroughputPoint { day_label, count });
    }

    let mut docs_stmt = conn.prepare(
        "SELECT id, document_name, category, operation_label,
                original_bytes, output_bytes, output_path, status,
                completed_ticks, percentage, created_label,
                CAST((julianday('now') - julianday(created_at)) * 86400 AS INTEGER) AS elapsed_secs
         FROM job_history
         ORDER BY rowid DESC
         LIMIT 100",
    )?;
    let recent_documents = docs_stmt
        .query_map([], |row| {
            let out_bytes: i64 = row.get(5)?;
            let out_path: String = row.get(6)?;
            let stored_label: Option<String> = row.get(10)?;
            let elapsed_secs: Option<i64> = row.get(11)?;
            let computed_label = match (stored_label.as_deref(), elapsed_secs) {
                (Some("Just now"), Some(secs)) | (None, Some(secs)) => {
                    Some(format_relative_elapsed(secs))
                }
                (Some(lbl), Some(secs)) if lbl.ends_with("ago") => {
                    Some(format_relative_elapsed(secs))
                }
                (Some(lbl), _) => Some(lbl.to_string()),
                (None, None) => Some("Just now".to_string()),
            };
            Ok(JobTickEvent {
                job_id: row.get(0)?,
                document_name: row.get(1)?,
                category: row.get(2)?,
                operation_label: row.get(3)?,
                original_bytes: row.get::<_, i64>(4)?.max(0) as u64,
                output_bytes: if out_bytes > 0 {
                    Some(out_bytes as u64)
                } else {
                    None
                },
                output_path: if out_path.is_empty() {
                    None
                } else {
                    Some(out_path)
                },
                status: row.get(7)?,
                completed_ticks: row.get::<_, i64>(8)?.clamp(0, 10) as u8,
                percentage: row.get::<_, i64>(9)?.clamp(0, 100) as u8,
                error: None,
                created_label: computed_label,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(DashboardMetrics {
        processed_today_count,
        processed_today_delta,
        total_space_saved_bytes,
        average_compression_ratio_percent,
        secured_files_count,
        weekly_throughput,
        recent_documents,
    })
}

fn format_relative_elapsed(secs: i64) -> String {
    if secs < 60 {
        "Just now".to_string()
    } else if secs < 3600 {
        format!("{}m ago", secs / 60)
    } else if secs < 86_400 {
        format!("{}h ago", secs / 3600)
    } else {
        format!("{}d ago", secs / 86_400)
    }
}

pub fn cancel_job(db: &DatabaseState, job_id: &str) -> Result<(), AppError> {
    let conn = db.conn.lock();
    conn.execute(
        "UPDATE job_history
         SET status = 'failed', created_label = 'Cancelled'
         WHERE id = ?1",
        rusqlite::params![job_id],
    )?;
    Ok(())
}

pub fn rerun_job(db: &DatabaseState, job_id: &str) -> Result<JobTickEvent, AppError> {
    let conn = db.conn.lock();
    let (doc_name, category, op_label, orig_bytes, out_bytes, is_secured, out_path): (
        String,
        String,
        String,
        i64,
        i64,
        i64,
        String,
    ) = conn.query_row(
        "SELECT document_name, category, operation_label, original_bytes,
                output_bytes, is_secured, output_path
         FROM job_history WHERE id = ?1",
        rusqlite::params![job_id],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
            ))
        },
    )?;

    let new_id = format!("job-{}", Uuid::new_v4());
    let final_out = if out_bytes > 0 { out_bytes } else { orig_bytes };

    conn.execute(
        "INSERT INTO job_history (
            id, document_name, category, operation_label,
            original_bytes, output_bytes, is_secured, duration_ms,
            output_path, status, completed_ticks, percentage,
            created_label, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 320, ?8, 'completed', 10, 100, 'Just now', datetime('now'))",
        rusqlite::params![
            new_id,
            doc_name,
            category,
            op_label,
            orig_bytes,
            final_out,
            is_secured,
            out_path,
        ],
    )?;

    // Increment today's weekday bar in weekly_throughput (Mon=1..Fri=5; Sat/Sun map to Fri=5)
    let dow_str: String = conn
        .query_row("SELECT strftime('%w', 'now', 'localtime')", [], |r| r.get(0))
        .unwrap_or_else(|_| "1".to_string());
    let day_order: i64 = match dow_str.as_str() {
        "1" => 1,
        "2" => 2,
        "3" => 3,
        "4" => 4,
        _ => 5,
    };
    let _ = conn.execute(
        "UPDATE weekly_throughput SET count = count + 1 WHERE day_order = ?1",
        [day_order],
    );

    Ok(JobTickEvent {
        job_id: new_id,
        document_name: doc_name,
        category,
        operation_label: op_label,
        completed_ticks: 10,
        percentage: 100,
        status: "completed".to_string(),
        original_bytes: orig_bytes.max(0) as u64,
        output_bytes: Some(final_out.max(0) as u64),
        output_path: Some(out_path),
        error: None,
        created_label: Some("Just now".to_string()),
    })
}

#[allow(clippy::too_many_arguments)]
pub fn insert_completed_job(
    db: &DatabaseState,
    document_name: &str,
    category: &str,
    operation_label: &str,
    original_bytes: u64,
    output_bytes: u64,
    is_secured: bool,
    duration_ms: u64,
    output_path: &str,
) -> Result<JobTickEvent, AppError> {
    let job_id = format!("job-{}", Uuid::new_v4());
    let conn = db.conn.lock();
    conn.execute(
        "INSERT INTO job_history (
            id, document_name, category, operation_label,
            original_bytes, output_bytes, is_secured, duration_ms,
            output_path, status, completed_ticks, percentage,
            created_label, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'completed', 10, 100, 'Just now', datetime('now'))",
        rusqlite::params![
            job_id,
            document_name,
            category,
            operation_label,
            original_bytes as i64,
            output_bytes as i64,
            if is_secured { 1_i64 } else { 0_i64 },
            duration_ms as i64,
            output_path,
        ],
    )?;

    // Increment today's weekday bar in weekly_throughput (Mon=1..Fri=5; Sat/Sun map to Fri=5)
    let dow_str: String = conn
        .query_row("SELECT strftime('%w', 'now', 'localtime')", [], |r| r.get(0))
        .unwrap_or_else(|_| "1".to_string());
    let day_order: i64 = match dow_str.as_str() {
        "1" => 1,
        "2" => 2,
        "3" => 3,
        "4" => 4,
        _ => 5,
    };
    let _ = conn.execute(
        "UPDATE weekly_throughput SET count = count + 1 WHERE day_order = ?1",
        [day_order],
    );

    Ok(JobTickEvent {
        job_id,
        document_name: document_name.to_string(),
        category: category.to_string(),
        operation_label: operation_label.to_string(),
        completed_ticks: 10,
        percentage: 100,
        status: "completed".to_string(),
        original_bytes,
        output_bytes: Some(output_bytes),
        output_path: Some(output_path.to_string()),
        error: None,
        created_label: Some("Just now".to_string()),
    })
}
