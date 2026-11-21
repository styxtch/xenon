import { create } from "zustand";
import { tauriClient } from "../lib/tauriClient";
import type { DashboardMetrics, SuiteCategory } from "../types/xenon";

interface HistoryState {
  metrics: DashboardMetrics;
  searchQuery: string;
  categoryFilter: "all" | SuiteCategory;
  isLoading: boolean;
  setSearchQuery: (q: string) => void;
  setCategoryFilter: (c: "all" | SuiteCategory) => void;
  fetchDashboardMetrics: () => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;
  rerunJob: (jobId: string) => Promise<void>;
}

export const useHistoryStore = create<HistoryState>((set) => ({
  metrics: {
    processedTodayCount: 0,
    processedTodayDelta: 0,
    totalSpaceSavedBytes: 0,
    averageCompressionRatioPercent: 0,
    securedFilesCount: 0,
    weeklyThroughput: [],
    recentDocuments: [],
  },
  searchQuery: "",
  categoryFilter: "all",
  isLoading: false,

  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setCategoryFilter: (categoryFilter) => set({ categoryFilter }),

  fetchDashboardMetrics: async () => {
    set({ isLoading: true });
    try {
      const metrics = await tauriClient.getDashboardMetrics();
      set({ metrics });
    } finally {
      set({ isLoading: false });
    }
  },

  cancelJob: async (jobId: string) => {
    const metrics = await tauriClient.cancelRecentJob(jobId);
    set({ metrics });
  },

  rerunJob: async (jobId: string) => {
    await tauriClient.rerunRecentJob(jobId);
    const metrics = await tauriClient.getDashboardMetrics();
    set({ metrics });
  },
}));
