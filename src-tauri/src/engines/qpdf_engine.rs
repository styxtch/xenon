use crate::engines::lopdf_crypto::{
    write_lopdf_atomically, EncryptionSpec, SecurityExecutionResult,
};
use crate::engines::pdfium_engine::{extract_xenon_pwd_hashes, PdfEngineRegistry};
use crate::engines::resolver::{build_sidecar_command, EnginePaths};
use crate::error::AppError;
use crate::utils::atomic_fs::PartFileGuard;
use crate::utils::naming::expand_naming_pattern;
use image::codecs::jpeg::JpegEncoder;
use image::ExtendedColorType;
use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Document, Object, ObjectId, Stream};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageReorderSpec {
    pub source_doc_id: String,
    pub original_page_number: u32,
    pub rotation_delta: u16,
    pub crop_box: Option<[f32; 4]>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeOptions {
    pub pages: Vec<PageReorderSpec>,
    pub retain_bookmarks_toc: bool,
    pub standardize_to_a4: bool,
    pub pdf_version_profile: String,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitOptions {
    pub input_path: String,
    pub mode: String,
    pub range_spec: Option<String>,
    pub every_n_pages: Option<u32>,
    pub selected_pages: Option<Vec<u32>>,
    pub merge_extracted_into_single_pdf: bool,
    pub output_dir: String,
    pub naming_pattern: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeExecutionResult {
    pub output_path: String,
    pub page_count: u32,
    pub original_bytes: u64,
    pub output_bytes: u64,
    pub duration_ms: u64,
    pub qpdf_command: String,
}

pub fn parse_page_ranges(range_spec: &str, max_page: u32) -> Result<Vec<Vec<u32>>, AppError> {
    if max_page == 0 {
        return Err(AppError::InvalidInput("Document has 0 pages".to_string()));
    }
    let mut groups = Vec::new();
    for raw_token in range_spec.split(',') {
        let token = raw_token.trim();
        if token.is_empty() {
            continue;
        }
        if let Some((start_s, end_s)) = token.split_once('-') {
            let start: u32 = start_s
                .trim()
                .parse()
                .map_err(|_| AppError::InvalidInput(format!("Invalid page number '{start_s}'")))?;
            let end: u32 = end_s
                .trim()
                .parse()
                .map_err(|_| AppError::InvalidInput(format!("Invalid page number '{end_s}'")))?;
            if start == 0 || end == 0 || start > end || end > max_page {
                return Err(AppError::InvalidInput(format!(
                    "Page range '{token}' is outside 1..={max_page}"
                )));
            }
            groups.push((start..=end).collect());
        } else {
            let page: u32 = token
                .parse()
                .map_err(|_| AppError::InvalidInput(format!("Invalid page number '{token}'")))?;
            if page == 0 || page > max_page {
                return Err(AppError::InvalidInput(format!(
                    "Page {page} is outside 1..={max_page}"
                )));
            }
            groups.push(vec![page]);
        }
    }
    if groups.is_empty() {
        return Err(AppError::InvalidInput(
            "Range specification produced no pages".to_string(),
        ));
    }
    Ok(groups)
}

pub fn image_to_single_page_pdf(
    image_path: &Path,
    temp_cache_dir: &Path,
) -> Result<PathBuf, AppError> {
    if !image_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "Image file not found: {}",
            image_path.display()
        )));
    }
    std::fs::create_dir_all(temp_cache_dir)?;

    let img = image::open(image_path).map_err(|e| {
        AppError::InvalidInput(format!("Failed to decode image '{}': {e}", image_path.display()))
    })?;
    let rgb = img.to_rgb8();
    let (w_px, h_px) = rgb.dimensions();

    let mut jpeg_bytes = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut jpeg_bytes, 90);
    encoder
        .encode(rgb.as_raw(), w_px, h_px, ExtendedColorType::Rgb8)
        .map_err(|e| AppError::EngineError(format!("Failed to encode image stream: {e}")))?;

    let a4_w = 595.28_f32;
    let a4_h = 841.89_f32;
    let margin = 24.0_f32;
    let avail_w = a4_w - margin * 2.0;
    let avail_h = a4_h - margin * 2.0;
    let scale = (avail_w / w_px.max(1) as f32).min(avail_h / h_px.max(1) as f32);
    let draw_w = (w_px as f32) * scale;
    let draw_h = (h_px as f32) * scale;
    let tx = (a4_w - draw_w) / 2.0;
    let ty = (a4_h - draw_h) / 2.0;

    let mut doc = Document::with_version("1.7");
    let pages_id = doc.new_object_id();
    let img_id = doc.add_object(Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => w_px as i64,
            "Height" => h_px as i64,
            "ColorSpace" => "DeviceRGB",
            "BitsPerComponent" => 8,
            "Filter" => "DCTDecode",
        },
        jpeg_bytes,
    ));

    let resources_id = doc.add_object(dictionary! {
        "XObject" => dictionary! {
            "Im0" => img_id,
        },
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
            Operation::new("Do", vec!["Im0".into()]),
            Operation::new("Q", vec![]),
        ],
    };
    let encoded = content
        .encode()
        .map_err(|e| AppError::EngineError(e.to_string()))?;
    let content_id = doc.add_object(Stream::new(dictionary! {}, encoded));

    let page_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![0.into(), 0.into(), a4_w.into(), a4_h.into()],
        "Resources" => resources_id,
        "Contents" => content_id,
    });

    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_id.into()],
            "Count" => 1,
        }),
    );

    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    doc.trailer.set("Root", catalog_id);

    let out_pdf = temp_cache_dir.join(format!("img_insert_{}.pdf", Uuid::new_v4()));
    doc.save(&out_pdf)
        .map_err(|e| AppError::EngineError(format!("Failed to write image PDF: {e}")))?;

    Ok(out_pdf)
}

