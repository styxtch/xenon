import React from "react";
import { useDragDropStore } from "../../stores/dragDropStore";
import { useImportProgressStore } from "../../stores/importProgressStore";
import { AppIcon } from "./AppIcon";

interface DropZoneWellProps {
  title: string;
  subtitle: string;
  onSelectFiles: () => void;
  accentClass?: string;
}

export const DropZoneWell: React.FC<DropZoneWellProps> = ({
  title,
  subtitle,
  onSelectFiles,
  accentClass = "text-primary",
}) => {
  const isDraggingFiles = useDragDropStore((s) => s.isDraggingFiles);
  const isImporting = useImportProgressStore((s) => s.isImporting);
  const importFileName = useImportProgressStore((s) => s.fileName);
  const importStage = useImportProgressStore((s) => s.stage);
  const importPercent = useImportProgressStore((s) => s.percentage);

  return (
    <button
      type="button"
      disabled={isImporting}
      onClick={onSelectFiles}
      className={`w-full rounded-xl border border-dashed transition-colors p-6 flex flex-col items-center justify-center gap-2 text-center group disabled:cursor-wait ${
        isDraggingFiles
          ? "border-primary bg-primary/10 ring-2 ring-primary/30"
          : "border-border-default bg-surface-container hover:bg-surface-elevated hover:border-primary-container"
      }`}
    >
      <div
        className={`w-11 h-11 rounded-lg bg-surface-elevated border border-border-default flex items-center justify-center ${accentClass}`}
      >
        <AppIcon
          name={isImporting ? "refresh" : "upload_file"}
          className={`w-6 h-6 ${isImporting ? "animate-spin text-primary" : ""}`}
        />
      </div>
      <span className="font-body-medium text-body-medium text-text-primary">
        {isImporting ? importFileName || "Importing file(s)..." : title}
      </span>
      <span className="font-caption text-caption text-text-muted">
        {isImporting ? `${importStage} (${Math.round(importPercent)}%)` : subtitle}
      </span>
      {isImporting && (
        <div className="w-full max-w-xs h-1.5 rounded-full bg-surface-elevated overflow-hidden mt-1">
          <div
            className="h-full bg-primary transition-all duration-200 rounded-full"
            style={{ width: `${Math.max(8, Math.min(100, importPercent))}%` }}
          />
        </div>
      )}
      {isDraggingFiles && !isImporting && (
        <span className="mt-1 px-2.5 py-0.5 rounded-full bg-primary/20 border border-primary/40 font-caption text-caption text-primary font-medium">
          Release to drop files
        </span>
      )}
    </button>
  );
};
