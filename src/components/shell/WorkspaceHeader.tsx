import React from "react";
import { useTelemetryStore } from "../../stores/telemetryStore";
import type { ActiveViewId } from "../../types/xenon";
import { AppIcon } from "../common/AppIcon";

interface WorkspaceHeaderProps {
  activeView: ActiveViewId;
}

const VIEW_LABELS: Record<ActiveViewId, string> = {
  dashboard: "Dashboard",
  "batch-queue": "Batch Queue",
  "organize-pdf": "Organize PDF",
  "optimize-repair": "Optimize & Repair",
  "convert-ocr": "Convert & OCR",
  "security-sign": "Security & Sign",
  settings: "Settings & Engines",
};

export const WorkspaceHeader: React.FC<WorkspaceHeaderProps> = ({
  activeView,
}) => {
  const telemetry = useTelemetryStore((s) => s.telemetry);

  return (
    <header className="fixed top-0 left-[250px] right-0 h-14 bg-bg-canvas/90 backdrop-blur-md border-b border-border-subtle z-30 flex items-center justify-between px-space-xl">
      <div className="flex items-center gap-space-sm text-text-muted font-body-sm text-body-sm">
        <AppIcon name="home" className="w-4 h-4" />
        <span>/</span>
        <span>Workspace</span>
        <span>/</span>
        <span className="text-text-primary font-medium">{VIEW_LABELS[activeView]}</span>
      </div>

      <div className="flex items-center gap-space-md">
        <div className="hidden md:flex items-center gap-space-sm">
          <div className="flex items-center gap-1.5 text-text-muted font-mono-metric text-mono-metric bg-surface-card px-2.5 py-1 rounded border border-border-subtle">
            <AppIcon name="memory" className="w-3.5 h-3.5 text-primary" />
            <span>RAM: {telemetry.ramUsedMb} MB | Rust Core</span>
          </div>
          <div className="flex items-center gap-1.5 text-text-muted font-mono-metric text-mono-metric bg-surface-card px-2.5 py-1 rounded border border-border-subtle">
            <AppIcon name="tune" className="w-3.5 h-3.5 text-tag-organize" />
            <span>Threads: {telemetry.activeWorkerThreads}</span>
          </div>
        </div>
      </div>
    </header>
  );
};