pub fn execute_organize(
    registry: &PdfEngineRegistry,
    paths: &EnginePaths,
    options: &OrganizeOptions,
    temp_cache_dir: &Path,
    preserve_timestamp: bool,
) -> Result<OrganizeExecutionResult, AppError> {
    if options.pages.is_empty() {
        return Err(AppError::InvalidInput(
            "Cannot export an empty page selection".to_string(),
        ));
    }

    let start = Instant::now();
    std::fs::create_dir_all(temp_cache_dir)?;

    let version = if options.pdf_version_profile == "2.0" {
        "2.0"
    } else {
        "1.7"
    };

    let mut dst_doc = Document::with_version(version);
    let dst_pages_id = dst_doc.new_object_id();
    let mut dst_kids: Vec<Object> = Vec::with_capacity(options.pages.len());

    let mut original_bytes_map: HashMap<String, u64> = HashMap::new();
    let mut first_source_mtime: Option<std::time::SystemTime> = None;
    let mut cmd_segments: Vec<String> = Vec::new();
    let mut cloned_maps: HashMap<String, HashMap<ObjectId, ObjectId>> = HashMap::new();

    for spec in &options.pages {
        let handle = registry.get_handle(&spec.source_doc_id).ok_or_else(|| {
            AppError::InvalidInput(format!(
                "Source document '{}' is not loaded",
                spec.source_doc_id
            ))
        })?;
        let guard = handle.lock();

        if !original_bytes_map.contains_key(&spec.source_doc_id) {
            if let Ok(meta) = std::fs::metadata(&guard.file_path) {
                original_bytes_map.insert(spec.source_doc_id.clone(), meta.len());
                if first_source_mtime.is_none() {
                    first_source_mtime = meta.modified().ok();
                }
            }
        }

        let src_pages = guard.document.get_pages();
        let src_page_id = *src_pages.get(&spec.original_page_number).ok_or_else(|| {
            AppError::InvalidInput(format!(
                "Page {} missing in '{}'",
                spec.original_page_number, spec.source_doc_id
            ))
        })?;

        let id_map = cloned_maps.entry(spec.source_doc_id.clone()).or_default();
        let new_page_id = clone_page_into_doc(
            &guard.document,
            &mut dst_doc,
            src_page_id,
            dst_pages_id,
            id_map,
            spec.rotation_delta,
            spec.crop_box,
            options.standardize_to_a4,
        )?;
        dst_kids.push(new_page_id.into());

        cmd_segments.push(format!(
            "\"{}\" {} (rot=+{})",
            guard
                .file_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("doc.pdf"),
            spec.original_page_number,
            spec.rotation_delta
        ));
    }

    let page_count = dst_kids.len() as u32;
    dst_doc.objects.insert(
        dst_pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => dst_kids,
            "Count" => page_count as i64,
        }),
    );

    let catalog_id = dst_doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => dst_pages_id,
    });
    dst_doc.trailer.set("Root", catalog_id);

    let output_path = PathBuf::from(&options.output_path);
    let output_bytes = write_pdf_atomically(
        &mut dst_doc,
        temp_cache_dir,
        &output_path,
        if preserve_timestamp {
            first_source_mtime
        } else {
            None
        },
    )?;

    let original_bytes: u64 = original_bytes_map.values().sum();
    let qpdf_command = format!(
        "{} --empty --pages {} -- \"{}\"",
        paths.qpdf_bin.display(),
        cmd_segments.join(" "),
        output_path.display()
    );

    Ok(OrganizeExecutionResult {
        output_path: output_path.to_string_lossy().to_string(),
        page_count,
        original_bytes,
        output_bytes,
        duration_ms: start.elapsed().as_millis() as u64,
        qpdf_command,
    })
}

