use crate::engines::resolver::EnginePaths;
use image::codecs::jpeg::JpegEncoder;
use image::{ExtendedColorType, Rgb, RgbImage};
use libloading::Library;
use parking_lot::Mutex;
use sha2::{Digest, Sha256};
use std::ffi::{c_char, c_int, c_void, CString};
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::OnceLock;
use std::time::UNIX_EPOCH;

type FpdfDocument = *mut c_void;
type FpdfPage = *mut c_void;
type FpdfTextPage = *mut c_void;
type FpdfBitmap = *mut c_void;

#[derive(Debug, Clone)]
pub struct PdfCharBox {
    pub ch: char,
    pub left: f32,
    pub right: f32,
    pub bottom: f32,
    pub top: f32,
}

struct PdfiumFns {
    init_library: unsafe extern "C" fn(),
    load_mem_document: unsafe extern "C" fn(*const c_void, c_int, *const c_char) -> FpdfDocument,
    close_document: unsafe extern "C" fn(FpdfDocument),
    get_page_count: unsafe extern "C" fn(FpdfDocument) -> c_int,
    load_page: unsafe extern "C" fn(FpdfDocument, c_int) -> FpdfPage,
    close_page: unsafe extern "C" fn(FpdfPage),
    get_page_width_f: unsafe extern "C" fn(FpdfPage) -> f32,
    get_page_height_f: unsafe extern "C" fn(FpdfPage) -> f32,
    bitmap_create: unsafe extern "C" fn(c_int, c_int, c_int) -> FpdfBitmap,
    bitmap_fill_rect: unsafe extern "C" fn(FpdfBitmap, c_int, c_int, c_int, c_int, u32),
    render_page_bitmap:
        unsafe extern "C" fn(FpdfBitmap, FpdfPage, c_int, c_int, c_int, c_int, c_int, c_int),
    bitmap_get_buffer: unsafe extern "C" fn(FpdfBitmap) -> *const c_void,
    bitmap_get_stride: unsafe extern "C" fn(FpdfBitmap) -> c_int,
    bitmap_destroy: unsafe extern "C" fn(FpdfBitmap),
    text_load_page: Option<unsafe extern "C" fn(FpdfPage) -> FpdfTextPage>,
    text_close_page: Option<unsafe extern "C" fn(FpdfTextPage)>,
    text_count_chars: Option<unsafe extern "C" fn(FpdfTextPage) -> c_int>,
    text_get_unicode: Option<unsafe extern "C" fn(FpdfTextPage, c_int) -> u32>,
    text_get_char_box: Option<
        unsafe extern "C" fn(
            FpdfTextPage,
            c_int,
            *mut f64,
            *mut f64,
            *mut f64,
            *mut f64,
        ) -> c_int,
    >,
}

struct ActivePdfiumDoc {
    cache_key: String,
    doc: FpdfDocument,
    close_fn: unsafe extern "C" fn(FpdfDocument),
    _backing_bytes: Pin<Box<[u8]>>,
}

// Guarded exclusively behind `Mutex<PdfiumRuntime>`.
unsafe impl Send for ActivePdfiumDoc {}

impl Drop for ActivePdfiumDoc {
    fn drop(&mut self) {
        if !self.doc.is_null() {
            unsafe { (self.close_fn)(self.doc) };
            self.doc = std::ptr::null_mut();
        }
    }
}

struct PdfiumRuntime {
    fns: PdfiumFns,
    active_doc: Option<ActivePdfiumDoc>,
    _lib: Library,
}

static CONFIGURED_LIB_PATH: OnceLock<PathBuf> = OnceLock::new();
static PDFIUM_SINGLETON: OnceLock<Option<Mutex<PdfiumRuntime>>> = OnceLock::new();

pub fn configure_default_lib_path(path: PathBuf) {
    let _ = CONFIGURED_LIB_PATH.set(path);
}

fn resolve_lib_path(override_path: Option<&Path>) -> PathBuf {
    if let Some(p) = override_path {
        return p.to_path_buf();
    }
    if let Some(p) = CONFIGURED_LIB_PATH.get() {
        return p.clone();
    }
    EnginePaths::resolve(None).pdfium_lib_path()
}

unsafe fn load_symbol<T: Copy>(lib: &Library, name: &[u8]) -> Result<T, String> {
    let sym = lib
        .get::<T>(name)
        .map_err(|e| format!("Missing symbol {}: {e}", String::from_utf8_lossy(name)))?;
    Ok(*sym)
}

