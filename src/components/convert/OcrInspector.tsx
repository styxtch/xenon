import React from "react";
import { AppIcon } from "../common/AppIcon";

export type ConvertSubTab = "pdf2img" | "img2pdf" | "ocr" | "pdfa" | "compare" | "forms";

interface OcrInspectorProps {
  mode: Extract<ConvertSubTab, "pdf2img" | "img2pdf" | "ocr" | "pdfa">;
  // PDF to Images
  imgFormat: "jpeg" | "png" | "webp" | "tiff";
  imgDpi: number;
  imgPageRange: string;
  // Images to PDF
  paperSize: "a4" | "letter" | "fit_to_image";
  orientation: "portrait" | "landscape" | "auto";
  marginPts: number;
  // OCR
  ocrEng: boolean;
  ocrInd: boolean;
  ocrDpi: 150 | 300 | 600;
  ocrToPdfA: boolean;
  // PDF/A
  pdfAConformance: "pdfa-1b" | "pdfa-2b" | "pdfa-3b";
  onChangeImgFormat: (f: "jpeg" | "png" | "webp" | "tiff") => void;
  onChangeImgDpi: (dpi: number) => void;
  onChangeImgPageRange: (r: string) => void;
  onChangePaperSize: (p: "a4" | "letter" | "fit_to_image") => void;
  onChangeOrientation: (o: "portrait" | "landscape" | "auto") => void;
  onChangeMarginPts: (m: number) => void;
  onToggleOcrEng: (v: boolean) => void;
  onToggleOcrInd: (v: boolean) => void;
  onChangeOcrDpi: (d: 150 | 300 | 600) => void;
  onToggleOcrToPdfA: (v: boolean) => void;
  onChangePdfAConformance: (c: "pdfa-1b" | "pdfa-2b" | "pdfa-3b") => void;
}

