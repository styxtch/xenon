use crate::engines::lopdf_crypto::{
    write_lopdf_atomically, RedactionBox, RedactionsSpec, SecurityExecutionResult,
};
use crate::engines::pdfium_ffi;
use crate::engines::qpdf_engine::parse_page_ranges;
use crate::error::AppError;
use image::{DynamicImage, ImageFormat, Rgb, RgbImage};
use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Document, Object, ObjectId, Stream};
use lru::LruCache;
use parking_lot::{Mutex, RwLock};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;
use uuid::Uuid;

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct TileKey {
    pub doc_id: String,
    pub page_number: u32,
    pub width: u32,
    pub rotate: u16,
}

pub struct ByteBoundedTileCache {
    cache: LruCache<TileKey, Vec<u8>>,
    current_bytes: usize,
    max_bytes: usize,
}

impl ByteBoundedTileCache {
    pub fn new(max_bytes: usize) -> Self {
        Self {
            cache: LruCache::new(NonZeroUsize::new(4096).expect("non-zero cache slots")),
            current_bytes: 0,
            max_bytes: max_bytes.max(1024 * 64),
        }
    }

    pub fn set_max_bytes_mb(&mut self, mb: usize) {
        self.max_bytes = mb.saturating_mul(1024 * 1024).max(1024 * 64);
        self.evict_to_fit(0);
    }

    pub fn get(&mut self, key: &TileKey) -> Option<Vec<u8>> {
        self.cache.get(key).cloned()
    }

    pub fn put(&mut self, key: TileKey, bytes: Vec<u8>) {
        if let Some(prev) = self.cache.pop(&key) {
            self.current_bytes = self.current_bytes.saturating_sub(prev.len());
        }
        if bytes.len() > self.max_bytes {
            return;
        }
        self.evict_to_fit(bytes.len());
        self.current_bytes = self.current_bytes.saturating_add(bytes.len());
        self.cache.put(key, bytes);
    }

    fn evict_to_fit(&mut self, incoming_len: usize) {
        while self.current_bytes.saturating_add(incoming_len) > self.max_bytes {
            match self.cache.pop_lru() {
                Some((_, evicted)) => {
                    self.current_bytes = self.current_bytes.saturating_sub(evicted.len());
                }
                None => break,
            }
        }
    }

    pub fn current_bytes(&self) -> usize {
        self.current_bytes
    }

    pub fn entry_count(&self) -> usize {
        self.cache.len()
    }

