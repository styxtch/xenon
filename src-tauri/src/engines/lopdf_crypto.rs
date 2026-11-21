use crate::error::AppError;
use image::codecs::jpeg::JpegEncoder;
use image::ExtendedColorType;
use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Document, Object, ObjectId, Stream};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::Path;
use std::time::Instant;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SizeEstimateResult {
    pub original_bytes: u64,
    pub estimated_bytes: u64,
    pub estimated_reduction_percent: f64,
    pub image_stream_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SanitizeResult {
    pub output_path: String,
    pub original_bytes: u64,
    pub output_bytes: u64,
    pub removed_metadata_streams: usize,
    pub stripped_info_keys: usize,
    pub pruned_orphan_objects: usize,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatermarkSpec {
    pub kind: String,
    pub text: Option<String>,
    pub image_path: Option<String>,
    pub opacity: f32,
    pub rotation_deg: f32,
    pub font_size_pts: Option<f32>,
    pub color_hex: Option<String>,
    pub layer: String,
    pub target_pages: Option<Vec<u32>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualStampSpec {
    pub page: u32,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub signature_image_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pkcs12SignatureSpec {
    pub p12_path: String,
    pub passphrase: Option<String>,
    pub use_keyring_passphrase: Option<bool>,
    pub reason: Option<String>,
    pub location: Option<String>,
    pub contact_info: Option<String>,
    pub visual_stamp: Option<VisualStampSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionSpec {
    pub level: String,
    pub user_password: Option<String>,
    pub owner_password: Option<String>,
    pub allow_print: bool,
    pub allow_copy: bool,
    pub allow_modify: bool,
    pub allow_form_fill: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactionBox {
    pub page_number: u32,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub fill_color_hex: Option<String>,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactionsSpec {
    pub boxes: Vec<RedactionBox>,
    pub preserve_unredacted_text: bool,
    pub burn_in_dpi: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecuritySignOptions {
    pub input_path: String,
    pub output_path: String,
    pub encryption: Option<EncryptionSpec>,
    pub pkcs12_signature: Option<Pkcs12SignatureSpec>,
    pub watermark: Option<WatermarkSpec>,
    pub redactions: Option<RedactionsSpec>,
    pub flatten_all: bool,
    pub sanitize_xmp: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityExecutionResult {
    pub output_path: String,
    pub original_bytes: u64,
    pub output_bytes: u64,
    pub page_count: u32,
    pub duration_ms: u64,
    pub command_log: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeystoreInfoDto {
    pub p12_path: String,
    pub subject: String,
    pub fingerprint_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormFieldSpec {
    pub id: String,
    pub name: String,
    pub field_type: String, // "text" | "checkbox" | "radio" | "dropdown"
    pub page_number: u32,
    pub rect: [f32; 4], // [x, y, width, height]
    pub value: serde_json::Value,
    pub options: Option<Vec<String>>,
    pub required: Option<bool>,
    pub read_only: Option<bool>,
}

pub fn estimate_compressed_size(
    input_path: &Path,
    profile: &str,
    custom_dpi: Option<u32>,
    custom_jpeg_quality: Option<u8>,
) -> Result<SizeEstimateResult, AppError> {
    if !input_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "PDF file not found: {}",
            input_path.display()
        )));
    }

    let original_bytes = std::fs::metadata(input_path)?.len();
    let doc = Document::load(input_path)
        .map_err(|e| AppError::EngineError(format!("Failed to parse PDF for size estimate: {e}")))?;

    let mut image_stream_bytes = 0_u64;
    for obj in doc.objects.values() {
        if let Ok(stream) = obj.as_stream() {
            let is_img = stream
                .dict
                .get(b"Subtype")
                .ok()
                .and_then(|v| v.as_name().ok())
                .map(|n| n == b"Image")
                .unwrap_or(false);
            if is_img {
                image_stream_bytes = image_stream_bytes.saturating_add(stream.content.len() as u64);
            }
        }
    }

    let (target_dpi, quality) = match profile {
        "screen" => (72_u32, 55_u8),
        "ebook" => (150_u32, 72_u8),
        "printer" => (300_u32, 88_u8),
        "prepress" => (300_u32, 95_u8),
        "custom" => (
            custom_dpi.unwrap_or(150).clamp(72, 600),
            custom_jpeg_quality.unwrap_or(75).clamp(10, 100),
        ),
        _ => (150_u32, 75_u8),
    };

    let dpi_ratio = ((target_dpi as f64) / 300.0).clamp(0.18, 1.0);
    let quality_ratio = ((quality as f64) / 100.0).clamp(0.25, 1.0);
    let image_factor = (dpi_ratio * quality_ratio).clamp(0.14, 0.94);

    let structural_overhead = original_bytes.saturating_sub(image_stream_bytes);
    let structural_factor = match profile {
        "screen" => 0.72,
        "ebook" => 0.80,
        "printer" => 0.88,
        "prepress" => 0.93,
        _ => 0.82,
    };

    let estimated_bytes = ((image_stream_bytes as f64) * image_factor
        + (structural_overhead as f64) * structural_factor)
        .round()
        .max(1024.0) as u64;
    let estimated_bytes = estimated_bytes.min(original_bytes);

    let estimated_reduction_percent = if original_bytes > 0 {
        (((original_bytes - estimated_bytes) as f64) / (original_bytes as f64)) * 100.0
    } else {
        0.0
    };

    Ok(SizeEstimateResult {
        original_bytes,
        estimated_bytes,
        estimated_reduction_percent: (estimated_reduction_percent * 10.0).round() / 10.0,
        image_stream_bytes,
    })
}

pub fn sanitize_pdf_metadata(
    input_path: &Path,
    output_path: &Path,
    temp_cache_dir: &Path,
) -> Result<SanitizeResult, AppError> {
    let start = Instant::now();
    if !input_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "PDF file not found: {}",
            input_path.display()
        )));
    }
    let original_bytes = std::fs::metadata(input_path)?.len();
    let mut doc = Document::load(input_path)
        .map_err(|e| AppError::EngineError(format!("Failed to load PDF for sanitization: {e}")))?;

    let mut removed_metadata_streams = 0_usize;
    let mut metadata_ids: Vec<ObjectId> = Vec::new();

    for (&obj_id, obj) in &doc.objects {
        if let Ok(stream) = obj.as_stream() {
            if stream.dict.type_is(b"Metadata") {
                metadata_ids.push(obj_id);
            }
        }
    }

    for id in &metadata_ids {
        doc.objects.remove(id);
        removed_metadata_streams += 1;
    }

    for obj in doc.objects.values_mut() {
        match obj {
            Object::Dictionary(dict) => {
                if dict.remove(b"Metadata").is_some() {
                    removed_metadata_streams += 1;
                }
            }
            Object::Stream(stream) => {
                if stream.dict.remove(b"Metadata").is_some() {
                    removed_metadata_streams += 1;
                }
            }
            _ => {}
        }
    }

    let mut stripped_info_keys = 0_usize;
    if let Ok(info_ref) = doc.trailer.get(b"Info").and_then(|o| o.as_reference()) {
        if let Ok(info_dict) = doc.get_dictionary_mut(info_ref) {
            for key in [
                b"Author".as_slice(),
                b"Creator".as_slice(),
                b"Producer".as_slice(),
                b"Subject".as_slice(),
                b"Keywords".as_slice(),
                b"CreationDate".as_slice(),
                b"ModDate".as_slice(),
                b"Trapped".as_slice(),
            ] {
                if info_dict.remove(key).is_some() {
                    stripped_info_keys += 1;
                }
            }
        }
        doc.trailer.remove(b"Info");
    }

    let pruned = doc.prune_objects();
    let output_bytes = write_lopdf_atomically(&mut doc, temp_cache_dir, output_path, "sanitize")?;

    Ok(SanitizeResult {
        output_path: output_path.to_string_lossy().to_string(),
        original_bytes,
        output_bytes,
        removed_metadata_streams,
        stripped_info_keys,
        pruned_orphan_objects: pruned.len(),
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

pub fn apply_watermark_to_pdf(
    input_path: &Path,
    output_path: &Path,
    spec: &WatermarkSpec,
    flatten_all: bool,
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
    let original_bytes = std::fs::metadata(input_path)?.len();
    let mut doc = Document::load(input_path)
        .map_err(|e| AppError::EngineError(format!("Failed to load PDF for watermark: {e}")))?;

    let target_set: Option<HashSet<u32>> = spec
        .target_pages
        .as_ref()
        .filter(|v| !v.is_empty())
        .map(|v| v.iter().copied().collect());

    let opacity = spec.opacity.clamp(0.05, 1.0);
    let font_size = spec.font_size_pts.unwrap_or(44.0).clamp(8.0, 144.0);
    let (r, g, b) = parse_hex_color(spec.color_hex.as_deref().unwrap_or("#4EDEA3"));
    let text_val = spec
        .text
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("CONFIDENTIAL — XENON");

    let gs_id = doc.add_object(dictionary! {
        "Type" => "ExtGState",
        "ca" => opacity,
        "CA" => opacity,
    });
    let font_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica-Bold",
    });

    let mut image_xobject_id: Option<ObjectId> = None;
    if spec.kind == "image" {
        if let Some(img_path_str) = spec.image_path.as_deref().filter(|s| !s.is_empty()) {
            let img_path = Path::new(img_path_str);
            if img_path.exists() {
                if let Ok(img) = image::open(img_path) {
                    let rgb = img.to_rgb8();
                    let (w, h) = rgb.dimensions();
                    let mut jpeg_bytes = Vec::new();
                    let mut encoder = JpegEncoder::new_with_quality(&mut jpeg_bytes, 88);
                    encoder
                        .encode(rgb.as_raw(), w, h, ExtendedColorType::Rgb8)
                        .map_err(|e| AppError::EngineError(e.to_string()))?;
                    let xobj = doc.add_object(Stream::new(
                        dictionary! {
                            "Type" => "XObject",
                            "Subtype" => "Image",
                            "Width" => w as i64,
                            "Height" => h as i64,
                            "ColorSpace" => "DeviceRGB",
                            "BitsPerComponent" => 8,
                            "Filter" => "DCTDecode",
                        },
                        jpeg_bytes,
                    ));
                    image_xobject_id = Some(xobj);
                }
            }
        }
    }

    let pages = doc.get_pages();
    let page_count = pages.len() as u32;

    for (page_num, page_id) in pages {
        if let Some(set) = &target_set {
            if !set.contains(&page_num) {
                continue;
            }
        }

        let (page_w, page_h) = read_page_dimensions(&doc, page_id);
        let theta = spec.rotation_deg.to_radians();
        let cos_t = theta.cos();
        let sin_t = theta.sin();

        let ops = if let Some(_img_id) = image_xobject_id {
            let draw_w = page_w * 0.45;
            let draw_h = draw_w * 0.6;
            let tx = (page_w - draw_w) / 2.0;
            let ty = (page_h - draw_h) / 2.0;
            vec![
                Operation::new("q", vec![]),
                Operation::new("gs", vec!["GSWm".into()]),
                Operation::new(
                    "cm",
                    vec![
                        (draw_w * cos_t).into(),
                        (draw_w * sin_t).into(),
                        (-draw_h * sin_t).into(),
                        (draw_h * cos_t).into(),
                        tx.into(),
                        ty.into(),
                    ],
                ),
                Operation::new("Do", vec!["WmImg".into()]),
                Operation::new("Q", vec![]),
            ]
        } else {
            let approx_text_w = (text_val.len() as f32) * font_size * 0.45;
            let cx = page_w / 2.0;
            let cy = page_h / 2.0;
            let tx = cx - (approx_text_w * 0.5 * cos_t);
            let ty = cy - (approx_text_w * 0.5 * sin_t);
            vec![
                Operation::new("q", vec![]),
                Operation::new("gs", vec!["GSWm".into()]),
                Operation::new("rg", vec![r.into(), g.into(), b.into()]),
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec!["FWm".into(), font_size.into()]),
                Operation::new(
                    "Tm",
                    vec![
                        cos_t.into(),
                        sin_t.into(),
                        (-sin_t).into(),
                        cos_t.into(),
                        tx.into(),
                        ty.into(),
                    ],
                ),
                Operation::new("Tj", vec![Object::string_literal(text_val)]),
                Operation::new("ET", vec![]),
                Operation::new("Q", vec![]),
            ]
        };

        let wm_stream_bytes = Content { operations: ops }
            .encode()
            .map_err(|e| AppError::EngineError(e.to_string()))?;
        let wm_stream_id = doc.add_object(Stream::new(dictionary! {}, wm_stream_bytes));

        attach_resources_to_page(&mut doc, page_id, gs_id, font_id, image_xobject_id)?;
        attach_content_stream(&mut doc, page_id, wm_stream_id, spec.layer == "background")?;
    }

    if flatten_all {
        flatten_doc_in_memory(&mut doc);
    }
    if sanitize_xmp {
        strip_xmp_in_memory(&mut doc);
    }

    let output_bytes = write_lopdf_atomically(&mut doc, temp_cache_dir, output_path, "watermark")?;

    Ok(SecurityExecutionResult {
        output_path: output_path.to_string_lossy().to_string(),
        original_bytes,
        output_bytes,
        page_count,
        duration_ms: start.elapsed().as_millis() as u64,
        command_log: format!(
            "lopdf::watermark(kind={}, layer={}, opacity={:.2}, rot={:.0}deg) -> {}",
            spec.kind,
            spec.layer,
            opacity,
            spec.rotation_deg,
            output_path.display()
        ),
        summary: format!(
            "Applied {} {} watermark across {} page(s)",
            spec.layer, spec.kind, page_count
        ),
    })
}

pub fn flatten_pdf_annotations(
    input_path: &Path,
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
    let mut doc = Document::load(input_path)
        .map_err(|e| AppError::EngineError(format!("Failed to load PDF for flatten: {e}")))?;

    let page_count = doc.get_pages().len() as u32;
    let flattened_items = flatten_doc_in_memory(&mut doc);
    doc.prune_objects();

    let output_bytes = write_lopdf_atomically(&mut doc, temp_cache_dir, output_path, "flatten")?;

    Ok(SecurityExecutionResult {
        output_path: output_path.to_string_lossy().to_string(),
        original_bytes,
        output_bytes,
        page_count,
        duration_ms: start.elapsed().as_millis() as u64,
        command_log: format!(
            "lopdf::flatten(annotations_and_acroform={flattened_items}) -> {}",
            output_path.display()
        ),
        summary: format!(
            "Flattened {flattened_items} interactive annotation/AcroForm entry(s) across {page_count} page(s)"
        ),
    })
}

pub fn generate_self_signed_p12(
    output_path: &Path,
    common_name: &str,
    passphrase: &str,
) -> Result<KeystoreInfoDto, AppError> {
    use p12_keystore::{Certificate, KeyStore, KeyStoreEntry, PrivateKey, PrivateKeyChain};
    use x509_certificate::{EcdsaCurve, KeyAlgorithm, X509CertificateBuilder};

    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut builder = X509CertificateBuilder::default();
    builder
        .subject()
        .append_common_name_utf8_string(common_name)
        .map_err(|e| AppError::EngineError(format!("Invalid certificate CN: {e:?}")))?;
    builder
        .issuer()
        .append_common_name_utf8_string(common_name)
        .map_err(|e| AppError::EngineError(format!("Invalid certificate issuer: {e:?}")))?;

    let (cert, signing_key) = builder
        .create_with_random_keypair(KeyAlgorithm::Ecdsa(EcdsaCurve::Secp256r1))
        .map_err(|e| AppError::EngineError(format!("Failed to generate X.509 keypair: {e}")))?;

    let cert_der = cert
        .encode_der()
        .map_err(|e| AppError::EngineError(format!("Failed to encode X.509 DER: {e}")))?;
    let key_der = signing_key.to_pkcs8_one_asymmetric_key_der();

    let fingerprint = hex::encode(Sha256::digest(&cert_der));
    let p12_key = PrivateKey::from_der(key_der.as_ref())
        .map_err(|e| AppError::EngineError(format!("Failed to wrap PKCS#8 key: {e}")))?;
    let p12_cert = Certificate::from_der(&cert_der)
        .map_err(|e| AppError::EngineError(format!("Failed to wrap X.509 cert: {e}")))?;

    let local_key_id = Sha256::digest(&cert_der)[..16].to_vec();
    let chain = PrivateKeyChain::new(local_key_id, p12_key, vec![p12_cert]);

    let mut ks = KeyStore::new();
    ks.add_entry("xenon-signer", KeyStoreEntry::PrivateKeyChain(chain));
    let p12_bytes = ks
        .writer(passphrase)
        .write()
        .map_err(|e| AppError::EngineError(format!("Failed to serialize PKCS#12 keystore: {e}")))?;
    std::fs::write(output_path, &p12_bytes)?;

    Ok(KeystoreInfoDto {
        p12_path: output_path.to_string_lossy().to_string(),
        subject: format!("CN={common_name} (ECDSA P-256 X.509)"),
        fingerprint_sha256: fingerprint,
    })
}

pub fn sign_pdf_incremental_pkcs12(
    input_path: &Path,
    output_path: &Path,
    sig_opts: &Pkcs12SignatureSpec,
    temp_cache_dir: &Path,
) -> Result<SecurityExecutionResult, AppError> {
    use cryptographic_message_syntax::{SignedDataBuilder, SignerBuilder};
    use p12_keystore::{KeyStore, Pkcs12ImportPolicy};
    use x509_certificate::{CapturedX509Certificate, InMemorySigningKeyPair};

    let start = Instant::now();
    if !input_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "PDF file not found: {}",
            input_path.display()
        )));
    }
    let p12_path = Path::new(&sig_opts.p12_path);
    if !p12_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "PKCS#12 keystore not found: {}",
            p12_path.display()
        )));
    }

    let p12_bytes = std::fs::read(p12_path)?;
    let passphrase = sig_opts.passphrase.as_deref().unwrap_or("");
    let ks = KeyStore::from_pkcs12(&p12_bytes, passphrase, Pkcs12ImportPolicy::default())
        .map_err(|e| AppError::InvalidInput(format!("Failed to unlock PKCS#12 keystore: {e}")))?;
    let (_, chain) = ks
        .private_key_chain()
        .ok_or_else(|| AppError::InvalidInput("PKCS#12 keystore has no private key chain".to_string()))?;

    let signing_key = InMemorySigningKeyPair::from_pkcs8_der(chain.key().as_der())
        .map_err(|e| AppError::EngineError(format!("Invalid PKCS#8 private key in .p12: {e}")))?;
    let leaf_cert_der = chain
        .certs()
        .first()
        .ok_or_else(|| AppError::InvalidInput("PKCS#12 keystore has no signing certificate".to_string()))?
        .as_der();
    let signer_cert = CapturedX509Certificate::from_der(leaf_cert_der)
        .map_err(|e| AppError::EngineError(format!("Invalid X.509 certificate in .p12: {e}")))?;
    let cert_digest_hex = hex::encode(Sha256::digest(leaf_cert_der));

    let orig_bytes = std::fs::read(input_path)?;
    let original_bytes = orig_bytes.len() as u64;

    let orig_doc = Document::load_mem(&orig_bytes)
        .map_err(|e| AppError::EngineError(format!("Failed to parse PDF for signing: {e}")))?;
    let page_map = orig_doc.get_pages();
    let page_count = page_map.len() as u32;
    let first_page_id = *page_map
        .get(&1)
        .ok_or_else(|| AppError::EngineError("PDF has no pages to sign".to_string()))?;
    let root_id = orig_doc
        .trailer
        .get(b"Root")
        .and_then(|o| o.as_reference())
        .map_err(|_| AppError::EngineError("Missing PDF Root catalog".to_string()))?;
    let prev_xref = orig_doc.xref_start;

    let sig_obj_num = orig_doc.max_id + 1;
    let widget_obj_num = orig_doc.max_id + 2;
    let new_size = orig_doc.max_id + 3;

    let reason = sig_opts
        .reason
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("Approved & Signed Offline via XENON");
    let location = sig_opts
        .location
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("Local Device");
    let contact = sig_opts
        .contact_info
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or("XENON Private PDF Workspace");

    let stamp_rect = if let Some(v) = &sig_opts.visual_stamp {
        format!("[{:.2} {:.2} {:.2} {:.2}]", v.x, v.y, v.x + v.w, v.y + v.h)
    } else {
        "[36.00 36.00 220.00 84.00]".to_string()
    };

    // Prepare updated Root (/AcroForm + /SigFlags 3) and Page 1 (/Annots)
    let mut updated_root = orig_doc
        .get_dictionary(root_id)
        .cloned()
        .unwrap_or_else(|_| lopdf::Dictionary::new());
    let mut acroform = match updated_root.get(b"AcroForm").ok() {
        Some(Object::Dictionary(d)) => d.clone(),
        Some(Object::Reference(id)) => orig_doc
            .get_dictionary(*id)
            .cloned()
            .unwrap_or_else(|_| lopdf::Dictionary::new()),
        _ => lopdf::Dictionary::new(),
    };
    let mut fields = match acroform.get(b"Fields").ok() {
        Some(Object::Array(a)) => a.clone(),
        _ => Vec::new(),
    };
    fields.push(Object::Reference((widget_obj_num, 0)));
    acroform.set("Fields", Object::Array(fields));
    acroform.set("SigFlags", 3_i64);
    updated_root.set("AcroForm", Object::Dictionary(acroform));

    let mut updated_page = orig_doc
        .get_dictionary(first_page_id)
        .cloned()
        .unwrap_or_else(|_| lopdf::Dictionary::new());
    let mut annots = match updated_page.get(b"Annots").ok() {
        Some(Object::Array(a)) => a.clone(),
        Some(Object::Reference(id)) => orig_doc
            .get_object(*id)
            .ok()
            .and_then(|o| o.as_array().ok())
            .cloned()
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    annots.push(Object::Reference((widget_obj_num, 0)));
    updated_page.set("Annots", Object::Array(annots));

    const CONTENTS_HEX_LEN: usize = 8192;
    let placeholder_zeros = "0".repeat(CONTENTS_HEX_LEN);
    let placeholder_br = "[0 0000000000 0000000000 0000000000]";

    let mut out = orig_bytes;
    if !out.ends_with(b"\n") {
        out.push(b'\n');
    }

    let sig_offset = out.len();
    let sig_header = format!(
        "{sig_obj_num} 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /Name (XENON PKCS#12 Signer) /Reason ({}) /Location ({}) /ContactInfo ({}) /ByteRange ",
        pdf_escape(reason),
        pdf_escape(location),
        pdf_escape(contact),
    );
    out.extend_from_slice(sig_header.as_bytes());
    let br_pos = out.len();
    out.extend_from_slice(placeholder_br.as_bytes());
    out.extend_from_slice(b" /Contents <");
    let contents_hex_start = out.len();
    let offset1 = contents_hex_start - 1;
    out.extend_from_slice(placeholder_zeros.as_bytes());
    out.push(b'>');
    let offset2 = out.len();
    out.extend_from_slice(b" >>\nendobj\n");

    let widget_offset = out.len();
    let widget_obj = format!(
        "{widget_obj_num} 0 obj\n<< /Type /Annot /Subtype /Widget /FT /Sig /T (XENON_Sig_{sig_obj_num}) /F 132 /Rect {stamp_rect} /P {p0} {p1} R /V {sig_obj_num} 0 R >>\nendobj\n",
        p0 = first_page_id.0,
        p1 = first_page_id.1,
    );
    out.extend_from_slice(widget_obj.as_bytes());

    let root_offset = out.len();
    write_indirect_dict(root_id, &updated_root, &mut out);

    let page_offset = out.len();
    write_indirect_dict(first_page_id, &updated_page, &mut out);

    let xref_offset = out.len();
    let mut xref_entries = vec![
        (root_id.0, root_id.1, root_offset),
        (first_page_id.0, first_page_id.1, page_offset),
        (sig_obj_num, 0, sig_offset),
        (widget_obj_num, 0, widget_offset),
    ];
    xref_entries.sort_by_key(|e| e.0);

    let mut xref_block = String::from("xref\n");
    for (obj_num, gen_num, offset) in xref_entries {
        xref_block.push_str(&format!("{obj_num} 1\n{offset:010} {gen_num:05} n \n"));
    }
    xref_block.push_str(&format!(
        "trailer\n<< /Size {new_size} /Root {r0} {r1} R /Prev {prev_xref} >>\nstartxref\n{xref_offset}\n%%EOF\n",
        r0 = root_id.0,
        r1 = root_id.1,
    ));
    out.extend_from_slice(xref_block.as_bytes());

    let len2 = out.len() - offset2;
    let final_br = format!("[0 {offset1:010} {offset2:010} {len2:010}]");
    assert_eq!(final_br.len(), placeholder_br.len());
    out[br_pos..br_pos + final_br.len()].copy_from_slice(final_br.as_bytes());

    let mut signed_payload = Vec::with_capacity(offset1 + len2);
    signed_payload.extend_from_slice(&out[0..offset1]);
    signed_payload.extend_from_slice(&out[offset2..]);

    let mut doc_hasher = Sha256::new();
    doc_hasher.update(&signed_payload);
    let doc_digest_hex = hex::encode(doc_hasher.finalize());

    let signer = SignerBuilder::new(&signing_key, signer_cert.clone());
    let mut cms_builder = SignedDataBuilder::default()
        .content_external(signed_payload)
        .certificate(signer_cert);
    for extra in chain.certs().iter().skip(1) {
        if let Ok(c) = CapturedX509Certificate::from_der(extra.as_der()) {
            cms_builder = cms_builder.certificate(c);
        }
    }
    let cms_der = cms_builder
        .signer(signer)
        .build_der()
        .map_err(|e| AppError::EngineError(format!("CMS SignedData build failed: {e}")))?;

    let mut cms_hex = hex::encode(&cms_der);
    if cms_hex.len() > CONTENTS_HEX_LEN {
        return Err(AppError::EngineError(format!(
            "CMS signature ({} hex chars) exceeded reserved PDF /Contents buffer ({CONTENTS_HEX_LEN})",
            cms_hex.len()
        )));
    }
    cms_hex.push_str(&"0".repeat(CONTENTS_HEX_LEN - cms_hex.len()));
    out[contents_hex_start..contents_hex_start + CONTENTS_HEX_LEN]
        .copy_from_slice(cms_hex.as_bytes());

    // Atomic .part write
    std::fs::create_dir_all(temp_cache_dir)?;
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let part_path = temp_cache_dir.join(format!("signed_{}.pdf.part", Uuid::new_v4()));
    std::fs::write(&part_path, &out)?;
    if std::fs::rename(&part_path, output_path).is_err() {
        std::fs::copy(&part_path, output_path)?;
        let _ = std::fs::remove_file(&part_path);
    }

    let output_bytes = out.len() as u64;
    Ok(SecurityExecutionResult {
        output_path: output_path.to_string_lossy().to_string(),
        original_bytes,
        output_bytes,
        page_count,
        duration_ms: start.elapsed().as_millis() as u64,
        command_log: format!(
            "lopdf_crypto::cms_rfc5652_sign(sha256={}, cert={}..., cmsBytes={}, byteRange={final_br})",
            &doc_digest_hex[..16],
            &cert_digest_hex[..12],
            cms_der.len(),
        ),
        summary: format!(
            "Signed incrementally with RFC 5652 PKCS#12 CMS SignedData ({} DER bytes, {} total appended)",
            cms_der.len(),
            output_bytes.saturating_sub(original_bytes)
        ),
    })
}