export const OcrInspector: React.FC<OcrInspectorProps> = (props) => {
  const { mode } = props;

  return (
    <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col gap-space-md">
      <div className="flex items-center gap-2">
        <AppIcon name="transform" className="w-5 h-5 text-tag-convert" />
        <h2 className="font-headline-sm text-headline-sm text-text-primary">
          {mode === "pdf2img"
            ? "PDF to Images Settings"
            : mode === "img2pdf"
              ? "Images to PDF Layout"
              : mode === "ocr"
                ? "Ghostscript OCR (pdfocr24)"
                : "ISO 19005 PDF/A Archival"}
        </h2>
      </div>

      {mode === "pdf2img" && (
        <div className="space-y-3">
          <div>
            <label className="block font-caption text-caption text-text-muted mb-1">
              Output Format
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {(["jpeg", "png", "webp", "tiff"] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => props.onChangeImgFormat(fmt)}
                  className={`py-1.5 rounded border font-mono-metric text-caption uppercase ${
                    props.imgFormat === fmt
                      ? "bg-surface-active border-tag-convert text-text-primary"
                      : "bg-surface-elevated border-border-subtle text-text-secondary"
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex justify-between font-caption text-caption mb-1">
              <span className="text-text-secondary">Render Resolution</span>
              <span className="font-mono-metric text-primary">{props.imgDpi} DPI</span>
            </div>
            <input
              type="range"
              min={72}
              max={600}
              step={24}
              value={props.imgDpi}
              onChange={(e) => props.onChangeImgDpi(Number(e.target.value))}
              className="w-full accent-tag-convert"
            />
          </div>

          <div>
            <label className="block font-caption text-caption text-text-muted mb-1">
              Page Range (blank = all pages)
            </label>
            <input
              type="text"
              value={props.imgPageRange}
              onChange={(e) => props.onChangeImgPageRange(e.target.value)}
              placeholder="e.g. 1-3, 5"
              className="w-full h-9 bg-surface-elevated border border-border-default rounded-lg px-3 font-mono-metric text-body-sm text-text-primary"
            />
          </div>
        </div>
      )}

      {mode === "img2pdf" && (
        <div className="space-y-3">
          <div>
            <label className="block font-caption text-caption text-text-muted mb-1">
              Paper Size
            </label>
            <select
              value={props.paperSize}
              onChange={(e) =>
                props.onChangePaperSize(
                  e.target.value as "a4" | "letter" | "fit_to_image"
                )
              }
              className="w-full h-9 bg-surface-elevated border border-border-default rounded-lg px-3 font-body-sm text-body-sm text-text-primary"
            >
              <option value="a4">ISO A4 (595 × 842 pts)</option>
              <option value="letter">US Letter (612 × 792 pts)</option>
              <option value="fit_to_image">Fit to Image Dimensions</option>
            </select>
          </div>

          <div>
            <label className="block font-caption text-caption text-text-muted mb-1">
              Orientation
            </label>
            <select
              value={props.orientation}
              onChange={(e) =>
                props.onChangeOrientation(
                  e.target.value as "portrait" | "landscape" | "auto"
                )
              }
              className="w-full h-9 bg-surface-elevated border border-border-default rounded-lg px-3 font-body-sm text-body-sm text-text-primary"
            >
              <option value="auto">Auto (Match Image Aspect)</option>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </div>

          <div>
            <div className="flex justify-between font-caption text-caption mb-1">
              <span className="text-text-secondary">Margin</span>
              <span className="font-mono-metric text-primary">{props.marginPts} pts</span>
            </div>
            <input
              type="range"
              min={0}
              max={72}
              step={6}
              value={props.marginPts}
              onChange={(e) => props.onChangeMarginPts(Number(e.target.value))}
              className="w-full accent-tag-convert"
            />
          </div>
        </div>
      )}

      {mode === "ocr" && (
        <div className="space-y-3">
          <label className="flex items-center justify-between p-2.5 rounded-lg bg-surface-elevated border border-border-subtle cursor-pointer">
            <span className="font-body-sm text-body-sm text-text-primary">
              English (eng.traineddata)
            </span>
            <input
              type="checkbox"
              checked={props.ocrEng}
              onChange={(e) => props.onToggleOcrEng(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
          </label>
          <label className="flex items-center justify-between p-2.5 rounded-lg bg-surface-elevated border border-border-subtle cursor-pointer">
            <span className="font-body-sm text-body-sm text-text-primary">
              Indonesian (ind.traineddata)
            </span>
            <input
              type="checkbox"
              checked={props.ocrInd}
              onChange={(e) => props.onToggleOcrInd(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
          </label>
          <div>
            <label className="block font-caption text-caption text-text-muted mb-1">
              OCR Scan DPI
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {([150, 300, 600] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => props.onChangeOcrDpi(d)}
                  className={`py-1.5 rounded border font-mono-metric text-caption ${
                    props.ocrDpi === d
                      ? "bg-surface-active border-tag-convert text-text-primary"
                      : "bg-surface-elevated border-border-subtle text-text-secondary"
                  }`}
                >
                  {d} DPI
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between p-2.5 rounded-lg bg-surface-elevated border border-border-subtle cursor-pointer">
            <span className="font-body-sm text-body-sm text-text-primary">
              Archive output as PDF/A-2b
            </span>
            <input
              type="checkbox"
              checked={props.ocrToPdfA}
              onChange={(e) => props.onToggleOcrToPdfA(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
          </label>
        </div>
      )}

      {mode === "pdfa" && (
        <div className="space-y-3">
          {(["pdfa-1b", "pdfa-2b", "pdfa-3b"] as const).map((conf) => (
            <button
              key={conf}
              type="button"
              onClick={() => props.onChangePdfAConformance(conf)}
              className={`w-full p-2.5 rounded-lg border text-left font-body-sm text-body-sm flex items-center justify-between ${
                props.pdfAConformance === conf
                  ? "bg-surface-active border-tag-convert text-text-primary font-medium"
                  : "bg-surface-elevated border-border-subtle text-text-secondary"
              }`}
            >
              <span>ISO 19005 {conf.toUpperCase()}</span>
              <span className="font-caption text-caption text-primary">sRGB.icc</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
