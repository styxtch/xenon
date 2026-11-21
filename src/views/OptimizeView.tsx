import React, { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { AppIcon } from "../components/common/AppIcon";
import { DropZoneWell } from "../components/common/DropZoneWell";
import {
  OutputTargetCard,
  deriveDefaultFilename,
  resolveOutputPath,
} from "../components/common/OutputTargetCard";
import { SegmentedTickProgress } from "../components/common/SegmentedTickProgress";
import {
  CompressEstimateSummary,
  CompressInspector,
  type CompressProfile,
} from "../components/optimize/CompressInspector";
import { runWithMinimumProgress } from "../lib/progressTiming";
import { formatBytes, isTauriRuntime, tauriClient } from "../lib/tauriClient";
import { useImportProgressStore } from "../stores/importProgressStore";
import { useProcessModalStore } from "../stores/processModalStore";
import { isPdfPath, useDragDropStore } from "../stores/dragDropStore";
import { useHistoryStore } from "../stores/historyStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useTelemetryStore } from "../stores/telemetryStore";
import { toolFileSig, useToolFilesStore } from "../stores/toolFilesStore";
import type { SizeEstimateResult } from "../types/xenon";

type OptimizeSubTab = "compress" | "repair" | "sanitize" | "linearize";
const EMPTY_PATHS: string[] = [];

interface OptimizeViewProps {
  onOpenFiles: () => void;
}

export const OptimizeView: React.FC<OptimizeViewProps> = ({ onOpenFiles }) => {
  const [subTab, setSubTab] = useState<OptimizeSubTab>("compress");
  const [profile, setProfile] = useState<CompressProfile>("ebook");
  const [customDpi, setCustomDpi] = useState(150);
  const [customJpegQuality, setCustomJpegQuality] = useState(75);
  const [linearizeFastWeb, setLinearizeFastWeb] = useState(true);
  const [sanitizeMetadata, setSanitizeMetadata] = useState(true);

  const [outputFilename, setOutputFilename] = useState("");
  const [estimate, setEstimate] = useState<SizeEstimateResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionTicks, setExecutionTicks] = useState(0);
  const [processingPercent, setProcessingPercent] = useState(0);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const toolKey = `optimize:${subTab}`;
  const setActiveToolKey = useToolFilesStore((s) => s.setActiveToolKey);
  const optimizePaths = useToolFilesStore(
    (s) => s.filesByTool[toolKey] ?? EMPTY_PATHS
  );
  const addToolFiles = useToolFilesStore((s) => s.addToolFiles);
  const removeToolFile = useToolFilesStore((s) => s.removeToolFile);
  const clearToolFiles = useToolFilesStore((s) => s.clearToolFiles);
  const markToolFileImported = useToolFilesStore((s) => s.markToolFileImported);
  const isImporting = useImportProgressStore((s) => s.isImporting);

  const addOptimizePaths = (paths: string[]) => addToolFiles(toolKey, paths);
  const removeOptimizePath = (path: string) => removeToolFile(toolKey, path);
  const clearOptimizePaths = () => clearToolFiles(toolKey);
  const settings = useSettingsStore((s) => s.settings);

  useEffect(() => {
    setActiveToolKey(toolKey);
    setResultMessage(null);
    setErrorMessage(null);
  }, [toolKey, setActiveToolKey]);

  const primaryPath = optimizePaths[0] ?? "";
  const isBatchCompress = subTab === "compress" && optimizePaths.length > 1;

  useEffect(() => {
    if (optimizePaths.length === 0) {
      setOutputFilename("");
      return;
    }
    if (isBatchCompress) {
      setOutputFilename(
        settings.outputNamingPattern || "{filename}_compressed.pdf"
      );
      return;
    }
    const suffixMap: Record<OptimizeSubTab, string> = {
      compress: "compressed",
      repair: "repaired",
      sanitize: "sanitized",
      linearize: "linearized",
    };
    setOutputFilename(
      deriveDefaultFilename(primaryPath, "Document", suffixMap[subTab])
    );
  }, [
    optimizePaths.length,
    primaryPath,
    subTab,
    isBatchCompress,
    settings.outputNamingPattern,
  ]);

  useEffect(() => {
    return useDragDropStore.getState().registerHandler(
      (droppedPaths) => {
        const pdfs = droppedPaths.filter(isPdfPath);
        if (pdfs.length === 0) return;
        addOptimizePaths(pdfs);
        setResultMessage(null);
        setErrorMessage(null);
      },
      "Drop PDF file(s) to queue in Optimize & Repair"
    );
  }, [addOptimizePaths]);

  useEffect(() => {
    if (!primaryPath) {
      setEstimate(null);
      return;
    }
    let cancelled = false;
    const fileName = primaryPath.split(/[\\/]/).pop() ?? "Document.pdf";
    const sig = toolFileSig(toolKey, primaryPath);
    const alreadyImported = Boolean(
      useToolFilesStore.getState().importedSignatures[sig]
    );
    if (!alreadyImported) {
      useImportProgressStore
        .getState()
        .startImport("Analyzing PDF streams...", fileName, 1);
    }
    void (async () => {
      try {
        const res = await tauriClient.estimateCompressedSize(
          primaryPath,
          profile,
          customDpi,
          customJpegQuality
        );
        if (!alreadyImported) {
          await useImportProgressStore.getState().finishImportAsync();
        }
        if (!cancelled) {
          markToolFileImported(toolKey, primaryPath);
          setEstimate(res);
        }
      } catch {
        if (!alreadyImported) {
          useImportProgressStore.getState().cancelImport();
        }
        if (!cancelled) setEstimate(null);
      }
    })();
    return () => {
      cancelled = true;
      if (!alreadyImported) {
        useImportProgressStore.getState().cancelImport();
      }
    };
  }, [primaryPath, toolKey, profile, customDpi, customJpegQuality, markToolFileImported]);

  const handlePickFiles = async () => {
    if (!isTauriRuntime()) {
      onOpenFiles();
      return;
    }
    const picked = await open({
      multiple: true,
      filters: [{ name: "PDF Files", extensions: ["pdf"] }],
    });
    const list = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (list.length > 0) {
      addOptimizePaths(list);
      setResultMessage(null);
      setErrorMessage(null);
    }
  };

  const handleClearFiles = () => {
    clearOptimizePaths();
    setEstimate(null);
    setExecutionTicks(0);
    setResultMessage(null);
    setErrorMessage(null);
  };

  const handleExecuteCompress = async () => {
    if (optimizePaths.length === 0) return;
    const outDir = settings.primaryDestinationFolder || "Exports";
    const namingPattern =
      outputFilename.trim() ||
      settings.outputNamingPattern ||
      "{filename}_xenon_{date}";
    const modalStore = useProcessModalStore.getState();

    const candidatePaths = !namingPattern.includes("{")
      ? optimizePaths.map((p) =>
          resolveOutputPath(
            outDir,
            namingPattern,
            deriveDefaultFilename(p, "Document", "compressed")
          )
        )
      : [];
    let effectiveNamingPattern = namingPattern;
    if (candidatePaths.length > 0) {
      const resolved = await modalStore.confirmOrCopyPaths(candidatePaths, "Compress PDF");
      if (!resolved) return;
      if (optimizePaths.length === 1 && resolved[0]) {
        effectiveNamingPattern = resolved[0].split(/[\\/]/).pop() || namingPattern;
      }
    }

    setIsExecuting(true);
    setExecutionTicks(1);
    setProcessingPercent(8);
    setResultMessage(null);
    setErrorMessage(null);
    try {
      const results = await runWithMinimumProgress(
        () =>
          tauriClient.compressPdf({
            inputPaths: optimizePaths,
            profile,
            customDpi: profile === "custom" ? customDpi : undefined,
            customJpegQuality: profile === "custom" ? customJpegQuality : undefined,
            linearizeFastWeb,
            sanitizeMetadata,
            outputDir: outDir,
            namingPattern: effectiveNamingPattern,
          }),
        (pct) => {
          setProcessingPercent(pct);
          setExecutionTicks(Math.max(1, Math.min(10, Math.round(pct / 10))));
        }
      );
      setExecutionTicks(10);
      const first = results[0];
      setResultMessage(
        `Compressed ${results.length} file(s): ${formatBytes(first.originalBytes)} -> ${formatBytes(first.outputBytes)} (-${first.reductionPercent}%) in ${first.durationMs} ms`
      );
      const totalOrig = results.reduce((acc, r) => acc + r.originalBytes, 0);
      const totalOut = results.reduce((acc, r) => acc + r.outputBytes, 0);
      const totalMs = results.reduce((acc, r) => acc + r.durationMs, 0);
      modalStore.showCompletion({
        title: "Compression Completed",
        summary: `Compressed ${results.length} PDF file(s) using Ghostscript (${profile}).`,
        outputPaths: results.map((r) => r.outputPath),
        originalBytes: totalOrig,
        outputBytes: totalOut,
        durationMs: totalMs,
      });
      await useHistoryStore.getState().fetchDashboardMetrics();
      await useTelemetryStore.getState().loadLogs();
    } catch (err) {
      setExecutionTicks(0);
      setErrorMessage(String((err as { message?: string })?.message ?? err));
    } finally {
      setIsExecuting(false);
    }
  };

  const handleRunSingleAction = async (kind: "repair" | "sanitize" | "linearize") => {
    if (!primaryPath) return;
    const suffixMap = {
      repair: "repaired",
      sanitize: "sanitized",
      linearize: "linearized",
    } as const;
    const labelMap = {
      repair: "Repair Xref",
      sanitize: "Sanitize Metadata",
      linearize: "Linearize Fast Web",
    } as const;
    const fallbackName = deriveDefaultFilename(
      primaryPath,
      "Document",
      suffixMap[kind]
    );
    const outPath = resolveOutputPath(
      settings.primaryDestinationFolder || "Exports",
      outputFilename,
      fallbackName
    );

    const modalStore = useProcessModalStore.getState();
    const resolved = await modalStore.confirmOrCopyPaths([outPath], labelMap[kind]);
    if (!resolved) return;
    const finalOutPath = resolved[0];

    setIsExecuting(true);
    setProcessingPercent(8);
    setResultMessage(null);
    setErrorMessage(null);
    try {
      if (kind === "repair") {
        const res = await runWithMinimumProgress(
          () => tauriClient.repairPdf(primaryPath, finalOutPath),
          setProcessingPercent
        );
        setResultMessage(
          `Repaired xref (${res.fixedXrefEntries} objects, ${res.recoveredPages} pages) -> ${res.outputPath}`
        );
        modalStore.showCompletion({
          title: "PDF Repair Completed",
          summary: `Recovered ${res.recoveredPages} page(s) (${res.fixedXrefEntries} objects verified).`,
          outputPaths: [res.outputPath],
          originalBytes: res.originalBytes,
          outputBytes: res.outputBytes,
          durationMs: res.durationMs,
        });
      } else if (kind === "sanitize") {
        const res = await runWithMinimumProgress(
          () => tauriClient.sanitizeMetadata(primaryPath, finalOutPath),
          setProcessingPercent
        );
        setResultMessage(
          `Sanitized: removed ${res.removedMetadataStreams} XMP stream(s), ${res.strippedInfoKeys} Info key(s), pruned ${res.prunedOrphanObjects} orphan object(s)`
        );
        modalStore.showCompletion({
          title: "Metadata Sanitization Completed",
          summary: `Removed ${res.removedMetadataStreams} XMP stream(s), ${res.strippedInfoKeys} Info key(s), and ${res.prunedOrphanObjects} orphan object(s).`,
          outputPaths: [res.outputPath],
          originalBytes: res.originalBytes,
          outputBytes: res.outputBytes,
          durationMs: res.durationMs,
        });
      } else {
        const res = await runWithMinimumProgress(
          () => tauriClient.linearizePdf(primaryPath, finalOutPath),
          setProcessingPercent
        );
        setResultMessage(
          `Linearized Fast Web View (${res.pageCount} pages, ${formatBytes(res.outputBytes)}) -> ${res.outputPath}`
        );
        modalStore.showCompletion({
          title: "Linearization Completed",
          summary: `Optimized ${res.pageCount} page(s) for Fast Web View.`,
          outputPaths: [res.outputPath],
          originalBytes: res.originalBytes,
          outputBytes: res.outputBytes,
          durationMs: res.durationMs,
        });
      }
      await useHistoryStore.getState().fetchDashboardMetrics();
      await useTelemetryStore.getState().loadLogs();
    } catch (err) {
      setErrorMessage(String((err as { message?: string })?.message ?? err));
    } finally {
      setIsExecuting(false);
    }
  };

  const handleExecuteActive = () => {
    if (subTab === "compress") {
      void handleExecuteCompress();
    } else {
      void handleRunSingleAction(subTab);
    }
  };

  const executeButtonLabel = (() => {
    if (isExecuting) {
      if (subTab === "compress") return "Compressing Offline...";
      if (subTab === "repair") return "Repairing Offline...";
      if (subTab === "sanitize") return "Sanitizing Offline...";
      return "Linearizing Offline...";
    }
    if (subTab === "compress") return "Compress & Export PDF";
    if (subTab === "repair") return "Repair & Rebuild PDF";
    if (subTab === "sanitize") return "Sanitize Metadata & Export";
    return "Linearize PDF & Export";
  })();

  const renderQueuedListOrEmpty = () => {
    if (optimizePaths.length === 0) return null;
    return (
      <div className="space-y-2">
        <span className="font-caption text-caption text-text-muted uppercase tracking-wider">
          Queued Input File(s) ({optimizePaths.length})
        </span>
        {optimizePaths.map((p) => (
          <div
            key={p}
            className="p-3 rounded-lg bg-surface-elevated border border-border-subtle flex items-center justify-between gap-2"
          >
            <span className="font-mono-metric text-body-sm text-text-primary truncate">
              {p}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-caption text-caption text-tag-optimize">
                Ready
              </span>
              <button
                type="button"
                onClick={() => removeOptimizePath(p)}
                title="Remove file"
                className="p-1 rounded hover:bg-surface-card text-text-muted hover:text-error transition-colors"
              >
                <AppIcon name="close" className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col gap-space-md">
        <div className="flex flex-wrap items-center justify-between gap-space-md">
          <div className="flex items-center gap-space-md">
            <div className="w-10 h-10 rounded-lg bg-tag-optimize/15 border border-tag-optimize/30 flex items-center justify-center text-tag-optimize">
              <AppIcon name="compress" className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-headline-md text-headline-md text-text-primary">
                  Optimize &amp; Repair PDF
                </h1>
                <span className="font-caption text-caption px-2 py-0.5 rounded-full bg-tag-optimize/15 text-tag-optimize border border-tag-optimize/30">
                  Ghostscript v10.05 + QPDF v12.4 + Lopdf
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-text-muted mt-0.5">
                Target:{" "}
                <span className="font-mono-metric text-text-primary">
                  {primaryPath
                    ? `${primaryPath.split(/[\\/]/).pop()}${
                        optimizePaths.length > 1
                          ? ` (+${optimizePaths.length - 1} more)`
                          : ""
                      }`
                    : "No PDF selected"}
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {optimizePaths.length > 0 && (
              <button
                type="button"
                onClick={handleClearFiles}
                className="px-3 py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default hover:border-status-danger/50 text-text-secondary hover:text-error font-body-sm text-body-sm flex items-center gap-1.5 transition-colors"
              >
                <AppIcon name="close" className="w-4 h-4" />
                <span>{optimizePaths.length > 1 ? "Clear All" : "Remove File"}</span>
              </button>
            )}
            <button
              type="button"
              onClick={handlePickFiles}
              className="px-3.5 py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default text-text-primary font-body-sm text-body-sm flex items-center gap-1.5"
            >
              <AppIcon name="file_open" className="w-4 h-4 text-primary" />
              <span>Select PDF(s)</span>
            </button>
          </div>
        </div>

        <div className="inline-flex p-1 bg-surface-elevated rounded-lg border border-border-subtle self-start flex-wrap">
          {(
            [
              { id: "compress", label: "Compress PDF" },
              { id: "repair", label: "Repair Corrupt PDF" },
              { id: "sanitize", label: "Sanitize Metadata" },
              { id: "linearize", label: "Linearize Fast Web" },
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

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-lg items-start">
        <div className="xl:col-span-8 flex flex-col gap-space-md">
          <div className="bg-surface-card border border-border-default rounded-xl p-space-xl flex flex-col gap-space-md">
            <DropZoneWell
              title="Drag & drop PDF files here, or click to select for Optimize & Repair"
              subtitle="Files queued here stay independent from Organize PDF Workspace."
              onSelectFiles={handlePickFiles}
              accentClass="text-tag-optimize"
            />
            {!isImporting && renderQueuedListOrEmpty()}
          </div>

          {subTab === "repair" && (
            <div className="bg-surface-card border border-border-default rounded-xl p-space-xl flex flex-col gap-2">
              <h2 className="font-headline-sm text-headline-sm text-text-primary">
                Corrupt PDF Xref &amp; Stream Recovery
              </h2>
              <p className="font-body-sm text-body-sm text-text-secondary leading-relaxed">
                Reconstructs damaged cross-reference (`xref`) tables, validates `/Catalog` and `/Pages` object references, and writes a clean PDF atomically via `.part` without modifying the original input file.
              </p>
            </div>
          )}

          {subTab === "sanitize" && (
            <div className="bg-surface-card border border-border-default rounded-xl p-space-xl flex flex-col gap-2">
              <h2 className="font-headline-sm text-headline-sm text-text-primary">
                XMP &amp; Hidden Metadata Sanitation
              </h2>
              <p className="font-body-sm text-body-sm text-text-secondary leading-relaxed">
                Strips embedded XML `/Metadata` streams, author/creator/producer strings, creation timestamps, GPS EXIF headers, and prunes unreferenced orphan objects from the PDF graph.
              </p>
            </div>
          )}

          {subTab === "linearize" && (
            <div className="bg-surface-card border border-border-default rounded-xl p-space-xl flex flex-col gap-2">
              <h2 className="font-headline-sm text-headline-sm text-text-primary">
                Linearize PDF (Fast Web View)
              </h2>
              <p className="font-body-sm text-body-sm text-text-secondary leading-relaxed">
                Optimizes PDF object stream ordering and compresses uncompressed content streams so page 1 renders instantaneously in browsers and desktop viewers.
              </p>
            </div>
          )}
        </div>

        <div className="xl:col-span-4 flex flex-col gap-space-md">
          {subTab === "compress" && (
            <CompressInspector
              profile={profile}
              customDpi={customDpi}
              customJpegQuality={customJpegQuality}
              linearizeFastWeb={linearizeFastWeb}
              sanitizeMetadata={sanitizeMetadata}
              onChangeProfile={setProfile}
              onChangeCustomDpi={setCustomDpi}
              onChangeCustomQuality={setCustomJpegQuality}
              onToggleLinearize={setLinearizeFastWeb}
              onToggleSanitize={setSanitizeMetadata}
            />
          )}

          <OutputTargetCard
            outputFilename={outputFilename}
            onChangeOutputFilename={setOutputFilename}
            disabled={optimizePaths.length === 0}
            isProcessing={isExecuting}
            processingPercent={processingPercent}
            processingLabel={
              subTab === "compress"
                ? "Compressing PDF via Ghostscript..."
                : subTab === "repair"
                  ? "Repairing PDF xref via QPDF..."
                  : subTab === "sanitize"
                    ? "Sanitizing XMP & metadata..."
                    : "Linearizing Fast Web View..."
            }
            filenameLabel={
              isBatchCompress ? "Batch Filename Pattern" : "Target Filename"
            }
            filenameHint={
              isBatchCompress
                ? "Tokens: {filename}, {date}, {time}, {compression_ratio}, {page_count}"
                : undefined
            }
          >
            {subTab === "compress" && (
              <CompressEstimateSummary estimate={estimate} />
            )}

            {subTab === "compress" && (isExecuting || executionTicks > 0) && (
              <div className="p-2.5 rounded-lg bg-surface-elevated border border-border-subtle flex items-center justify-between">
                <span className="font-caption text-caption text-text-secondary">
                  Ghostscript Pipeline
                </span>
                <SegmentedTickProgress
                  completedTicks={executionTicks}
                  percentage={executionTicks * 10}
                  status={isExecuting ? "processing" : "completed"}
                  category="optimize"
                />
              </div>
            )}

            {resultMessage && (
              <div className="p-2.5 rounded-lg bg-status-success/10 border border-status-success/30 font-caption text-caption text-status-success break-words">
                {resultMessage}
              </div>
            )}
            {errorMessage && (
              <div className="p-2.5 rounded-lg bg-error-container/40 border border-status-danger/40 font-caption text-caption text-error break-words">
                {errorMessage}
              </div>
            )}

            <button
              type="button"
              onClick={handleExecuteActive}
              disabled={isExecuting || optimizePaths.length === 0}
              className="w-full py-3 rounded-lg bg-primary-container hover:bg-primary-fixed disabled:opacity-50 text-on-primary-container font-headline-sm text-headline-sm font-semibold flex items-center justify-center gap-2 shadow-md transition-all"
            >
              <AppIcon
                name={isExecuting ? "refresh" : "bolt"}
                className={`w-5 h-5 ${isExecuting ? "animate-spin" : ""}`}
              />
              <span>{executeButtonLabel}</span>
            </button>
          </OutputTargetCard>
        </div>
      </div>
    </div>
  );
};