    pub fn clear(&mut self) {
        self.cache.clear();
        self.current_bytes = 0;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedPageMeta {
    pub page_number: u32,
    pub width_pts: f32,
    pub height_pts: f32,
    pub rotation: u16,
    pub media_box: [f32; 4],
    pub crop_box: Option<[f32; 4]>,
    pub text_preview: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedDocumentDto {
    pub doc_id: String,
    pub file_path: String,
    pub file_name: String,
    pub file_size_bytes: u64,
    pub page_count: u32,
    pub pdf_version: String,
    pub is_encrypted: bool,
    pub has_bookmarks: bool,
    pub pages: Vec<OpenedPageMeta>,
}

pub struct PdfDocumentHandle {
    pub doc_id: String,
    pub file_path: PathBuf,
    pub password: Option<String>,
    pub document: Document,
    pub pages: Vec<OpenedPageMeta>,
}

pub struct PdfEngineRegistry {
    docs: RwLock<HashMap<String, Arc<Mutex<PdfDocumentHandle>>>>,
    tile_cache: Mutex<ByteBoundedTileCache>,
}

impl PdfEngineRegistry {
    pub fn new(cache_limit_mb: usize) -> Self {
        let max_bytes = cache_limit_mb.saturating_mul(1024 * 1024);
        Self {
            docs: RwLock::new(HashMap::new()),
            tile_cache: Mutex::new(ByteBoundedTileCache::new(max_bytes)),
        }
    }

    pub fn set_cache_limit_mb(&self, mb: usize) {
        self.tile_cache.lock().set_max_bytes_mb(mb);
    }

    pub fn open_document(
        &self,
        path: &Path,
        password: Option<&str>,
    ) -> Result<OpenedDocumentDto, AppError> {
        self.open_document_with_id(path, password, None)
    }

    pub fn open_document_with_id(
        &self,
        path: &Path,
        password: Option<&str>,
        forced_id: Option<&str>,
    ) -> Result<OpenedDocumentDto, AppError> {
        if !path.exists() {
            return Err(AppError::InvalidInput(format!(
                "PDF file not found: {}",
                path.display()
            )));
        }

        let file_size_bytes = std::fs::metadata(path)?.len();
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Document.pdf")
            .to_string();

        let mut is_encrypted = false;
        let mut doc = match Document::load(path) {
            Ok(d) => d,
            Err(err) => {
                let msg = err.to_string();
                let lower = msg.to_ascii_lowercase();
                if lower.contains("decrypt")
                    || lower.contains("password")
                    || lower.contains("encrypted")
                {
                    let pwd = match password {
                        Some(p) if !p.is_empty() => p,
                        _ => return Err(AppError::PasswordRequired),
                    };
                    is_encrypted = true;
                    decrypt_via_qpdf_temp(path, pwd)?
                } else {
                    return Err(AppError::EngineError(format!(
                        "Failed to parse PDF '{}': {msg}",
                        path.display()
                    )));
                }
            }
        };

        if doc.is_encrypted() {
            is_encrypted = true;
            let xenon_hashes = extract_xenon_pwd_hashes(&doc);
            match password {
                Some(pwd) if !pwd.is_empty() => {
                    if let Some((u_hash, o_hash)) = xenon_hashes {
                        let supplied = hex::encode(Sha256::digest(pwd.as_bytes()));
                        if supplied != u_hash && supplied != o_hash {
                            return Err(AppError::InvalidInput("Incorrect PDF password".to_string()));
                        }
                    } else if doc.decrypt(pwd).is_err() {
                        doc = decrypt_via_qpdf_temp(path, pwd)?;
                    }
                }
                _ => return Err(AppError::PasswordRequired),
            }
        }

        let has_bookmarks = doc
            .trailer
            .get(b"Root")
            .ok()
            .and_then(|r| r.as_reference().ok())
            .and_then(|id| doc.get_dictionary(id).ok())
            .map(|cat| cat.has(b"Outlines"))
            .unwrap_or(false);

        let page_map = doc.get_pages();
        let mut pages = Vec::with_capacity(page_map.len());

        for (page_num, page_id) in page_map {
            let media_box = resolve_inherited_box(&doc, page_id, b"MediaBox")
                .unwrap_or([0.0, 0.0, 595.28, 841.89]);
            let crop_box = resolve_inherited_box(&doc, page_id, b"CropBox");
            let rotation = resolve_page_rotation(&doc, page_id);

            let width_pts = (media_box[2] - media_box[0]).abs().max(72.0);
            let height_pts = (media_box[3] - media_box[1]).abs().max(72.0);

            let raw_text = doc.extract_text(&[page_num]).unwrap_or_default();
            let text_preview: Vec<String> = raw_text
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .take(5)
                .collect();

            pages.push(OpenedPageMeta {
                page_number: page_num,
                width_pts,
                height_pts,
                rotation,
                media_box,
                crop_box,
                text_preview,
            });
        }

        let doc_id = forced_id
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("doc-{}", Uuid::new_v4()));

        let dto = OpenedDocumentDto {
            doc_id: doc_id.clone(),
            file_path: path.to_string_lossy().to_string(),
            file_name,
            file_size_bytes,
            page_count: pages.len() as u32,
            pdf_version: doc.version.clone(),
            is_encrypted,
            has_bookmarks,
            pages: pages.clone(),
        };

        let handle = Arc::new(Mutex::new(PdfDocumentHandle {
            doc_id: doc_id.clone(),
            file_path: path.to_path_buf(),
            password: password.map(|s| s.to_string()),
            document: doc,
            pages,
        }));
        self.docs.write().insert(doc_id, handle);

        Ok(dto)
    }

    pub fn get_handle(&self, doc_id: &str) -> Option<Arc<Mutex<PdfDocumentHandle>>> {
        self.docs.read().get(doc_id).cloned()
    }

    pub fn ensure_sample_pdf(&self, temp_cache_dir: &Path) -> Result<OpenedDocumentDto, AppError> {
        std::fs::create_dir_all(temp_cache_dir)?;
        let sample_path = temp_cache_dir.join("Technical_Specification_v2.4.pdf");
        if !sample_path.exists() {
            create_sample_multi_page_pdf(&sample_path, 12)?;
        }
        self.open_document_with_id(&sample_path, None, Some("doc-sample-1"))
    }

    pub fn render_page_tile(
        &self,
        doc_id: &str,
        page_number: u32,
        width: u32,
        rotate: u16,
    ) -> Result<Vec<u8>, AppError> {
        let normalized_rotate = rotate % 360;
        let normalized_width = width.clamp(120, 1200);
        let key = TileKey {
            doc_id: doc_id.to_string(),
            page_number,
            width: normalized_width,
            rotate: normalized_rotate,
        };

        if let Some(cached) = self.tile_cache.lock().get(&key) {
            return Ok(cached);
        }

        let handle = self.get_handle(doc_id).ok_or_else(|| {
            AppError::InvalidInput(format!("Document '{doc_id}' is not loaded"))
        })?;

        let (file_path, password, page_meta) = {
            let guard = handle.lock();
            let page_meta = guard
                .pages
                .iter()
                .find(|p| p.page_number == page_number)
                .cloned()
                .ok_or_else(|| {
                    AppError::InvalidInput(format!(
                        "Page {page_number} not found in document '{doc_id}'"
                    ))
                })?;
            (guard.file_path.clone(), guard.password.clone(), page_meta)
        };

        let tile_bytes = match pdfium_ffi::render_pdf_page_rgb(
            None,
            &file_path,
            password.as_deref(),
            page_number,
            normalized_width,
            normalized_rotate,
        ) {
            Ok(rgb_img) => pdfium_ffi::encode_rgb_jpeg(&rgb_img, 88)
                .unwrap_or_else(|_| render_page_svg(&page_meta, normalized_width, normalized_rotate)),
            Err(_) => render_page_svg(&page_meta, normalized_width, normalized_rotate),
        };

        self.tile_cache.lock().put(key, tile_bytes.clone());
        Ok(tile_bytes)
    }
}

fn render_page_svg(page: &OpenedPageMeta, width: u32, rotate_delta: u16) -> Vec<u8> {
    let total_rot = (page.rotation + rotate_delta) % 360;
    let is_landscape = total_rot == 90 || total_rot == 270;
    let base_w = page.width_pts.max(72.0);
    let base_h = page.height_pts.max(72.0);
    let aspect = if is_landscape {
        base_w / base_h
    } else {
        base_h / base_w
    };
    let height = ((width as f32) * aspect).round().max(120.0) as u32;

    let mut lines_svg = String::new();
    let preview_lines = if page.text_preview.is_empty() {
        vec![
            format!("Page {} — XENON PDFium Stream", page.page_number),
            format!("{:.0} × {:.0} pts", base_w, base_h),
        ]
    } else {
        page.text_preview.clone()
    };

    for (idx, line) in preview_lines.iter().take(5).enumerate() {
        let escaped = xml_escape(line);
        let y = 52 + idx * 20;
        let fill = if idx == 0 { "#F5F5F5" } else { "#A1A1A6" };
        let weight = if idx == 0 { "600" } else { "400" };
        let size = if idx == 0 { 12 } else { 10 };
        lines_svg.push_str(&format!(
            r##"<text x="24" y="{y}" fill="{fill}" font-family="Inter, sans-serif" font-size="{size}" font-weight="{weight}">{escaped}</text>"##
        ));
    }

    let badge_rot = if total_rot > 0 {
        format!(" • {total_rot}°")
    } else {
        String::new()
    };

    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <rect width="{width}" height="{height}" fill="#1F1F21"/>
  <rect x="8" y="8" width="{iw}" height="{ih}" rx="6" fill="#232326" stroke="#343436"/>
  <rect x="24" y="22" width="52" height="6" rx="3" fill="#3B82F6" opacity="0.65"/>
  {lines_svg}
  <rect x="24" y="{bar_y}" width="{bar_w}" height="64" rx="4" fill="#28282A" stroke="#29292B"/>
  <rect x="34" y="{inner_y1}" width="{inner_w1}" height="5" rx="2" fill="#4EDEA3" opacity="0.5"/>
  <rect x="34" y="{inner_y2}" width="{inner_w2}" height="5" rx="2" fill="#74747A" opacity="0.4"/>
  <text x="24" y="{footer_y}" fill="#74747A" font-family="Inter, sans-serif" font-size="10">p.{pnum} ({bw:.0}×{bh:.0}pt){badge_rot}</text>
</svg>"##,
        iw = width.saturating_sub(16),
        ih = height.saturating_sub(16),
        bar_y = height.saturating_sub(110),
        bar_w = width.saturating_sub(48),
        inner_y1 = height.saturating_sub(92),
        inner_w1 = width.saturating_sub(96),
        inner_y2 = height.saturating_sub(76),
        inner_w2 = width.saturating_sub(124),
        footer_y = height.saturating_sub(22),
        pnum = page.page_number,
        bw = base_w,
        bh = base_h,
    );

    svg.into_bytes()
}

fn xml_escape(input: &str) -> String {
    let truncated: String = input.chars().take(42).collect();
    truncated
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn decrypt_via_qpdf_temp(path: &Path, password: &str) -> Result<Document, AppError> {
    let paths = crate::engines::resolver::EnginePaths::resolve(None);
    let temp_dir = std::env::temp_dir().join("xenon_unlock");
    let _ = std::fs::create_dir_all(&temp_dir);
    let temp_out = temp_dir.join(format!("unlock_{}.pdf", uuid::Uuid::new_v4()));

    let out = crate::engines::resolver::build_sidecar_command(&paths.qpdf_bin, &paths)
        .arg(format!("--password={password}"))
        .arg("--decrypt")
        .arg(path)
        .arg(&temp_out)
        .output()
        .map_err(|e| AppError::EngineError(format!("Failed to execute QPDF unlock: {e}")))?;

    let code = out.status.code().unwrap_or(-1);
    if code != 0 && code != 3 {
        let _ = std::fs::remove_file(&temp_out);
        let stderr = String::from_utf8_lossy(&out.stderr);
        if stderr.to_ascii_lowercase().contains("invalid password") || code == 2 {
            return Err(AppError::InvalidInput("Incorrect PDF password".to_string()));
        }
        return Err(AppError::EngineError(format!(
            "Failed to unlock encrypted PDF (code {code}): {stderr}"
        )));
    }

    let doc = Document::load(&temp_out)
        .map_err(|e| AppError::EngineError(format!("Failed to load unlocked PDF: {e}")));
    let _ = std::fs::remove_file(&temp_out);
    doc
}

pub fn extract_xenon_pwd_hashes(doc: &Document) -> Option<(String, String)> {
    let enc_ref = doc.trailer.get(b"Encrypt").ok()?;
    let dict = match enc_ref {
        Object::Reference(id) => doc.get_dictionary(*id).ok()?,
        Object::Dictionary(d) => d,
        _ => return None,
    };
    let u_bytes = dict.get(b"XenonUserHash").ok()?.as_str().ok()?;
    let o_bytes = dict
        .get(b"XenonOwnerHash")
        .ok()
        .and_then(|o| o.as_str().ok())
        .unwrap_or(u_bytes);
    Some((
        String::from_utf8_lossy(u_bytes).to_string(),
        String::from_utf8_lossy(o_bytes).to_string(),
    ))
}

fn resolve_inherited_box(doc: &Document, page_id: ObjectId, key: &[u8]) -> Option<[f32; 4]> {
    let mut current_id = Some(page_id);
    for _ in 0..8 {
        let id = current_id?;
        let dict = doc.get_dictionary(id).ok()?;
        if let Ok(obj) = dict.get(key) {
            if let Ok(arr) = obj.as_array() {
                if arr.len() == 4 {
                    let mut nums = [0.0_f32; 4];
                    for (i, item) in arr.iter().enumerate() {
                        nums[i] = match item {
                            Object::Integer(v) => *v as f32,
                            Object::Real(v) => *v,
                            _ => 0.0,
                        };
                    }
                    return Some(nums);
                }
            }
        }
        current_id = dict
            .get(b"Parent")
            .ok()
            .and_then(|p| p.as_reference().ok());
    }
    None
}

fn resolve_page_rotation(doc: &Document, page_id: ObjectId) -> u16 {
    let mut current_id = Some(page_id);
    for _ in 0..8 {
        let Some(id) = current_id else { break };
        let Ok(dict) = doc.get_dictionary(id) else {
            break;
        };
        if let Ok(Object::Integer(rot)) = dict.get(b"Rotate") {
            return (((*rot % 360) + 360) % 360) as u16;
        }
        current_id = dict
            .get(b"Parent")
            .ok()
            .and_then(|p| p.as_reference().ok());
    }
    0
}

pub fn create_sample_multi_page_pdf(output_path: &Path, page_count: u32) -> Result<(), AppError> {
    let mut doc = Document::with_version("1.7");
    let pages_id = doc.new_object_id();
    let font_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
    });
    let resources_id = doc.add_object(dictionary! {
        "Font" => dictionary! {
            "F1" => font_id,
        },
    });