fn init_runtime_from_path(lib_path: &Path) -> Result<PdfiumRuntime, String> {
    if !lib_path.exists() {
        return Err(format!("PDFium library not found at {}", lib_path.display()));
    }
    let meta_len = std::fs::metadata(lib_path).map(|m| m.len()).unwrap_or(0);
    if meta_len < 65_536 {
        return Err(format!(
            "PDFium binary at {} appears to be a stub ({meta_len} bytes)",
            lib_path.display()
        ));
    }

    let lib = unsafe { Library::new(lib_path) }
        .map_err(|e| format!("Failed to load '{}': {e}", lib_path.display()))?;

    let fns = unsafe {
        PdfiumFns {
            init_library: load_symbol(&lib, b"FPDF_InitLibrary\0")?,
            load_mem_document: load_symbol(&lib, b"FPDF_LoadMemDocument\0")?,
            close_document: load_symbol(&lib, b"FPDF_CloseDocument\0")?,
            get_page_count: load_symbol(&lib, b"FPDF_GetPageCount\0")?,
            load_page: load_symbol(&lib, b"FPDF_LoadPage\0")?,
            close_page: load_symbol(&lib, b"FPDF_ClosePage\0")?,
            get_page_width_f: load_symbol(&lib, b"FPDF_GetPageWidthF\0")?,
            get_page_height_f: load_symbol(&lib, b"FPDF_GetPageHeightF\0")?,
            bitmap_create: load_symbol(&lib, b"FPDFBitmap_Create\0")?,
            bitmap_fill_rect: load_symbol(&lib, b"FPDFBitmap_FillRect\0")?,
            render_page_bitmap: load_symbol(&lib, b"FPDF_RenderPageBitmap\0")?,
            bitmap_get_buffer: load_symbol(&lib, b"FPDFBitmap_GetBuffer\0")?,
            bitmap_get_stride: load_symbol(&lib, b"FPDFBitmap_GetStride\0")?,
            bitmap_destroy: load_symbol(&lib, b"FPDFBitmap_Destroy\0")?,
            text_load_page: load_symbol(&lib, b"FPDFText_LoadPage\0").ok(),
            text_close_page: load_symbol(&lib, b"FPDFText_ClosePage\0").ok(),
            text_count_chars: load_symbol(&lib, b"FPDFText_CountChars\0").ok(),
            text_get_unicode: load_symbol(&lib, b"FPDFText_GetUnicode\0").ok(),
            text_get_char_box: load_symbol(&lib, b"FPDFText_GetCharBox\0").ok(),
        }
    };

    unsafe { (fns.init_library)() };

    Ok(PdfiumRuntime {
        fns,
        active_doc: None,
        _lib: lib,
    })
}

fn get_singleton_runtime(override_path: Option<&Path>) -> Option<&'static Mutex<PdfiumRuntime>> {
    PDFIUM_SINGLETON
        .get_or_init(|| {
            let path = resolve_lib_path(override_path);
            init_runtime_from_path(&path).ok().map(Mutex::new)
        })
        .as_ref()
}

pub fn is_pdfium_available(override_path: Option<&Path>) -> bool {
    if let Some(path) = override_path {
        if !path.exists() {
            return false;
        }
        let configured = resolve_lib_path(None);
        if path != configured {
            return std::fs::metadata(path).map(|m| m.len() >= 65_536).unwrap_or(false)
                && get_singleton_runtime(Some(path)).is_some();
        }
    }
    get_singleton_runtime(override_path).is_some()
}

fn build_doc_cache_key(pdf_path: &Path, password: Option<&str>) -> Result<String, String> {
    let meta = std::fs::metadata(pdf_path)
        .map_err(|e| format!("Failed to stat PDF '{}': {e}", pdf_path.display()))?;
    let mtime_ns = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pwd_hash = match password {
        Some(p) if !p.is_empty() => hex::encode(Sha256::digest(p.as_bytes())),
        _ => String::from("none"),
    };
    Ok(format!(
        "{}|{}|{}|{}",
        pdf_path.display(),
        meta.len(),
        mtime_ns,
        pwd_hash
    ))
}

