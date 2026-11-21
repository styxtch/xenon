use crate::engines::pdfium_ffi;
use crate::error::AppError;
use image::{Rgb, RgbImage};
use lopdf::Document;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextChangeChunk {
    pub change_type: String, // "insert" | "delete" | "equal"
    pub text: String,
    pub bounds: Option<[f32; 4]>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageDiffSummary {
    pub page_number: u32,
    pub pixel_difference_ratio: f64,
    pub heatmap_data_url: String,
    pub text_changes: Vec<TextChangeChunk>,
}

pub fn compare_pdf_documents(
    left_path: &Path,
    right_path: &Path,
    dpi: u32,
) -> Result<Vec<PageDiffSummary>, AppError> {
    if !left_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "Left PDF not found: {}",
            left_path.display()
        )));
    }
    if !right_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "Right PDF not found: {}",
            right_path.display()
        )));
    }

    let left_doc = Document::load(left_path)
        .map_err(|e| AppError::EngineError(format!("Failed to load left PDF: {e}")))?;
    let right_doc = Document::load(right_path)
        .map_err(|e| AppError::EngineError(format!("Failed to load right PDF: {e}")))?;

    let left_pages = left_doc.get_pages().len() as u32;
    let right_pages = right_doc.get_pages().len() as u32;
    let total_pages = left_pages.max(right_pages).max(1);
    let render_width = ((480_u32 * dpi.clamp(72, 300)) / 150).clamp(320, 960);

    let mut left_renders: BTreeMap<u32, RgbImage> = BTreeMap::new();
    let mut right_renders: BTreeMap<u32, RgbImage> = BTreeMap::new();
    if pdfium_ffi::is_pdfium_available(None) {
        for page_num in 1..=left_pages {
            if let Ok(img) =
                pdfium_ffi::render_pdf_page_rgb(None, left_path, None, page_num, render_width, 0)
            {
                left_renders.insert(page_num, img);
            }
        }
        for page_num in 1..=right_pages {
            if let Ok(img) =
                pdfium_ffi::render_pdf_page_rgb(None, right_path, None, page_num, render_width, 0)
            {
                right_renders.insert(page_num, img);
            }
        }
    }

    let mut summaries = Vec::with_capacity(total_pages as usize);

    for page_num in 1..=total_pages {
        let left_text = if page_num <= left_pages {
            left_doc.extract_text(&[page_num]).unwrap_or_default()
        } else {
            String::new()
        };
        let right_text = if page_num <= right_pages {
            right_doc.extract_text(&[page_num]).unwrap_or_default()
        } else {
            String::new()
        };

        let left_words: Vec<&str> = left_text.split_whitespace().take(350).collect();
        let right_words: Vec<&str> = right_text.split_whitespace().take(350).collect();

        let text_changes = compute_word_diff(&left_words, &right_words);

        let total_tokens = left_words.len().max(right_words.len()).max(1);
        let changed_tokens = text_changes
            .iter()
            .filter(|c| c.change_type != "equal")
            .map(|c| c.text.split_whitespace().count())
            .sum::<usize>();

        let text_diff_ratio = if page_num > left_pages || page_num > right_pages {
            1.0
        } else if left_text == right_text {
            0.0
        } else {
            ((changed_tokens as f64) / (total_tokens as f64)).clamp(0.02, 1.0)
        };

        let (pixel_difference_ratio, heatmap_data_url) = match build_visual_diff_heatmap(
            left_renders.get(&page_num),
            right_renders.get(&page_num),
        ) {
            Some((visual_ratio, data_url)) => {
                let combined = if page_num > left_pages || page_num > right_pages {
                    1.0
                } else {
                    visual_ratio.max(text_diff_ratio)
                };
                (combined, data_url)
            }
            None => (
                text_diff_ratio,
                render_diff_heatmap_svg(page_num, text_diff_ratio, &text_changes),
            ),
        };

        summaries.push(PageDiffSummary {
            page_number: page_num,
            pixel_difference_ratio: (pixel_difference_ratio * 1000.0).round() / 1000.0,
            heatmap_data_url,
            text_changes,
        });
    }

    Ok(summaries)
}