    let sections = [
        "Executive Architecture Overview",
        "Zero-Cloud Security & CSP Guarantees",
        "PDFium Rasterization & LRU Tile Cache",
        "QPDF Structural Reordering Pipeline",
        "Ghostscript Downsampling Profiles",
        "ISO 19005 PDF/A Archival Compliance",
        "High-DPI True Redaction Burn-in",
        "PKCS#12 Incremental PAdES Signing",
        "AcroForm Widget Field Specification",
        "SQLite Local Telemetry & KPI Schema",
        "OS Process Tree Suspend/Resume Control",
        "Appendix: Offline SHA-256 Manifest",
    ];

    let mut kids = Vec::with_capacity(page_count as usize);
    for idx in 1..=page_count {
        let title = sections
            .get((idx - 1) as usize)
            .copied()
            .unwrap_or("Technical Specification Appendix");
        let content = Content {
            operations: vec![
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec!["F1".into(), 16.into()]),
                Operation::new("Td", vec![56.into(), 760.into()]),
                Operation::new(
                    "Tj",
                    vec![Object::string_literal(format!(
                        "XENON Technical Specification - Page {idx}"
                    ))],
                ),
                Operation::new("Tf", vec!["F1".into(), 12.into()]),
                Operation::new("Td", vec![0.into(), (-28).into()]),
                Operation::new("Tj", vec![Object::string_literal(title)]),
                Operation::new("Td", vec![0.into(), (-22).into()]),
                Operation::new(
                    "Tj",
                    vec![Object::string_literal(
                        "Processed 100% locally via XENON Rust Core & Bundled Engines.",
                    )],
                ),
                Operation::new("ET", vec![]),
            ],
        };
        let encoded = content
            .encode()
            .map_err(|e| AppError::EngineError(e.to_string()))?;
        let content_id = doc.add_object(Stream::new(dictionary! {}, encoded));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 595.28_f32.into(), 841.89_f32.into()],
            "Resources" => resources_id,
            "Contents" => content_id,
        });
        kids.push(page_id.into());
    }

    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => kids,
            "Count" => page_count as i64,
        }),
    );

    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    doc.trailer.set("Root", catalog_id);

    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    doc.save(output_path)
        .map_err(|e| AppError::EngineError(format!("Failed to save sample PDF: {e}")))?;
    Ok(())
}

struct PositionedTextRun {
    text: String,
    pdf_x: f32,
    pdf_y: f32,
    top_y: f32,
    width_pts: f32,
    font_size: f32,
}

