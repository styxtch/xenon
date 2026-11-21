pub mod commands;
pub mod db;
pub mod engines;
pub mod error;
pub mod utils;

use commands::convert_ocr::{
    compare_pdfs, convert_pdfa, images_to_pdf, ocr_pdf, pdf_to_images,
};
use commands::document::{
    get_initial_sample_pdf, get_page_tile_svg, insert_images_or_pdf, open_pdf,
};
use commands::forms::{get_form_fields, save_form_fields};
use commands::optimize::{
    compress_pdf, estimate_compressed_size, linearize_pdf, repair_pdf, sanitize_metadata,
};
use commands::organize::{execute_merge_pdfs, execute_organize_pdf, execute_split_pdf};
use commands::security_sign::{
    apply_watermark, decrypt_pdf, encrypt_pdf, find_text_redaction_boxes, flatten_pdf,
    generate_demo_p12, sign_pdf_pkcs12, stamp_visual_signature, true_redact,
};
use commands::system::{
    cancel_batch_job, cancel_recent_job, check_existing_paths, clear_engine_logs, clear_temp_cache,
    get_app_settings, get_dashboard_metrics, get_demo_showcase_mode, get_engine_logs,
    get_hardware_telemetry, open_file_in_os, pause_batch_job, rerun_recent_job,
    restore_default_settings, resume_batch_job, reveal_in_explorer, save_app_settings,
    set_demo_showcase_mode, test_engine_binary, verify_engines, LogBufferState,
};
use db::settings_repo;
use db::DatabaseState;
use engines::pdfium_engine::PdfEngineRegistry;
use engines::resolver::{self, EnginePaths};
use std::path::PathBuf;
use tauri::{http::Response, Manager};
use utils::atomic_fs;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .register_uri_scheme_protocol("xenon", |ctx, request| {
            let uri = request.uri();
            let segments: Vec<&str> = uri
                .path()
                .trim_start_matches('/')
                .split('/')
                .filter(|s| !s.is_empty())
                .collect();

            let (doc_id, page_number) = match (uri.host(), segments.as_slice()) {
                (Some("tile"), [doc, page, ..]) => (*doc, page.parse::<u32>().unwrap_or(1)),
                (_, ["tile", doc, page, ..]) => (*doc, page.parse::<u32>().unwrap_or(1)),
                (_, [doc, page, ..]) => (*doc, page.parse::<u32>().unwrap_or(1)),
                _ => ("doc-sample-1", 1),
            };

            let mut width: u32 = 320;
            let mut rotate: u16 = 0;
            if let Some(query) = uri.query() {
                for pair in query.split('&') {
                    if let Some((k, v)) = pair.split_once('=') {
                        match k {
                            "width" => width = v.parse::<u32>().unwrap_or(320),
                            "rotate" => rotate = v.parse::<u16>().unwrap_or(0),
                            _ => {}
                        }
                    }
                }
            }

            let registry = ctx.app_handle().state::<PdfEngineRegistry>();
            match registry.render_page_tile(doc_id, page_number, width, rotate) {
                Ok(tile_bytes) => {
                    let content_type = if tile_bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
                        "image/jpeg"
                    } else if tile_bytes.starts_with(b"\x89PNG") {
                        "image/png"
                    } else {
                        "image/svg+xml"
                    };
                    Response::builder()
                        .status(200)
                        .header("Content-Type", content_type)
                        .header("Cache-Control", "public, max-age=300")
                        .header("Access-Control-Allow-Origin", "*")
                        .body(tile_bytes)
                        .unwrap_or_else(|_| Response::new(Vec::new()))
                }
                Err(err) => {
                    let fallback = format!(
                        r##"<svg xmlns="http://www.w3.org/2000/svg" width="320" height="452" viewBox="0 0 320 452"><rect width="320" height="452" fill="#1F1F21"/><rect x="16" y="16" width="288" height="420" rx="6" fill="#28282A" stroke="#343436"/><text x="32" y="52" fill="#4EDEA3" font-family="Inter, sans-serif" font-size="13" font-weight="600">XENON Tile</text><text x="32" y="76" fill="#A1A1A6" font-family="Inter, sans-serif" font-size="11">{}</text></svg>"##,
                        err
                    );
                    Response::builder()
                        .status(200)
                        .header("Content-Type", "image/svg+xml")
                        .header("Access-Control-Allow-Origin", "*")
                        .body(fallback.into_bytes())
                        .unwrap_or_else(|_| Response::new(Vec::new()))
                }
            }
        })
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("xenon-pdf"));
            let db_path = app_data_dir.join("xenon_local.db");
            let db_state = DatabaseState::open_at(&db_path)?;

            let settings = settings_repo::get_settings(&db_state)?;
            let cache_dir = PathBuf::from(&settings.temp_cache_dir);
            let output_dir = PathBuf::from(&settings.primary_destination_folder);
            let swept = atomic_fs::sweep_startup_crash_artifacts(&cache_dir, &output_dir)
                .unwrap_or(0);

            let registry = PdfEngineRegistry::new(settings.memory_cache_limit_mb);

            let logs_state = LogBufferState::new();
            logs_state.push(
                "INFO",
                "tauri",
                format!(
                    "XENON v1.0.0 core booted (0% cloud egress). SQLite mounted at {}",
                    db_path.display()
                ),
            );
            logs_state.push(
                "INFO",
                "tauri",
                format!(
                    "Startup orphan sweep at {} removed {swept} .part file(s).",
                    cache_dir.display()
                ),
            );
            logs_state.push(
                "INFO",
                "tauri",
                format!(
                    "Registered custom URI protocol xenon://tile/ with {} MB byte-bounded LRU cache.",
                    settings.memory_cache_limit_mb
                ),
            );

            let resource_dir = app.path().resource_dir().ok();
            let paths = EnginePaths::resolve(resource_dir.as_deref());
            engines::pdfium_ffi::configure_default_lib_path(paths.pdfium_lib_path());
            let pdfium_native = engines::pdfium_ffi::is_pdfium_available(None);
            logs_state.push(
                if pdfium_native { "INFO" } else { "WARN" },
                "pdfium",
                if pdfium_native {
                    format!(
                        "Native PDFium FFI initialized from {}",
                        paths.pdfium_lib_path().display()
                    )
                } else {
                    format!(
                        "Native PDFium DLL unavailable at {} — using SVG wireframe fallback",
                        paths.pdfium_lib_path().display()
                    )
                },
            );
            for diag in resolver::verify_all_engines(&paths) {
                let short_hash = if diag.sha256.len() >= 12 {
                    &diag.sha256[..12]
                } else {
                    &diag.sha256
                };
                logs_state.push(
                    if diag.sha256_verified { "INFO" } else { "WARN" },
                    &diag.name,
                    format!(
                        "{} verified={} (sha256={}...)",
                        diag.display_name, diag.sha256_verified, short_hash
                    ),
                );
            }

            app.manage(db_state);
            app.manage(registry);
            app.manage(logs_state);
            app.manage(utils::process_control::ProcessRegistry::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_hardware_telemetry,
            get_dashboard_metrics,
            get_demo_showcase_mode,
            set_demo_showcase_mode,
            verify_engines,
            test_engine_binary,
            get_app_settings,
            save_app_settings,
            restore_default_settings,
            clear_temp_cache,
            get_engine_logs,
            clear_engine_logs,
            cancel_recent_job,
            rerun_recent_job,
            check_existing_paths,
            reveal_in_explorer,
            open_file_in_os,
            pause_batch_job,
            resume_batch_job,
            cancel_batch_job,
            open_pdf,
            get_initial_sample_pdf,
            insert_images_or_pdf,
            get_page_tile_svg,
            execute_organize_pdf,
            execute_merge_pdfs,
            execute_split_pdf,
            estimate_compressed_size,
            compress_pdf,
            repair_pdf,
            linearize_pdf,
            sanitize_metadata,
            encrypt_pdf,
            decrypt_pdf,
            generate_demo_p12,
            sign_pdf_pkcs12,
            stamp_visual_signature,
            apply_watermark,
            flatten_pdf,
            true_redact,
            find_text_redaction_boxes,
            pdf_to_images,
            images_to_pdf,
            ocr_pdf,
            convert_pdfa,
            compare_pdfs,
            get_form_fields,
            save_form_fields,
        ])
        .run(tauri::generate_context!())
        .expect("error while running XENON Tauri application");
}
