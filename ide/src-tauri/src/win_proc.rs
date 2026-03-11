// ─────────────────────────────────────────────────────────────────────────────
//  win_proc.rs  —  Windows-only process-spawn helper
//
//  Problem: on Windows, CREATE_NO_WINDOW (0x0800_0000) conflicts with
//  Stdio::piped() in some configurations, causing spawn to fail or producing
//  garbled output.  The correct flag for "hidden subprocess with inherited
//  pipes" is DETACHED_PROCESS (0x0000_0008), which detaches the child from
//  the parent console without preventing it from using anonymous pipes.
//
//  This module exposes a single extension trait `WinSpawn` that wraps
//  std::process::Command and applies the right flags on Windows, falling
//  back to a no-op on other platforms.
//
//  Usage (inside main.rs):
//
//      #[cfg(windows)]
//      use crate::win_proc::WinSpawn;
//
//      let child = Command::new("tsuki.exe")
//          .args(&["build", "--compile"])
//          .stdin(Stdio::piped())
//          .stdout(Stdio::piped())
//          .stderr(Stdio::piped())
//          .win_spawn()?;   // ← replaces .spawn()
//
//  On non-Windows platforms, `win_spawn()` is an alias for `.spawn()` so
//  callers can use it unconditionally without cfg guards.
// ─────────────────────────────────────────────────────────────────────────────

use std::io;
use std::process::{Child, Command};

/// Extension trait that adds `win_spawn()` to `std::process::Command`.
pub trait WinSpawn {
    /// Spawn the process with the correct flags:
    ///   - Windows: DETACHED_PROCESS so no console window appears and
    ///              anonymous pipes work reliably.
    ///   - Other:   Plain `.spawn()`.
    fn win_spawn(&mut self) -> io::Result<Child>;
}

impl WinSpawn for Command {
    #[cfg(windows)]
    fn win_spawn(&mut self) -> io::Result<Child> {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW (0x0800_0000)
        //   Prevents a console window from appearing for console-subsystem
        //   processes. This flag IS INHERITED by all child processes spawned
        //   by the child (e.g. avr-gcc, avrdude, go.exe called internally by
        //   tsuki) so none of them open visible windows either.
        //
        //   Contrary to old comments, CREATE_NO_WINDOW works fine with
        //   Stdio::piped(). DETACHED_PROCESS was used before but only
        //   detaches from the *parent* console; grandchildren spawned by
        //   tsuki.exe could still pop up their own console windows.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        self.creation_flags(CREATE_NO_WINDOW).spawn()
    }

    #[cfg(not(windows))]
    fn win_spawn(&mut self) -> io::Result<Child> {
        self.spawn()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Windows Job Object helper
//
//  Ensures that all child processes spawned by the IDE are automatically
//  killed when the Tauri process exits — even if it crashes.  Without this,
//  orphan tsuki.exe / arduino-cli.exe processes can linger on Windows.
//
//  Call `init_job_object()` once from main() on Windows.  It creates a Job
//  Object with JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE and assigns the current
//  process to it.  Every child process created after that is automatically
//  added to the same job by the OS.
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
pub fn init_job_object() {
    use std::ptr;

    // We use the raw Win32 API via the windows-sys crate if available,
    // or fall back to a safe Rust reimplementation using raw FFI.
    // Since we only depend on `which` and standard library, we use FFI.
    unsafe {
        // ── Load kernel32 symbols via GetProcAddress ──────────────────────
        // This avoids adding a new dependency while still calling the API.
        // If any call fails we silently skip — the IDE still works, it just
        // won't kill orphans on crash.
        type FnCreateJobObjectA  = unsafe extern "system" fn(*mut (), *const i8) -> *mut ();
        type FnSetInformationJobObject = unsafe extern "system" fn(*mut (), u32, *mut (), u32) -> i32;
        type FnAssignProcessToJobObject = unsafe extern "system" fn(*mut (), *mut ()) -> i32;
        type FnGetCurrentProcess  = unsafe extern "system" fn() -> *mut ();

        let kernel32 = LoadLibraryA(b"kernel32.dll\0".as_ptr() as *const i8);
        if kernel32.is_null() { return; }

        macro_rules! sym {
            ($name:expr, $ty:ty) => {{
                let p = GetProcAddress(kernel32, concat!($name, "\0").as_ptr() as *const i8);
                if p.is_null() { return; }
                std::mem::transmute::<*mut (), $ty>(p)
            }};
        }

        let create_job:    FnCreateJobObjectA          = sym!("CreateJobObjectA",          FnCreateJobObjectA);
        let set_info:      FnSetInformationJobObject    = sym!("SetInformationJobObject",   FnSetInformationJobObject);
        let assign:        FnAssignProcessToJobObject   = sym!("AssignProcessToJobObject",  FnAssignProcessToJobObject);
        let current_proc:  FnGetCurrentProcess          = sym!("GetCurrentProcess",         FnGetCurrentProcess);

        // Create an anonymous job object
        let job = create_job(ptr::null_mut(), ptr::null());
        if job.is_null() { return; }

        // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
        // JOBOBJECT_EXTENDED_LIMIT_INFORMATION layout (simplified):
        //   BasicLimitInformation (88 bytes on x64) + I/O counters (48 bytes)
        //   LimitFlags is at offset 20 (within BasicLimitInformation)
        // We zero-init and just set LimitFlags.
        #[repr(C)]
        struct JobObjectExtendedLimitInfo {
            basic: [u8; 88],    // JOBOBJECT_BASIC_LIMIT_INFORMATION
            io:    [u8; 48],    // IO_COUNTERS
            process_memory_limit: usize,
            job_memory_limit:     usize,
            peak_process_memory:  usize,
            peak_job_memory:      usize,
        }
        let mut info = JobObjectExtendedLimitInfo {
            basic: [0u8; 88],
            io:    [0u8; 48],
            process_memory_limit: 0,
            job_memory_limit:     0,
            peak_process_memory:  0,
            peak_job_memory:      0,
        };
        // LimitFlags is at byte offset 20 of BasicLimitInformation on x64
        // (after PerProcessUserTimeLimit[8], PerJobUserTimeLimit[8], LimitFlags[4])
        // Actually it's at offset 16 on x64 (two LARGE_INTEGERs = 16 bytes, then DWORD)
        let limit_flags_offset = 16usize;
        let kill_on_close: u32 = 0x2000;
        let flags_ptr = info.basic.as_mut_ptr().add(limit_flags_offset) as *mut u32;
        *flags_ptr = kill_on_close;

        // JobObjectExtendedLimitInformation = 9
        let ok = set_info(
            job,
            9,
            &mut info as *mut _ as *mut (),
            std::mem::size_of::<JobObjectExtendedLimitInfo>() as u32,
        );
        if ok == 0 { return; }

        // Assign the current process to the job
        assign(job, current_proc());
        // Job handle intentionally leaked — lives for the lifetime of the process
    }
}

#[cfg(not(windows))]
pub fn init_job_object() {
    // No-op on non-Windows platforms
}

// ── Raw FFI stubs (Windows only) ─────────────────────────────────────────────
#[cfg(windows)]
extern "system" {
    fn LoadLibraryA(lp_lib_file_name: *const i8) -> *mut ();
    fn GetProcAddress(h_module: *mut (), lp_proc_name: *const i8) -> *mut ();
}