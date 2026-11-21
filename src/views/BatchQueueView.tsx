import React, { useMemo } from "react";
import { AppIcon } from "../components/common/AppIcon";
import { CategoryBadge } from "../components/common/CategoryBadge";
import { SegmentedTickProgress } from "../components/common/SegmentedTickProgress";
import { formatBytes } from "../lib/tauriClient";
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
  const clearCompleted = useQueueStore((s) => s.clearCompleted);

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
        {visibleJobs.length === 0 ? (
          <div className="py-10 text-center text-text-muted font-body-sm text-body-sm">
            No batch jobs in this view.
          </div>
        ) : (
          visibleJobs.map((job) => (
            <div
              key={job.jobId}
              className="bg-surface-elevated border border-border-subtle rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3 min-w-[220px]">
                <AppIcon name="description" className="w-5 h-5 text-primary" />
                <div>
                  <div className="font-body-medium text-body-medium text-text-primary">
                    {job.documentName}
                  </div>
                  <div className="font-mono-metric text-caption text-text-muted">
                    {formatBytes(job.originalBytes)} • {job.status}
                  </div>
                </div>
              </div>

              <CategoryBadge category={job.category} label={job.operationLabel} />

              <SegmentedTickProgress
                completedTicks={job.completedTicks}
                percentage={job.percentage}
                status={job.status}
                category={job.category}
              />

              <div className="flex items-center gap-1.5">
                {job.status === "processing" && (
                  <button
                    type="button"
                    onClick={() => pauseJob(job.jobId)}
                    title="Pause Process Tree"
                    className="p-1.5 rounded bg-surface-card hover:bg-surface-hover border border-border-default text-text-secondary hover:text-text-primary"
                  >
                    <AppIcon name="pause" className="w-4 h-4" />
                  </button>
                )}
                {job.status === "paused" && (
                  <button
                    type="button"
                    onClick={() => resumeJob(job.jobId)}
                    title="Resume Process Tree"
                    className="p-1.5 rounded bg-surface-card hover:bg-surface-hover border border-border-default text-primary"
                  >
                    <AppIcon name="play_arrow" className="w-4 h-4" />
                  </button>
                )}
                {(job.status === "processing" || job.status === "paused") && (
                  <button
                    type="button"
                    onClick={() => cancelJob(job.jobId)}
                    title="Cancel & Clean .part"
                    className="p-1.5 rounded bg-surface-card hover:bg-surface-hover border border-border-default text-status-danger"
                  >
                    <AppIcon name="stop_circle" className="w-4 h-4" />
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