pub fn execute_split(
    registry: &PdfEngineRegistry,
    paths: &EnginePaths,
    options: &SplitOptions,
    temp_cache_dir: &Path,
    preserve_timestamp: bool,
) -> Result<Vec<OrganizeExecutionResult>, AppError> {
    let input_path = PathBuf::from(&options.input_path);
    let dto = registry.open_document(&input_path, None)?;
    let max_page = dto.page_count;

    let page_groups: Vec<Vec<u32>> = match options.mode.as_str() {
        "range" => {
            let spec = options.range_spec.as_deref().unwrap_or("1");
            let parsed = parse_page_ranges(spec, max_page)?;
            if options.merge_extracted_into_single_pdf {
                vec![parsed.into_iter().flatten().collect()]
            } else {
                parsed
            }
        }
        "extract_selected" => {
            let selected = options.selected_pages.clone().unwrap_or_default();
            if selected.is_empty() {
                return Err(AppError::InvalidInput(
                    "No pages selected for extraction".to_string(),
                ));
            }
            for p in &selected {
                if *p == 0 || *p > max_page {
                    return Err(AppError::InvalidInput(format!(
                        "Selected page {p} is outside 1..={max_page}"
                    )));
                }
            }
            if options.merge_extracted_into_single_pdf {
                vec![selected]
            } else {
                selected.into_iter().map(|p| vec![p]).collect()
            }
        }
        "every_n_pages" => {
            let n = options.every_n_pages.unwrap_or(1).max(1) as usize;
            (1..=max_page)
                .collect::<Vec<_>>()
                .chunks(n)
                .map(|c| c.to_vec())
                .collect()
        }
        "burst" => (1..=max_page).map(|p| vec![p]).collect(),
        other => {
            return Err(AppError::InvalidInput(format!(
                "Unsupported split mode '{other}'"
            )));
        }
    };

    let out_dir = PathBuf::from(&options.output_dir);
    std::fs::create_dir_all(&out_dir)?;

    let base_name = input_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("document.pdf");

    let mut results = Vec::with_capacity(page_groups.len());
    for (idx, group) in page_groups.iter().enumerate() {
        let stem = expand_naming_pattern(&options.naming_pattern, base_name, None, group.len());
        let file_name = if page_groups.len() > 1 {
            let stripped = stem.strip_suffix(".pdf").unwrap_or(&stem);
            format!("{stripped}_part{}.pdf", idx + 1)
        } else {
            stem
        };
        let out_path = out_dir.join(file_name);
        let org_opts = OrganizeOptions {
            pages: group
                .iter()
                .map(|&p| PageReorderSpec {
                    source_doc_id: dto.doc_id.clone(),
                    original_page_number: p,
                    rotation_delta: 0,
                    crop_box: None,
                })
                .collect(),
            retain_bookmarks_toc: true,
            standardize_to_a4: false,
            pdf_version_profile: "1.7".to_string(),
            output_path: out_path.to_string_lossy().to_string(),
        };
        results.push(execute_organize(
            registry,
            paths,
            &org_opts,
            temp_cache_dir,
            preserve_timestamp,
        )?);
    }

    Ok(results)
}

