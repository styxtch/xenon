import React, { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { runWithMinimumProgress } from "../../lib/progressTiming";
import { getXenonTileUrl, isTauriRuntime, tauriClient } from "../../lib/tauriClient";
import { isPdfPath, useDragDropStore } from "../../stores/dragDropStore";
import { useToolFilesStore } from "../../stores/toolFilesStore";
import type { PageDiffSummary } from "../../types/xenon";
import { AppIcon } from "../common/AppIcon";

export const PdfCompareViewer: React.FC = () => {
  const leftPath = useToolFilesStore((s) => s.compareLeftPath);
  const rightPath = useToolFilesStore((s) => s.compareRightPath);
  const setLeftPath = useToolFilesStore((s) => s.setCompareLeftPath);
  const setRightPath = useToolFilesStore((s) => s.setCompareRightPath);
  const clearComparePaths = useToolFilesStore((s) => s.clearComparePaths);
  const [dpi, setDpi] = useState(150);
  const [viewMode, setViewMode] = useState<"side-by-side" | "heatmap">("side-by-side");
  const [leftDocId, setLeftDocId] = useState("");
  const [rightDocId, setRightDocId] = useState("");
  const [diffs, setDiffs] = useState<PageDiffSummary[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  const [comparePercent, setComparePercent] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDiffs([]);
    setError(null);
    if (!leftPath || !isTauriRuntime()) {
      setLeftDocId("");
      return;
    }
    let cancelled = false;
    void tauriClient
      .openPdf(leftPath)
      .then((dto) => {
        if (!cancelled) setLeftDocId(dto.docId);
      })
      .catch(() => {
        if (!cancelled) setLeftDocId("");
      });
    return () => {
      cancelled = true;
    };
  }, [leftPath]);

  useEffect(() => {
    setDiffs([]);
    setError(null);
    if (!rightPath || !isTauriRuntime()) {
      setRightDocId("");
      return;
    }
    let cancelled = false;
    void tauriClient
      .openPdf(rightPath)
      .then((dto) => {
        if (!cancelled) setRightDocId(dto.docId);
      })
      .catch(() => {
        if (!cancelled) setRightDocId("");
      });
    return () => {
      cancelled = true;
    };
  }, [rightPath]);

  useEffect(() => {
    return useDragDropStore.getState().registerHandler(
      (droppedPaths) => {
        const pdfs = droppedPaths.filter(isPdfPath);
        if (pdfs.length === 0) return;
        if (pdfs.length >= 2) {
          setLeftPath(pdfs[0]);
          setRightPath(pdfs[1]);
        } else if (!leftPath) {
          setLeftPath(pdfs[0]);
        } else {
          setRightPath(pdfs[0]);
        }
        setError(null);
      },
      "Drop PDF revision file(s) to compare side-by-side"
    );
  }, [leftPath, setLeftPath, setRightPath]);

  const pickPdf = async (side: "left" | "right") => {
    if (!isTauriRuntime()) return;
    const picked = await open({
      multiple: false,
      filters: [{ name: "PDF Document", extensions: ["pdf"] }],
    });
    if (typeof picked === "string") {
      if (side === "left") setLeftPath(picked);
      else setRightPath(picked);
    }
  };

  const handleRunCompare = async () => {
    if (!leftPath || !rightPath) return;
    setIsComparing(true);
    setComparePercent(8);
    setError(null);
    try {
      const result = await runWithMinimumProgress(
        () =>
          tauriClient.comparePdfs({
            leftPdfPath: leftPath,
            rightPdfPath: rightPath,
            dpi,
          }),
        setComparePercent
      );
      setDiffs(result);
    } catch (err) {
      setError(String((err as { message?: string })?.message ?? err));
    } finally {
      setIsComparing(false);
    }
  };

  return (
    <div className="flex flex-col gap-space-md">
      <div className="bg-surface-card border border-border-default rounded-xl p-space-md grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
        <div className="md:col-span-5">
          <label className="block font-caption text-caption text-text-muted mb-1">
            Left Revision (Baseline PDF)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={leftPath}
              onChange={(e) => setLeftPath(e.target.value)}
              placeholder="Drop or browse baseline PDF..."
              className="flex-1 h-9 bg-surface-elevated border border-border-default rounded-lg px-3 font-mono-metric text-caption text-text-primary"
            />
            {leftPath && (
              <button
                type="button"
                onClick={() => setLeftPath("")}
                title="Clear left PDF"
                className="w-9 h-9 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default text-text-muted hover:text-error flex items-center justify-center shrink-0"
              >
                <AppIcon name="close" className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void pickPdf("left")}
              className="px-3 h-9 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default font-body-sm text-body-sm text-text-primary"
            >
              Browse
            </button>
          </div>
        </div>

        <div className="md:col-span-5">
          <label className="block font-caption text-caption text-text-muted mb-1">
            Right Revision (Updated PDF)
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={rightPath}
              onChange={(e) => setRightPath(e.target.value)}
              placeholder="Drop or browse updated PDF..."
              className="flex-1 h-9 bg-surface-elevated border border-border-default rounded-lg px-3 font-mono-metric text-caption text-text-primary"
            />
            {rightPath && (
              <button
                type="button"
                onClick={() => setRightPath("")}
                title="Clear right PDF"
                className="w-9 h-9 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default text-text-muted hover:text-error flex items-center justify-center shrink-0"
              >
                <AppIcon name="close" className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void pickPdf("right")}
              className="px-3 h-9 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default font-body-sm text-body-sm text-text-primary"
            >
              Browse
            </button>
          </div>
        </div>

        <div className="md:col-span-2 flex gap-2">
          <select
            value={dpi}
            onChange={(e) => setDpi(Number(e.target.value))}
            className="h-9 bg-surface-elevated border border-border-default rounded-lg px-2 font-mono-metric text-caption text-text-primary"
          >
            <option value={150}>150 DPI</option>
            <option value={300}>300 DPI</option>
          </select>
          <button
            type="button"
            onClick={() => void handleRunCompare()}
            disabled={isComparing || !leftPath || !rightPath}
            className="flex-1 h-9 px-3 rounded-lg bg-primary-container hover:bg-primary-fixed disabled:opacity-50 text-on-primary-container font-body-sm text-body-sm font-semibold flex items-center justify-center gap-1.5"
          >
            {isComparing && (
              <AppIcon name="refresh" className="w-4 h-4 animate-spin" />
            )}
            <span>{isComparing ? "Comparing..." : "Compare"}</span>
          </button>
        </div>
      </div>

      {(leftPath || rightPath) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="inline-flex p-1 rounded-lg bg-surface-card border border-border-default">
            <button
              type="button"
              onClick={() => setViewMode("side-by-side")}
              className={`px-3 py-1 rounded-md font-caption text-caption transition-colors ${
                viewMode === "side-by-side"
                  ? "bg-surface-active text-text-primary font-medium"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              Side-by-Side + Diff
            </button>
            <button
              type="button"
              onClick={() => setViewMode("heatmap")}
              className={`px-3 py-1 rounded-md font-caption text-caption transition-colors ${
                viewMode === "heatmap"
                  ? "bg-surface-active text-text-primary font-medium"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              Diff Overlay Only
            </button>
          </div>
          <button
            type="button"
            onClick={clearComparePaths}
            className="px-3 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default hover:border-status-danger/50 text-text-secondary hover:text-error font-caption text-caption flex items-center gap-1.5 transition-colors"
          >
            <AppIcon name="close" className="w-3.5 h-3.5" />
            <span>Clear Both Files</span>
          </button>
        </div>
      )}

      {isComparing && (
        <div className="p-3 rounded-xl bg-surface-card border border-primary/30 space-y-2">
          <div className="flex items-center justify-between gap-2 font-body-sm text-body-sm text-text-primary">
            <div className="flex items-center gap-2">
              <AppIcon name="refresh" className="w-4 h-4 text-primary animate-spin" />
              <span>Rendering revisions &amp; computing pixel/semantic diffs at {dpi} DPI...</span>
            </div>
            <span className="font-mono-metric text-caption text-primary font-semibold">
              {Math.round(comparePercent)}%
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-surface-elevated overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-150"
              style={{ width: `${Math.max(5, Math.min(100, comparePercent))}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-error-container/40 border border-status-danger/40 font-caption text-caption text-error">
          {error}
        </div>
      )}

      {diffs.length === 0 ? (
        <div className="bg-surface-card border border-border-default rounded-xl p-10 text-center flex flex-col items-center gap-2">
          <AppIcon name="difference" className="w-8 h-8 text-tag-convert" />
          <span className="font-body-medium text-body-medium text-text-primary">
            Side-by-Side Visual &amp; Semantic Word Diff
          </span>
          <span className="font-caption text-caption text-text-muted">
            Select Left &amp; Right PDF revisions above and click Compare to inspect side-by-side pages, diff heatmaps, and word changes.
          </span>
        </div>
      ) : (
        <div className="space-y-4">
          {diffs.map((page) => (
            <div
              key={page.pageNumber}
              className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col gap-space-md"
            >
              <div className="flex items-center justify-between">
                <span className="font-headline-sm text-headline-sm text-text-primary">
                  Page {page.pageNumber}
                </span>
                <span
                  className={`font-mono-metric text-caption px-2 py-0.5 rounded border ${
                    page.pixelDifferenceRatio > 0
                      ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                      : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                  }`}
                >
                  {(page.pixelDifferenceRatio * 100).toFixed(1)}% visual delta
                </span>
              </div>

              {viewMode === "side-by-side" ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <span className="font-caption text-caption text-text-muted uppercase tracking-wider">
                      Left (Baseline)
                    </span>
                    <div className="rounded-lg border border-border-subtle bg-bg-canvas p-2 flex items-center justify-center min-h-[220px]">
                      {leftDocId ? (
                        <img
                          src={getXenonTileUrl(leftDocId, page.pageNumber, 420) ?? undefined}
                          alt={`Left page ${page.pageNumber}`}
                          className="max-h-[420px] w-auto rounded object-contain"
                        />
                      ) : (
                        <span className="font-caption text-caption text-text-muted">
                          Preview unavailable
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="font-caption text-caption text-text-muted uppercase tracking-wider">
                      Right (Updated)
                    </span>
                    <div className="rounded-lg border border-border-subtle bg-bg-canvas p-2 flex items-center justify-center min-h-[220px]">
                      {rightDocId ? (
                        <img
                          src={getXenonTileUrl(rightDocId, page.pageNumber, 420) ?? undefined}
                          alt={`Right page ${page.pageNumber}`}
                          className="max-h-[420px] w-auto rounded object-contain"
                        />
                      ) : (
                        <span className="font-caption text-caption text-text-muted">
                          Preview unavailable
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="font-caption text-caption text-text-muted uppercase tracking-wider">
                      Diff Overlay Heatmap
                    </span>
                    <div className="rounded-lg border border-border-subtle bg-bg-canvas p-2 flex items-center justify-center min-h-[220px]">
                      {page.heatmapDataUrl ? (
                        <img
                          src={page.heatmapDataUrl}
                          alt={`Diff heatmap page ${page.pageNumber}`}
                          className="max-h-[420px] w-auto rounded object-contain"
                        />
                      ) : (
                        <span className="font-caption text-caption text-text-muted">
                          No pixel diff image
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-border-subtle bg-bg-canvas p-3 flex items-center justify-center">
                  {page.heatmapDataUrl ? (
                    <img
                      src={page.heatmapDataUrl}
                      alt={`Diff heatmap page ${page.pageNumber}`}
                      className="max-h-[520px] w-auto rounded object-contain"
                    />
                  ) : (
                    <span className="font-caption text-caption text-text-muted py-12">
                      Pixel diff overlay ready
                    </span>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <span className="font-caption text-caption text-text-muted uppercase tracking-wider">
                  Semantic Text Diff
                </span>
                <div className="p-4 rounded-lg bg-surface-elevated border border-border-subtle font-body-sm text-body-sm leading-relaxed flex flex-wrap gap-1.5">
                  {page.textChanges.length === 0 ? (
                    <span className="font-caption text-caption text-text-muted italic">
                      No selectable text detected on this page (image/scanned page).
                    </span>
                  ) : (
                    page.textChanges.map((chunk, idx) => (
                      <span
                        key={idx}
                        className={
                          chunk.changeType === "insert"
                            ? "px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : chunk.changeType === "delete"
                              ? "px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 line-through border border-red-500/30"
                              : "text-text-secondary"
                        }
                      >
                        {chunk.text}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
