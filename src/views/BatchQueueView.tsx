import React, { useMemo } from "react";
import { AppIcon } from "../components/common/AppIcon";
import { CategoryBadge } from "../components/common/CategoryBadge";
import { SegmentedTickProgress } from "../components/common/SegmentedTickProgress";
import { formatBytes, tauriClient } from "../lib/tauriClient";
import { useQueueStore, type QueueStatusFilter } from "../stores/queueStore";

const FILTERS: { id: QueueStatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "processing", label: "Processing" },
  { id: "paused", label: "Paused" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
];

export const BatchQueueView: React.FC = () => {
  const jobs = useQueueStore((s) => s.jobs);
  const statusFilter = useQueueStore((s) => s.statusFilter);
  const setStatusFilter = useQueueStore((s) => s.setStatusFilter);
  const pauseJob = useQueueStore((s) => s.pauseJob);
  const resumeJob = useQueueStore((s) => s.resumeJob);
  const cancelJob = useQueueStore((s) => s.cancelJob);
  const pauseAll = useQueueStore((s) => s.pauseAll);
  const resumeAll = useQueueStore((s) => s.resumeAll);
  const cancelAll = useQueueStore((s) => s.cancelAll);
  const clearCompleted = useQueueStore((s) => s.clearCompleted);

  const hasProcessing = jobs.some((j) => j.status === "processing");
  const hasPaused = jobs.some((j) => j.status === "paused");
  const hasActiveOrPaused = hasProcessing || hasPaused || jobs.some((j) => j.status === "queued");

  const visibleJobs = useMemo(() => {
    if (statusFilter === "all") return jobs;
    return jobs.filter((j) => j.status === statusFilter);
  }, [jobs, statusFilter]);

  return (
    <div className="flex flex-col w-full gap-space-lg">
      <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col md:flex-row md:items-center justify-between gap-space-md">
        <div>
          <h1 className="font-headline-md text-headline-md text-text-primary">
            Batch Queue &amp; Process Control
          </h1>
          <p className="font-body-sm text-body-sm text-text-muted mt-0.5">
            OS-level process tree management (Win32 Job Objects / Unix Process Groups) with atomic `.part` cleanup.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {hasProcessing && (
            <button
              type="button"
              onClick={() => void pauseAll()}
              className="px-3 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover text-text-primary border border-border-default font-body-sm text-body-sm flex items-center gap-1.5"
            >
              <AppIcon name="pause" className="w-4 h-4" />
              <span>Pause All</span>
            </button>
          )}
          {hasPaused && (
            <button
              type="button"
              onClick={() => void resumeAll()}
              className="px-3 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover text-primary border border-border-default font-body-sm text-body-sm flex items-center gap-1.5"
            >
              <AppIcon name="play_arrow" className="w-4 h-4" />
              <span>Resume All</span>
            </button>
          )}
          {hasActiveOrPaused && (
            <button
              type="button"
              onClick={() => void cancelAll()}
              className="px-3 py-1.5 rounded-lg bg-error-container/30 hover:bg-error-container/50 text-error border border-status-danger/40 font-body-sm text-body-sm flex items-center gap-1.5"
            >
              <AppIcon name="stop_circle" className="w-4 h-4" />
              <span>Cancel All</span>
            </button>
          )}
          <button
            type="button"
            onClick={clearCompleted}
            className="px-3 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover text-text-secondary hover:text-text-primary border border-border-default font-body-sm text-body-sm"
          >
            Clear Completed
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setStatusFilter(f.id)}
            className={`px-3 py-1.5 rounded-lg font-body-sm text-body-sm border transition-colors ${
              statusFilter === f.id
                ? "bg-surface-active text-primary border-border-default font-medium"
                : "bg-surface-card text-text-secondary border-border-subtle hover:text-text-primary"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col gap-2">
        {visibleJobs.length > 0 && (
          <div className="hidden md:grid md:grid-cols-[minmax(0,2.2fr)_minmax(180px,1.1fr)_160px_88px] items-center gap-3 px-4 pb-1 font-caption text-caption text-text-muted uppercase tracking-wider">
            <span>Document</span>
            <span>Operation</span>
            <span>Progress</span>
            <span className="text-right">Actions</span>
          </div>
        )}
        {visibleJobs.length === 0 ? (
          <div className="py-10 text-center text-text-muted font-body-sm text-body-sm">
            No batch jobs in this view.
          </div>
        ) : (
          visibleJobs.map((job) => (
            <div
              key={job.jobId}
              className="bg-surface-elevated border border-border-subtle rounded-lg px-4 py-3 grid grid-cols-1 md:grid-cols-[minmax(0,2.2fr)_minmax(180px,1.1fr)_160px_88px] items-center gap-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <AppIcon name="description" className="w-5 h-5 text-primary shrink-0" />
                <div className="min-w-0">
                  <div
                    className="font-body-medium text-body-medium text-text-primary truncate"
                    title={job.documentName}
                  >
                    {job.documentName}
                  </div>
                  <div className="font-mono-metric text-caption text-text-muted truncate">
                    {formatBytes(job.originalBytes)} • {job.status}
                  </div>
                </div>
              </div>

              <div className="flex items-center">
                <CategoryBadge category={job.category} label={job.operationLabel} />
              </div>

              <div className="flex items-center">
                <SegmentedTickProgress
                  completedTicks={job.completedTicks}
                  percentage={job.percentage}
                  status={job.status}
                  category={job.category}
                />
              </div>

              <div className="flex items-center md:justify-end gap-1.5">
                {job.status === "processing" && (
                  <button
                    type="button"
                    onClick={() => void pauseJob(job.jobId)}
                    title="Pause Process Tree"
                    className="p-1.5 rounded bg-surface-card hover:bg-surface-hover border border-border-default text-text-secondary hover:text-text-primary"
                  >
                    <AppIcon name="pause" className="w-4 h-4" />
                  </button>
                )}
                {job.status === "paused" && (
                  <button
                    type="button"
                    onClick={() => void resumeJob(job.jobId)}
                    title="Resume Process Tree"
                    className="p-1.5 rounded bg-surface-card hover:bg-surface-hover border border-border-default text-primary"
                  >
                    <AppIcon name="play_arrow" className="w-4 h-4" />
                  </button>
                )}
                {(job.status === "processing" || job.status === "paused") && (
                  <button
                    type="button"
                    onClick={() => void cancelJob(job.jobId)}
                    title="Cancel & Clean .part"
                    className="p-1.5 rounded bg-surface-card hover:bg-surface-hover border border-border-default text-status-danger"
                  >
                    <AppIcon name="stop_circle" className="w-4 h-4" />
                  </button>
                )}
                {job.status === "completed" && job.outputPath && (
                  <button
                    type="button"
                    onClick={() => void tauriClient.revealInExplorer(job.outputPath!)}
                    title="Open Output Folder"
                    className="p-1.5 rounded bg-surface-card hover:bg-surface-hover border border-border-default text-text-secondary hover:text-primary"
                  >
                    <AppIcon name="folder_open" className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