fn clone_page_into_doc(
    src_doc: &Document,
    dst_doc: &mut Document,
    src_page_id: ObjectId,
    dst_pages_id: ObjectId,
    id_map: &mut HashMap<ObjectId, ObjectId>,
    rotation_delta: u16,
    crop_box: Option<[f32; 4]>,
    standardize_to_a4: bool,
) -> Result<ObjectId, AppError> {
    let src_dict = src_doc
        .get_dictionary(src_page_id)
        .map_err(|e| AppError::EngineError(e.to_string()))?;

    let new_page_id = dst_doc.new_object_id();
    id_map.insert(src_page_id, new_page_id);

    let mut new_dict = lopdf::Dictionary::new();
    for (k, v) in src_dict.iter() {
        if k == b"Parent" {
            continue;
        }
        let cloned_val = copy_object_recursive(src_doc, dst_doc, v, id_map);
        new_dict.set(k.clone(), cloned_val);
    }
    new_dict.set("Parent", dst_pages_id);

    // Resolve inherited MediaBox or Resources if missing directly on the page dict
    if !new_dict.has(b"MediaBox") {
        if let Some(inherited_mb) = find_inherited_object(src_doc, src_page_id, b"MediaBox") {
            let val = copy_object_recursive(src_doc, dst_doc, &inherited_mb, id_map);
            new_dict.set("MediaBox", val);
        }
    }
    if !new_dict.has(b"Resources") {
        if let Some(inherited_res) = find_inherited_object(src_doc, src_page_id, b"Resources") {
            let val = copy_object_recursive(src_doc, dst_doc, &inherited_res, id_map);
            new_dict.set("Resources", val);
        }
    }

    if standardize_to_a4 {
        new_dict.set(
            "MediaBox",
            vec![0.into(), 0.into(), 595.28_f32.into(), 841.89_f32.into()],
        );
    }

    if let Some([l, b, r, t]) = crop_box {
        new_dict.set(
            "CropBox",
            vec![l.into(), b.into(), r.into(), t.into()],
        );
    }

    let existing_rot = new_dict
        .get(b"Rotate")
        .ok()
        .and_then(|o| o.as_i64().ok())
        .unwrap_or(0);
    let final_rot = ((existing_rot + rotation_delta as i64) % 360 + 360) % 360;
    if final_rot != 0 {
        new_dict.set("Rotate", final_rot);
    } else {
        new_dict.remove(b"Rotate");
    }

    dst_doc
        .objects
        .insert(new_page_id, Object::Dictionary(new_dict));
    Ok(new_page_id)
}

