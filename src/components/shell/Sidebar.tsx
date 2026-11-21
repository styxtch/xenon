import React, { useMemo, useState } from "react";
import { useQueueStore } from "../../stores/queueStore";
import { useTelemetryStore } from "../../stores/telemetryStore";
import type { ActiveViewId } from "../../types/xenon";
import { AppIcon } from "../common/AppIcon";

interface SidebarProps {
  activeView: ActiveViewId;
  onNavigate: (view: ActiveViewId) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

interface QuickCommandItem {
  label: string;
  hint: string;
  view: ActiveViewId;
}

const QUICK_COMMANDS: QuickCommandItem[] = [
  { label: "Dashboard Overview", hint: "KPIs & Recent", view: "dashboard" },
  { label: "Batch Queue", hint: "Pause / Resume", view: "batch-queue" },
  { label: "Organize PDF", hint: "Grid / Merge / Split", view: "organize-pdf" },
  { label: "Optimize & Repair", hint: "Compress / Linearize", view: "optimize-repair" },
  { label: "Convert & OCR", hint: "PDF/A / Diff / Forms", view: "convert-ocr" },
  { label: "Security & Sign", hint: "AES-256 / Redact / .p12", view: "security-sign" },
  { label: "Settings & Engines", hint: "SHA-256 / Hardware", view: "settings" },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeView,
  onNavigate,
  searchInputRef,
}) => {
  const [query, setQuery] = useState("");
  const logsCount = useTelemetryStore((s) => s.logs.length);
  const isLogsDrawerOpen = useTelemetryStore((s) => s.isLogsDrawerOpen);
  const toggleLogsDrawer = useTelemetryStore((s) => s.toggleLogsDrawer);
  const activeQueueCount = useQueueStore(
    (s) => s.jobs.filter((j) => j.status === "processing" || j.status === "queued").length
  );

  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return QUICK_COMMANDS.filter(
      (item) =>
        item.label.toLowerCase().includes(q) || item.hint.toLowerCase().includes(q)
    );
  }, [query]);

  const navClass = (id: ActiveViewId) =>
    activeView === id
      ? "flex items-center justify-between px-2.5 py-2 transition-colors bg-surface-active text-primary font-body-medium rounded-lg"
      : "flex items-center justify-between px-2.5 py-2 rounded-lg text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors font-body-default text-body-default";

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[250px] bg-bg-sidebar border-r border-border-subtle z-40 flex flex-col justify-between overflow-y-auto">
      <div className="p-space-md flex flex-col gap-space-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-space-sm">
            <div className="w-8 h-8 rounded-lg bg-surface-elevated border border-border-default flex items-center justify-center text-primary">
              <AppIcon name="bolt" className="w-5 h-5" />
            </div>
            <span className="font-headline-sm text-headline-sm text-text-primary font-bold tracking-tight">
              XENON
            </span>
          </div>
          <span className="font-caption text-caption px-1.5 py-0.5 rounded bg-surface-elevated text-primary border border-border-default">
            v1.0
          </span>
        </div>

        <div className="relative">
          <span className="absolute left-2.5 top-2.5 text-text-muted">
            <AppIcon name="search" className="w-4 h-4" />
          </span>
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools or actions... Ctrl+K"
            className="w-full h-9 bg-surface-elevated border border-border-default rounded-lg pl-8 pr-3 font-body-sm text-body-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-container transition-colors"
          />
          {filteredCommands.length > 0 && (
            <div className="absolute left-0 right-0 top-10 bg-surface-card border border-border-default rounded-lg shadow-xl z-50 p-1 flex flex-col gap-0.5">
              {filteredCommands.map((cmd) => (
                <button
                  key={cmd.view}
                  type="button"
                  onClick={() => {
                    onNavigate(cmd.view);
                    setQuery("");
                  }}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded text-left hover:bg-surface-hover text-text-primary font-body-sm text-body-sm"
                >
                  <span>{cmd.label}</span>
                  <span className="font-caption text-caption text-text-muted">{cmd.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <nav className="flex flex-col gap-0.5" aria-label="Main navigation">
          <span className="px-2.5 py-1 font-caption text-caption text-text-muted uppercase tracking-wider">
            Main
          </span>
          <button
            type="button"
            onClick={() => onNavigate("dashboard")}
            className={navClass("dashboard")}
          >
            <div className="flex items-center gap-space-sm">
              <AppIcon name="dashboard" className="w-[18px] h-[18px]" />
              <span>Dashboard</span>
            </div>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("batch-queue")}
            className={navClass("batch-queue")}
          >
            <div className="flex items-center gap-space-sm">
              <AppIcon name="layers" className="w-[18px] h-[18px]" />
              <span>Batch Queue</span>
            </div>
            {activeQueueCount > 0 && (
              <span className="font-mono-metric text-caption px-1.5 py-0.5 rounded bg-surface-card text-primary border border-border-default">
                {activeQueueCount}
              </span>
            )}
          </button>
        </nav>

        <div className="h-px bg-border-subtle my-0.5" />

        <nav className="flex flex-col gap-0.5" aria-label="PDF Suites navigation">
          <span className="px-2.5 py-1 font-caption text-caption text-text-muted uppercase tracking-wider">
            PDF Suites
          </span>
          <button
            type="button"
            onClick={() => onNavigate("organize-pdf")}
            className={navClass("organize-pdf")}
          >
            <div className="flex items-center gap-space-sm">
              <AppIcon name="grid_view" className="w-[18px] h-[18px] text-tag-organize" />
              <span>Organize PDF</span>
            </div>
            <span className="font-caption text-caption text-text-muted">Merge/Split</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("optimize-repair")}
            className={navClass("optimize-repair")}
          >
            <div className="flex items-center gap-space-sm">
              <AppIcon name="compress" className="w-[18px] h-[18px] text-tag-optimize" />
              <span>Optimize &amp; Repair</span>
            </div>
            <span className="font-caption text-caption text-text-muted">Shrink</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("convert-ocr")}
            className={navClass("convert-ocr")}
          >
            <div className="flex items-center gap-space-sm">
              <AppIcon name="transform" className="w-[18px] h-[18px] text-tag-convert" />
              <span>Convert &amp; OCR</span>
            </div>
            <span className="font-caption text-caption text-text-muted">Text/Img</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("security-sign")}
            className={navClass("security-sign")}
          >
            <div className="flex items-center gap-space-sm">
              <AppIcon name="lock" className="w-[18px] h-[18px] text-tag-security" />
              <span>Security &amp; Sign</span>
            </div>
            <span className="font-caption text-caption text-text-muted">Protect</span>
          </button>
        </nav>

        <div className="h-px bg-border-subtle my-0.5" />

        <nav className="flex flex-col gap-0.5" aria-label="System navigation">
          <span className="px-2.5 py-1 font-caption text-caption text-text-muted uppercase tracking-wider">
            System
          </span>
          <button
            type="button"
            onClick={() => onNavigate("settings")}
            className={navClass("settings")}
          >
            <div className="flex items-center gap-space-sm">
              <AppIcon name="tune" className="w-[18px] h-[18px]" />
              <span>Settings &amp; Engines</span>
            </div>
          </button>
          <button
            type="button"
            onClick={() => toggleLogsDrawer()}
            className={
              isLogsDrawerOpen
                ? "flex items-center justify-between px-2.5 py-2 transition-colors bg-surface-active text-primary font-body-medium rounded-lg"
                : "flex items-center justify-between px-2.5 py-2 rounded-lg text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors font-body-default text-body-default"
            }
          >
            <div className="flex items-center gap-space-sm">
              <AppIcon name="terminal" className="w-[18px] h-[18px]" />
              <span>Logs &amp; Terminal</span>
            </div>
            <span className="font-mono-metric text-caption px-1.5 py-0.5 rounded bg-surface-card text-text-muted border border-border-subtle">
              {logsCount}
            </span>
          </button>
        </nav>
      </div>

      <div className="p-space-md">
        <div className="bg-surface-card border border-border-default rounded-xl p-3 flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-primary">
            <AppIcon name="verified_user" className="w-[18px] h-[18px]" />
            <span className="font-body-medium text-body-medium text-text-primary font-medium">
              100% Local &amp; Private
            </span>
          </div>
          <p className="font-caption text-caption text-text-muted leading-relaxed">
            Your Documents. Your Device. Your Privacy. Zero cloud uploads — executed locally via bundled Rust binaries.
          </p>
        </div>
      </div>
    </aside>
  );
};
