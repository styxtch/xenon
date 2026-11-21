import React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "../../lib/tauriClient";
import { AppIcon } from "../common/AppIcon";

export const TitleBar: React.FC = () => {
  const isMac =
    typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);

  const handleMinimize = async () => {
    if (isTauriRuntime()) {
      await getCurrentWindow().minimize();
    }
  };

  const handleToggleMaximize = async () => {
    if (isTauriRuntime()) {
      await getCurrentWindow().toggleMaximize();
    }
  };

  const handleClose = async () => {
    if (isTauriRuntime()) {
      await getCurrentWindow().close();
    }
  };

  return (
    <div
      data-tauri-drag-region
      className="fixed top-0 left-0 right-0 h-10 bg-bg-sidebar z-50 flex items-center justify-between px-space-md select-none border-b border-border-subtle"
    >
      <div data-tauri-drag-region className="flex items-center gap-space-sm min-w-0">
        {isMac && (
          <div className="flex items-center gap-1.5 mr-space-sm">
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close window"
              className="w-3 h-3 rounded-full bg-[#EF4444] opacity-80 hover:opacity-100 transition-opacity focus:outline-none"
            />
            <button
              type="button"
              onClick={handleMinimize}
              aria-label="Minimize window"
              className="w-3 h-3 rounded-full bg-[#F59E0B] opacity-80 hover:opacity-100 transition-opacity focus:outline-none"
            />
            <button
              type="button"
              onClick={handleToggleMaximize}
              aria-label="Maximize window"
              className="w-3 h-3 rounded-full bg-[#22C55E] opacity-80 hover:opacity-100 transition-opacity focus:outline-none"
            />
          </div>
        )}
        <span
          data-tauri-drag-region
          className="font-caption text-caption text-text-muted truncate"
        >
          XENON Private PDF Workspace v1.0.0 — Your Documents. Your Device. Your Privacy.
        </span>
      </div>

      <div className="flex items-center gap-space-sm">
        <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-card border border-border-subtle font-caption text-caption text-primary">
          <span className="w-1.5 h-1.5 rounded-full bg-status-success" />
          100% Offline
        </span>
        {!isMac && (
          <div className="flex items-center gap-1 text-text-muted pl-space-sm">
            <button
              type="button"
              onClick={handleMinimize}
              title="Minimize"
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-hover hover:text-text-primary transition-colors"
            >
              <AppIcon name="remove" className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleToggleMaximize}
              title="Maximize"
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-hover hover:text-text-primary transition-colors"
            >
              <AppIcon name="crop_square" className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleClose}
              title="Close"
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-status-danger hover:text-text-primary transition-colors"
            >
              <AppIcon name="close" className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