fn write_indirect_dict(id: (u32, u16), dict: &lopdf::Dictionary, out: &mut Vec<u8>) {
    out.extend_from_slice(format!("{} {} obj\n", id.0, id.1).as_bytes());
    write_pdf_obj(&Object::Dictionary(dict.clone()), out);
    out.extend_from_slice(b"\nendobj\n");
}

fn write_pdf_obj(obj: &Object, out: &mut Vec<u8>) {
    match obj {
        Object::Null => out.extend_from_slice(b"null"),
        Object::Boolean(b) => out.extend_from_slice(if *b { b"true" } else { b"false" }),
        Object::Integer(i) => out.extend_from_slice(i.to_string().as_bytes()),
        Object::Real(r) => out.extend_from_slice(format!("{r}").as_bytes()),
        Object::Name(n) => {
            out.push(b'/');
            out.extend_from_slice(n);
        }
        Object::String(bytes, _) => {
            out.push(b'<');
            out.extend_from_slice(hex::encode(bytes).as_bytes());
            out.push(b'>');
        }
        Object::Array(arr) => {
            out.push(b'[');
            for (idx, item) in arr.iter().enumerate() {
                if idx > 0 {
                    out.push(b' ');
                }
                write_pdf_obj(item, out);
            }
            out.push(b']');
        }
        Object::Dictionary(dict) => {
            out.extend_from_slice(b"<< ");
            for (k, v) in dict.iter() {
                out.push(b'/');
                out.extend_from_slice(k);
                out.push(b' ');
                write_pdf_obj(v, out);
                out.push(b' ');
            }
            out.extend_from_slice(b">>");
        }
        Object::Reference((n, g)) => {
            out.extend_from_slice(format!("{n} {g} R").as_bytes());
        }
        Object::Stream(_) => out.extend_from_slice(b"null"),
    }
}

