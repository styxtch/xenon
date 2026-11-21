import React, { useMemo, useState } from "react";
import { AppIcon } from "../components/common/AppIcon";
import { CategoryBadge } from "../components/common/CategoryBadge";
import { SegmentedTickProgress } from "../components/common/SegmentedTickProgress";
import { formatBytes, formatCompressionDelta, tauriClient } from "../lib/tauriClient";
import { useHistoryStore } from "../stores/historyStore";
import { useTelemetryStore } from "../stores/telemetryStore";
import type { ActiveViewId, SuiteCategory } from "../types/xenon";

interface DashboardViewProps {
  onNavigate: (view: ActiveViewId) => void;
  onOpenFiles: () => void;
}

interface SuiteToolItem {
  id: ActiveViewId;
  category: SuiteCategory;
  title: string;
  engineBadge: string;
  description: string;
  icon: string;
  iconColorClass: string;
  badgeTextClass: string;
}

const TOOL_SUITES: SuiteToolItem[] = [
  {
    id: "organize-pdf",
    category: "organize",
    title: "Organize & Merge PDF",
    engineBadge: "QPDF Engine",
    description: "Merge, Split per range, Extract, and drag-and-drop Reorder pages",
    icon: "layers",
    iconColorClass: "text-tag-organize",
    badgeTextClass: "text-tag-organize",
  },
  {
    id: "optimize-repair",
    category: "optimize",
    title: "Compress & Repair PDF",
    engineBadge: "Ghostscript v10",
    description: "Ghostscript downsampling (Screen, Ebook, Prepress) & xref rebuild",
    icon: "compress",
    iconColorClass: "text-tag-optimize",
    badgeTextClass: "text-tag-optimize",
  },
  {
    id: "convert-ocr",
    category: "convert",
    title: "Convert to / from PDF",
    engineBadge: "PDFium Vector",
    description: "High-Res JPG/PNG render, Images to PDF, OCR (eng+ind) & ISO PDF/A",
    icon: "transform",
    iconColorClass: "text-tag-convert",
    badgeTextClass: "text-tag-convert",
  },
  {
    id: "security-sign",
    category: "security",
    title: "Protect, Sign & Flatten",
    engineBadge: "Rust Crypto",
    description: "AES-256 permissions, PKCS#12 signatures, True Redaction & Watermark",
    icon: "lock_reset",
    iconColorClass: "text-tag-security",
    badgeTextClass: "text-tag-security",
  },
];

