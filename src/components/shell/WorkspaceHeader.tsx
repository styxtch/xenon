import React from "react";
import { useTelemetryStore } from "../../stores/telemetryStore";
import type { ActiveViewId } from "../../types/xenon";
import { AppIcon } from "../common/AppIcon";

interface WorkspaceHeaderProps {
  activeView: ActiveViewId;
  onOpenFiles: () => void;
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
  onOpenFiles,
}) => {
  const telemetry = useTelemetryStore((s) => s.telemetry);
  const toggleLogsDrawer = useTelemetryStore((s) => s.toggleLogsDrawer);

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

        <button
          type="button"
          onClick={() => toggleLogsDrawer(true)}
          title="Toggle Logs & Terminal (Ctrl+L)"
          className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover text-text-secondary hover:text-text-primary border border-border-default font-caption text-caption transition-colors"
        >
          <AppIcon name="terminal" className="w-3.5 h-3.5 text-primary" />
          <span>Logs</span>
        </button>

        <button
          type="button"
          onClick={onOpenFiles}
          className="inline-flex items-center gap-1.5 bg-primary-container hover:bg-primary-fixed transition-colors text-on-primary-container font-body-medium text-body-medium px-3.5 py-1.5 rounded-lg shadow-sm font-semibold"
        >
          <AppIcon name="file_open" className="w-[18px] h-[18px]" />
          <span>Open Files (Ctrl+O)</span>
        </button>
      </div>
    </header>
  );
};