fn pdf_escape(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('(', "\\(")
        .replace(')', "\\)")
}

fn parse_hex_color(hex_str: &str) -> (f32, f32, f32) {
    let clean = hex_str.trim().trim_start_matches('#');
    if clean.len() == 6 {
        if let (Ok(r), Ok(g), Ok(b)) = (
            u8::from_str_radix(&clean[0..2], 16),
            u8::from_str_radix(&clean[2..4], 16),
            u8::from_str_radix(&clean[4..6], 16),
        ) {
            return (
                (r as f32) / 255.0,
                (g as f32) / 255.0,
                (b as f32) / 255.0,
            );
        }
    }
    (0.31, 0.87, 0.64)
}

fn read_page_box(doc: &Document, page_id: ObjectId) -> [f32; 4] {
    let mut cur = Some(page_id);
    for _ in 0..8 {
        let Some(id) = cur else { break };
        let Ok(dict) = doc.get_dictionary(id) else { break };
        for key in [b"CropBox".as_slice(), b"MediaBox".as_slice()] {
            if let Ok(arr) = dict.get(key).and_then(|o| o.as_array()) {
                if arr.len() == 4 {
                    let x0 = as_f32(&arr[0]);
                    let y0 = as_f32(&arr[1]);
                    let x1 = as_f32(&arr[2]);
                    let y1 = as_f32(&arr[3]);
                    let min_x = x0.min(x1);
                    let min_y = y0.min(y1);
                    let w = (x1 - x0).abs().max(72.0);
                    let h = (y1 - y0).abs().max(72.0);
                    return [min_x, min_y, w, h];
                }
            }
        }
        cur = dict.get(b"Parent").ok().and_then(|o| o.as_reference().ok());
    }
    [0.0, 0.0, 595.28, 841.89]
}