const FILTER_CYCLE: ("all" | SuiteCategory)[] = [
  "all",
  "organize",
  "optimize",
  "convert",
  "security",
];

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigate,
  onOpenFiles,
}) => {
  const metrics = useHistoryStore((s) => s.metrics);
  const searchQuery = useHistoryStore((s) => s.searchQuery);
  const categoryFilter = useHistoryStore((s) => s.categoryFilter);
  const setSearchQuery = useHistoryStore((s) => s.setSearchQuery);
  const setCategoryFilter = useHistoryStore((s) => s.setCategoryFilter);
  const cancelJob = useHistoryStore((s) => s.cancelJob);
  const rerunJob = useHistoryStore((s) => s.rerunJob);
  const telemetry = useTelemetryStore((s) => s.telemetry);

  const [suiteQuery, setSuiteQuery] = useState("");
  const [suiteCategory, setSuiteCategory] = useState<"all" | SuiteCategory>("all");
  const [recentPage, setRecentPage] = useState(1);
  const [recentPageSize, setRecentPageSize] = useState<10 | 25 | 50 | 100>(10);

  const filteredSuites = useMemo(() => {
    const q = suiteQuery.trim().toLowerCase();
    return TOOL_SUITES.filter((s) => {
      if (suiteCategory !== "all" && s.category !== suiteCategory) return false;
      if (
        q &&
        !s.title.toLowerCase().includes(q) &&
        !s.description.toLowerCase().includes(q) &&
        !s.engineBadge.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [suiteQuery, suiteCategory]);

  const filteredRecentDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return metrics.recentDocuments.filter((doc) => {
      if (categoryFilter !== "all" && doc.category !== categoryFilter) return false;
      if (
        q &&
        !doc.documentName.toLowerCase().includes(q) &&
        !doc.operationLabel.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [metrics.recentDocuments, searchQuery, categoryFilter]);

  const activeProcessingCount = metrics.recentDocuments.filter(
    (d) => d.status === "processing" || d.status === "queued"
  ).length;

  const cycleSuiteFilter = () => {
    const idx = FILTER_CYCLE.indexOf(suiteCategory);
    setSuiteCategory(FILTER_CYCLE[(idx + 1) % FILTER_CYCLE.length]);
  };

  const docIconForCategory = (cat: SuiteCategory) => {
    switch (cat) {
      case "optimize":
        return { icon: "description", color: "text-tag-optimize" };
      case "security":
        return { icon: "verified", color: "text-tag-security" };
      case "convert":
        return { icon: "difference", color: "text-tag-convert" };
      default:
        return { icon: "folder_copy", color: "text-tag-organize" };
    }
  };

  return (
    <div className="flex flex-col w-full gap-space-xl">
      {/* Top Welcome Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-headline-lg text-headline-lg text-text-primary tracking-tight">
              Welcome to XENON ⚡
            </h1>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full font-mono-metric text-mono-metric bg-surface-elevated text-primary border border-border-default">
              Private PDF Workspace
            </span>
          </div>
          <p className="font-body-default text-body-default text-text-secondary">
            Your Documents. Your Device. Your Privacy. — Offline Engine: Ghostscript v10.03, PDFium, QPDF &amp; Lopdf
          </p>
        </div>

        <div className="flex items-center gap-space-sm shrink-0">
          <button
            type="button"
            onClick={() => onNavigate("batch-queue")}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover text-text-primary font-body-medium text-body-medium border border-border-default transition-colors shadow-sm"
          >
            <AppIcon name="stacks" className="w-[18px] h-[18px] text-text-secondary" />
            <span>Quick Batch Process</span>
          </button>
          <button
            type="button"
            onClick={onOpenFiles}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-container hover:bg-primary-fixed text-on-primary-container font-body-medium text-body-medium font-semibold transition-colors shadow-md"
          >
            <AppIcon name="add_circle" className="w-[18px] h-[18px]" />
            <span>+ Open PDF Files</span>
          </button>
        </div>
      </div>

      {/* 4 Stat / KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
        <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col justify-between shadow-sm hover:bg-surface-elevated transition-colors">
          <div className="flex items-start justify-between">
            <span className="font-body-medium text-body-medium text-text-secondary">
              Processed Today
            </span>
            <div className="w-10 h-10 rounded-lg bg-surface-elevated border border-border-subtle flex items-center justify-center text-tag-organize">
              <AppIcon name="folder" className="w-[22px] h-[22px]" />
            </div>
          </div>
          <div className="flex flex-col mt-3">
            <span className="font-display-kpi text-display-kpi text-text-primary font-semibold tracking-tight">
              {metrics.processedTodayCount} Files
            </span>
            <div className="flex items-center gap-1.5 mt-1 font-mono-metric text-mono-metric text-status-success">
              <AppIcon name="trending_up" className="w-4 h-4" />
              <span>
                {metrics.processedTodayDelta >= 0
                  ? `+${metrics.processedTodayDelta}`
                  : metrics.processedTodayDelta}{" "}
                vs yesterday
              </span>
            </div>
          </div>
        </div>

        <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col justify-between shadow-sm hover:bg-surface-elevated transition-colors">
          <div className="flex items-start justify-between">
            <span className="font-body-medium text-body-medium text-text-secondary">
              Space Saved
            </span>
            <div className="w-10 h-10 rounded-lg bg-surface-elevated border border-border-subtle flex items-center justify-center text-tag-optimize">
              <AppIcon name="pie_chart" className="w-[22px] h-[22px]" />
            </div>
          </div>
          <div className="flex flex-col mt-3">
            <span className="font-display-kpi text-display-kpi text-text-primary font-semibold tracking-tight">
              {formatBytes(metrics.totalSpaceSavedBytes)}
            </span>
            <div className="flex items-center gap-1.5 mt-1 font-mono-metric text-mono-metric text-status-success">
              <AppIcon name="arrow_downward" className="w-4 h-4" />
              <span>{Math.round(metrics.averageCompressionRatioPercent)}% avg compression</span>
            </div>
          </div>
        </div>

        <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col justify-between shadow-sm hover:bg-surface-elevated transition-colors">
          <div className="flex items-start justify-between">
            <span className="font-body-medium text-body-medium text-text-secondary">
              Queue Status
            </span>
            <div className="w-10 h-10 rounded-lg bg-surface-elevated border border-border-subtle flex items-center justify-center text-primary">
              <AppIcon name="check_circle" className="w-[22px] h-[22px]" />
            </div>
          </div>
          <div className="flex flex-col mt-3">
            <span className="font-display-kpi text-display-kpi text-text-primary font-semibold tracking-tight">
              {activeProcessingCount > 0 ? "Active" : "Idle"}
            </span>
            <div className="flex items-center gap-1.5 mt-1 font-mono-metric text-mono-metric text-text-muted">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  activeProcessingCount > 0 ? "bg-tag-optimize animate-pulse" : "bg-status-success"
                }`}
              />
              <span>
                {activeProcessingCount} Pending / {telemetry.activeWorkerThreads} Threads Ready
              </span>
            </div>
          </div>
        </div>

        <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col justify-between shadow-sm hover:bg-surface-elevated transition-colors">
          <div className="flex items-start justify-between">
            <span className="font-body-medium text-body-medium text-text-secondary">
              Secured Files
            </span>
            <div className="w-10 h-10 rounded-lg bg-surface-elevated border border-border-subtle flex items-center justify-center text-tag-security">
              <AppIcon name="lock" className="w-[22px] h-[22px]" />
            </div>
          </div>
          <div className="flex flex-col mt-3">
            <span className="font-display-kpi text-display-kpi text-text-primary font-semibold tracking-tight">
              {metrics.securedFilesCount} PDFs
            </span>
            <div className="flex items-center gap-1.5 mt-1 font-mono-metric text-mono-metric text-tag-security">
              <AppIcon name="verified_user" className="w-4 h-4" />
              <span>AES-256 &amp; PKCS#12</span>
            </div>
          </div>
        </div>
      </div>

      {/* Middle Section (2fr 1fr Split) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-md">
        {/* Core PDF Tool Suites */}
        <div className="lg:col-span-2 bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col gap-space-md shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm">
            <div className="flex items-center gap-2">
              <AppIcon name="handyman" className="w-5 h-5 text-primary" />
              <h2 className="font-headline-sm text-headline-sm text-text-primary font-semibold">
                Core PDF Tool Suites
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <span className="absolute left-2.5 top-2 text-text-muted">
                  <AppIcon name="search" className="w-4 h-4" />
                </span>
                <input
                  type="text"
                  value={suiteQuery}
                  onChange={(e) => setSuiteQuery(e.target.value)}
                  placeholder="Search tool..."
                  className="w-44 h-8 bg-surface-elevated border border-border-default rounded-lg pl-8 pr-3 font-body-sm text-body-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-container transition-colors"
                />
              </div>
              <button
                type="button"
                onClick={cycleSuiteFilter}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover text-text-secondary border border-border-default font-label-default text-label-default transition-colors capitalize"
              >
                <AppIcon name="tune" className="w-3.5 h-3.5" />
                <span>{suiteCategory === "all" ? "Filter" : suiteCategory}</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            {filteredSuites.map((suite) => (
              <div
                key={suite.id}
                onClick={() => onNavigate(suite.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onNavigate(suite.id);
                }}
                className="bg-surface-elevated hover:bg-surface-hover border border-border-subtle rounded-lg p-3 flex items-center justify-between transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-lg bg-surface-card border border-border-subtle flex items-center justify-center shrink-0 ${suite.iconColorClass}`}
                  >
                    <AppIcon name={suite.icon} className="w-5 h-5" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-body-medium text-body-medium text-text-primary font-semibold">
                        {suite.title}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full font-mono-metric text-mono-metric bg-surface-card border border-border-subtle ${suite.badgeTextClass}`}
                      >
                        {suite.engineBadge}
                      </span>
                    </div>
                    <span className="font-body-sm text-body-sm text-text-secondary truncate mt-0.5">
                      {suite.description}
                    </span>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-card hover:bg-surface-active text-text-primary border border-border-default font-label-default text-label-default shrink-0 ml-4 transition-colors">
                  <span>Launch Tool</span>
                  <AppIcon name="arrow_forward" className="w-3.5 h-3.5" />
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Engine Performance Card */}
        <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col justify-between shadow-sm">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="font-headline-sm text-headline-sm text-text-primary font-semibold">
                Performance
              </span>
              <AppIcon name="memory" className="w-[18px] h-[18px] text-text-muted" />
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="font-display-kpi text-display-kpi text-text-primary font-semibold">
                {metrics.recentDocuments.length > 0
                  ? `${Math.round(
                      (metrics.recentDocuments.filter((d) => d.status === "completed").length /
                        metrics.recentDocuments.length) *
                        1000
                    ) / 10}%`
                  : "100%"}
              </span>
              <span className="font-mono-metric text-mono-metric text-status-success font-medium">
                {metrics.processedTodayCount} jobs today
              </span>
            </div>
            <span className="font-caption text-caption text-text-muted">
              Local Rust Core &amp; native sidecar completion rate
            </span>
          </div>

          <div className="pt-4 pb-2">
            <div className="h-32 flex items-end justify-between gap-2 px-1">
              {(() => {
                const maxCount = Math.max(
                  0,
                  ...metrics.weeklyThroughput.map((d) => d.count)
                );
                return metrics.weeklyThroughput.map((day) => {
                  const isPeak = maxCount > 0 && day.count === maxCount;
                  const heightPct =
                    day.count > 0 && maxCount > 0
                      ? Math.max(24, Math.round((day.count / maxCount) * 100))
                      : 18;
                  return (
                    <div
                      key={day.dayLabel}
                      className="flex-1 flex flex-col items-center h-full justify-end group"
                    >
                      <div className="w-full bg-surface-elevated rounded-t-md h-full flex flex-col justify-end p-1 relative overflow-hidden">
                        <div
                          className={`w-full rounded-sm flex items-center justify-center transition-all duration-500 ${
                            isPeak ? "bg-text-secondary shadow-sm" : "bg-surface-active"
                          }`}
                          style={{ height: `${heightPct}%` }}
                        >
                          <span
                            className={`font-mono-metric text-[10px] ${
                              isPeak
                                ? "text-surface-container-lowest font-bold"
                                : "text-text-secondary"
                            }`}
                          >
                            {day.count > 0 ? `${day.count}` : "0"}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`font-caption text-caption mt-2 ${
                          isPeak ? "text-text-primary font-semibold" : "text-text-muted"
                        }`}
                      >
                        {day.dayLabel}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          <div className="mt-2 bg-surface-elevated border border-border-subtle rounded-lg p-2.5 flex items-center justify-between text-text-muted font-mono-metric text-mono-metric">
            <div className="flex items-center gap-1.5">
              <AppIcon name="developer_board" className="w-4 h-4 text-primary" />
              <span>
                RAM: {telemetry.ramUsedMb} MB / {telemetry.totalRamGb} GB
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-tag-security" />
              <span>CPU: {telemetry.cpuUsagePercent.toFixed(1)}% Multi</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Table Card: Recent Processed Documents */}
      <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col gap-space-md shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm">
          <div className="flex items-center gap-2">
            <AppIcon name="history_toggle_off" className="w-5 h-5 text-tag-organize" />
            <h2 className="font-headline-sm text-headline-sm text-text-primary font-semibold">
              Recent Processed Documents
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <span className="absolute left-2.5 top-2 text-text-muted">
                <AppIcon name="search" className="w-4 h-4" />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setRecentPage(1);
                }}
                placeholder="Search here..."
                className="w-52 h-8 bg-surface-elevated border border-border-default rounded-lg pl-8 pr-3 font-body-sm text-body-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary-container transition-colors"
              />
            </div>
            <div className="relative flex items-center">
              <AppIcon
                name="filter_list"
                className="w-4 h-4 text-text-muted absolute left-2.5 pointer-events-none"
              />
              <select
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value as "all" | SuiteCategory);
                  setRecentPage(1);
                }}
                className="h-8 pl-8 pr-3 rounded-lg bg-surface-elevated hover:bg-surface-hover text-text-primary border border-border-default font-label-default text-label-default focus:outline-none focus:border-primary-container transition-colors cursor-pointer"
              >
                <option value="all">All Categories</option>
                <option value="organize">Organize</option>
                <option value="optimize">Optimize</option>
                <option value="convert">Convert</option>
                <option value="security">Security</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-text-muted font-caption text-caption uppercase tracking-wider">
                <th className="py-2 px-3 font-medium">Document Name</th>
                <th className="py-2 px-3 font-medium">Operation</th>
                <th className="py-2 px-3 font-medium">Engine Progress</th>
                <th className="py-2 px-3 font-medium">Size &amp; Ratio</th>
                <th className="py-2 px-3 font-medium">Processed</th>
                <th className="py-2 px-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="font-body-default text-body-default">
              {filteredRecentDocs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-text-muted font-body-sm text-body-sm">
                    No processed documents yet. Open a PDF file or launch any tool suite above to get started.
                  </td>
                </tr>
              ) : (
                filteredRecentDocs
                  .slice(
                    (Math.min(
                      recentPage,
                      Math.max(1, Math.ceil(filteredRecentDocs.length / recentPageSize))
                    ) -
                      1) *
                      recentPageSize,
                    Math.min(
                      recentPage,
                      Math.max(1, Math.ceil(filteredRecentDocs.length / recentPageSize))
                    ) *
                      recentPageSize
                  )
                  .map((doc, index) => {
                const iconMeta = docIconForCategory(doc.category);
                const ratio = formatCompressionDelta(doc.originalBytes, doc.outputBytes);
                const displaySize = doc.outputBytes
                  ? formatBytes(doc.outputBytes)
                  : formatBytes(doc.originalBytes);
                return (
                  <React.Fragment key={doc.jobId}>
                    {index > 0 && (
                      <tr className="h-2">
                        <td colSpan={6} />
                      </tr>
                    )}
                    <tr className="bg-surface-elevated hover:bg-surface-hover transition-colors">
                      <td className="py-3 px-3 rounded-l-lg">
                        <div className="flex items-center gap-2.5">
                          <AppIcon
                            name={iconMeta.icon}
                            className={`w-5 h-5 ${iconMeta.color}`}
                          />
                          <span className="font-body-medium text-body-medium text-text-primary font-medium truncate max-w-xs">
                            {doc.documentName}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <CategoryBadge category={doc.category} label={doc.operationLabel} />
                      </td>
                      <td className="py-3 px-3">
                        <SegmentedTickProgress
                          completedTicks={doc.completedTicks}
                          percentage={doc.percentage}
                          status={doc.status}
                          category={doc.category}
                        />
                      </td>
                      <td className="py-3 px-3 font-mono-metric text-mono-metric">
                        <span
                          className={
                            doc.status === "processing"
                              ? "text-text-secondary"
                              : "text-text-primary"
                          }
                        >
                          {displaySize}
                        </span>
                        {ratio && <span className="text-status-success ml-1">({ratio})</span>}
                      </td>
                      <td
                        className={`py-3 px-3 font-caption text-caption ${
                          doc.createdLabel === "Just now" ? "text-primary" : "text-text-muted"
                        }`}
                      >
                        {doc.createdLabel ?? "Recently"}
                      </td>
                      <td className="py-3 px-3 rounded-r-lg text-right">
                        <div className="inline-flex items-center gap-1">
                          {doc.status === "processing" ? (
                            <button
                              type="button"
                              onClick={() => cancelJob(doc.jobId)}
                              title="Cancel Operation"
                              className="p-1.5 rounded hover:bg-surface-card text-status-danger transition-colors"
                            >
                              <AppIcon name="stop_circle" className="w-[17px] h-[17px]" />
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (doc.outputPath) {
                                    await tauriClient.openFileInOs(doc.outputPath);
                                  }
                                }}
                                disabled={!doc.outputPath}
                                title="Open File"
                                className="p-1.5 rounded hover:bg-surface-card disabled:opacity-40 text-primary hover:text-primary-fixed transition-colors"
                              >
                                <AppIcon name="open_in_new" className="w-[17px] h-[17px]" />
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (doc.outputPath) {
                                    await tauriClient.revealInExplorer(doc.outputPath);
                                  }
                                }}
                                disabled={!doc.outputPath}
                                title="Open Folder in Explorer"
                                className="p-1.5 rounded hover:bg-surface-card disabled:opacity-40 text-text-secondary hover:text-text-primary transition-colors"
                              >
                                <AppIcon name="folder_open" className="w-[17px] h-[17px]" />
                              </button>
                              <button
                                type="button"
                                onClick={() => rerunJob(doc.jobId)}
                                title="Re-run Operation"
                                className="p-1.5 rounded hover:bg-surface-card text-text-secondary hover:text-text-primary transition-colors"
                              >
                                <AppIcon name="replay" className="w-[17px] h-[17px]" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  </React.Fragment>
                );
              })
              )}
            </tbody>
          </table>
        </div>

        {filteredRecentDocs.length > 0 && (() => {
          const totalPages = Math.max(1, Math.ceil(filteredRecentDocs.length / recentPageSize));
          const safePage = Math.min(recentPage, totalPages);
          const startItem = (safePage - 1) * recentPageSize + 1;
          const endItem = Math.min(filteredRecentDocs.length, safePage * recentPageSize);
          return (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border-subtle">
              <div className="flex items-center gap-3">
                <span className="font-caption text-caption text-text-muted">
                  Showing {startItem}–{endItem} of {filteredRecentDocs.length} files
                </span>
                <label className="inline-flex items-center gap-1.5 font-caption text-caption text-text-muted">
                  <span>Show:</span>
                  <select
                    value={recentPageSize}
                    onChange={(e) => {
                      setRecentPageSize(Number(e.target.value) as 10 | 25 | 50 | 100);
                      setRecentPage(1);
                    }}
                    className="h-7 px-2 rounded-md bg-surface-elevated border border-border-default text-text-primary font-mono-metric text-caption focus:outline-none focus:border-primary-container"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setRecentPage((p) => Math.max(1, p - 1))}
                    className="px-2.5 py-1 rounded-lg bg-surface-elevated hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed border border-border-default font-body-sm text-body-sm text-text-primary transition-colors"
                  >
                    Prev
                  </button>
                  <span className="font-mono-metric text-caption text-text-secondary px-2">
                    {safePage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setRecentPage((p) => Math.min(totalPages, p + 1))}
                    className="px-2.5 py-1 rounded-lg bg-surface-elevated hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed border border-border-default font-body-sm text-body-sm text-text-primary transition-colors"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
};
