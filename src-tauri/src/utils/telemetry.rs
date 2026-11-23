use crate::utils::atomic_fs;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::OnceLock;
use sysinfo::{ProcessesToUpdate, System};

static TELEMETRY_SYS: OnceLock<Mutex<System>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareTelemetry {
    pub ram_used_mb: u64,
    pub total_ram_gb: f64,
    pub cpu_usage_percent: f32,
    pub physical_cores: usize,
    pub active_worker_threads: usize,
    pub memory_cache_limit_mb: usize,
    pub temp_cache_size_bytes: u64,
    pub target_arch: String,
}

pub fn collect_hardware_telemetry(
    configured_threads: usize,
    memory_cache_limit_mb: usize,
    temp_cache_dir: &Path,
) -> HardwareTelemetry {
    let mutex = TELEMETRY_SYS.get_or_init(|| {
        let mut s = System::new();
        s.refresh_cpu_usage();
        s.refresh_memory();
        Mutex::new(s)
    });
    let mut sys = mutex.lock();
    sys.refresh_memory();
    sys.refresh_cpu_usage();

    let ram_used_mb = if let Ok(pid) = sysinfo::get_current_pid() {
        sys.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
        sys.process(pid)
            .map(|p| p.memory() / (1024 * 1024))
            .unwrap_or(142)
            .max(1)
    } else {
        142
    };

    let total_ram_gb = (sys.total_memory() as f64) / (1024.0 * 1024.0 * 1024.0);
    let cpu_usage_percent = sys.global_cpu_usage();
    let physical_cores = sys.physical_core_count().unwrap_or(8).max(1);
    drop(sys);
    let temp_cache_size_bytes = atomic_fs::get_cache_size_bytes(temp_cache_dir).unwrap_or(0);

    HardwareTelemetry {
        ram_used_mb,
        total_ram_gb: (total_ram_gb * 10.0).round() / 10.0,
        cpu_usage_percent: (cpu_usage_percent * 10.0).round() / 10.0,
        physical_cores,
        active_worker_threads: configured_threads.clamp(1, physical_cores),
        memory_cache_limit_mb,
        temp_cache_size_bytes,
        target_arch: target_triple().to_string(),
    }
}

pub fn target_triple() -> &'static str {
    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "x86_64-pc-windows-msvc"
    } else if cfg!(all(target_os = "windows", target_arch = "aarch64")) {
        "aarch64-pc-windows-msvc"
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "x86_64-apple-darwin"
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        "aarch64-unknown-linux-gnu"
    } else {
        "x86_64-unknown-linux-gnu"
    }
}