fn read_page_dimensions(doc: &Document, page_id: ObjectId) -> (f32, f32) {
    let b = read_page_box(doc, page_id);
    (b[2], b[3])
}

fn as_f32(obj: &Object) -> f32 {
    match obj {
        Object::Integer(v) => *v as f32,
        Object::Real(v) => *v,
        _ => 0.0,
    }
}

fn attach_resources_to_page(
    doc: &mut Document,
    page_id: ObjectId,
    gs_id: ObjectId,
    font_id: ObjectId,
    img_id: Option<ObjectId>,
) -> Result<(), AppError> {
    let existing_res = doc
        .get_dictionary(page_id)
        .ok()
        .and_then(|d| d.get(b"Resources").ok())
        .cloned();

    let mut res_dict = match existing_res {
        Some(Object::Reference(res_id)) => doc
            .get_dictionary(res_id)
            .cloned()
            .unwrap_or_else(|_| lopdf::Dictionary::new()),
        Some(Object::Dictionary(d)) => d,
        _ => lopdf::Dictionary::new(),
    };

    let mut ext_gs = res_dict
        .get(b"ExtGState")
        .ok()
        .and_then(|o| o.as_dict().ok())
        .cloned()
        .unwrap_or_else(lopdf::Dictionary::new);
    ext_gs.set("GSWm", gs_id);
    res_dict.set("ExtGState", ext_gs);

    let mut fonts = res_dict
        .get(b"Font")
        .ok()
        .and_then(|o| o.as_dict().ok())
        .cloned()
        .unwrap_or_else(lopdf::Dictionary::new);
    fonts.set("FWm", font_id);
    res_dict.set("Font", fonts);

    if let Some(im) = img_id {
        let mut xobjs = res_dict
            .get(b"XObject")
            .ok()
            .and_then(|o| o.as_dict().ok())
            .cloned()
            .unwrap_or_else(lopdf::Dictionary::new);
        xobjs.set("WmImg", im);
        res_dict.set("XObject", xobjs);
    }

    let new_res_id = doc.add_object(res_dict);
    if let Ok(page_dict) = doc.get_dictionary_mut(page_id) {
        page_dict.set("Resources", new_res_id);
    }
    Ok(())
}