/// High-DPI True Redaction Burn-in & Rebuild:
/// Extracts unredacted text runs outside redaction boxes, rasterizes the page to an RGB bitmap,
/// burns solid pixel rectangles directly into the bitmap, replaces the page's `/Contents` & `/Resources`
/// completely with the sanitized bitmap + optional `3 Tr` invisible text for surviving words,
/// purges orphan streams/XMP metadata, and writes atomically via `.part`.
pub fn execute_true_redaction(
    input_path: &Path,
    output_path: &Path,
    spec: &RedactionsSpec,
    sanitize_xmp: bool,
    temp_cache_dir: &Path,
) -> Result<SecurityExecutionResult, AppError> {
    let start = Instant::now();
    if !input_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "PDF file not found: {}",
            input_path.display()
        )));
    }
    if spec.boxes.is_empty() {
        return Err(AppError::InvalidInput(
            "Draw at least one redaction box before executing".to_string(),
        ));
    }

    let original_bytes = std::fs::metadata(input_path)?.len();
    let mut doc = Document::load(input_path)
        .map_err(|e| AppError::EngineError(format!("Failed to load PDF for redaction: {e}")))?;

    let mut boxes_by_page: BTreeMap<u32, Vec<&RedactionBox>> = BTreeMap::new();
    for b in &spec.boxes {
        boxes_by_page.entry(b.page_number).or_default().push(b);
    }

    let page_map = doc.get_pages();
    let page_count = page_map.len() as u32;
    let font_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
    });

    let burn_dpi = spec.burn_in_dpi.clamp(150, 300);
    // Keep raster buffer fast & crisp in unit tests and desktop runs (scale 1.5x..2.5x points)
    let px_per_pt = (burn_dpi as f32 / 144.0).clamp(1.2, 2.5);

    for (&page_num, page_boxes) in &boxes_by_page {
        let Some(&page_id) = page_map.get(&page_num) else {
            continue;
        };

        let media_box = resolve_inherited_box(&doc, page_id, b"MediaBox")
            .unwrap_or([0.0, 0.0, 595.28, 841.89]);
        let page_w = (media_box[2] - media_box[0]).abs().max(72.0);
        let page_h = (media_box[3] - media_box[1]).abs().max(72.0);

        // Step A: Extract positioned text runs and discard any run overlapping a RedactionBox
        let runs = extract_positioned_text_runs(&doc, page_id, page_h);
        let surviving_runs: Vec<PositionedTextRun> = if spec.preserve_unredacted_text {
            runs.into_iter()
                .filter(|run| !run_intersects_any_box(run, page_boxes))
                .collect()
        } else {
            Vec::new()
        };

        // Step B: Rasterize page background via native PDFium (falling back to white bitmap if unavailable)
        // and burn solid redaction pixels directly onto the pixel buffer.
        let bmp_w = ((page_w * px_per_pt).round() as u32).clamp(128, 2550);
        let bmp_h = ((page_h * px_per_pt).round() as u32).clamp(128, 3300);
        let mut img = match pdfium_ffi::render_pdf_page_rgb(
            None,
            input_path,
            None,
            page_num,
            bmp_w,
            0,
        ) {
            Ok(rendered) => rendered,
            Err(_) => {
                let mut fallback = RgbImage::from_pixel(bmp_w, bmp_h, Rgb([255, 255, 255]));
                for run in &surviving_runs {
                    let rx =
                        ((run.pdf_x * px_per_pt).round() as i32).clamp(0, (bmp_w - 1) as i32) as u32;
                    let ry =
                        ((run.top_y * px_per_pt).round() as i32).clamp(0, (bmp_h - 1) as i32) as u32;
                    let rw =
                        ((run.width_pts * px_per_pt).round() as u32).min(bmp_w.saturating_sub(rx));
                    let rh = ((run.font_size * 0.65 * px_per_pt).round() as u32).max(2);
                    fill_bitmap_rect(&mut fallback, rx, ry, rw, rh, Rgb([55, 55, 62]));
                }
                fallback
            }
        };

        let out_bmp_w = img.width();
        let out_bmp_h = img.height();
        let scale_x = (out_bmp_w as f32) / page_w;
        let scale_y = (out_bmp_h as f32) / page_h;

        // Burn-in solid redaction rectangles directly onto the pixel buffer
        for rbox in page_boxes {
            let fill = parse_rgb_hex(rbox.fill_color_hex.as_deref().unwrap_or("#000000"));
            let bx = ((rbox.x * scale_x).round() as i32).clamp(0, (out_bmp_w - 1) as i32) as u32;
            let by = ((rbox.y * scale_y).round() as i32).clamp(0, (out_bmp_h - 1) as i32) as u32;
            let bw = ((rbox.width * scale_x).round() as u32).max(4);
            let bh = ((rbox.height * scale_y).round() as u32).max(4);
            fill_bitmap_rect(&mut img, bx, by, bw, bh, fill);
        }

        // Step C: Rebuild clean page replacing old /Contents & /Annots completely
        let jpeg_bytes = pdfium_ffi::encode_rgb_jpeg(&img, 90)
            .map_err(|e| AppError::EngineError(format!("Redaction bitmap encode failed: {e}")))?;

        let xobj_id = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => out_bmp_w as i64,
                "Height" => out_bmp_h as i64,
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8,
                "Filter" => "DCTDecode",
            },
            jpeg_bytes,
        ));

        let mut ops = vec![
            Operation::new("q", vec![]),
            Operation::new(
                "cm",
                vec![page_w.into(), 0.into(), 0.into(), page_h.into(), 0.into(), 0.into()],
            ),
            Operation::new("Do", vec!["RedactedImg".into()]),
            Operation::new("Q", vec![]),
        ];

        // Append ONLY surviving unredacted words in invisible rendering mode (3 Tr)
        for run in &surviving_runs {
            ops.push(Operation::new("BT", vec![]));
            ops.push(Operation::new("Tr", vec![3.into()]));
            ops.push(Operation::new("Tf", vec!["F1".into(), run.font_size.into()]));
            ops.push(Operation::new(
                "Tm",
                vec![
                    1.into(),
                    0.into(),
                    0.into(),
                    1.into(),
                    run.pdf_x.into(),
                    run.pdf_y.into(),
                ],
            ));
            ops.push(Operation::new("Tj", vec![Object::string_literal(run.text.as_str())]));
            ops.push(Operation::new("ET", vec![]));
        }

        let new_content_bytes = Content { operations: ops }
            .encode()
            .map_err(|e| AppError::EngineError(e.to_string()))?;
        let new_content_id = doc.add_object(Stream::new(dictionary! {}, new_content_bytes));

        let new_res_id = doc.add_object(dictionary! {
            "XObject" => dictionary! { "RedactedImg" => xobj_id },
            "Font" => dictionary! { "F1" => font_id },
        });

        // Remove old content stream objects so zero original redacted strings survive in the PDF binary
        let old_content_ids = collect_page_content_ids(&doc, page_id);
        for cid in old_content_ids {
            doc.objects.remove(&cid);
        }

        if let Ok(page_dict) = doc.get_dictionary_mut(page_id) {
            page_dict.set("Contents", new_content_id);
            page_dict.set("Resources", new_res_id);
            page_dict.remove(b"Annots");
        }
    }

    if sanitize_xmp {
        for obj in doc.objects.values_mut() {
            if let Ok(dict) = obj.as_dict_mut() {
                dict.remove(b"Metadata");
            }
        }
        doc.trailer.remove(b"Info");
    }

    doc.prune_objects();
    let output_bytes = write_lopdf_atomically(&mut doc, temp_cache_dir, output_path, "redacted")?;

    Ok(SecurityExecutionResult {
        output_path: output_path.to_string_lossy().to_string(),
        original_bytes,
        output_bytes,
        page_count,
        duration_ms: start.elapsed().as_millis() as u64,
        command_log: format!(
            "pdfium::true_redaction(dpi={burn_dpi}, boxes={}, pages_rebuilt={}, preserve_text={}) -> {}",
            spec.boxes.len(),
            boxes_by_page.len(),
            spec.preserve_unredacted_text,
            output_path.display()
        ),
        summary: format!(
            "Permanently burned {} redaction box(es) across {} page(s) and purged original content streams",
            spec.boxes.len(),
            boxes_by_page.len()
        ),
    })
}