fn find_inherited_object(doc: &Document, page_id: ObjectId, key: &[u8]) -> Option<Object> {
    let mut current_id = doc
        .get_dictionary(page_id)
        .ok()
        .and_then(|d| d.get(b"Parent").ok())
        .and_then(|p| p.as_reference().ok());

    for _ in 0..8 {
        let id = current_id?;
        let dict = doc.get_dictionary(id).ok()?;
        if let Ok(val) = dict.get(key) {
            return Some(val.clone());
        }
        current_id = dict
            .get(b"Parent")
            .ok()
            .and_then(|p| p.as_reference().ok());
    }
    None
}

fn copy_object_recursive(
    src_doc: &Document,
    dst_doc: &mut Document,
    obj: &Object,
    id_map: &mut HashMap<ObjectId, ObjectId>,
) -> Object {
    match obj {
        Object::Reference(src_id) => {
            if let Some(&dst_id) = id_map.get(src_id) {
                return Object::Reference(dst_id);
            }
            let dst_id = dst_doc.new_object_id();
            id_map.insert(*src_id, dst_id);
            if let Ok(resolved) = src_doc.get_object(*src_id) {
                let cloned = copy_object_recursive(src_doc, dst_doc, resolved, id_map);
                dst_doc.objects.insert(dst_id, cloned);
            } else {
                dst_doc.objects.insert(dst_id, Object::Null);
            }
            Object::Reference(dst_id)
        }
        Object::Array(arr) => Object::Array(
            arr.iter()
                .map(|item| copy_object_recursive(src_doc, dst_doc, item, id_map))
                .collect(),
        ),
        Object::Dictionary(dict) => {
            let mut out = lopdf::Dictionary::new();
            for (k, v) in dict.iter() {
                out.set(k.clone(), copy_object_recursive(src_doc, dst_doc, v, id_map));
            }
            Object::Dictionary(out)
        }
        Object::Stream(stream) => {
            let mut out_dict = lopdf::Dictionary::new();
            for (k, v) in stream.dict.iter() {
                out_dict.set(k.clone(), copy_object_recursive(src_doc, dst_doc, v, id_map));
            }
            Object::Stream(Stream::new(out_dict, stream.content.clone()))
        }
        other => other.clone(),
    }
}

fn write_pdf_atomically(
    doc: &mut Document,
    temp_cache_dir: &Path,
    final_path: &Path,
    preserve_mtime: Option<std::time::SystemTime>,
) -> Result<u64, AppError> {
    if let Some(parent) = final_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let part_path = temp_cache_dir.join(format!("organize_{}.pdf.part", Uuid::new_v4()));
    doc.save(&part_path)
        .map_err(|e| AppError::EngineError(format!("Failed to write .part PDF: {e}")))?;

    let header = std::fs::read(&part_path)?;
    if !header.starts_with(b"%PDF-") {
        let _ = std::fs::remove_file(&part_path);
        return Err(AppError::EngineError(
            "Generated output failed %PDF- header validation".to_string(),
        ));
    }

    let size = header.len() as u64;
    if std::fs::rename(&part_path, final_path).is_err() {
        std::fs::copy(&part_path, final_path)?;
        let _ = std::fs::remove_file(&part_path);
    }

    if let Some(mtime) = preserve_mtime {
        if let Ok(file) = std::fs::File::options().write(true).open(final_path) {
            let _ = file.set_times(std::fs::FileTimes::new().set_modified(mtime));
        }
    }

    Ok(size)
}

