import React from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { formatBytes, isTauriRuntime } from "../../lib/tauriClient";
import {
  useDocumentStore,
  type OrganizeSubTab,
  type SplitMode,
} from "../../stores/documentStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { AppIcon } from "../common/AppIcon";

interface OrganizeInspectorProps {
  activeSubTab: OrganizeSubTab;
  onExecute: () => void;
  onSwitchSubTab: (tab: OrganizeSubTab) => void;
}

export const OrganizeInspector: React.FC<OrganizeInspectorProps> = ({
  activeSubTab,
  onExecute,
  onSwitchSubTab,
}) => {
  const pages = useDocumentStore((s) => s.pages);
  const splitPages = useDocumentStore((s) => s.splitPages);
  const totalBytes = useDocumentStore((s) => s.totalBytes);
  const splitTotalBytes = useDocumentStore((s) => s.splitTotalBytes);
  const mergeQueue = useDocumentStore((s) => s.mergeQueue);
  const undoStack = useDocumentStore((s) => s.undoStack);
  const redoStack = useDocumentStore((s) => s.redoStack);
  const retainBookmarksToc = useDocumentStore((s) => s.retainBookmarksToc);
  const standardizeToA4 = useDocumentStore((s) => s.standardizeToA4);
  const pdfVersionProfile = useDocumentStore((s) => s.pdfVersionProfile);
  const splitMode = useDocumentStore((s) => s.splitMode);
  const splitRangeSpec = useDocumentStore((s) => s.splitRangeSpec);
  const splitEveryN = useDocumentStore((s) => s.splitEveryN);
  const mergeExtractedIntoSinglePdf = useDocumentStore(
    (s) => s.mergeExtractedIntoSinglePdf
  );
  const cropMargins = useDocumentStore((s) => s.cropMargins);
  const outputFilename = useDocumentStore((s) => s.outputFilename);
  const isExecuting = useDocumentStore((s) => s.isExecuting);
  const executionTicks = useDocumentStore((s) => s.executionTicks);
  const lastResultMessage = useDocumentStore((s) => s.lastResultMessage);
  const lastError = useDocumentStore((s) => s.lastError);

  const undo = useDocumentStore((s) => s.undo);
  const redo = useDocumentStore((s) => s.redo);
  const rotateSelectedRight = useDocumentStore((s) => s.rotateSelectedRight);
  const deleteSelected = useDocumentStore((s) => s.deleteSelected);
  const setRetainBookmarksToc = useDocumentStore((s) => s.setRetainBookmarksToc);
  const setStandardizeToA4 = useDocumentStore((s) => s.setStandardizeToA4);
  const setPdfVersionProfile = useDocumentStore((s) => s.setPdfVersionProfile);
  const setSplitMode = useDocumentStore((s) => s.setSplitMode);
  const setSplitRangeSpec = useDocumentStore((s) => s.setSplitRangeSpec);
  const setSplitEveryN = useDocumentStore((s) => s.setSplitEveryN);
  const setMergeExtractedIntoSinglePdf = useDocumentStore(
    (s) => s.setMergeExtractedIntoSinglePdf
  );
  const setCropMargins = useDocumentStore((s) => s.setCropMargins);
  const applyCropToSelected = useDocumentStore((s) => s.applyCropToSelected);
  const resetCropOnSelected = useDocumentStore((s) => s.resetCropOnSelected);
  const setOutputFilename = useDocumentStore((s) => s.setOutputFilename);
  const sendActiveDocToSplit = useDocumentStore((s) => s.sendActiveDocToSplit);

  const destinationFolder = useSettingsStore(
    (s) => s.settings.primaryDestinationFolder
  );
  const updateSetting = useSettingsStore((s) => s.updateSetting);

  const selectedPages = pages.filter((p) => p.selected);
  const hasInput =
    activeSubTab === "merge"
      ? mergeQueue.length > 0
      : activeSubTab === "split"
        ? splitPages.length > 0
        : pages.length > 0;
  const pageTotal =
    activeSubTab === "merge"
      ? mergeQueue.reduce((acc, m) => acc + m.pageCount, 0)
      : activeSubTab === "split"
        ? splitPages.length
        : pages.length;
  const estimatedBytes = !hasInput
    ? 0
    : activeSubTab === "merge"
      ? mergeQueue.reduce((acc, m) => acc + m.fileSizeBytes, 0)
      : activeSubTab === "split"
        ? splitTotalBytes
        : totalBytes;

  const handleBrowseFolder = async () => {
    if (!isTauriRuntime()) return;
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") {
      updateSetting("primaryDestinationFolder", picked);
      void useSettingsStore.getState().saveSettings();
    }
  };

  return (
    <div className="flex flex-col gap-space-md">
      {/* Card 1: Selected Pages & Undo/Redo */}
      <div className="bg-surface-card border border-border-default rounded-xl p-space-md shadow-sm flex flex-col gap-space-md">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
            <h2 className="font-headline-sm text-headline-sm text-text-primary">
              Selected Pages ({selectedPages.length})
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={undo}
              disabled={undoStack.length === 0}
              title="Undo (Ctrl+Z)"
              className="px-2 py-1 rounded bg-surface-elevated hover:bg-surface-hover disabled:opacity-40 border border-border-subtle font-caption text-caption text-text-secondary"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={redoStack.length === 0}
              title="Redo (Ctrl+Y)"
              className="px-2 py-1 rounded bg-surface-elevated hover:bg-surface-hover disabled:opacity-40 border border-border-subtle font-caption text-caption text-text-secondary"
            >
              Redo
            </button>
          </div>
        </div>

        <div className="font-mono-metric text-caption text-text-secondary bg-surface-elevated px-2.5 py-1.5 rounded border border-border-subtle truncate">
          {selectedPages.length > 0
            ? selectedPages.map((p) => `p.${p.originalPageNumber}`).join(", ")
            : "No pages selected — click thumbnails or Ctrl+A"}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={selectedPages.length === 0}
            onClick={() => {
              sendActiveDocToSplit();
              setSplitMode("extract_selected");
              onSwitchSubTab("split");
            }}
            className="flex items-center gap-2 p-2.5 rounded-lg bg-surface-elevated hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed border border-border-subtle text-text-primary transition-colors text-left"
          >
            <AppIcon name="file_download" className="w-[18px] h-[18px] text-tag-security" />
            <div className="min-w-0">
              <span className="font-body-sm text-body-sm block truncate">Extract</span>
              <span className="font-caption text-caption text-text-muted block">
                To new PDF
              </span>
            </div>
          </button>

          <button
            type="button"
            disabled={selectedPages.length === 0}
            onClick={rotateSelectedRight}
            className="flex items-center gap-2 p-2.5 rounded-lg bg-surface-elevated hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed border border-border-subtle text-text-primary transition-colors text-left"
          >
            <AppIcon name="rotate_right" className="w-[18px] h-[18px] text-tag-optimize" />
            <div className="min-w-0">
              <span className="font-body-sm text-body-sm block truncate">Rotate 90°</span>
              <span className="font-caption text-caption text-text-muted block">
                Clockwise
              </span>
            </div>
          </button>

          <button
            type="button"
            disabled={pages.length === 0}
            onClick={() => onSwitchSubTab("crop")}
            className="flex items-center gap-2 p-2.5 rounded-lg bg-surface-elevated hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed border border-border-subtle text-text-primary transition-colors text-left"
          >
            <AppIcon name="crop_rotate" className="w-[18px] h-[18px] text-tag-convert" />
            <div className="min-w-0">
              <span className="font-body-sm text-body-sm block truncate">Crop Box</span>
              <span className="font-caption text-caption text-text-muted block">
                Trim margins
              </span>
            </div>
          </button>

          <button
            type="button"
            disabled={selectedPages.length === 0}
            onClick={deleteSelected}
            className="flex items-center gap-2 p-2.5 rounded-lg bg-error-container/30 hover:bg-error-container/60 disabled:opacity-40 disabled:cursor-not-allowed text-error transition-colors text-left"
          >
            <AppIcon name="delete_sweep" className="w-[18px] h-[18px]" />
            <div className="min-w-0">
              <span className="font-body-sm text-body-sm block truncate">Delete</span>
              <span className="font-caption text-caption text-text-muted block">
                Remove {selectedPages.length}
              </span>
            </div>
          </button>
        </div>
      </div>

      {/* Card 2: Tool Parameters / Arrangement Rules */}
      <div className="bg-surface-card border border-border-default rounded-xl p-space-md shadow-sm flex flex-col gap-space-md">
        <div className="flex items-center gap-2">
          <AppIcon name="tune" className="w-5 h-5 text-tag-organize" />
          <h2 className="font-headline-sm text-headline-sm text-text-primary">
            {activeSubTab === "split"
              ? "Split Parameters"
              : activeSubTab === "crop"
                ? "Margin Crop Controls (pts)"
                : "Arrangement Rules"}
          </h2>
        </div>

        {activeSubTab === "split" ? (
          <div className="space-y-3">
            <select
              value={splitMode}
              onChange={(e) => setSplitMode(e.target.value as SplitMode)}
              className="w-full h-9 bg-surface-elevated border border-border-default rounded-lg px-3 font-body-sm text-body-sm text-text-primary focus:outline-none focus:border-primary-container"
            >
              <option value="range">Split by Range (e.g. 1-4, 5-8)</option>
              <option value="extract_selected">Extract Selected Pages</option>
              <option value="every_n_pages">Split Every N Pages</option>
              <option value="burst">Burst (1 Page = 1 PDF)</option>
            </select>

            {splitMode === "range" && (
              <div>
                <label className="block font-caption text-caption text-text-muted mb-1">
                  Page Range Spec
                </label>
                <input
                  type="text"
                  value={splitRangeSpec}
                  onChange={(e) => setSplitRangeSpec(e.target.value)}
                  placeholder="1-5, 8, 11-12"
                  className="w-full h-9 bg-surface-elevated border border-border-default rounded-lg px-3 font-mono-metric text-body-sm text-text-primary focus:outline-none focus:border-primary-container"
                />
              </div>
            )}

            {splitMode === "every_n_pages" && (
              <div>
                <label className="block font-caption text-caption text-text-muted mb-1">
                  Pages Per Output File
                </label>
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, splitPages.length)}
                  value={splitEveryN}
                  onChange={(e) => setSplitEveryN(Number(e.target.value))}
                  className="w-full h-9 bg-surface-elevated border border-border-default rounded-lg px-3 font-mono-metric text-body-sm text-text-primary focus:outline-none focus:border-primary-container"
                />
              </div>
            )}

            <label className="flex items-center justify-between cursor-pointer p-2.5 rounded-lg bg-surface-elevated border border-border-subtle">
              <span className="font-body-sm text-body-sm text-text-primary">
                Merge extracted ranges into single PDF
              </span>
              <input
                type="checkbox"
                checked={mergeExtractedIntoSinglePdf}
                onChange={(e) => setMergeExtractedIntoSinglePdf(e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
            </label>
          </div>
        ) : activeSubTab === "crop" ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {(["top", "bottom", "left", "right"] as const).map((side) => (
                <div key={side}>
                  <label className="block font-caption text-caption text-text-muted mb-1 capitalize">
                    {side} (pts)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={250}
                    value={cropMargins[side]}
                    onChange={(e) =>
                      setCropMargins({ [side]: Math.max(0, Number(e.target.value)) })
                    }
                    className="w-full h-8 bg-surface-elevated border border-border-default rounded-lg px-2.5 font-mono-metric text-body-sm text-text-primary focus:outline-none focus:border-primary-container"
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={pages.length === 0}
                onClick={applyCropToSelected}
                className="flex-1 py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed border border-border-default font-body-sm text-body-sm text-primary font-medium"
              >
                Apply Crop Box
              </button>
              <button
                type="button"
                disabled={pages.length === 0}
                onClick={resetCropOnSelected}
                className="px-3 py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed border border-border-default font-body-sm text-body-sm text-text-secondary"
              >
                Reset
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="flex items-center justify-between cursor-pointer p-2.5 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-subtle transition-colors">
              <div className="flex flex-col">
                <span className="font-body-sm text-body-sm text-text-primary font-medium">
                  Retain bookmarks &amp; TOC
                </span>
                <span className="font-caption text-caption text-text-muted">
                  Re-link nested chapter hierarchy
                </span>
              </div>
              <input
                type="checkbox"
                checked={retainBookmarksToc}
                onChange={(e) => setRetainBookmarksToc(e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer p-2.5 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-subtle transition-colors">
              <div className="flex flex-col">
                <span className="font-body-sm text-body-sm text-text-primary font-medium">
                  Standardize dimensions to A4
                </span>
                <span className="font-caption text-caption text-text-muted">
                  Normalize MediaBox to 595.28 × 841.89 pts
                </span>
              </div>
              <input
                type="checkbox"
                checked={standardizeToA4}
                onChange={(e) => setStandardizeToA4(e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
            </label>

            <div className="p-2.5 rounded-lg bg-surface-container border border-border-subtle flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AppIcon name="bolt" className="w-4 h-4 text-primary" />
                <span className="font-caption text-caption text-text-secondary">
                  Core Engine:
                </span>
              </div>
              <span className="font-mono-metric text-caption text-text-primary">
                QPDF Bundled + Lopdf
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Card 3: Output Target & Primary Execute */}
      <div className="bg-surface-card border border-border-default rounded-xl p-space-md shadow-sm flex flex-col gap-space-md">
        <div className="flex items-center gap-2">
          <AppIcon name="output" className="w-5 h-5 text-primary" />
          <h2 className="font-headline-sm text-headline-sm text-text-primary">
            Output Target
          </h2>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block font-caption text-caption text-text-muted mb-1">
              Target Filename
            </label>
            <input
              type="text"
              value={outputFilename}
              onChange={(e) => setOutputFilename(e.target.value)}
              placeholder="Select a PDF first..."
              disabled={!hasInput}
              className="w-full h-9 bg-surface-elevated border border-border-default rounded-lg px-3 font-body-sm text-body-sm text-text-primary disabled:opacity-50 focus:outline-none focus:border-primary-container"
            />
          </div>

          <div>
            <label className="block font-caption text-caption text-text-muted mb-1">
              Output Folder
            </label>
            <div className="flex items-center gap-2">
              <div className="h-9 flex-1 bg-surface-elevated border border-border-default rounded-lg px-3 flex items-center font-mono-metric text-caption text-text-secondary truncate">
                {destinationFolder || "Documents/XENON_Exports"}
              </div>
              <button
                type="button"
                onClick={handleBrowseFolder}
                className="h-9 px-3 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default text-text-primary font-body-sm text-body-sm"
              >
                Browse
              </button>
            </div>
          </div>

          <div>
            <label className="block font-caption text-caption text-text-muted mb-1">
              PDF Version Profile
            </label>
            <select
              value={pdfVersionProfile}
              onChange={(e) =>
                setPdfVersionProfile(
                  e.target.value as "1.7" | "2.0" | "pdfa-2b"
                )
              }
              className="w-full h-9 bg-surface-elevated border border-border-default rounded-lg px-3 font-body-sm text-body-sm text-text-primary focus:outline-none focus:border-primary-container"
            >
              <option value="1.7">PDF 1.7 (ISO 32000-1)</option>
              <option value="2.0">PDF 2.0 (ISO 32000-2)</option>
              <option value="pdfa-2b">PDF/A-2b (ISO 19005-2)</option>
            </select>
          </div>

          {hasInput && (
            <div className="p-3 bg-surface-container border border-border-subtle rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AppIcon name="speed" className="w-[18px] h-[18px] text-tag-optimize" />
                <div>
                  <span className="font-body-sm text-body-sm text-text-primary block font-medium">
                    Estimated Size
                  </span>
                  <span className="font-caption text-caption text-primary">
                    ~{formatBytes(estimatedBytes)} (atomic .part write)
                  </span>
                </div>
              </div>
              <span className="font-mono-metric text-mono-metric text-text-muted">
                {pageTotal} Pages
              </span>
            </div>
          )}
        </div>

        {isExecuting && (
          <div className="p-2.5 rounded-lg bg-surface-elevated border border-primary/30 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <AppIcon name="refresh" className="w-4 h-4 text-primary animate-spin shrink-0" />
                <span className="font-caption text-caption text-text-primary font-medium truncate">
                  Processing locally...
                </span>
              </div>
              <span className="font-mono-metric text-[11px] text-primary shrink-0">
                {Math.min(100, Math.round(executionTicks * 10))}%
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-surface-container overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-150"
                style={{ width: `${Math.max(5, Math.min(100, executionTicks * 10))}%` }}
              />
            </div>
          </div>
        )}

        {lastResultMessage && (
          <div className="p-2.5 rounded-lg bg-status-success/10 border border-status-success/30 font-caption text-caption text-status-success break-words">
            {lastResultMessage}
          </div>
        )}

        {lastError && (
          <div className="p-2.5 rounded-lg bg-error-container/40 border border-status-danger/40 font-caption text-caption text-error break-words">
            {lastError}
          </div>
        )}

        <button
          type="button"
          onClick={onExecute}
          disabled={isExecuting || !hasInput}
          className="w-full py-3 rounded-lg bg-primary-container hover:bg-primary-fixed disabled:opacity-50 text-on-primary-container font-headline-sm text-headline-sm font-semibold flex items-center justify-center gap-2 shadow-md transition-all"
        >
          <AppIcon
            name={isExecuting ? "refresh" : "bolt"}
            className={`w-5 h-5 ${isExecuting ? "animate-spin" : ""}`}
          />
          <span>
            {isExecuting ? "Processing Offline..." : "Execute & Export (Ctrl+E)"}
          </span>
        </button>
      </div>
    </div>
  );
};