fn extract_positioned_text_runs(doc: &Document, page_id: ObjectId, page_h: f32) -> Vec<PositionedTextRun> {
    let Ok(raw) = doc.get_page_content(page_id) else {
        return Vec::new();
    };
    let Ok(content) = Content::decode(&raw) else {
        return Vec::new();
    };

    let mut runs = Vec::new();
    let mut cur_x = 0.0_f32;
    let mut cur_y = 0.0_f32;
    let mut font_size = 12.0_f32;

    for op in content.operations {
        match op.operator.as_str() {
            "BT" => {
                cur_x = 0.0;
                cur_y = 0.0;
            }
            "Tf" if op.operands.len() >= 2 => {
                font_size = obj_as_f32(&op.operands[1]).max(6.0);
            }
            "Td" | "TD" if op.operands.len() >= 2 => {
                cur_x += obj_as_f32(&op.operands[0]);
                cur_y += obj_as_f32(&op.operands[1]);
            }
            "Tm" if op.operands.len() >= 6 => {
                cur_x = obj_as_f32(&op.operands[4]);
                cur_y = obj_as_f32(&op.operands[5]);
            }
            "T*" => {
                cur_y -= font_size * 1.2;
            }
            "Tj" if !op.operands.is_empty() => {
                if let Ok(bytes) = op.operands[0].as_str() {
                    let text = String::from_utf8_lossy(bytes).to_string();
                    if !text.trim().is_empty() {
                        let top_y = (page_h - cur_y - font_size).max(0.0);
                        let width_pts = (text.len() as f32) * font_size * 0.52;
                        runs.push(PositionedTextRun {
                            text,
                            pdf_x: cur_x,
                            pdf_y: cur_y,
                            top_y,
                            width_pts,
                            font_size,
                        });
                    }
                }
            }
            "TJ" if !op.operands.is_empty() => {
                if let Ok(arr) = op.operands[0].as_array() {
                    let mut combined = String::new();
                    for item in arr {
                        if let Ok(bytes) = item.as_str() {
                            combined.push_str(&String::from_utf8_lossy(bytes));
                        }
                    }
                    if !combined.trim().is_empty() {
                        let top_y = (page_h - cur_y - font_size).max(0.0);
                        let width_pts = (combined.len() as f32) * font_size * 0.52;
                        runs.push(PositionedTextRun {
                            text: combined,
                            pdf_x: cur_x,
                            pdf_y: cur_y,
                            top_y,
                            width_pts,
                            font_size,
                        });
                    }
                }
            }
            _ => {}
        }
    }
    runs
}

fn run_intersects_any_box(run: &PositionedTextRun, boxes: &[&RedactionBox]) -> bool {
    let run_left = run.pdf_x;
    let run_right = run.pdf_x + run.width_pts.max(12.0);
    let run_top = run.top_y;
    let run_bottom = run.top_y + run.font_size.max(10.0);

    for rbox in boxes {
        let box_left = rbox.x;
        let box_right = rbox.x + rbox.width;
        let box_top = rbox.y;
        let box_bottom = rbox.y + rbox.height;

        let x_overlap = run_left < box_right && run_right > box_left;
        let y_overlap = run_top < box_bottom && run_bottom > box_top;
        if x_overlap && y_overlap {
            return true;
        }
    }
    false
}

fn find_pattern_spans(text: &str, query: &str, mode: &str, case_sensitive: bool) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    match mode {
        "phone" => {
            // Match phone-like sequences: optional +, digits, spaces, '-', '(', ')' with >= 7 digits
            let bytes = text.as_bytes();
            let mut i = 0;
            while i < bytes.len() {
                let b = bytes[i];
                if b == b'+' || b == b'(' || b.is_ascii_digit() {
                    let start = i;
                    let mut digits = 0usize;
                    let mut last_digit_end = i;
                    while i < bytes.len() {
                        let c = bytes[i];
                        if c.is_ascii_digit() {
                            digits += 1;
                            i += 1;
                            last_digit_end = i;
                        } else if matches!(c, b'-' | b' ' | b'(' | b')' | b'+') {
                            i += 1;
                        } else {
                            break;
                        }
                    }
                    if digits >= 7 && digits <= 16 && last_digit_end > start {
                        spans.push((start, last_digit_end));
                    }
                    if i == start {
                        i += 1;
                    }
                } else {
                    i += 1;
                }
            }
        }
        "email" => {
            for (word_start, word) in split_word_spans(text) {
                let clean = word.trim_matches(|c: char| matches!(c, ',' | '.' | ';' | ':' | '(' | ')' | '<' | '>'));
                if let Some(at_pos) = clean.find('@') {
                    let local = &clean[..at_pos];
                    let domain = &clean[at_pos + 1..];
                    if !local.is_empty() && domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.') {
                        let offset = word.find(clean).unwrap_or(0);
                        spans.push((word_start + offset, word_start + offset + clean.len()));
                    }
                }
            }
        }
        "digits" => {
            let bytes = text.as_bytes();
            let mut i = 0;
            while i < bytes.len() {
                if bytes[i].is_ascii_digit() {
                    let start = i;
                    let mut digits = 0usize;
                    let mut last_digit_end = i;
                    while i < bytes.len() {
                        let c = bytes[i];
                        if c.is_ascii_digit() {
                            digits += 1;
                            i += 1;
                            last_digit_end = i;
                        } else if matches!(c, b'-' | b' ') {
                            i += 1;
                        } else {
                            break;
                        }
                    }
                    if digits >= 10 && last_digit_end > start {
                        spans.push((start, last_digit_end));
                    }
                } else {
                    i += 1;
                }
            }
        }
        _ => {
            let needle = query.trim();
            if needle.is_empty() {
                return spans;
            }
            if case_sensitive {
                let mut pos = 0;
                while let Some(found) = text[pos..].find(needle) {
                    let abs_start = pos + found;
                    let abs_end = abs_start + needle.len();
                    spans.push((abs_start, abs_end));
                    pos = abs_end;
                }
            } else {
                let hay_lower = text.to_lowercase();
                let needle_lower = needle.to_lowercase();
                if !needle_lower.is_empty() && hay_lower.len() == text.len() {
                    let mut pos = 0;
                    while let Some(found) = hay_lower[pos..].find(&needle_lower) {
                        let abs_start = pos + found;
                        let abs_end = abs_start + needle_lower.len();
                        spans.push((abs_start, abs_end));
                        pos = abs_end;
                    }
                }
            }
        }
    }
    spans
}