fn attach_content_stream(
    doc: &mut Document,
    page_id: ObjectId,
    stream_id: ObjectId,
    prepend: bool,
) -> Result<(), AppError> {
    let existing = doc
        .get_dictionary(page_id)
        .ok()
        .and_then(|d| d.get(b"Contents").ok())
        .cloned();

    let mut arr = match existing {
        Some(Object::Array(a)) => a,
        Some(other) => vec![other],
        None => Vec::new(),
    };

    if prepend {
        arr.insert(0, stream_id.into());
    } else {
        arr.push(stream_id.into());
    }

    if let Ok(page_dict) = doc.get_dictionary_mut(page_id) {
        page_dict.set("Contents", Object::Array(arr));
    }
    Ok(())
}

fn flatten_doc_in_memory(doc: &mut Document) -> usize {
    let mut count = 0_usize;
    let page_ids: Vec<ObjectId> = doc.get_pages().into_values().collect();
    for page_id in page_ids {
        if let Ok(dict) = doc.get_dictionary_mut(page_id) {
            if let Some(removed) = dict.remove(b"Annots") {
                if let Ok(arr) = removed.as_array() {
                    count += arr.len().max(1);
                } else {
                    count += 1;
                }
            }
        }
    }
    if let Ok(root_id) = doc.trailer.get(b"Root").and_then(|o| o.as_reference()) {
        if let Ok(cat) = doc.get_dictionary_mut(root_id) {
            if cat.remove(b"AcroForm").is_some() {
                count += 1;
            }
        }
    }
    count
}

fn strip_xmp_in_memory(doc: &mut Document) {
    for obj in doc.objects.values_mut() {
        if let Ok(dict) = obj.as_dict_mut() {
            dict.remove(b"Metadata");
        }
    }
    doc.trailer.remove(b"Info");
}

pub fn write_lopdf_atomically(
    doc: &mut Document,
    temp_cache_dir: &Path,
    final_path: &Path,
    prefix: &str,
) -> Result<u64, AppError> {
    std::fs::create_dir_all(temp_cache_dir)?;
    if let Some(parent) = final_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let part_path = temp_cache_dir.join(format!("{prefix}_{}.pdf.part", Uuid::new_v4()));
    doc.save(&part_path)
        .map_err(|e| AppError::EngineError(format!("Failed to write .part PDF: {e}")))?;
    let data = std::fs::read(&part_path)?;
    if !data.starts_with(b"%PDF-") {
        let _ = std::fs::remove_file(&part_path);
        return Err(AppError::EngineError(
            "Output file failed %PDF- validation".to_string(),
        ));
    }
    let len = data.len() as u64;
    if std::fs::rename(&part_path, final_path).is_err() {
        std::fs::copy(&part_path, final_path)?;
        let _ = std::fs::remove_file(&part_path);
    }
    Ok(len)
}

