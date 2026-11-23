import React from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../../lib/tauriClient";
import { useSettingsStore } from "../../stores/settingsStore";
import { AppIcon } from "./AppIcon";

export function deriveDefaultFilename(
  inputPath: string,
  fallbackStem: string,
  suffix: string
): string {
  if (!inputPath.trim()) {
    return "";
  }
  const rawName = inputPath.split(/[\\/]/).pop() ?? "";
  const cleanedFromPath = rawName.replace(
    /\.(pdf|jpe?g|png|webp|tiff?|bmp)$/i,
    ""
  );
  const cleanedFallback =
    fallbackStem.replace(/\.(pdf|jpe?g|png|webp|tiff?|bmp)$/i, "") || "Document";
  const stem = cleanedFromPath || cleanedFallback;
  return `${stem}_${suffix}.pdf`;
}

export function resolveOutputPath(
  outputDir: string,
  filename: string,
  fallbackName: string
): string {
  const dir = (outputDir || "Exports").replace(/[\\/]+$/, "");
  const sep = dir.includes("\\") ? "\\" : "/";
  const rawName = filename.trim() || fallbackName;
  const finalName = /\.pdf$/i.test(rawName) ? rawName : `${rawName}.pdf`;
  return `${dir}${sep}${finalName}`;
}

interface OutputTargetCardProps {
  outputFilename?: string;
  onChangeOutputFilename?: (name: string) => void;
  filenameLabel?: string;
  filenamePlaceholder?: string;
  filenameHint?: string;
  hideFilenameInput?: boolean;
  disabled?: boolean;
  isProcessing?: boolean;
  processingLabel?: string;
  processingPercent?: number;
  outputFolder?: string;
  onChangeOutputFolder?: (dir: string) => void;
  children?: React.ReactNode;
}

export const OutputTargetCard: React.FC<OutputTargetCardProps> = ({
  outputFilename = "",
  onChangeOutputFilename,
  filenameLabel = "Target Filename",
  filenamePlaceholder = "Select a PDF first...",
  filenameHint,
  hideFilenameInput = false,
  disabled = false,
  isProcessing = false,
  processingLabel = "Processing locally...",
  processingPercent,
  outputFolder,
  onChangeOutputFolder,
  children,
}) => {
  const primaryDestinationFolder = useSettingsStore(
    (s) => s.settings.primaryDestinationFolder
  );
  const updateSetting = useSettingsStore((s) => s.updateSetting);

  const effectiveFolder = outputFolder ?? primaryDestinationFolder;

  const handleBrowseFolder = async () => {
    if (!isTauriRuntime()) return;
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") {
      if (onChangeOutputFolder) {
        onChangeOutputFolder(picked);
      } else {
        updateSetting("primaryDestinationFolder", picked);
        void useSettingsStore.getState().saveSettings();
      }
    }
  };

  return (
    <div className="bg-surface-card border border-border-default rounded-xl p-space-md shadow-sm flex flex-col gap-space-md">
      <div className="flex items-center gap-2">
        <AppIcon name="output" className="w-5 h-5 text-primary" />
        <h2 className="font-headline-sm text-headline-sm text-text-primary">
          Output Target
        </h2>
      </div>

      <div className="space-y-3">
        {!hideFilenameInput && onChangeOutputFilename ? (
          <div>
            <label className="block font-caption text-caption text-text-muted mb-1">
              {filenameLabel}
            </label>
            <input
              type="text"
              value={outputFilename}
              onChange={(e) => onChangeOutputFilename(e.target.value)}
              placeholder={filenamePlaceholder}
              disabled={disabled}
              className="w-full h-9 bg-surface-elevated border border-border-default rounded-lg px-3 font-body-sm text-body-sm text-text-primary disabled:opacity-50 focus:outline-none focus:border-primary-container"
            />
            {filenameHint && (
              <p className="font-caption text-caption text-text-muted mt-1 leading-snug">
                {filenameHint}
              </p>
            )}
          </div>
        ) : (
          filenameHint && (
            <p className="font-caption text-caption text-text-muted leading-snug">
              {filenameHint}
            </p>
          )
        )}

        <div>
          <label className="block font-caption text-caption text-text-muted mb-1">
            Output Folder
          </label>
          <div className="flex items-center gap-2">
            <div
              title={effectiveFolder || "Documents/XENON_Exports"}
              className="h-9 flex-1 bg-surface-elevated border border-border-default rounded-lg px-3 flex items-center font-mono-metric text-caption text-text-secondary truncate"
            >
              {effectiveFolder || "Documents/XENON_Exports"}
            </div>
            <button
              type="button"
              onClick={() => void handleBrowseFolder()}
              className="h-9 px-3 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default text-text-primary font-body-sm text-body-sm shrink-0"
            >
              Browse
            </button>
          </div>
        </div>

        {isProcessing && (
          <div className="p-2.5 rounded-lg bg-surface-elevated border border-primary/30 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <AppIcon name="refresh" className="w-4 h-4 text-primary animate-spin shrink-0" />
                <span className="font-caption text-caption text-text-primary font-medium truncate">
                  {processingLabel}
                </span>
              </div>
              <span className="font-mono-metric text-[11px] text-primary shrink-0">
                {typeof processingPercent === "number"
                  ? `${Math.round(processingPercent)}%`
                  : "Running..."}
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-surface-container overflow-hidden">
              <div
                className={`h-full bg-primary rounded-full transition-all duration-150 ${
                  typeof processingPercent === "number" ? "" : "w-2/3 animate-pulse"
                }`}
                style={
                  typeof processingPercent === "number"
                    ? { width: `${Math.max(5, Math.min(100, processingPercent))}%` }
                    : undefined
                }
              />
            </div>
          </div>
        )}

        {children}
      </div>
    </div>
  );
};