impl PdfiumRuntime {
    fn ensure_doc_loaded(&mut self, pdf_path: &Path, password: Option<&str>) -> Result<FpdfDocument, String> {
        let key = build_doc_cache_key(pdf_path, password)?;
        if let Some(active) = &self.active_doc {
            if active.cache_key == key && !active.doc.is_null() {
                return Ok(active.doc);
            }
        }

        // Drop old handle before loading a new document.
        self.active_doc = None;

        let raw = std::fs::read(pdf_path)
            .map_err(|e| format!("Failed to read PDF '{}': {e}", pdf_path.display()))?;
        let byte_len = c_int::try_from(raw.len())
            .map_err(|_| "PDF exceeds i32 size supported by PDFium FPDF_LoadMemDocument".to_string())?;
        let pinned = Pin::new(raw.into_boxed_slice());

        let pwd_cstr = match password {
            Some(p) if !p.is_empty() => {
                Some(CString::new(p).map_err(|_| "Password contains null byte".to_string())?)
            }
            _ => None,
        };
        let pwd_ptr = pwd_cstr
            .as_ref()
            .map(|s| s.as_ptr())
            .unwrap_or(std::ptr::null());

        let doc = unsafe {
            (self.fns.load_mem_document)(pinned.as_ptr() as *const c_void, byte_len, pwd_ptr)
        };
        if doc.is_null() {
            return Err(format!(
                "PDFium rejected or could not decrypt '{}'",
                pdf_path.display()
            ));
        }

        self.active_doc = Some(ActivePdfiumDoc {
            cache_key: key,
            doc,
            close_fn: self.fns.close_document,
            _backing_bytes: pinned,
        });

        Ok(doc)
    }

    fn render_page_rgb_internal(
        &mut self,
        pdf_path: &Path,
        password: Option<&str>,
        page_number_1based: u32,
        target_width: u32,
        rotate_delta_deg: u16,
    ) -> Result<RgbImage, String> {
        let doc = self.ensure_doc_loaded(pdf_path, password)?;
        let page_count = unsafe { (self.fns.get_page_count)(doc) };
        let page_index = page_number_1based
            .checked_sub(1)
            .and_then(|i| c_int::try_from(i).ok())
            .ok_or_else(|| format!("Invalid page number {page_number_1based}"))?;

        if page_index >= page_count {
            return Err(format!(
                "Page {} out of range (count={page_count})",
                page_number_1based
            ));
        }

        let page = unsafe { (self.fns.load_page)(doc, page_index) };
        if page.is_null() {
            return Err(format!("PDFium failed to load page {page_number_1based}"));
        }

        let res = (|| {
            let rot_steps: c_int = match rotate_delta_deg % 360 {
                90 => 1,
                180 => 2,
                270 => 3,
                _ => 0,
            };

            let raw_w = unsafe { (self.fns.get_page_width_f)(page) }.max(1.0);
            let raw_h = unsafe { (self.fns.get_page_height_f)(page) }.max(1.0);
            let (vis_w, vis_h) = if rot_steps == 1 || rot_steps == 3 {
                (raw_h, raw_w)
            } else {
                (raw_w, raw_h)
            };

            let out_w = target_width.clamp(64, 4096);
            let out_h = ((out_w as f32) * (vis_h / vis_w))
                .round()
                .clamp(64.0, 4096.0) as u32;

            let bitmap = unsafe { (self.fns.bitmap_create)(out_w as c_int, out_h as c_int, 0) };
            if bitmap.is_null() {
                return Err("PDFium FPDFBitmap_Create returned null".to_string());
            }

            let copy_res = (|| {
                unsafe {
                    (self.fns.bitmap_fill_rect)(
                        bitmap,
                        0,
                        0,
                        out_w as c_int,
                        out_h as c_int,
                        0xFFFF_FFFF,
                    );
                    (self.fns.render_page_bitmap)(
                        bitmap,
                        page,
                        0,
                        0,
                        out_w as c_int,
                        out_h as c_int,
                        rot_steps,
                        0x01, // FPDF_ANNOT
                    );
                }

                let buf_ptr = unsafe { (self.fns.bitmap_get_buffer)(bitmap) } as *const u8;
                let stride = unsafe { (self.fns.bitmap_get_stride)(bitmap) };
                if buf_ptr.is_null() || stride < (out_w as c_int) * 4 {
                    return Err("Invalid PDFium bitmap buffer/stride".to_string());
                }

                let stride_usize = stride as usize;
                let total_bytes = stride_usize
                    .checked_mul(out_h as usize)
                    .ok_or_else(|| "Bitmap size overflow".to_string())?;
                let src = unsafe { std::slice::from_raw_parts(buf_ptr, total_bytes) };

                let mut rgb_img = RgbImage::new(out_w, out_h);
                for y in 0..out_h {
                    let row_start = (y as usize) * stride_usize;
                    for x in 0..out_w {
                        let px = row_start + (x as usize) * 4;
                        let b = src[px];
                        let g = src[px + 1];
                        let r = src[px + 2];
                        rgb_img.put_pixel(x, y, Rgb([r, g, b]));
                    }
                }
                Ok(rgb_img)
            })();

            unsafe { (self.fns.bitmap_destroy)(bitmap) };
            copy_res
        })();

        unsafe { (self.fns.close_page)(page) };
        res
    }
}