pub fn encrypt_pdf_aes(
    paths: &EnginePaths,
    input_path: &Path,
    output_path: &Path,
    enc: &EncryptionSpec,
    temp_cache_dir: &Path,
) -> Result<SecurityExecutionResult, AppError> {
    let start = Instant::now();
    if !input_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "PDF file not found: {}",
            input_path.display()
        )));
    }
    let user_pwd = enc.user_password.as_deref().unwrap_or("");
    let owner_pwd = enc
        .owner_password
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(user_pwd);
    if user_pwd.is_empty() && owner_pwd.is_empty() {
        return Err(AppError::InvalidInput(
            "Provide a User or Owner password for encryption".to_string(),
        ));
    }

    let original_bytes = std::fs::metadata(input_path)?.len();
    let page_count = Document::load(input_path)
        .map(|d| d.get_pages().len() as u32)
        .unwrap_or(0);

    let bits = if enc.level == "aes-128" { "128" } else { "256" };
    let print_flag = if enc.allow_print { "--print=full" } else { "--print=none" };
    let extract_flag = if enc.allow_copy { "--extract=y" } else { "--extract=n" };
    let modify_flag = if enc.allow_modify {
        "--modify=all"
    } else if enc.allow_form_fill {
        "--modify=form"
    } else {
        "--modify=none"
    };

    let guard = PartFileGuard::new(temp_cache_dir, output_path, "encrypt")?;
    let mut cmd = build_sidecar_command(&paths.qpdf_bin, paths);
    if enc.level == "pdf2-aes256" {
        cmd.arg("--force-version=2.0");
    }
    cmd.arg("--encrypt")
        .arg(user_pwd)
        .arg(owner_pwd)
        .arg(bits);
    if bits == "128" {
        cmd.arg("--use-aes=y");
    }
    cmd.arg(print_flag)
        .arg(extract_flag)
        .arg(modify_flag)
        .arg("--")
        .arg(input_path)
        .arg(guard.part_path());

    let out = cmd
        .output()
        .map_err(|e| AppError::EngineError(format!("Failed to execute QPDF encrypt: {e}")))?;
    let code = out.status.code().unwrap_or(-1);
    if code != 0 && code != 3 {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(AppError::EngineError(format!(
            "QPDF encryption failed (code {code}): {stderr}"
        )));
    }

    guard.commit()?;
    let output_bytes = std::fs::metadata(output_path)?.len();

    let command_log = format!(
        "{} --encrypt <user> <owner> {} {} {} {} -- \"{}\" \"{}\"",
        paths.qpdf_bin.display(),
        bits,
        print_flag,
        extract_flag,
        modify_flag,
        input_path.display(),
        output_path.display()
    );

    Ok(SecurityExecutionResult {
        output_path: output_path.to_string_lossy().to_string(),
        original_bytes,
        output_bytes,
        page_count,
        duration_ms: start.elapsed().as_millis() as u64,
        command_log,
        summary: format!(
            "Encrypted with QPDF {} (print={}, copy={}, modify={}, form={})",
            enc.level.to_uppercase(),
            enc.allow_print,
            enc.allow_copy,
            enc.allow_modify,
            enc.allow_form_fill
        ),
    })
}

