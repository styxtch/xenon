import React from "react";
import { useImportProgressStore } from "../../stores/importProgressStore";
import { AppIcon } from "./AppIcon";

interface InlineImportProgressProps {
  className?: string;
}

export const InlineImportProgress: React.FC<InlineImportProgressProps> = ({
  className = "",
}) => {
  const isImporting = useImportProgressStore((s) => s.isImporting);
  const fileName = useImportProgressStore((s) => s.fileName);
  const stage = useImportProgressStore((s) => s.stage);
  const current = useImportProgressStore((s) => s.current);
  const total = useImportProgressStore((s) => s.total);
  const percentage = useImportProgressStore((s) => s.percentage);

  if (!isImporting) return null;

  return (
    <div
      className={`rounded-xl border border-primary/30 bg-surface-elevated/90 p-4 flex flex-col gap-2.5 shadow-sm ${className}`}
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center text-primary shrink-0">
          <AppIcon name="refresh" className="w-5 h-5 animate-spin" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-body-medium text-body-medium font-semibold text-text-primary truncate">
            {fileName || "Importing file(s)..."}
          </div>
          <div className="font-caption text-caption text-text-muted truncate">
            {stage || "Reading document"}
            {total > 1 ? ` (${current}/${total})` : ""}
          </div>
        </div>
        <span className="font-mono-metric text-body-sm text-primary font-semibold shrink-0">
          {Math.round(percentage)}%
        </span>
      </div>
      <div className="w-full h-2 rounded-full bg-surface-card overflow-hidden border border-border-subtle">
        <div
          className="h-full bg-primary transition-all duration-150 rounded-full"
          style={{ width: `${Math.max(8, Math.min(100, percentage))}%` }}
        />
      </div>
    </div>
  );
};
