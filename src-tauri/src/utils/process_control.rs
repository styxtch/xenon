use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug)]
struct ActiveProcessEntry {
    pid: u32,
    #[cfg(target_os = "windows")]
    job_handle: usize,
    paused: bool,
    cancelled: bool,
}

#[cfg(target_os = "windows")]
impl Drop for ActiveProcessEntry {
    fn drop(&mut self) {
        if self.job_handle != 0 {
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(
                    self.job_handle as windows_sys::Win32::Foundation::HANDLE,
                );
            }
        }
    }
}

/// Thread-safe registry of live sidecar OS processes keyed by logical job ID.
/// On Windows, each child process is assigned to a dedicated Win32 Job Object
/// with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` so pause, resume, and tree-kill
/// operate deterministically at the OS kernel level.
#[derive(Clone, Default)]
pub struct ProcessRegistry {
    entries: Arc<Mutex<HashMap<String, ActiveProcessEntry>>>,
}

impl ProcessRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_child(&self, job_id: &str, pid: u32) -> Result<(), String> {
        #[cfg(target_os = "windows")]
        let job_handle = unsafe { assign_pid_to_new_job(pid)? };

        let mut guard = self.entries.lock();
        guard.insert(
            job_id.to_string(),
            ActiveProcessEntry {
                pid,
                #[cfg(target_os = "windows")]
                job_handle,
                paused: false,
                cancelled: false,
            },
        );
        Ok(())
    }

    pub fn unregister(&self, job_id: &str) {
        let mut guard = self.entries.lock();
        guard.remove(job_id);
    }

    pub fn is_cancelled(&self, job_id: &str) -> bool {
        let guard = self.entries.lock();
        guard.get(job_id).map(|e| e.cancelled).unwrap_or(false)
    }

    pub fn pause_job(&self, job_id: &str) -> Result<bool, String> {
        let mut guard = self.entries.lock();
        let Some(entry) = guard.get_mut(job_id) else {
            return Ok(false);
        };
        if entry.paused || entry.cancelled {
            return Ok(true);
        }
        #[cfg(target_os = "windows")]
        unsafe {
            nt_suspend_or_resume(entry.pid, true)?;
        }
        #[cfg(unix)]
        {
            let status = std::process::Command::new("kill")
                .args(["-STOP", &entry.pid.to_string()])
                .status()
                .map_err(|e| format!("Failed to pause process {}: {e}", entry.pid))?;
            if !status.success() {
                return Err(format!("kill -STOP failed for pid {}", entry.pid));
            }
        }
        entry.paused = true;
        Ok(true)
    }

    pub fn resume_job(&self, job_id: &str) -> Result<bool, String> {
        let mut guard = self.entries.lock();
        let Some(entry) = guard.get_mut(job_id) else {
            return Ok(false);
        };
        if !entry.paused || entry.cancelled {
            return Ok(true);
        }
        #[cfg(target_os = "windows")]
        unsafe {
            nt_suspend_or_resume(entry.pid, false)?;
        }
        #[cfg(unix)]
        {
            let status = std::process::Command::new("kill")
                .args(["-CONT", &entry.pid.to_string()])
                .status()
                .map_err(|e| format!("Failed to resume process {}: {e}", entry.pid))?;
            if !status.success() {
                return Err(format!("kill -CONT failed for pid {}", entry.pid));
            }
        }
        entry.paused = false;
        Ok(true)
    }

    pub fn cancel_job(&self, job_id: &str) -> Result<bool, String> {
        let mut guard = self.entries.lock();
        let Some(entry) = guard.get_mut(job_id) else {
            return Ok(false);
        };
        entry.cancelled = true;
        #[cfg(target_os = "windows")]
        unsafe {
            if entry.paused {
                let _ = nt_suspend_or_resume(entry.pid, false);
                entry.paused = false;
            }
            if entry.job_handle != 0 {
                let ok = windows_sys::Win32::System::JobObjects::TerminateJobObject(
                    entry.job_handle as windows_sys::Win32::Foundation::HANDLE,
                    1,
                );
                if ok == 0 {
                    return Err("TerminateJobObject failed".to_string());
                }
            }
        }
        #[cfg(unix)]
        {
            if entry.paused {
                let _ = std::process::Command::new("kill")
                    .args(["-CONT", &entry.pid.to_string()])
                    .status();
                entry.paused = false;
            }
            let _ = std::process::Command::new("kill")
                .args(["-KILL", &entry.pid.to_string()])
                .status();
        }
        Ok(true)
    }
}

#[cfg(target_os = "windows")]
unsafe fn assign_pid_to_new_job(pid: u32) -> Result<usize, String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_ALL_ACCESS};

    let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
    if job.is_null() {
        return Err("CreateJobObjectW returned null".to_string());
    }

    let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let set_ok = SetInformationJobObject(
        job,
        JobObjectExtendedLimitInformation,
        &info as *const _ as *const _,
        std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
    );
    if set_ok == 0 {
        CloseHandle(job);
        return Err("SetInformationJobObject failed".to_string());
    }

    let proc_handle = OpenProcess(PROCESS_ALL_ACCESS, 0, pid);
    if proc_handle.is_null() {
        CloseHandle(job);
        return Err(format!("OpenProcess failed for pid {}", pid));
    }

    let assign_ok = AssignProcessToJobObject(job, proc_handle);
    CloseHandle(proc_handle);
    if assign_ok == 0 {
        CloseHandle(job);
        return Err(format!("AssignProcessToJobObject failed for pid {}", pid));
    }

    Ok(job as usize)
}

#[cfg(target_os = "windows")]
unsafe fn nt_suspend_or_resume(pid: u32, suspend: bool) -> Result<(), String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SUSPEND_RESUME};

    let proc_handle = OpenProcess(PROCESS_SUSPEND_RESUME, 0, pid);
    if proc_handle.is_null() {
        return Err(format!("OpenProcess(PROCESS_SUSPEND_RESUME) failed for pid {}", pid));
    }

    let result = (|| -> Result<(), String> {
        let ntdll = libloading::Library::new("ntdll.dll")
            .map_err(|e| format!("Failed to load ntdll.dll: {}", e))?;
        let symbol_name: &[u8] = if suspend {
            b"NtSuspendProcess\0"
        } else {
            b"NtResumeProcess\0"
        };
        let func: libloading::Symbol<
            unsafe extern "system" fn(windows_sys::Win32::Foundation::HANDLE) -> i32,
        > = ntdll
            .get(symbol_name)
            .map_err(|e| format!("Missing ntdll symbol: {}", e))?;

        let status = func(proc_handle);
        if status < 0 {
            return Err(format!("NTSTATUS error 0x{:08X}", status as u32));
        }
        Ok(())
    })();

    CloseHandle(proc_handle);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};

    #[test]
    fn win32_job_object_pauses_resumes_and_terminates_process() {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let mut child = Command::new("cmd.exe")
                .args(["/c", "ping", "-n", "15", "127.0.0.1"])
                .creation_flags(CREATE_NO_WINDOW)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("spawn child");

            let registry = ProcessRegistry::new();
            registry
                .register_child("test-job-1", child.id())
                .expect("register in job object");

            assert!(registry.pause_job("test-job-1").expect("pause"));
            assert!(registry.resume_job("test-job-1").expect("resume"));
            assert!(registry.cancel_job("test-job-1").expect("cancel"));
            assert!(registry.is_cancelled("test-job-1"));

            let status = child.wait().expect("wait terminated child");
            assert!(!status.success());
            registry.unregister("test-job-1");
        }
    }
}
