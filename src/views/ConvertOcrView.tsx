import React, { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { AppIcon } from "../components/common/AppIcon";
import { DropZoneWell } from "../components/common/DropZoneWell";
import { InlineImportProgress } from "../components/common/InlineImportProgress";
import {
  OutputTargetCard,
  deriveDefaultFilename,
  resolveOutputPath,
} from "../components/common/OutputTargetCard";
import { FormEditorCanvas } from "../components/convert/FormEditorCanvas";
import {
  OcrInspector,
  type ConvertSubTab,
} from "../components/convert/OcrInspector";
import { PdfCompareViewer } from "../components/convert/PdfCompareViewer";
import { runWithMinimumProgress } from "../lib/progressTiming";
import { getXenonTileUrl, isTauriRuntime, tauriClient } from "../lib/tauriClient";
import { useImportProgressStore } from "../stores/importProgressStore";
import { useProcessModalStore } from "../stores/processModalStore";
import {
  isImagePath,
  isPdfPath,
  useDragDropStore,
} from "../stores/dragDropStore";
import { useHistoryStore } from "../stores/historyStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useTelemetryStore } from "../stores/telemetryStore";
import { toolFileSig, useToolFilesStore } from "../stores/toolFilesStore";

interface ConvertOcrViewProps {
  onOpenFiles: () => void;
}
const EMPTY_PATHS: string[] = [];

export const ConvertOcrView: React.FC<ConvertOcrViewProps> = ({
  onOpenFiles,
}) => {
  const [subTab, setSubTab] = useState<ConvertSubTab>("ocr");
  const [outputFilename, setOutputFilename] = useState("");
  const [previewDocId, setPreviewDocId] = useState("");

  // PDF to Images
  const [imgFormat, setImgFormat] = useState<"jpeg" | "png" | "webp" | "tiff">("png");
  const [imgDpi, setImgDpi] = useState(150);
  const [imgPageRange, setImgPageRange] = useState("");

  // Images to PDF
  const [paperSize, setPaperSize] = useState<"a4" | "letter" | "fit_to_image">("a4");
  const [orientation, setOrientation] = useState<"portrait" | "landscape" | "auto">("auto");
  const [marginPts, setMarginPts] = useState(24);

  // OCR & PDF/A
  const [ocrEng, setOcrEng] = useState(true);
  const [ocrInd, setOcrInd] = useState(true);
  const [ocrDpi, setOcrDpi] = useState<150 | 300 | 600>(300);
  const [ocrToPdfA, setOcrToPdfA] = useState(true);
  const [pdfAConformance, setPdfAConformance] = useState<
    "pdfa-1b" | "pdfa-2b" | "pdfa-3b"
  >("pdfa-2b");

  const [isExecuting, setIsExecuting] = useState(false);
  const [processingPercent, setProcessingPercent] = useState(0);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewPageCount, setPreviewPageCount] = useState(0);
  const [previewPage, setPreviewPage] = useState(1);

  const pdfToolKey = `convert:${subTab}`;
  const imgToolKey = "convert:img2pdf";
  const setActiveToolKey = useToolFilesStore((s) => s.setActiveToolKey);
  const convertPdfPath = useToolFilesStore(
    (s) => (s.filesByTool[pdfToolKey] ?? EMPTY_PATHS)[0] ?? ""
  );
  const convertImagePaths = useToolFilesStore(
    (s) => s.filesByTool[imgToolKey] ?? EMPTY_PATHS
  );
  const setToolFiles = useToolFilesStore((s) => s.setToolFiles);
  const addToolFiles = useToolFilesStore((s) => s.addToolFiles);
  const removeToolFile = useToolFilesStore((s) => s.removeToolFile);
  const clearToolFiles = useToolFilesStore((s) => s.clearToolFiles);
  const markToolFileImported = useToolFilesStore((s) => s.markToolFileImported);
  const compareLeftPath = useToolFilesStore((s) => s.compareLeftPath);
  const compareRightPath = useToolFilesStore((s) => s.compareRightPath);
  const clearComparePaths = useToolFilesStore((s) => s.clearComparePaths);

  const setConvertPdfPath = (path: string) => setToolFiles(pdfToolKey, [path]);
  const clearConvertPdfPath = () => clearToolFiles(pdfToolKey);
  const addConvertImagePaths = (paths: string[]) => addToolFiles(imgToolKey, paths);
  const removeConvertImagePath = (path: string) => removeToolFile(imgToolKey, path);
  const clearConvertImagePaths = () => clearToolFiles(imgToolKey);
  const settings = useSettingsStore((s) => s.settings);

  useEffect(() => {
    setActiveToolKey(pdfToolKey);
    setResultMessage(null);
    setErrorMessage(null);
  }, [pdfToolKey, setActiveToolKey]);

  const outputDir = settings.primaryDestinationFolder || "Exports";
  const hasActiveInput =
    subTab === "img2pdf"
      ? convertImagePaths.length > 0
      : Boolean(convertPdfPath);

  useEffect(() => {
    if (!convertPdfPath) {
      setPreviewDocId("");
      setPreviewPageCount(0);
      setPreviewPage(1);
      return;
    }
    if (!isTauriRuntime()) {
      setPreviewDocId("");
      setPreviewPageCount(0);
      setPreviewPage(1);
      return;
    }
    const sig = toolFileSig(pdfToolKey, convertPdfPath);
    const cached = useToolFilesStore.getState().previewMetaBySig[sig];
    if (cached) {
      setPreviewDocId(cached.docId);
      setPreviewPageCount(cached.pageCount);
      setPreviewPage(1);
      return;
    }
    let cancelled = false;
    const fileName = convertPdfPath.split(/[\\/]/).pop() ?? "Document.pdf";
    useImportProgressStore
      .getState()
      .startImport("Loading document preview...", fileName, 1);
    void (async () => {
      try {
        const dto = await tauriClient.openPdf(convertPdfPath);
        await useImportProgressStore.getState().finishImportAsync();
        if (!cancelled) {
          markToolFileImported(pdfToolKey, convertPdfPath, {
            docId: dto.docId,
            pageCount: dto.pageCount,
          });
          setPreviewDocId(dto.docId);
          setPreviewPageCount(dto.pageCount);
          setPreviewPage(1);
        }
      } catch {
        useImportProgressStore.getState().cancelImport();
        if (!cancelled) {
          setPreviewDocId("");
          setPreviewPageCount(0);
          setPreviewPage(1);
        }
      }
    })();
    return () => {
      cancelled = true;
      useImportProgressStore.getState().cancelImport();
    };
  }, [convertPdfPath, pdfToolKey, markToolFileImported]);

  useEffect(() => {
    if (subTab === "pdf2img") {
      const baseStem = convertPdfPath
        ? convertPdfPath.split(/[\\/]/).pop()?.replace(/\.pdf$/i, "") ?? "page"
        : "";
      setOutputFilename(baseStem);
    } else if (subTab === "img2pdf") {
      setOutputFilename(
        deriveDefaultFilename(convertImagePaths[0] ?? "", "Images", "images")
      );
    } else if (subTab === "ocr") {
      setOutputFilename(
        deriveDefaultFilename(convertPdfPath, "Document", "ocr")
      );
    } else if (subTab === "pdfa") {
      setOutputFilename(
        deriveDefaultFilename(convertPdfPath, "Document", pdfAConformance)
      );
    } else if (subTab === "forms") {
      setOutputFilename(
        deriveDefaultFilename(convertPdfPath, "AcroForm", "acroform")
      );
    } else {
      setOutputFilename("");
    }
  }, [convertPdfPath, convertImagePaths, subTab, pdfAConformance]);

  useEffect(() => {
    if (subTab === "compare") return;
    const hint =
      subTab === "img2pdf"
        ? "Drop image file(s) to queue for Images to PDF"
        : "Drop PDF or image files into Convert & OCR";

    return useDragDropStore.getState().registerHandler((droppedPaths) => {
      const pdfs = droppedPaths.filter(isPdfPath);
      const images = droppedPaths.filter(isImagePath);

      if (subTab === "img2pdf") {
        if (images.length > 0) {
          addConvertImagePaths(images);
          setResultMessage(null);
          setErrorMessage(null);
        }
        return;
      }

      if (pdfs.length > 0) {
        setConvertPdfPath(pdfs[0]);
        setResultMessage(null);
        setErrorMessage(null);
      } else if (images.length > 0) {
        setSubTab("img2pdf");
        addConvertImagePaths(images);
        setResultMessage(null);
        setErrorMessage(null);
      }
    }, hint);
  }, [subTab, setConvertPdfPath, addConvertImagePaths]);

  const handlePickInputs = async () => {
    if (!isTauriRuntime()) {
      onOpenFiles();
      return;
    }
    if (subTab === "img2pdf") {
      const picked = await open({
        multiple: true,
        filters: [
          {
            name: "Images",
            extensions: ["jpg", "jpeg", "png", "webp", "tiff", "tif", "bmp"],
          },
        ],
      });
      const list = Array.isArray(picked) ? picked : picked ? [picked] : [];
      if (list.length > 0) addConvertImagePaths(list);
    } else {
      const picked = await open({
        multiple: false,
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      });
      if (typeof picked === "string") setConvertPdfPath(picked);
    }
    setResultMessage(null);
    setErrorMessage(null);
  };

  const handleClearInput = () => {
    if (subTab === "img2pdf") {
      clearConvertImagePaths();
    } else {
      clearConvertPdfPath();
    }
    setResultMessage(null);
    setErrorMessage(null);
  };

  const refreshMetricsAndLogs = async () => {
    await useHistoryStore.getState().fetchDashboardMetrics();
    await useTelemetryStore.getState().loadLogs();
  };

  const handleExecuteConversion = async () => {
    if (subTab === "compare" || subTab === "forms" || !hasActiveInput) return;
    const modalStore = useProcessModalStore.getState();

    const targetOutPath =
      subTab === "img2pdf"
        ? resolveOutputPath(
            outputDir,
            outputFilename,
            deriveDefaultFilename(
              convertImagePaths[0] ?? "",
              "Images",
              "images"
            ) || "Images_to_PDF.pdf"
          )
        : subTab === "ocr"
          ? resolveOutputPath(
              outputDir,
              outputFilename,
              deriveDefaultFilename(convertPdfPath, "Document", "ocr") ||
                "Document_ocr.pdf"
            )
          : subTab === "pdfa"
            ? resolveOutputPath(
                outputDir,
                outputFilename,
                deriveDefaultFilename(convertPdfPath, "Document", pdfAConformance) ||
                  `Document_${pdfAConformance}.pdf`
              )
            : null;

    let finalTargetOutPath = targetOutPath;
    let effectivePdf2ImgPrefix = outputFilename.trim() || undefined;

    if (subTab === "pdf2img") {
      const sep = outputDir.includes("\\") ? "\\" : "/";
      const cleanPrefix = (
        outputFilename.trim() ||
        convertPdfPath.split(/[\\/]/).pop()?.replace(/\.pdf$/i, "") ||
        "page"
      ).replace(/\.(png|jpe?g|webp|tiff?|pdf)$/i, "");
      const ext = imgFormat === "jpeg" ? "jpg" : imgFormat;
      const probePath = `${outputDir}${sep}${cleanPrefix}_p001.${ext}`;
      const resolved = await modalStore.confirmOrCopyPaths([probePath], "PDF to Images");
      if (!resolved) return;
      const chosenName = resolved[0].split(/[\\/]/).pop() || "";
      effectivePdf2ImgPrefix =
        chosenName.replace(new RegExp(`_p001\\.${ext}$`, "i"), "") || cleanPrefix;
    } else if (targetOutPath) {
      const label =
        subTab === "img2pdf"
          ? "Images to PDF"
          : subTab === "ocr"
            ? "OCR Searchable PDF"
            : "PDF/A Archival Conversion";
      const resolved = await modalStore.confirmOrCopyPaths([targetOutPath], label);
      if (!resolved) return;
      finalTargetOutPath = resolved[0];
    }

    setIsExecuting(true);
    setProcessingPercent(8);
    setResultMessage(null);
    setErrorMessage(null);

    try {
      if (subTab === "pdf2img") {
        const files = await runWithMinimumProgress(
          () =>
            tauriClient.pdfToImages({
              inputPath: convertPdfPath,
              format: imgFormat,
              dpi: imgDpi,
              pageRange: imgPageRange.trim() || undefined,
              outputDir,
              filenamePrefix: effectivePdf2ImgPrefix,
            }),
          setProcessingPercent
        );
        setResultMessage(
          `Exported ${files.length} ${imgFormat.toUpperCase()} image(s) @ ${imgDpi} DPI to ${outputDir}`
        );
        modalStore.showCompletion({
          title: "PDF to Images Completed",
          summary: `Exported ${files.length} ${imgFormat.toUpperCase()} image(s) @ ${imgDpi} DPI.`,
          outputPaths: files,
        });
      } else if (subTab === "img2pdf" && finalTargetOutPath) {
        const outPath = finalTargetOutPath;
        const res = await runWithMinimumProgress(
          () =>
            tauriClient.imagesToPdf({
              imagePaths: convertImagePaths,
              paperSize,
              orientation,
              marginPts,
              outputPath: outPath,
            }),
          setProcessingPercent
        );
        setResultMessage(`${res.summary} -> ${res.outputPath}`);
        modalStore.showCompletion({
          title: "Images to PDF Completed",
          summary: res.summary,
          outputPaths: [res.outputPath],
          originalBytes: res.originalBytes,
          outputBytes: res.outputBytes,
          durationMs: res.durationMs,
        });
      } else if (subTab === "ocr" && finalTargetOutPath) {
        const outPath = finalTargetOutPath;
        const langs: ("eng" | "ind")[] = [];
        if (ocrEng) langs.push("eng");
        if (ocrInd) langs.push("ind");
        const res = await runWithMinimumProgress(
          () =>
            tauriClient.ocrPdf({
              inputPath: convertPdfPath,
              languages: langs.length > 0 ? langs : ["eng"],
              dpi: ocrDpi,
              outputToPdfA: ocrToPdfA,
              pdfAConformance: ocrToPdfA ? pdfAConformance : undefined,
              outputPath: outPath,
            }),
          setProcessingPercent
        );
        setResultMessage(`${res.summary} -> ${res.outputPath}`);
        modalStore.showCompletion({
          title: "OCR Processing Completed",
          summary: res.summary,
          outputPaths: [res.outputPath],
          originalBytes: res.originalBytes,
          outputBytes: res.outputBytes,
          durationMs: res.durationMs,
        });
      } else if (subTab === "pdfa" && finalTargetOutPath) {
        const outPath = finalTargetOutPath;
        const res = await runWithMinimumProgress(
          () =>
            tauriClient.convertPdfA(
              convertPdfPath,
              pdfAConformance,
              outPath
            ),
          setProcessingPercent
        );
        setResultMessage(`${res.summary} -> ${res.outputPath}`);
        modalStore.showCompletion({
          title: "PDF/A Archival Conversion Completed",
          summary: res.summary,
          outputPaths: [res.outputPath],
          originalBytes: res.originalBytes,
          outputBytes: res.outputBytes,
          durationMs: res.durationMs,
        });
      }
      await refreshMetricsAndLogs();
    } catch (err) {
      setErrorMessage(String((err as { message?: string })?.message ?? err));
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col gap-space-md">
        <div className="flex flex-wrap items-center justify-between gap-space-md">
          <div className="flex items-center gap-space-md">
            <div className="w-10 h-10 rounded-lg bg-tag-convert/15 border border-tag-convert/30 flex items-center justify-center text-tag-convert">
              <AppIcon name="transform" className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-headline-md text-headline-md text-text-primary">
                  Convert, OCR, Compare &amp; AcroForm Suite
                </h1>
                <span className="font-caption text-caption px-2 py-0.5 rounded-full bg-tag-convert/15 text-tag-convert border border-tag-convert/30">
                  PDFium + Ghostscript pdfocr24 + tessdata
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-text-muted mt-0.5">
                {subTab === "img2pdf"
                  ? "Selected Images: "
                  : subTab === "compare"
                    ? "Compare Pair: "
                    : "Active PDF: "}
                <span className="font-mono-metric text-text-primary">
                  {subTab === "img2pdf"
                    ? convertImagePaths.length > 0
                      ? `${convertImagePaths.length} image(s) queued`
                      : "No images selected"
                    : subTab === "compare"
                      ? compareLeftPath || compareRightPath
                        ? `${compareLeftPath ? compareLeftPath.split(/[\\/]/).pop() : "—"} vs ${compareRightPath ? compareRightPath.split(/[\\/]/).pop() : "—"}`
                        : "No PDFs selected"
                      : convertPdfPath
                        ? convertPdfPath.split(/[\\/]/).pop()
                        : "No PDF selected"}
                </span>
              </p>
            </div>
          </div>

          {subTab === "compare" ? (
            (compareLeftPath || compareRightPath) && (
              <button
                type="button"
                onClick={clearComparePaths}
                className="px-3 py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default hover:border-status-danger/50 text-text-secondary hover:text-error font-body-sm text-body-sm flex items-center gap-1.5 transition-colors"
              >
                <AppIcon name="close" className="w-4 h-4" />
                <span>Remove Files</span>
              </button>
            )
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              {hasActiveInput && (
                <button
                  type="button"
                  onClick={handleClearInput}
                  className="px-3 py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default hover:border-status-danger/50 text-text-secondary hover:text-error font-body-sm text-body-sm flex items-center gap-1.5 transition-colors"
                >
                  <AppIcon name="close" className="w-4 h-4" />
                  <span>{subTab === "img2pdf" ? "Clear All" : "Remove File"}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => void handlePickInputs()}
                className="px-3.5 py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default text-text-primary font-body-sm text-body-sm flex items-center gap-1.5"
              >
                <AppIcon name="file_open" className="w-4 h-4 text-primary" />
                <span>{subTab === "img2pdf" ? "Select Images" : "Select PDF"}</span>
              </button>
            </div>
          )}
        </div>

        <div className="inline-flex p-1 bg-surface-elevated rounded-lg border border-border-subtle self-start flex-wrap">
          {(
            [
              { id: "pdf2img", label: "PDF to Images" },
              { id: "img2pdf", label: "Images to PDF" },
              { id: "ocr", label: "OCR Searchable PDF" },
              { id: "pdfa", label: "PDF/A Archival" },
              { id: "compare", label: "Compare PDFs" },
              { id: "forms", label: "Form Editor" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setSubTab(tab.id);
                setResultMessage(null);
                setErrorMessage(null);
              }}
              className={`px-3 py-1.5 rounded-md font-body-sm text-body-sm transition-colors ${
                subTab === tab.id
                  ? "bg-surface-active text-text-primary font-medium"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {resultMessage && (
        <div className="p-3 rounded-xl bg-status-success/10 border border-status-success/30 font-body-sm text-body-sm text-status-success break-words">
          {resultMessage}
        </div>
      )}
      {errorMessage && (
        <div className="p-3 rounded-xl bg-error-container/40 border border-status-danger/40 font-body-sm text-body-sm text-error break-words">
          {errorMessage}
        </div>
      )}

      {subTab === "compare" ? (
        <PdfCompareViewer />
      ) : subTab === "forms" ? (
        <FormEditorCanvas
          docId={previewDocId}
          pageCount={previewPageCount}
          inputPath={convertPdfPath}
          outputDir={outputDir}
          outputFilename={outputFilename}
          onChangeOutputFilename={setOutputFilename}
          onSaved={(msg) => {
            setResultMessage(msg);
            void refreshMetricsAndLogs();
          }}
        />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-lg items-start">
          <div className="xl:col-span-8 bg-surface-card border border-border-default rounded-xl p-space-xl flex flex-col gap-space-md">
            {(subTab === "img2pdf" || !convertPdfPath) && (
              <DropZoneWell
                title={
                  subTab === "img2pdf"
                    ? "Drag & drop JPG, PNG, WebP, TIFF, or BMP images, or click to select"
                    : "Drag & drop a PDF file here, or click to select for conversion or OCR"
                }
                subtitle="Files added here stay independent from Organize PDF Workspace."
                onSelectFiles={() => void handlePickInputs()}
                accentClass="text-tag-convert"
              />
            )}

            {subTab !== "img2pdf" && <InlineImportProgress />}

            {subTab === "img2pdf" ? (
              convertImagePaths.length > 0 ? (
                <div className="space-y-2">
                  <span className="font-caption text-caption text-text-muted uppercase tracking-wider">
                    Selected Images ({convertImagePaths.length})
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {convertImagePaths.map((p) => (
                      <div
                        key={p}
                        className="p-2.5 rounded-lg bg-surface-elevated border border-border-subtle flex items-center justify-between gap-2.5"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {isTauriRuntime() && (
                            <img
                              src={convertFileSrc(p)}
                              alt={p}
                              className="w-10 h-10 rounded object-cover border border-border-subtle shrink-0 bg-bg-canvas"
                            />
                          )}
                          <span className="font-mono-metric text-caption text-text-primary truncate">
                            {p.split(/[\\/]/).pop() ?? p}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeConvertImagePath(p)}
                          title="Remove image"
                          className="p-1 rounded hover:bg-surface-card text-text-muted hover:text-error shrink-0 transition-colors"
                        >
                          <AppIcon name="close" className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null
            ) : convertPdfPath ? (
              <div className="flex flex-col gap-3">
                <div className="p-3 rounded-lg bg-surface-elevated border border-border-subtle flex items-center justify-between gap-2">
                  <span className="font-mono-metric text-caption text-text-secondary truncate">
                    Target Path: {convertPdfPath}
                  </span>
                  <button
                    type="button"
                    onClick={clearConvertPdfPath}
                    title="Remove PDF"
                    className="p-1 rounded hover:bg-surface-card text-text-muted hover:text-error shrink-0 transition-colors"
                  >
                    <AppIcon name="close" className="w-4 h-4" />
                  </button>
                </div>

                {previewDocId && (
                  <div className="rounded-xl border border-border-subtle bg-surface-elevated/60 p-3 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-caption text-caption text-text-muted uppercase tracking-wider">
                        Document Preview
                      </span>
                      {previewPageCount > 0 && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={previewPage <= 1}
                            onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                            className="px-2 py-0.5 rounded bg-surface-card border border-border-subtle text-text-secondary hover:text-text-primary disabled:opacity-40 text-xs"
                          >
                            &lt;
                          </button>
                          <span className="font-mono-metric text-caption text-text-secondary px-1">
                            Page {previewPage} / {previewPageCount}
                          </span>
                          <button
                            type="button"
                            disabled={previewPage >= previewPageCount}
                            onClick={() =>
                              setPreviewPage((p) => Math.min(previewPageCount, p + 1))
                            }
                            className="px-2 py-0.5 rounded bg-surface-card border border-border-subtle text-text-secondary hover:text-text-primary disabled:opacity-40 text-xs"
                          >
                            &gt;
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="w-full max-h-[380px] overflow-auto rounded-lg bg-bg-canvas border border-border-subtle flex items-center justify-center p-3">
                      <img
                        src={getXenonTileUrl(previewDocId, previewPage, 520) ?? undefined}
                        alt={`Page ${previewPage} preview`}
                        className="max-h-[340px] w-auto rounded shadow-md object-contain"
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-surface-elevated/50 border border-border-subtle font-caption text-caption text-text-muted">
                No PDF selected — drag &amp; drop a PDF above or click Select PDF.
              </div>
            )}
          </div>

          <div className="xl:col-span-4 flex flex-col gap-space-md">
            <OcrInspector
              mode={subTab}
              imgFormat={imgFormat}
              imgDpi={imgDpi}
              imgPageRange={imgPageRange}
              paperSize={paperSize}
              orientation={orientation}
              marginPts={marginPts}
              ocrEng={ocrEng}
              ocrInd={ocrInd}
              ocrDpi={ocrDpi}
              ocrToPdfA={ocrToPdfA}
              pdfAConformance={pdfAConformance}
              onChangeImgFormat={setImgFormat}
              onChangeImgDpi={setImgDpi}
              onChangeImgPageRange={setImgPageRange}
              onChangePaperSize={setPaperSize}
              onChangeOrientation={setOrientation}
              onChangeMarginPts={setMarginPts}
              onToggleOcrEng={setOcrEng}
              onToggleOcrInd={setOcrInd}
              onChangeOcrDpi={setOcrDpi}
              onToggleOcrToPdfA={setOcrToPdfA}
              onChangePdfAConformance={setPdfAConformance}
            />

            <OutputTargetCard
              outputFilename={outputFilename}
              onChangeOutputFilename={setOutputFilename}
              filenameLabel={subTab === "pdf2img" ? "Filename Prefix" : "Target Filename"}
              disabled={!hasActiveInput}
              isProcessing={isExecuting}
              processingPercent={processingPercent}
              processingLabel={
                subTab === "pdf2img"
                  ? "Rendering pages to images..."
                  : subTab === "img2pdf"
                    ? "Combining images into PDF..."
                    : subTab === "ocr"
                      ? "Running Tesseract OCR..."
                      : "Converting to ISO PDF/A..."
              }
              filenameHint={
                subTab === "pdf2img"
                  ? `Exports as ${
                      (outputFilename.trim() || "page").replace(
                        /\.(png|jpe?g|webp|tiff?|pdf)$/i,
                        ""
                      )
                    }_p001.${imgFormat} inside this folder.`
                  : undefined
              }
            >
              <button
                type="button"
                onClick={() => void handleExecuteConversion()}
                disabled={isExecuting || !hasActiveInput}
                className="w-full py-3 rounded-lg bg-primary-container hover:bg-primary-fixed disabled:opacity-50 text-on-primary-container font-headline-sm text-headline-sm font-semibold flex items-center justify-center gap-2 shadow-md transition-all"
              >
                <AppIcon
                  name={isExecuting ? "refresh" : "bolt"}
                  className={`w-5 h-5 ${isExecuting ? "animate-spin" : ""}`}
                />
                <span>
                  {isExecuting
                    ? "Processing Offline..."
                    : "Execute Conversion (Ctrl+E)"}
                </span>
              </button>
            </OutputTargetCard>
          </div>
        </div>
      )}
    </div>
  );
};