pub fn get_pdf_form_fields(input_path: &Path) -> Result<Vec<FormFieldSpec>, AppError> {
    if !input_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "PDF file not found: {}",
            input_path.display()
        )));
    }
    let doc = Document::load(input_path)
        .map_err(|e| AppError::EngineError(format!("Failed to load PDF forms: {e}")))?;

    let mut fields = Vec::new();
    for (page_num, page_id) in doc.get_pages() {
        let Ok(page_dict) = doc.get_dictionary(page_id) else {
            continue;
        };
        let Ok(annots) = page_dict.get(b"Annots").and_then(|o| o.as_array()) else {
            continue;
        };

        for annot_obj in annots {
            let Ok(annot_id) = annot_obj.as_reference() else {
                continue;
            };
            let Ok(dict) = doc.get_dictionary(annot_id) else {
                continue;
            };
            let is_widget = dict
                .get(b"Subtype")
                .ok()
                .and_then(|o| o.as_name().ok())
                .map(|n| n == b"Widget")
                .unwrap_or(false);
            if !is_widget {
                continue;
            }

            let ft = dict
                .get(b"FT")
                .ok()
                .and_then(|o| o.as_name().ok())
                .unwrap_or(b"Tx");
            let ff = dict
                .get(b"Ff")
                .ok()
                .and_then(|o| o.as_i64().ok())
                .unwrap_or(0);

            let field_type = match ft {
                b"Btn" => {
                    if (ff & 32768) != 0 {
                        "radio"
                    } else {
                        "checkbox"
                    }
                }
                b"Ch" => "dropdown",
                _ => "text",
            };

            let name = dict
                .get(b"T")
                .ok()
                .and_then(|o| o.as_str().ok())
                .map(|b| String::from_utf8_lossy(b).to_string())
                .unwrap_or_else(|| format!("field_{}", fields.len() + 1));

            let rect = dict
                .get(b"Rect")
                .ok()
                .and_then(|o| o.as_array().ok())
                .filter(|a| a.len() == 4)
                .map(|a| {
                    let x0 = as_f32(&a[0]);
                    let y0 = as_f32(&a[1]);
                    let x1 = as_f32(&a[2]);
                    let y1 = as_f32(&a[3]);
                    [x0, y0, (x1 - x0).abs().max(16.0), (y1 - y0).abs().max(14.0)]
                })
                .unwrap_or([72.0, 680.0, 180.0, 26.0]);

            let value = if field_type == "checkbox" {
                let checked = dict
                    .get(b"V")
                    .ok()
                    .and_then(|o| o.as_name().ok())
                    .map(|n| n == b"Yes")
                    .unwrap_or(false);
                serde_json::Value::Bool(checked)
            } else {
                let text = dict
                    .get(b"V")
                    .ok()
                    .and_then(|o| o.as_str().ok())
                    .map(|b| String::from_utf8_lossy(b).to_string())
                    .unwrap_or_default();
                serde_json::Value::String(text)
            };

            let options = dict
                .get(b"Opt")
                .ok()
                .and_then(|o| o.as_array().ok())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| item.as_str().ok())
                        .map(|b| String::from_utf8_lossy(b).to_string())
                        .collect::<Vec<_>>()
                });

            fields.push(FormFieldSpec {
                id: format!("widget-{}-{}", annot_id.0, fields.len() + 1),
                name,
                field_type: field_type.to_string(),
                page_number: page_num,
                rect,
                value,
                options,
                required: Some((ff & 2) != 0),
                read_only: Some((ff & 1) != 0),
            });
        }
    }

    Ok(fields)
}

pub fn save_pdf_form_fields(
    input_path: &Path,
    output_path: &Path,
    fields: &[FormFieldSpec],
    flatten_on_save: bool,
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
    let mut doc = Document::load(input_path)
        .map_err(|e| AppError::EngineError(format!("Failed to load PDF for form save: {e}")))?;

    let font_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
    });
    let ap_res_id = doc.add_object(dictionary! {
        "Font" => dictionary! { "Helv" => font_id },
    });

    let page_map = doc.get_pages();
    let page_count = page_map.len() as u32;
    let mut acroform_fields: Vec<Object> = Vec::new();

    for field in fields {
        let Some(&page_id) = page_map.get(&field.page_number) else {
            continue;
        };

        let [x, y, w, h] = field.rect;
        let w = w.max(18.0);
        let h = h.max(16.0);
        let val_display = match &field.value {
            serde_json::Value::Bool(b) => {
                if *b {
                    "[X]".to_string()
                } else {
                    "[ ]".to_string()
                }
            }
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        };

        if flatten_on_save {
            let ops = vec![
                Operation::new("q", vec![]),
                Operation::new("rg", vec![0.16.into(), 0.16.into(), 0.18.into()]),
                Operation::new("RG", vec![0.31.into(), 0.87.into(), 0.64.into()]),
                Operation::new("re", vec![x.into(), y.into(), w.into(), h.into()]),
                Operation::new("B", vec![]),
                Operation::new("rg", vec![0.96.into(), 0.96.into(), 0.96.into()]),
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec!["FWm".into(), 10.into()]),
                Operation::new("Td", vec![(x + 6.0).into(), (y + (h * 0.32)).into()]),
                Operation::new("Tj", vec![Object::string_literal(val_display)]),
                Operation::new("ET", vec![]),
                Operation::new("Q", vec![]),
            ];
            let bytes = Content { operations: ops }
                .encode()
                .map_err(|e| AppError::EngineError(e.to_string()))?;
            let stream_id = doc.add_object(Stream::new(dictionary! {}, bytes));
            let gs_id = doc.add_object(dictionary! { "Type" => "ExtGState", "ca" => 1.0, "CA" => 1.0 });
            attach_resources_to_page(&mut doc, page_id, gs_id, font_id, None)?;
            attach_content_stream(&mut doc, page_id, stream_id, false)?;
        } else {
            let ap_ops = vec![
                Operation::new("q", vec![]),
                Operation::new("rg", vec![0.95.into(), 0.96.into(), 0.98.into()]),
                Operation::new("re", vec![0.into(), 0.into(), w.into(), h.into()]),
                Operation::new("f", vec![]),
                Operation::new("rg", vec![0.08.into(), 0.08.into(), 0.1.into()]),
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec!["Helv".into(), 10.into()]),
                Operation::new("Td", vec![4.into(), (h * 0.3).into()]),
                Operation::new("Tj", vec![Object::string_literal(val_display.clone())]),
                Operation::new("ET", vec![]),
                Operation::new("Q", vec![]),
            ];
            let ap_bytes = Content { operations: ap_ops }
                .encode()
                .map_err(|e| AppError::EngineError(e.to_string()))?;
            let ap_stream_id = doc.add_object(Stream::new(
                dictionary! {
                    "Type" => "XObject",
                    "Subtype" => "Form",
                    "BBox" => vec![0.into(), 0.into(), w.into(), h.into()],
                    "Resources" => ap_res_id,
                },
                ap_bytes,
            ));

            let (ft_name, mut ff_val): (&str, i64) = match field.field_type.as_str() {
                "checkbox" => ("Btn", 0),
                "radio" => ("Btn", 49152),
                "dropdown" => ("Ch", 131072),
                _ => ("Tx", 0),
            };
            if field.read_only.unwrap_or(false) {
                ff_val |= 1;
            }
            if field.required.unwrap_or(false) {
                ff_val |= 2;
            }

            let mut widget_dict = dictionary! {
                "Type" => "Annot",
                "Subtype" => "Widget",
                "FT" => ft_name,
                "T" => Object::string_literal(field.name.as_str()),
                "Ff" => ff_val,
                "Rect" => vec![x.into(), y.into(), (x + w).into(), (y + h).into()],
                "P" => page_id,
                "F" => 4,
                "AP" => dictionary! { "N" => ap_stream_id },
            };

            if ft_name == "Btn" {
                let state = if field.value.as_bool().unwrap_or(false) {
                    "Yes"
                } else {
                    "Off"
                };
                widget_dict.set("V", Object::Name(state.as_bytes().to_vec()));
                widget_dict.set("AS", Object::Name(state.as_bytes().to_vec()));
            } else {
                widget_dict.set("V", Object::string_literal(val_display));
            }

            if let Some(opts) = &field.options {
                let opt_objs: Vec<Object> = opts
                    .iter()
                    .map(|o| Object::string_literal(o.as_str()))
                    .collect();
                widget_dict.set("Opt", opt_objs);
            }

            let widget_id = doc.add_object(widget_dict);
            acroform_fields.push(widget_id.into());

            let existing_annots = doc
                .get_dictionary(page_id)
                .ok()
                .and_then(|d| d.get(b"Annots").ok())
                .and_then(|o| o.as_array().ok())
                .cloned()
                .unwrap_or_default();
            let mut next_annots = existing_annots;
            next_annots.push(widget_id.into());
            if let Ok(page_dict) = doc.get_dictionary_mut(page_id) {
                page_dict.set("Annots", next_annots);
            }
        }
    }

    if flatten_on_save {
        flatten_doc_in_memory(&mut doc);
    } else if !acroform_fields.is_empty() {
        let acroform_dict = dictionary! {
            "Fields" => acroform_fields,
            "NeedAppearances" => true,
            "DR" => ap_res_id,
            "DA" => Object::string_literal("/Helv 10 Tf 0 g"),
        };
        if let Ok(root_id) = doc.trailer.get(b"Root").and_then(|o| o.as_reference()) {
            if let Ok(cat) = doc.get_dictionary_mut(root_id) {
                cat.set("AcroForm", acroform_dict);
            }
        }
    }

    doc.prune_objects();
    let output_bytes = write_lopdf_atomically(&mut doc, temp_cache_dir, output_path, "acroform")?;

    Ok(SecurityExecutionResult {
        output_path: output_path.to_string_lossy().to_string(),
        original_bytes,
        output_bytes,
        page_count,
        duration_ms: start.elapsed().as_millis() as u64,
        command_log: format!(
            "lopdf::acroform(fields={}, flatten={}) -> {}",
            fields.len(),
            flatten_on_save,
            output_path.display()
        ),
        summary: if flatten_on_save {
            format!("Rendered and flattened {} form field(s) into static PDF paths", fields.len())
        } else {
            format!("Saved {} interactive AcroForm widget(s) with /AP appearance streams", fields.len())
        },
    })
}