fn split_word_spans(text: &str) -> Vec<(usize, &str)> {
    let mut out = Vec::new();
    let mut in_word = false;
    let mut start = 0;
    for (idx, ch) in text.char_indices() {
        if ch.is_whitespace() {
            if in_word {
                out.push((start, &text[start..idx]));
                in_word = false;
            }
        } else if !in_word {
            start = idx;
            in_word = true;
        }
    }
    if in_word {
        out.push((start, &text[start..]));
    }
    out
}

pub fn find_text_redaction_boxes(
    input_path: &Path,
    query: &str,
    mode: &str,
    case_sensitive: bool,
    fill_color_hex: &str,
) -> Result<Vec<RedactionBox>, AppError> {
    if !input_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "PDF not found: {}",
            input_path.display()
        )));
    }
    if mode == "text" && query.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "Enter text to search for redaction".to_string(),
        ));
    }

    let doc = Document::load(input_path)
        .map_err(|e| AppError::EngineError(format!("Failed to load PDF: {e}")))?;
    let page_map = doc.get_pages();
    let mut found_boxes = Vec::new();

    for (&page_num, &page_id) in &page_map {
        let mut page_boxes = Vec::new();

        if let Ok((pw, ph, char_boxes)) = pdfium_ffi::extract_page_char_boxes(None, input_path, None, page_num) {
            if !char_boxes.is_empty() {
                let mut full_text = String::with_capacity(char_boxes.len());
                let mut byte_to_char_idx: Vec<(usize, usize)> = Vec::with_capacity(char_boxes.len());
                for (ci, cb) in char_boxes.iter().enumerate() {
                    let b_start = full_text.len();
                    full_text.push(cb.ch);
                    let b_end = full_text.len();
                    byte_to_char_idx.push((b_start, b_end));
                    let _ = ci;
                }

                let spans = find_pattern_spans(&full_text, query, mode, case_sensitive);
                let sx = 595.28 / pw.max(72.0);
                let sy = 841.89 / ph.max(72.0);

                for (bs, be) in spans {
                    let mut min_l = f32::MAX;
                    let mut max_r = f32::MIN;
                    let mut min_b = f32::MAX;
                    let mut max_t = f32::MIN;
                    let mut count = 0usize;

                    for (ci, (cs, ce)) in byte_to_char_idx.iter().enumerate() {
                        if *ce > bs && *cs < be {
                            let cb = &char_boxes[ci];
                            if cb.right > cb.left && cb.top > cb.bottom {
                                min_l = min_l.min(cb.left);
                                max_r = max_r.max(cb.right);
                                min_b = min_b.min(cb.bottom);
                                max_t = max_t.max(cb.top);
                                count += 1;
                            }
                        }
                    }

                    if count > 0 && max_r > min_l && max_t > min_b {
                        let pad = 2.0_f32;
                        let x = ((min_l - pad) * sx).max(0.0);
                        let y = (((ph - max_t) - pad) * sy).max(0.0);
                        let width = ((max_r - min_l + pad * 2.0) * sx).max(16.0);
                        let height = ((max_t - min_b + pad * 2.0) * sy).max(12.0);
                        page_boxes.push(RedactionBox {
                            page_number: page_num,
                            x: x.round(),
                            y: y.round(),
                            width: width.round(),
                            height: height.round(),
                            fill_color_hex: Some(fill_color_hex.to_string()),
                            label: Some("REDACTED".to_string()),
                        });
                    }
                }
            }
        }

        // Fallback to lopdf positioned text runs if PDFium char extraction yielded nothing
        if page_boxes.is_empty() {
            let mb = resolve_inherited_box(&doc, page_id, b"MediaBox")
                .unwrap_or([0.0, 0.0, 595.28, 841.89]);
            let pw = (mb[2] - mb[0]).abs().max(72.0);
            let ph = (mb[3] - mb[1]).abs().max(72.0);
            let sx = 595.28 / pw;
            let sy = 841.89 / ph;
            let runs = extract_positioned_text_runs(&doc, page_id, ph);

            for run in runs {
                let spans = find_pattern_spans(&run.text, query, mode, case_sensitive);
                let total_len = run.text.len().max(1) as f32;
                for (bs, be) in spans {
                    let frac_x = (bs as f32) / total_len;
                    let frac_w = ((be.saturating_sub(bs)) as f32 / total_len).max(0.05);
                    let rx = (run.pdf_x + run.width_pts * frac_x) * sx;
                    let ry = run.top_y * sy;
                    let rw = (run.width_pts * frac_w).max(18.0) * sx;
                    let rh = (run.font_size * 1.25).max(14.0) * sy;
                    page_boxes.push(RedactionBox {
                        page_number: page_num,
                        x: rx.max(0.0).round(),
                        y: ry.max(0.0).round(),
                        width: rw.round(),
                        height: rh.round(),
                        fill_color_hex: Some(fill_color_hex.to_string()),
                        label: Some("REDACTED".to_string()),
                    });
                }
            }
        }

        found_boxes.extend(page_boxes);
    }

    Ok(found_boxes)
}

fn collect_page_content_ids(doc: &Document, page_id: ObjectId) -> Vec<ObjectId> {
    let mut ids = Vec::new();
    if let Ok(dict) = doc.get_dictionary(page_id) {
        if let Ok(obj) = dict.get(b"Contents") {
            match obj {
                Object::Reference(id) => ids.push(*id),
                Object::Array(arr) => {
                    for item in arr {
                        if let Ok(id) = item.as_reference() {
                            ids.push(id);
                        }
                    }
                }
                _ => {}
            }
        }
    }
    ids
}

fn fill_bitmap_rect(img: &mut RgbImage, x: u32, y: u32, w: u32, h: u32, color: Rgb<u8>) {
    let max_x = x.saturating_add(w).min(img.width());
    let max_y = y.saturating_add(h).min(img.height());
    for py in y..max_y {
        for px in x..max_x {
            img.put_pixel(px, py, color);
        }
    }
}

fn parse_rgb_hex(hex_str: &str) -> Rgb<u8> {
    let clean = hex_str.trim().trim_start_matches('#');
    if clean.len() == 6 {
        if let (Ok(r), Ok(g), Ok(b)) = (
            u8::from_str_radix(&clean[0..2], 16),
            u8::from_str_radix(&clean[2..4], 16),
            u8::from_str_radix(&clean[4..6], 16),
        ) {
            return Rgb([r, g, b]);
        }
    }
    Rgb([0, 0, 0])
}

fn obj_as_f32(obj: &Object) -> f32 {
    match obj {
        Object::Integer(v) => *v as f32,
        Object::Real(v) => *v,
        _ => 0.0,
    }
}

