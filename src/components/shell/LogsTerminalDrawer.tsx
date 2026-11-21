import React, { useMemo, useState } from "react";
import { useTelemetryStore } from "../../stores/telemetryStore";
import type { LogLevel } from "../../types/xenon";
import { AppIcon } from "../common/AppIcon";

const LEVELS: ("ALL" | LogLevel)[] = ["ALL", "INFO", "CMD", "WARN", "ERR"];

const LEVEL_STYLES: Record<LogLevel, string> = {
  INFO: "text-status-success bg-status-success/10 border-status-success/30",
  CMD: "text-tag-organize bg-tag-organize/10 border-tag-organize/30",
  WARN: "text-tag-optimize bg-tag-optimize/10 border-tag-optimize/30",
  ERR: "text-status-danger bg-status-danger/10 border-status-danger/30",
};

export const LogsTerminalDrawer: React.FC = () => {
  const isOpen = useTelemetryStore((s) => s.isLogsDrawerOpen);
  const logs = useTelemetryStore((s) => s.logs);
  const filterLevel = useTelemetryStore((s) => s.logFilterLevel);
  const isVerifyingAll = useTelemetryStore((s) => s.isVerifyingAll);
  const toggleLogsDrawer = useTelemetryStore((s) => s.toggleLogsDrawer);
  const setLogFilterLevel = useTelemetryStore((s) => s.setLogFilterLevel);
  const runDiagnostics = useTelemetryStore((s) => s.runDiagnostics);
  const clearLogs = useTelemetryStore((s) => s.clearLogs);

  const [searchText, setSearchText] = useState("");
  const [copied, setCopied] = useState(false);

  const visibleLogs = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return logs.filter((entry) => {
      if (filterLevel !== "ALL" && entry.level !== filterLevel) return false;
      if (
        q &&
        !entry.message.toLowerCase().includes(q) &&
        !entry.engine.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [logs, filterLevel, searchText]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    const text = visibleLogs
      .map((l) => `[${l.timestamp}] [${l.level}] (${l.engine}) ${l.message}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-[1px]">
      <div
        className="w-full max-w-[520px] h-full bg-surface-container-lowest border-l border-border-default flex flex-col shadow-2xl"
        role="dialog"
        aria-label="Engine Logs and Terminal"
      >
        <div className="h-14 px-4 border-b border-border-default bg-bg-sidebar flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AppIcon name="terminal" className="w-5 h-5 text-primary" />
            <div>
              <h2 className="font-headline-sm text-headline-sm text-text-primary">
                Logs &amp; Terminal
              </h2>
              <p className="font-caption text-caption text-text-muted">
                Real-time Rust IPC, QPDF, Ghostscript &amp; PDFium stdout/stderr
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => toggleLogsDrawer(false)}
            className="w-8 h-8 rounded-lg bg-surface-elevated hover:bg-surface-hover flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
            title="Close Drawer (Ctrl+L)"
          >
            <AppIcon name="close" className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 border-b border-border-subtle bg-surface-container-low flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              {LEVELS.map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setLogFilterLevel(lvl)}
                  className={`px-2 py-1 rounded text-caption font-mono-metric border transition-colors ${
                    filterLevel === lvl
                      ? "bg-surface-active text-primary border-primary-container"
                      : "bg-surface-card text-text-secondary border-border-subtle hover:text-text-primary"
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => runDiagnostics()}
                disabled={isVerifyingAll}
                className="px-2.5 py-1 rounded bg-surface-elevated hover:bg-surface-hover text-text-primary font-caption text-caption border border-border-default flex items-center gap-1"
              >
                <AppIcon name="bug_report" className="w-3.5 h-3.5 text-primary" />
                <span>{isVerifyingAll ? "Checking..." : "Run Diagnostics"}</span>
              </button>
              <button
                type="button"
                onClick={handleCopy}
                className="px-2.5 py-1 rounded bg-surface-elevated hover:bg-surface-hover text-text-secondary hover:text-text-primary font-caption text-caption border border-border-default flex items-center gap-1"
              >
                <AppIcon name="content_copy" className="w-3.5 h-3.5" />
                <span>{copied ? "Copied" : "Copy"}</span>
              </button>
              <button
                type="button"
                onClick={() => clearLogs()}
                className="px-2.5 py-1 rounded bg-surface-elevated hover:bg-surface-hover text-status-danger font-caption text-caption border border-border-default"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="relative">
            <span className="absolute left-2.5 top-2 text-text-muted">
              <AppIcon name="search" className="w-4 h-4" />
            </span>
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Filter logs by engine or message..."
              className="w-full h-8 bg-surface-elevated border border-border-default rounded-lg pl-8 pr-3 font-mono-metric text-caption text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-container"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 font-mono-metric text-caption">
          {visibleLogs.length === 0 ? (
            <div className="h-full flex items-center justify-center text-text-muted">
              No log entries match the current filter.
            </div>
          ) : (
            visibleLogs.map((entry) => (
              <div
                key={entry.id}
                className="p-2 rounded bg-surface-container-low border border-border-subtle flex flex-col gap-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`px-1.5 py-0.2 rounded border text-[10px] ${
                        LEVEL_STYLES[entry.level] ?? LEVEL_STYLES.INFO
                      }`}
                    >
                      {entry.level}
                    </span>
                    <span className="text-primary font-semibold">[{entry.engine}]</span>
                  </div>
                  <span className="text-text-muted">{entry.timestamp}</span>
                </div>
                <p className="text-text-secondary break-words leading-relaxed">
                  {entry.message}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