pub fn apply_visual_image_signature(
    input_path: &Path,
    output_path: &Path,
    image_path: &Path,
    page_number: u32,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    temp_cache_dir: &Path,
) -> Result<SecurityExecutionResult, AppError> {
    let start = Instant::now();
    if !input_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "PDF file not found: {}",
            input_path.display()
        )));
    }
    if !image_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "Signature image not found: {}",
            image_path.display()
        )));
    }

    let original_bytes = std::fs::metadata(input_path).map(|m| m.len()).unwrap_or(0);
    let img = image::open(image_path)
        .map_err(|e| AppError::InvalidInput(format!("Failed to decode signature image: {e}")))?
        .to_rgba8();
    let img_w = img.width().max(1);
    let img_h = img.height().max(1);

    let mut rgb_bytes = Vec::with_capacity((img_w * img_h * 3) as usize);
    let mut alpha_bytes = Vec::with_capacity((img_w * img_h) as usize);
    let mut has_transparency = false;
    for px in img.pixels() {
        rgb_bytes.push(px[0]);
        rgb_bytes.push(px[1]);
        rgb_bytes.push(px[2]);
        alpha_bytes.push(px[3]);
        if px[3] < 255 {
            has_transparency = true;
        }
    }

    let mut doc = Document::load(input_path)
        .map_err(|e| AppError::EngineError(format!("Failed to load PDF: {e}")))?;
    let page_map = doc.get_pages();
    let page_count = page_map.len() as u32;
    let target_page = page_number.clamp(1, page_count.max(1));
    let page_id = *page_map
        .get(&target_page)
        .ok_or_else(|| AppError::EngineError(format!("Page {target_page} not found")))?;

    let mut smask_id: Option<ObjectId> = None;
    if has_transparency {
        let mut smask_stream = Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => img_w as i64,
                "Height" => img_h as i64,
                "ColorSpace" => "DeviceGray",
                "BitsPerComponent" => 8,
            },
            alpha_bytes,
        );
        let _ = smask_stream.compress();
        smask_id = Some(doc.add_object(smask_stream));
    }

    let mut img_dict = dictionary! {
        "Type" => "XObject",
        "Subtype" => "Image",
        "Width" => img_w as i64,
        "Height" => img_h as i64,
        "ColorSpace" => "DeviceRGB",
        "BitsPerComponent" => 8,
    };
    if let Some(sid) = smask_id {
        img_dict.set("SMask", Object::Reference(sid));
    }
    let mut img_stream = Stream::new(img_dict, rgb_bytes);
    let _ = img_stream.compress();
    let img_xobj_id = doc.add_object(img_stream);

    let xobj_name = format!("XenonSig_{}", img_xobj_id.0);
    let existing_res_ref = doc
        .get_dictionary(page_id)
        .ok()
        .and_then(|d| d.get(b"Resources").ok())
        .and_then(|o| o.as_reference().ok());

    if let Some(res_id) = existing_res_ref {
        if let Ok(res_dict) = doc.get_object_mut(res_id).and_then(|o| o.as_dict_mut()) {
            let mut xobjs = match res_dict.get(b"XObject").ok() {
                Some(Object::Dictionary(d)) => d.clone(),
                _ => lopdf::Dictionary::new(),
            };
            xobjs.set(xobj_name.as_bytes(), Object::Reference(img_xobj_id));
            res_dict.set("XObject", Object::Dictionary(xobjs));
        }
    } else if let Ok(page_dict) = doc.get_object_mut(page_id).and_then(|o| o.as_dict_mut()) {
        let mut res_dict = match page_dict.get(b"Resources").ok() {
            Some(Object::Dictionary(d)) => d.clone(),
            _ => lopdf::Dictionary::new(),
        };
        let mut xobjs = match res_dict.get(b"XObject").ok() {
            Some(Object::Dictionary(d)) => d.clone(),
            _ => lopdf::Dictionary::new(),
        };
        xobjs.set(xobj_name.as_bytes(), Object::Reference(img_xobj_id));
        res_dict.set("XObject", Object::Dictionary(xobjs));
        page_dict.set("Resources", Object::Dictionary(res_dict));
    }

    let draw_w = w.max(12.0);
    let draw_h = h.max(12.0);
    let [box_x0, box_y0, page_w, page_h] = read_page_box(&doc, page_id);
    let sx = page_w / 595.28;
    let sy = page_h / 841.89;
    let px = box_x0 + x * sx;
    let py = box_y0 + y * sy;
    let pw = draw_w * sx;
    let ph = draw_h * sy;

    // Isolate existing page /Contents inside q ... Q so any unclosed CTM transform
    // (such as flipped Y or scale matrices from Chrome/Word/Skia) does not shrink or invert our stamp.
    let q_start_id = doc.add_object(Stream::new(dictionary! {}, b"q\n".to_vec()));
    let q_end_and_overlay = format!(
        "\nQ\nq\n{:.2} 0 0 {:.2} {:.2} {:.2} cm\n/{} Do\nQ\n",
        pw, ph, px, py, xobj_name
    )
    .into_bytes();
    let overlay_id = doc.add_object(Stream::new(dictionary! {}, q_end_and_overlay));
    attach_content_stream(&mut doc, page_id, q_start_id, true)?;
    attach_content_stream(&mut doc, page_id, overlay_id, false)?;

    let output_bytes = write_lopdf_atomically(&mut doc, temp_cache_dir, output_path, "vsign")?;
    Ok(SecurityExecutionResult {
        output_path: output_path.to_string_lossy().to_string(),
        original_bytes,
        output_bytes,
        page_count,
        duration_ms: start.elapsed().as_millis() as u64,
        command_log: format!(
            "lopdf::visual_signature(page={}, rect=[{:.0},{:.0},{:.0},{:.0}], alpha={}) -> {}",
            target_page,
            x,
            y,
            draw_w,
            draw_h,
            has_transparency,
            output_path.display()
        ),
        summary: format!(
            "Stamped visual image signature on page {} ({})",
            target_page,
            output_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("signed.pdf")
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engines::pdfium_engine::create_sample_multi_page_pdf;
    use tempfile::tempdir;

    #[test]
    fn estimates_size_and_sanitizes_metadata() {
        let dir = tempdir().expect("tempdir");
        let cache = dir.path().join("cache");
        let sample = dir.path().join("sample.pdf");
        create_sample_multi_page_pdf(&sample, 4).expect("sample");

        let est = estimate_compressed_size(&sample, "ebook", None, None).expect("estimate");
        assert_eq!(est.original_bytes, std::fs::metadata(&sample).unwrap().len());
        assert!(est.estimated_bytes <= est.original_bytes);

        let sanitized_out = dir.path().join("sanitized.pdf");
        let san = sanitize_pdf_metadata(&sample, &sanitized_out, &cache).expect("sanitize");
        assert!(sanitized_out.exists());
        assert!(san.output_bytes > 0);
    }

    #[test]
    fn applies_watermark_flattens_and_signs_incrementally() {
        let dir = tempdir().expect("tempdir");
        let cache = dir.path().join("cache");
        let sample = dir.path().join("contract.pdf");
        create_sample_multi_page_pdf(&sample, 3).expect("sample");

        let wm_out = dir.path().join("watermarked.pdf");
        let wm_res = apply_watermark_to_pdf(
            &sample,
            &wm_out,
            &WatermarkSpec {
                kind: "text".into(),
                text: Some("CONFIDENTIAL".into()),
                image_path: None,
                opacity: 0.35,
                rotation_deg: 45.0,
                font_size_pts: Some(42.0),
                color_hex: Some("#4EDEA3".into()),
                layer: "foreground".into(),
                target_pages: None,
            },
            true,
            true,
            &cache,
        )
        .expect("watermark");
        assert_eq!(wm_res.page_count, 3);
        assert!(wm_out.exists());

        let p12_path = dir.path().join("signer.p12");
        let ks = generate_self_signed_p12(&p12_path, "Legal Counsel", "secret123").expect("p12");
        assert!(ks.fingerprint_sha256.len() == 64);

        let signed_out = dir.path().join("signed.pdf");
        let sig_res = sign_pdf_incremental_pkcs12(
            &wm_out,
            &signed_out,
            &Pkcs12SignatureSpec {
                p12_path: p12_path.to_string_lossy().to_string(),
                passphrase: Some("secret123".into()),
                use_keyring_passphrase: None,
                reason: Some("Contract Executed".into()),
                location: Some("Jakarta".into()),
                contact_info: Some("counsel@xenon.local".into()),
                visual_stamp: None,
            },
            &cache,
        )
        .expect("sign incrementally");
        assert!(sig_res.output_bytes > sig_res.original_bytes);

        let signed_bytes = std::fs::read(&signed_out).expect("read signed");
        let signed_text = String::from_utf8_lossy(&signed_bytes);
        assert!(signed_text.contains("/SubFilter /adbe.pkcs7.detached"));
        assert!(signed_text.contains("/ByteRange [0 "));
        assert!(signed_text.contains("/SigFlags 3"));

        // Verify real RFC 5652 DER CMS SignedData can be parsed from /Contents
        let contents_marker = "/Contents <";
        let start_hex = signed_text.find(contents_marker).expect("contents marker") + contents_marker.len();
        let end_hex = start_hex + signed_text[start_hex..].find('>').expect("end contents");
        let cms_raw_bytes = hex::decode(&signed_text[start_hex..end_hex]).expect("decode hex");
        let parsed_cms = cryptographic_message_syntax::SignedData::parse_ber(&cms_raw_bytes)
            .expect("parse real DER CMS SignedData");
        assert!(parsed_cms.signers().count() >= 1);

        let parsed = Document::load(&signed_out).expect("parse incrementally signed pdf");
        assert_eq!(parsed.get_pages().len(), 3);
    }

    #[test]
    fn creates_reads_and_flattens_acroform_widgets() {
        let dir = tempdir().expect("tempdir");
        let cache = dir.path().join("cache");
        let sample = dir.path().join("form_base.pdf");
        create_sample_multi_page_pdf(&sample, 2).expect("sample");

        let fields = vec![
            FormFieldSpec {
                id: "f1".into(),
                name: "ApplicantName".into(),
                field_type: "text".into(),
                page_number: 1,
                rect: [72.0, 620.0, 220.0, 26.0],
                value: serde_json::json!("Budi Santoso"),
                options: None,
                required: Some(true),
                read_only: Some(false),
            },
            FormFieldSpec {
                id: "f2".into(),
                name: "AcceptTerms".into(),
                field_type: "checkbox".into(),
                page_number: 1,
                rect: [72.0, 580.0, 20.0, 20.0],
                value: serde_json::json!(true),
                options: None,
                required: Some(false),
                read_only: Some(false),
            },
            FormFieldSpec {
                id: "f3".into(),
                name: "Department".into(),
                field_type: "dropdown".into(),
                page_number: 1,
                rect: [72.0, 540.0, 180.0, 24.0],
                value: serde_json::json!("Legal"),
                options: Some(vec!["Legal".into(), "Finance".into(), "Engineering".into()]),
                required: Some(false),
                read_only: Some(false),
            },
        ];

        let interactive_pdf = dir.path().join("interactive_form.pdf");
        save_pdf_form_fields(&sample, &interactive_pdf, &fields, false, &cache)
            .expect("save interactive form");

        let read_back = get_pdf_form_fields(&interactive_pdf).expect("read form fields");
        assert_eq!(read_back.len(), 3);
        assert_eq!(read_back[0].name, "ApplicantName");
        assert_eq!(read_back[1].field_type, "checkbox");
        assert_eq!(read_back[2].field_type, "dropdown");

        let flattened_pdf = dir.path().join("flattened_form.pdf");
        save_pdf_form_fields(&interactive_pdf, &flattened_pdf, &fields, true, &cache)
            .expect("flatten form");
        let after_flatten = get_pdf_form_fields(&flattened_pdf).expect("read flattened");
        assert!(after_flatten.is_empty());
    }
}