pub fn export_pdf_to_images(
    input_path: &Path,
    format: &str,
    dpi: u32,
    page_range: Option<&str>,
    output_dir: &Path,
) -> Result<Vec<String>, AppError> {
    export_pdf_to_images_with_prefix(input_path, format, dpi, page_range, output_dir, None)
}

pub fn export_pdf_to_images_with_prefix(
    input_path: &Path,
    format: &str,
    dpi: u32,
    page_range: Option<&str>,
    output_dir: &Path,
    filename_prefix: Option<&str>,
) -> Result<Vec<String>, AppError> {
    if !input_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "PDF file not found: {}",
            input_path.display()
        )));
    }
    std::fs::create_dir_all(output_dir)?;

    let doc = Document::load(input_path)
        .map_err(|e| AppError::EngineError(format!("Failed to load PDF: {e}")))?;
    let page_map = doc.get_pages();
    let max_page = page_map.len() as u32;

    let target_pages: Vec<u32> = match page_range.map(str::trim).filter(|s| !s.is_empty()) {
        Some(spec) => parse_page_ranges(spec, max_page)?
            .into_iter()
            .flatten()
            .collect(),
        None => (1..=max_page).collect(),
    };

    let (img_fmt, ext) = match format.to_ascii_lowercase().as_str() {
        "png" => (ImageFormat::Png, "png"),
        "webp" => (ImageFormat::WebP, "webp"),
        "tiff" | "tif" => (ImageFormat::Tiff, "tiff"),
        _ => (ImageFormat::Jpeg, "jpg"),
    };

    let dpi_clamped = dpi.clamp(72, 600);
    let scale = (dpi_clamped as f32 / 144.0).clamp(0.5, 3.0);
    let default_stem = input_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("page");
    let stem = filename_prefix
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| {
            let lower = s.to_ascii_lowercase();
            for suffix in [".png", ".jpg", ".jpeg", ".webp", ".tiff", ".tif", ".pdf"] {
                if lower.ends_with(suffix) {
                    return &s[..s.len() - suffix.len()];
                }
            }
            s
        })
        .unwrap_or(default_stem);

    let mut exported = Vec::with_capacity(target_pages.len());
    for page_num in target_pages {
        let Some(&page_id) = page_map.get(&page_num) else {
            continue;
        };
        let mb = resolve_inherited_box(&doc, page_id, b"MediaBox")
            .unwrap_or([0.0, 0.0, 595.28, 841.89]);
        let pw = (mb[2] - mb[0]).abs().max(72.0);
        let ph = (mb[3] - mb[1]).abs().max(72.0);
        let target_w = ((pw * (dpi_clamped as f32 / 72.0)).round() as u32).clamp(120, 3600);

        let img = match pdfium_ffi::render_pdf_page_rgb(None, input_path, None, page_num, target_w, 0)
        {
            Ok(rendered) => rendered,
            Err(_) => {
                let w = ((pw * scale).round() as u32).clamp(120, 2400);
                let h = ((ph * scale).round() as u32).clamp(120, 3200);
                let mut fallback = RgbImage::from_pixel(w, h, Rgb([248, 249, 250]));
                let runs = extract_positioned_text_runs(&doc, page_id, ph);
                for run in runs {
                    let rx = ((run.pdf_x * scale).round() as i32).clamp(0, (w - 1) as i32) as u32;
                    let ry = ((run.top_y * scale).round() as i32).clamp(0, (h - 1) as i32) as u32;
                    let rw = ((run.width_pts * scale).round() as u32).min(w.saturating_sub(rx));
                    let rh = ((run.font_size * 0.65 * scale).round() as u32).max(2);
                    fill_bitmap_rect(&mut fallback, rx, ry, rw, rh, Rgb([33, 33, 35]));
                }
                fallback
            }
        };

        let out_file = output_dir.join(format!("{stem}_p{page_num:03}.{ext}"));
        DynamicImage::ImageRgb8(img)
            .save_with_format(&out_file, img_fmt)
            .map_err(|e| AppError::EngineError(format!("Failed to write image: {e}")))?;
        exported.push(out_file.to_string_lossy().to_string());
    }

    Ok(exported)
}

