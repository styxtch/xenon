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
  pauseJob: (jobId: string) => Promise<void>;
  resumeJob: (jobId: string) => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;
  pauseAll: () => Promise<void>;
  resumeAll: () => Promise<void>;
  cancelAll: () => Promise<void>;
  clearCompleted: () => void;
}

export const useQueueStore = create<QueueState>((set, get) => ({
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

  pauseJob: async (jobId) => {
    try {
      const ok = await tauriClient.pauseBatchJob(jobId);
      if (ok) {
        set((state) => ({
          jobs: state.jobs.map((j) =>
            j.jobId === jobId && j.status === "processing" ? { ...j, status: "paused" } : j
          ),
        }));
      }
    } catch {
      // keep actual state on IPC failure
    }
  },

  resumeJob: async (jobId) => {
    try {
      const ok = await tauriClient.resumeBatchJob(jobId);
      if (ok) {
        set((state) => ({
          jobs: state.jobs.map((j) =>
            j.jobId === jobId && j.status === "paused" ? { ...j, status: "processing" } : j
          ),
        }));
      }
    } catch {
      // keep actual state on IPC failure
    }
  },

  cancelJob: async (jobId) => {
    try {
      await tauriClient.cancelBatchJob(jobId);
    } catch {
      // still mark UI cancelled when user explicitly cancels
    }
    set((state) => ({
      jobs: state.jobs.map((j) =>
        j.jobId === jobId ? { ...j, status: "failed", error: "Cancelled by user" } : j
      ),
    }));
  },

  pauseAll: async () => {
    const active = get().jobs.filter((j) => j.status === "processing");
    await Promise.all(active.map((j) => get().pauseJob(j.jobId)));
  },

  resumeAll: async () => {
    const paused = get().jobs.filter((j) => j.status === "paused");
    await Promise.all(paused.map((j) => get().resumeJob(j.jobId)));
  },

  cancelAll: async () => {
    const pending = get().jobs.filter(
      (j) => j.status === "processing" || j.status === "paused" || j.status === "queued"
    );
    await Promise.all(pending.map((j) => get().cancelJob(j.jobId)));
  },

  clearCompleted: () =>
    set((state) => ({
      jobs: state.jobs.filter((j) => j.status !== "completed" && j.status !== "failed"),
    })),
}));