pub fn render_pdf_page_rgb(
    override_path: Option<&Path>,
    pdf_path: &Path,
    password: Option<&str>,
    page_number_1based: u32,
    target_width: u32,
    rotate_delta_deg: u16,
) -> Result<RgbImage, String> {
    let mutex = get_singleton_runtime(override_path)
        .ok_or_else(|| "PDFium native library unavailable".to_string())?;
    let mut guard = mutex.lock();
    guard.render_page_rgb_internal(
        pdf_path,
        password,
        page_number_1based,
        target_width,
        rotate_delta_deg,
    )
}

pub fn extract_page_char_boxes(
    override_path: Option<&Path>,
    pdf_path: &Path,
    password: Option<&str>,
    page_number_1based: u32,
) -> Result<(f32, f32, Vec<PdfCharBox>), String> {
    let mutex = get_singleton_runtime(override_path)
        .ok_or_else(|| "PDFium native library unavailable".to_string())?;
    let mut guard = mutex.lock();

    let (Some(text_load), Some(text_close), Some(text_count), Some(text_unicode), Some(text_box)) = (
        guard.fns.text_load_page,
        guard.fns.text_close_page,
        guard.fns.text_count_chars,
        guard.fns.text_get_unicode,
        guard.fns.text_get_char_box,
    ) else {
        return Err("PDFium text extraction symbols unavailable".to_string());
    };

    let doc = guard.ensure_doc_loaded(pdf_path, password)?;
    let page_count = unsafe { (guard.fns.get_page_count)(doc) };
    if page_count <= 0 {
        return Err("Document has zero pages".to_string());
    }
    let page_idx = ((page_number_1based.max(1) - 1) as c_int).min(page_count - 1);
    let page = unsafe { (guard.fns.load_page)(doc, page_idx) };
    if page.is_null() {
        return Err(format!("Failed to load page {page_number_1based}"));
    }

    let pw = unsafe { (guard.fns.get_page_width_f)(page) }.max(72.0);
    let ph = unsafe { (guard.fns.get_page_height_f)(page) }.max(72.0);

    let text_page = unsafe { text_load(page) };
    let mut chars = Vec::new();
    if !text_page.is_null() {
        let count = unsafe { text_count(text_page) };
        chars.reserve(count.max(0) as usize);
        for i in 0..count {
            let code = unsafe { text_unicode(text_page, i) };
            let Some(ch) = char::from_u32(code) else {
                continue;
            };
            let mut left = 0.0_f64;
            let mut right = 0.0_f64;
            let mut bottom = 0.0_f64;
            let mut top = 0.0_f64;
            let ok = unsafe { text_box(text_page, i, &mut left, &mut right, &mut bottom, &mut top) };
            if ok != 0 {
                chars.push(PdfCharBox {
                    ch,
                    left: left as f32,
                    right: right as f32,
                    bottom: bottom as f32,
                    top: top as f32,
                });
            }
        }
        unsafe { text_close(text_page) };
    }

    unsafe { (guard.fns.close_page)(page) };
    Ok((pw, ph, chars))
}

pub fn encode_rgb_jpeg(img: &RgbImage, quality: u8) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut out, quality);
    encoder
        .encode(
            img.as_raw(),
            img.width(),
            img.height(),
            ExtendedColorType::Rgb8,
        )
        .map_err(|e| format!("JPEG encode failed: {e}"))?;
    Ok(out)
}

pub fn encode_base64(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 { chunk[1] as usize } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as usize } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;

        out.push(TABLE[(triple >> 18) & 0x3F] as char);
        out.push(TABLE[(triple >> 12) & 0x3F] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(triple >> 6) & 0x3F] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[triple & 0x3F] as char
        } else {
            '='
        });
    }
    out
}