fn build_visual_diff_heatmap(
    left: Option<&RgbImage>,
    right: Option<&RgbImage>,
) -> Option<(f64, String)> {
    match (left, right) {
        (Some(l), Some(r)) => {
            let w = l.width().max(r.width());
            let h = l.height().max(r.height());
            let mut out = RgbImage::new(w, h);
            let mut diff_pixels = 0_u64;
            let white = Rgb([255, 255, 255]);

            for y in 0..h {
                for x in 0..w {
                    let lp = if x < l.width() && y < l.height() {
                        *l.get_pixel(x, y)
                    } else {
                        white
                    };
                    let rp = if x < r.width() && y < r.height() {
                        *r.get_pixel(x, y)
                    } else {
                        white
                    };
                    let max_delta = lp[0]
                        .abs_diff(rp[0])
                        .max(lp[1].abs_diff(rp[1]))
                        .max(lp[2].abs_diff(rp[2]));
                    if max_delta > 24 {
                        diff_pixels += 1;
                        out.put_pixel(
                            x,
                            y,
                            Rgb([
                                ((rp[0] as u16 + 478) / 3) as u8,
                                (rp[1] as u16 / 3) as u8,
                                (rp[2] as u16 / 3) as u8,
                            ]),
                        );
                    } else {
                        out.put_pixel(
                            x,
                            y,
                            Rgb([
                                ((lp[0] as u16 + rp[0] as u16) / 2) as u8,
                                ((lp[1] as u16 + rp[1] as u16) / 2) as u8,
                                ((lp[2] as u16 + rp[2] as u16) / 2) as u8,
                            ]),
                        );
                    }
                }
            }

            let total_pixels = (w as u64).saturating_mul(h as u64).max(1);
            let ratio = (diff_pixels as f64) / (total_pixels as f64);
            let jpeg = pdfium_ffi::encode_rgb_jpeg(&out, 85).ok()?;
            Some((
                ratio,
                format!("data:image/jpeg;base64,{}", pdfium_ffi::encode_base64(&jpeg)),
            ))
        }
        (Some(only), None) | (None, Some(only)) => {
            let (w, h) = (only.width(), only.height());
            let mut out = RgbImage::new(w, h);
            for y in 0..h {
                for x in 0..w {
                    let p = *only.get_pixel(x, y);
                    out.put_pixel(
                        x,
                        y,
                        Rgb([
                            ((p[0] as u16 + 478) / 3) as u8,
                            (p[1] as u16 / 3) as u8,
                            (p[2] as u16 / 3) as u8,
                        ]),
                    );
                }
            }
            let jpeg = pdfium_ffi::encode_rgb_jpeg(&out, 85).ok()?;
            Some((
                1.0,
                format!("data:image/jpeg;base64,{}", pdfium_ffi::encode_base64(&jpeg)),
            ))
        }
        (None, None) => None,
    }
}

fn compute_word_diff(left: &[&str], right: &[&str]) -> Vec<TextChangeChunk> {
    let m = left.len();
    let n = right.len();
    let mut dp = vec![vec![0_usize; n + 1]; m + 1];

    for i in (0..m).rev() {
        for j in (0..n).rev() {
            dp[i][j] = if left[i] == right[j] {
                1 + dp[i + 1][j + 1]
            } else {
                dp[i + 1][j].max(dp[i][j + 1])
            };
        }
    }

    let mut raw: Vec<(&str, &str)> = Vec::new();
    let (mut i, mut j) = (0, 0);
    while i < m && j < n {
        if left[i] == right[j] {
            raw.push(("equal", left[i]));
            i += 1;
            j += 1;
        } else if dp[i + 1][j] >= dp[i][j + 1] {
            raw.push(("delete", left[i]));
            i += 1;
        } else {
            raw.push(("insert", right[j]));
            j += 1;
        }
    }
    while i < m {
        raw.push(("delete", left[i]));
        i += 1;
    }
    while j < n {
        raw.push(("insert", right[j]));
        j += 1;
    }

    let mut grouped: Vec<TextChangeChunk> = Vec::new();
    for (idx, (kind, word)) in raw.into_iter().enumerate() {
        if let Some(last) = grouped.last_mut() {
            if last.change_type == kind {
                last.text.push(' ');
                last.text.push_str(word);
                continue;
            }
        }
        let y = 40.0 + ((idx as f32) % 24.0) * 28.0;
        grouped.push(TextChangeChunk {
            change_type: kind.to_string(),
            text: word.to_string(),
            bounds: Some([48.0, y, 480.0, 20.0]),
        });
    }

    grouped
}

