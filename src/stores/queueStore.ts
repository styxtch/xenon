import { create } from "zustand";
import { tauriClient } from "../lib/tauriClient";
import type { JobTickEvent } from "../types/xenon";

export type QueueStatusFilter = "all" | "processing" | "paused" | "completed" | "failed";

interface QueueState {
  jobs: JobTickEvent[];
  statusFilter: QueueStatusFilter;
  setStatusFilter: (filter: QueueStatusFilter) => void;
  seedFromRecent: (recent: JobTickEvent[]) => void;
  upsertFromTick: (tick: JobTickEvent) => void;
  pauseJob: (jobId: string) => void;
  resumeJob: (jobId: string) => void;
  cancelJob: (jobId: string) => void;
  clearCompleted: () => void;
}

export const useQueueStore = create<QueueState>((set) => ({
  jobs: [],
  statusFilter: "all",

  setStatusFilter: (statusFilter) => set({ statusFilter }),

  seedFromRecent: (recent) =>
    set((state) => (state.jobs.length === 0 ? { jobs: recent } : state)),

  upsertFromTick: (tick) =>
    set((state) => {
      const exists = state.jobs.some((j) => j.jobId === tick.jobId);
      if (exists) {
        return {
          jobs: state.jobs.map((j) => (j.jobId === tick.jobId ? { ...j, ...tick } : j)),
        };
      }
      return { jobs: [tick, ...state.jobs] };
    }),

  pauseJob: (jobId) => {
    void tauriClient.pauseBatchJob(jobId);
    set((state) => ({
      jobs: state.jobs.map((j) =>
        j.jobId === jobId && j.status === "processing" ? { ...j, status: "paused" } : j
      ),
    }));
  },

  resumeJob: (jobId) => {
    void tauriClient.resumeBatchJob(jobId);
    set((state) => ({
      jobs: state.jobs.map((j) =>
        j.jobId === jobId && j.status === "paused" ? { ...j, status: "processing" } : j
      ),
    }));
  },

  cancelJob: (jobId) => {
    void tauriClient.cancelBatchJob(jobId);
    set((state) => ({
      jobs: state.jobs.map((j) =>
        j.jobId === jobId ? { ...j, status: "failed", error: "Cancelled by user" } : j
      ),
    }));
  },

  clearCompleted: () =>
    set((state) => ({
      jobs: state.jobs.filter((j) => j.status !== "completed" && j.status !== "failed"),
    })),
}));
