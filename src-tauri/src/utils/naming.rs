use std::time::{SystemTime, UNIX_EPOCH};

/// Expands output naming pattern tokens:
/// `{filename}`, `{date}`, `{time}`, `{compression_ratio}`, `{page_count}`.
pub fn expand_naming_pattern(
    pattern: &str,
    filename: &str,
    compression_ratio: Option<i32>,
    page_count: usize,
) -> String {
    let (date_str, time_str) = current_utc_date_time();
    let ratio_str = match compression_ratio {
        Some(r) => format!("{r}pct"),
        None => "0pct".to_string(),
    };

    let stem = filename
        .strip_suffix(".pdf")
        .or_else(|| filename.strip_suffix(".PDF"))
        .unwrap_or(filename);

    let expanded = pattern
        .replace("{filename}", stem)
        .replace("{date}", &date_str)
        .replace("{time}", &time_str)
        .replace("{compression_ratio}", &ratio_str)
        .replace("{page_count}", &format!("{page_count}p"));

    if expanded.to_ascii_lowercase().ends_with(".pdf") {
        expanded
    } else {
        format!("{expanded}.pdf")
    }
}

fn current_utc_date_time() -> (String, String) {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let hour = rem / 3_600;
    let min = (rem % 3_600) / 60;
    let sec = rem % 60;

    let (year, month, day) = civil_from_days(days);
    (
        format!("{year:04}-{month:02}-{day:02}"),
        format!("{hour:02}{min:02}{sec:02}"),
    )
}

/// Converts days since 1970-01-01 to (year, month, day) in proleptic Gregorian calendar.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year, m as u32, d as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_all_naming_tokens() {
        let out = expand_naming_pattern(
            "{filename}_xenon_{compression_ratio}_{page_count}",
            "Quarterly_Report.pdf",
            Some(-68),
            24,
        );
        assert_eq!(out, "Quarterly_Report_xenon_-68pct_24p.pdf");
    }

    #[test]
    fn expands_date_and_time_tokens() {
        let out = expand_naming_pattern("{filename}_{date}_{time}", "contract.pdf", None, 4);
        assert!(out.starts_with("contract_"));
        assert!(out.ends_with(".pdf"));
        assert!(!out.contains("{date}"));
        assert!(!out.contains("{time}"));
    }
}