fn render_diff_heatmap_svg(
    page_num: u32,
    diff_ratio: f64,
    changes: &[TextChangeChunk],
) -> String {
    let mut markers = String::new();
    for (idx, chunk) in changes
        .iter()
        .filter(|c| c.change_type != "equal")
        .take(18)
        .enumerate()
    {
        let y = 64 + (idx * 18);
        let fill = if chunk.change_type == "insert" {
            "#22C55E"
        } else {
            "#EF4444"
        };
        let label = xml_escape(&chunk.text);
        markers.push_str(&format!(
            r##"<rect x="20" y="{y}" width="280" height="14" rx="2" fill="{fill}" opacity="0.22"/><text x="26" y="{ty}" fill="{fill}" font-family="Inter, sans-serif" font-size="9">{kind}: {label}</text>"##,
            ty = y + 10,
            kind = chunk.change_type.to_uppercase(),
        ));
    }

    if markers.is_empty() {
        markers = r##"<text x="24" y="140" fill="#4EDEA3" font-family="Inter, sans-serif" font-size="11">100% Visual &amp; Text Match (0 deltas)</text>"##.to_string();
    }

    let pct = (diff_ratio * 100.0).round();
    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="320" height="452" viewBox="0 0 320 452"><rect width="320" height="452" fill="#1B1B1D"/><rect x="10" y="10" width="300" height="432" rx="6" fill="#212123" stroke="#343436"/><text x="20" y="34" fill="#F5F5F5" font-family="Inter, sans-serif" font-size="11" font-weight="600">Page {page_num} Diff Heatmap ({pct:.0}% delta)</text>{markers}</svg>"##
    );

    format!("data:image/svg+xml;utf8,{}", url_encode_svg(&svg))
}

fn xml_escape(s: &str) -> String {
    s.chars()
        .take(36)
        .collect::<String>()
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn url_encode_svg(s: &str) -> String {
    s.replace('#', "%23")
        .replace('<', "%3C")
        .replace('>', "%3E")
        .replace('"', "%22")
        .replace('\n', " ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::content::{Content, Operation};
    use lopdf::{dictionary, Object, Stream};
    use tempfile::tempdir;

    fn make_text_pdf(path: &Path, line: &str) {
        let mut doc = Document::with_version("1.7");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
        });
        let res_id = doc.add_object(dictionary! {
            "Font" => dictionary! { "F1" => font_id },
        });
        let content = Content {
            operations: vec![
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec!["F1".into(), 12.into()]),
                Operation::new("Td", vec![48.into(), 720.into()]),
                Operation::new("Tj", vec![Object::string_literal(line)]),
                Operation::new("ET", vec![]),
            ],
        };
        let cid = doc.add_object(Stream::new(dictionary! {}, content.encode().unwrap()));
        let pid = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            "Resources" => res_id,
            "Contents" => cid,
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => vec![pid.into()],
                "Count" => 1,
            }),
        );
        let root = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", root);
        doc.save(path).unwrap();
    }

    #[test]
    fn compares_two_pdfs_and_detects_text_and_visual_deltas() {
        let dir = tempdir().expect("tempdir");
        let left = dir.path().join("v1.pdf");
        let right = dir.path().join("v2.pdf");
        make_text_pdf(&left, "Contract payment due within 30 days");
        make_text_pdf(&right, "Contract payment due within 15 days immediately");

        let diffs = compare_pdf_documents(&left, &right, 150).expect("compare");
        assert_eq!(diffs.len(), 1);
        assert!(diffs[0].pixel_difference_ratio > 0.0);
        assert!(diffs[0].text_changes.iter().any(|c| c.change_type == "delete"));
        assert!(diffs[0].text_changes.iter().any(|c| c.change_type == "insert"));
        if pdfium_ffi::is_pdfium_available(None) {
            assert!(diffs[0].heatmap_data_url.starts_with("data:image/jpeg;base64,"));
        } else {
            assert!(diffs[0].heatmap_data_url.starts_with("data:image/svg+xml"));
        }
    }
}