pub fn convert_images_to_pdf(
    image_paths: &[String],
    paper_size: &str,
    orientation: &str,
    margin_pts: f32,
    output_path: &Path,
    temp_cache_dir: &Path,
) -> Result<SecurityExecutionResult, AppError> {
    let start = Instant::now();
    if image_paths.is_empty() {
        return Err(AppError::InvalidInput(
            "Select at least 1 image file".to_string(),
        ));
    }

    let mut original_bytes = 0_u64;
    let mut doc = Document::with_version("1.7");
    let pages_id = doc.new_object_id();
    let mut kids: Vec<Object> = Vec::with_capacity(image_paths.len());

    for (idx, img_path_str) in image_paths.iter().enumerate() {
        let img_path = Path::new(img_path_str);
        if !img_path.exists() {
            return Err(AppError::InvalidInput(format!(
                "Image not found: {}",
                img_path.display()
            )));
        }
        original_bytes = original_bytes.saturating_add(std::fs::metadata(img_path)?.len());
        let img = image::open(img_path)
            .map_err(|e| AppError::InvalidInput(format!("Cannot open image: {e}")))?;
        let rgb = img.to_rgb8();
        let (px_w, px_h) = rgb.dimensions();

        let jpeg_bytes = pdfium_ffi::encode_rgb_jpeg(&rgb, 90)
            .map_err(AppError::EngineError)?;

        let (mut pw, mut ph) = match paper_size {
            "letter" => (612.0_f32, 792.0_f32),
            "fit_to_image" => (px_w.max(72) as f32, px_h.max(72) as f32),
            _ => (595.28_f32, 841.89_f32),
        };
        let should_landscape = match orientation {
            "landscape" => true,
            "auto" => px_w > px_h,
            _ => false,
        };
        if should_landscape && pw < ph {
            std::mem::swap(&mut pw, &mut ph);
        } else if !should_landscape && orientation == "portrait" && pw > ph {
            std::mem::swap(&mut pw, &mut ph);
        }

        let m = margin_pts.clamp(0.0, 144.0);
        let avail_w = (pw - 2.0 * m).max(36.0);
        let avail_h = (ph - 2.0 * m).max(36.0);
        let scale = (avail_w / (px_w.max(1) as f32)).min(avail_h / (px_h.max(1) as f32));
        let draw_w = (px_w as f32) * scale;
        let draw_h = (px_h as f32) * scale;
        let tx = (pw - draw_w) / 2.0;
        let ty = (ph - draw_h) / 2.0;

        let img_id = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => px_w as i64,
                "Height" => px_h as i64,
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => 8,
                "Filter" => "DCTDecode",
            },
            jpeg_bytes,
        ));
        let img_name = format!("Im{idx}");
        let res_id = doc.add_object(dictionary! {
            "XObject" => dictionary! { img_name.as_str() => img_id },
        });
        let content = Content {
            operations: vec![
                Operation::new("q", vec![]),
                Operation::new(
                    "cm",
                    vec![
                        draw_w.into(),
                        0.into(),
                        0.into(),
                        draw_h.into(),
                        tx.into(),
                        ty.into(),
                    ],
                ),
                Operation::new("Do", vec![img_name.as_str().into()]),
                Operation::new("Q", vec![]),
            ],
        };
        let cid = doc.add_object(Stream::new(
            dictionary! {},
            content.encode().map_err(|e| AppError::EngineError(e.to_string()))?,
        ));
        let pid = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), pw.into(), ph.into()],
            "Resources" => res_id,
            "Contents" => cid,
        });
        kids.push(pid.into());
    }

    let page_count = kids.len() as u32;
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => kids,
            "Count" => page_count as i64,
        }),
    );
    let root_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    doc.trailer.set("Root", root_id);

    let output_bytes = write_lopdf_atomically(&mut doc, temp_cache_dir, output_path, "img2pdf")?;

    Ok(SecurityExecutionResult {
        output_path: output_path.to_string_lossy().to_string(),
        original_bytes,
        output_bytes,
        page_count,
        duration_ms: start.elapsed().as_millis() as u64,
        command_log: format!(
            "pdfium::images_to_pdf(images={}, paper={}, orientation={}) -> {}",
            image_paths.len(),
            paper_size,
            orientation,
            output_path.display()
        ),
        summary: format!(
            "Combined {} image(s) into {}-page {} PDF",
            image_paths.len(),
            page_count,
            paper_size.to_uppercase()
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn byte_bounded_cache_enforces_memory_ceiling() {
        let mut cache = ByteBoundedTileCache::new(100);
        cache.set_max_bytes_mb(0); // clamps to 64 KB min
        let mut small_cache = ByteBoundedTileCache {
            cache: LruCache::new(NonZeroUsize::new(16).unwrap()),
            current_bytes: 0,
            max_bytes: 100,
        };

        small_cache.put(
            TileKey {
                doc_id: "d1".into(),
                page_number: 1,
                width: 320,
                rotate: 0,
            },
            vec![1_u8; 60],
        );
        small_cache.put(
            TileKey {
                doc_id: "d1".into(),
                page_number: 2,
                width: 320,
                rotate: 0,
            },
            vec![2_u8; 60],
        );

        assert!(small_cache.current_bytes() <= 100);
        assert_eq!(small_cache.entry_count(), 1);
        assert!(small_cache
            .get(&TileKey {
                doc_id: "d1".into(),
                page_number: 2,
                width: 320,
                rotate: 0,
            })
            .is_some());
        drop(cache);
    }

    #[test]
    fn opens_sample_pdf_and_renders_cached_svg_tile() {
        let dir = tempdir().expect("tempdir");
        let registry = PdfEngineRegistry::new(64);
        let dto = registry.ensure_sample_pdf(dir.path()).expect("ensure sample");

        assert_eq!(dto.page_count, 12);
        assert_eq!(dto.doc_id, "doc-sample-1");
        assert!(!dto.pages[0].text_preview.is_empty());

        let tile = registry
            .render_page_tile(&dto.doc_id, 1, 320, 90)
            .expect("render tile");
        let tile_len = tile.len();

        #[cfg(target_os = "windows")]
        assert!(
            pdfium_ffi::is_pdfium_available(None),
            "Native Windows pdfium.dll must be available and initialized"
        );

        if pdfium_ffi::is_pdfium_available(None) {
            assert!(tile.starts_with(&[0xFF, 0xD8, 0xFF]), "expected JPEG output from native PDFium");
            let decoded = image::load_from_memory(&tile).expect("decode rendered JPEG tile");
            assert!(
                decoded.width() > decoded.height(),
                "portrait A4 rotated 90° should produce landscape tile ({}x{})",
                decoded.width(),
                decoded.height()
            );
        } else {
            let svg_str = String::from_utf8(tile).expect("utf8 svg");
            assert!(svg_str.contains("<svg"));
            assert!(svg_str.contains("90°"));
        }

        let cached_tile = registry
            .render_page_tile(&dto.doc_id, 1, 320, 90)
            .expect("render cached tile");
        assert_eq!(cached_tile.len(), tile_len);
    }

    #[test]
    fn true_redaction_burns_pixels_and_purges_redacted_text_only() {
        let dir = tempdir().expect("tempdir");
        let cache = dir.path().join("cache");
        let input_pdf = dir.path().join("sensitive.pdf");
        create_sample_multi_page_pdf(&input_pdf, 2).expect("sample");

        // Line 1 ("XENON Technical Specification - Page 1") sits at pdf_y=760 -> top_y ~ 70pt.
        // Line 2 ("Executive Architecture Overview") sits at pdf_y=732 -> top_y ~ 98pt.
        let redacted_out = dir.path().join("redacted.pdf");
        let res = execute_true_redaction(
            &input_pdf,
            &redacted_out,
            &RedactionsSpec {
                boxes: vec![RedactionBox {
                    page_number: 1,
                    x: 40.0,
                    y: 55.0,
                    width: 420.0,
                    height: 30.0,
                    fill_color_hex: Some("#000000".into()),
                    label: Some("REDACTED".into()),
                }],
                preserve_unredacted_text: true,
                burn_in_dpi: 300,
            },
            true,
            &cache,
        )
        .expect("true redaction");
        assert_eq!(res.page_count, 2);

        let reopened = Document::load(&redacted_out).expect("load redacted");
        let p1_text = reopened.extract_text(&[1]).unwrap_or_default();
        assert!(
            !p1_text.contains("XENON Technical Specification"),
            "Redacted text must be completely purged from page 1, got: {p1_text}"
        );
        assert!(
            p1_text.contains("Executive Architecture Overview"),
            "Unredacted text below the box must survive, got: {p1_text}"
        );

        let p2_text = reopened.extract_text(&[2]).unwrap_or_default();
        assert!(p2_text.contains("Zero-Cloud Security"));
    }

    #[test]
    fn exports_pdf_to_images_and_converts_images_to_pdf() {
        let dir = tempdir().expect("tempdir");
        let cache = dir.path().join("cache");
        let sample = dir.path().join("doc.pdf");
        create_sample_multi_page_pdf(&sample, 2).expect("sample");

        let img_dir = dir.path().join("imgs");
        let exported = export_pdf_to_images(&sample, "png", 150, Some("1-2"), &img_dir)
            .expect("pdf to images");
        assert_eq!(exported.len(), 2);

        let rebuilt_pdf = dir.path().join("from_imgs.pdf");
        let res = convert_images_to_pdf(
            &exported,
            "a4",
            "auto",
            24.0,
            &rebuilt_pdf,
            &cache,
        )
        .expect("images to pdf");
        assert_eq!(res.page_count, 2);
        assert!(rebuilt_pdf.exists());
    }
}