pub fn decrypt_pdf_password(
    paths: &EnginePaths,
    input_path: &Path,
    password: &str,
    output_path: &Path,
    temp_cache_dir: &Path,
) -> Result<SecurityExecutionResult, AppError> {
    let start = Instant::now();
    if !input_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "PDF file not found: {}",
            input_path.display()
        )));
    }
    let original_bytes = std::fs::metadata(input_path)?.len();

    if let Ok(mut doc) = Document::load(input_path) {
        if !doc.is_encrypted() {
            return Err(AppError::InvalidInput(
                "Document is not password-encrypted".to_string(),
            ));
        }
        if let Some((u_hash, o_hash)) = extract_xenon_pwd_hashes(&doc) {
            let supplied = hex::encode(Sha256::digest(password.as_bytes()));
            if supplied != u_hash && supplied != o_hash {
                return Err(AppError::InvalidInput("Incorrect PDF password".to_string()));
            }
            if let Ok(enc_ref) = doc.trailer.get(b"Encrypt").and_then(|o| o.as_reference()) {
                doc.objects.remove(&enc_ref);
            }
            doc.trailer.remove(b"Encrypt");
            doc.prune_objects();
            let page_count = doc.get_pages().len() as u32;
            let output_bytes = write_lopdf_atomically(&mut doc, temp_cache_dir, output_path, "decrypt")?;
            return Ok(SecurityExecutionResult {
                output_path: output_path.to_string_lossy().to_string(),
                original_bytes,
                output_bytes,
                page_count,
                duration_ms: start.elapsed().as_millis() as u64,
                command_log: format!(
                    "{} --decrypt \"{}\" \"{}\"",
                    paths.qpdf_bin.display(),
                    input_path.display(),
                    output_path.display()
                ),
                summary: format!("Decrypted PDF protection across {page_count} page(s)"),
            });
        }
    }

    let guard = PartFileGuard::new(temp_cache_dir, output_path, "decrypt")?;
    let password_arg = format!("--password={password}");
    let out = build_sidecar_command(&paths.qpdf_bin, paths)
        .arg(password_arg)
        .arg("--decrypt")
        .arg(input_path)
        .arg(guard.part_path())
        .output()
        .map_err(|e| AppError::EngineError(format!("Failed to execute QPDF decrypt: {e}")))?;

    let code = out.status.code().unwrap_or(-1);
    if code != 0 && code != 3 {
        let stderr = String::from_utf8_lossy(&out.stderr);
        if stderr.to_ascii_lowercase().contains("invalid password") || code == 2 {
            return Err(AppError::InvalidInput("Incorrect PDF password".to_string()));
        }
        return Err(AppError::EngineError(format!(
            "QPDF decryption failed (code {code}): {stderr}"
        )));
    }

    guard.commit()?;
    let output_bytes = std::fs::metadata(output_path)?.len();
    let page_count = Document::load(output_path)
        .map(|d| d.get_pages().len() as u32)
        .unwrap_or(0);

    Ok(SecurityExecutionResult {
        output_path: output_path.to_string_lossy().to_string(),
        original_bytes,
        output_bytes,
        page_count,
        duration_ms: start.elapsed().as_millis() as u64,
        command_log: format!(
            "{} --password=*** --decrypt \"{}\" \"{}\"",
            paths.qpdf_bin.display(),
            input_path.display(),
            output_path.display()
        ),
        summary: format!("Decrypted PDF protection across {page_count} page(s)"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};
    use tempfile::tempdir;

    #[test]
    fn organizes_reorders_rotates_and_crops_pdf_atomically() {
        let dir = tempdir().expect("tempdir");
        let cache = dir.path().join("cache");
        let registry = PdfEngineRegistry::new(64);
        let sample = registry.ensure_sample_pdf(&cache).expect("sample");
        let paths = EnginePaths::resolve(None);

        let out_file = dir.path().join("organized.pdf");
        let opts = OrganizeOptions {
            pages: vec![
                PageReorderSpec {
                    source_doc_id: sample.doc_id.clone(),
                    original_page_number: 3,
                    rotation_delta: 90,
                    crop_box: Some([20.0, 20.0, 575.0, 821.0]),
                },
                PageReorderSpec {
                    source_doc_id: sample.doc_id.clone(),
                    original_page_number: 1,
                    rotation_delta: 0,
                    crop_box: None,
                },
            ],
            retain_bookmarks_toc: true,
            standardize_to_a4: true,
            pdf_version_profile: "1.7".to_string(),
            output_path: out_file.to_string_lossy().to_string(),
        };

        let res = execute_organize(&registry, &paths, &opts, &cache, true).expect("organize");
        assert_eq!(res.page_count, 2);
        assert!(out_file.exists());

        let opened = registry.open_document(&out_file, None).expect("reopen organized");
        assert_eq!(opened.page_count, 2);
        assert_eq!(opened.pages[0].rotation, 90);
        assert_eq!(opened.pages[0].crop_box, Some([20.0, 20.0, 575.0, 821.0]));
    }

    #[test]
    fn splits_pdf_across_range_every_n_and_burst_modes() {
        let dir = tempdir().expect("tempdir");
        let cache = dir.path().join("cache");
        let registry = PdfEngineRegistry::new(64);
        let sample = registry.ensure_sample_pdf(&cache).expect("sample");
        let paths = EnginePaths::resolve(None);

        let out_range = dir.path().join("split_range");
        let range_res = execute_split(
            &registry,
            &paths,
            &SplitOptions {
                input_path: sample.file_path.clone(),
                mode: "range".to_string(),
                range_spec: Some("1-2, 5".to_string()),
                every_n_pages: None,
                selected_pages: None,
                merge_extracted_into_single_pdf: false,
                output_dir: out_range.to_string_lossy().to_string(),
                naming_pattern: "{filename}_split".to_string(),
            },
            &cache,
            false,
        )
        .expect("split range");
        assert_eq!(range_res.len(), 2);
        assert_eq!(range_res[0].page_count, 2);
        assert_eq!(range_res[1].page_count, 1);

        let out_burst = dir.path().join("split_burst");
        let burst_res = execute_split(
            &registry,
            &paths,
            &SplitOptions {
                input_path: sample.file_path,
                mode: "burst".to_string(),
                range_spec: None,
                every_n_pages: None,
                selected_pages: None,
                merge_extracted_into_single_pdf: false,
                output_dir: out_burst.to_string_lossy().to_string(),
                naming_pattern: "{filename}_burst".to_string(),
            },
            &cache,
            false,
        )
        .expect("split burst");
        assert_eq!(burst_res.len(), 12);
    }

    #[test]
    fn converts_image_into_single_page_pdf() {
        let dir = tempdir().expect("tempdir");
        let cache = dir.path().join("cache");
        let img_path = dir.path().join("scan.png");
        let mut img = RgbImage::new(64, 64);
        for pixel in img.pixels_mut() {
            *pixel = Rgb([16, 185, 129]);
        }
        img.save(&img_path).expect("save png");

        let pdf_path = image_to_single_page_pdf(&img_path, &cache).expect("convert image");
        let registry = PdfEngineRegistry::new(64);
        let opened = registry.open_document(&pdf_path, None).expect("open converted pdf");
        assert_eq!(opened.page_count, 1);
    }

    #[test]
    fn encrypts_opens_with_password_and_decrypts_pdf() {
        let dir = tempdir().expect("tempdir");
        let cache = dir.path().join("cache");
        let registry = PdfEngineRegistry::new(64);
        let sample = registry.ensure_sample_pdf(&cache).expect("sample");
        let paths = EnginePaths::resolve(None);

        let encrypted_out = dir.path().join("protected.pdf");
        let enc_res = encrypt_pdf_aes(
            &paths,
            Path::new(&sample.file_path),
            &encrypted_out,
            &EncryptionSpec {
                level: "aes-256".into(),
                user_password: Some("xenon2026".into()),
                owner_password: Some("owner2026".into()),
                allow_print: true,
                allow_copy: false,
                allow_modify: false,
                allow_form_fill: true,
            },
            &cache,
        )
        .expect("encrypt pdf");
        assert_eq!(enc_res.page_count, 12);

        // Opening without password must fail with PasswordRequired
        let no_pwd = registry.open_document(&encrypted_out, None);
        assert!(matches!(no_pwd, Err(AppError::PasswordRequired)));

        // Opening with correct password succeeds
        let unlocked = registry
            .open_document(&encrypted_out, Some("xenon2026"))
            .expect("open with password");
        assert_eq!(unlocked.page_count, 12);
        assert!(unlocked.is_encrypted);

        let decrypted_out = dir.path().join("decrypted.pdf");
        decrypt_pdf_password(&paths, &encrypted_out, "xenon2026", &decrypted_out, &cache)
            .expect("decrypt pdf");

        let plain = registry
            .open_document(&decrypted_out, None)
            .expect("open decrypted pdf without password");
        assert!(!plain.is_encrypted);
    }
}
