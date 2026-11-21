import { create } from "zustand";
import { tauriClient } from "../lib/tauriClient";
import type {
  EngineDiagnosticStatus,
  EngineLogEntry,
  EngineName,
  HardwareTelemetry,
  LogLevel,
} from "../types/xenon";

interface TelemetryState {
  telemetry: HardwareTelemetry;
  engines: EngineDiagnosticStatus[];
  logs: EngineLogEntry[];
  isLogsDrawerOpen: boolean;
  logFilterLevel: "ALL" | LogLevel;
  testingEngine: EngineName | null;
  isVerifyingAll: boolean;
  refreshTelemetry: () => Promise<void>;
  runDiagnostics: () => Promise<void>;
  testSingleEngine: (name: EngineName) => Promise<void>;
  loadLogs: () => Promise<void>;
  toggleLogsDrawer: (open?: boolean) => void;
  setLogFilterLevel: (level: "ALL" | LogLevel) => void;
  appendLog: (entry: EngineLogEntry) => void;
  clearLogs: () => Promise<void>;
}

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  telemetry: {
    ramUsedMb: 142,
    totalRamGb: 16,
    cpuUsagePercent: 2.1,
    physicalCores: 8,
    activeWorkerThreads: 8,
    memoryCacheLimitMb: 2048,
    tempCacheSizeBytes: 0,
    targetArch: "x86_64-pc-windows-msvc",
  },
  engines: [],
  logs: [],
  isLogsDrawerOpen: false,
  logFilterLevel: "ALL",
  testingEngine: null,
  isVerifyingAll: false,

  refreshTelemetry: async () => {
    const telemetry = await tauriClient.getHardwareTelemetry();
    set({ telemetry });
  },

  runDiagnostics: async () => {
    set({ isVerifyingAll: true });
    try {
      const engines = await tauriClient.verifyEngines();
      const logs = await tauriClient.getEngineLogs();
      set({ engines, logs });
    } finally {
      set({ isVerifyingAll: false });
    }
  },

  testSingleEngine: async (name: EngineName) => {
    set({ testingEngine: name });
    try {
      const result = await tauriClient.testEngineBinary(name);
      const logs = await tauriClient.getEngineLogs();
      set((state) => ({
        logs,
        engines: state.engines.map((e) =>
          e.name === name
            ? {
                ...e,
                sha256: result.sha256,
                sha256Verified: result.success,
                version: result.version,
                binaryPath: result.binaryPath,
              }
            : e
        ),
      }));
      if (get().logs.length === 0) {
        set({
          logs: [
            {
              id: `test-${Date.now()}`,
              timestamp: new Date().toTimeString().slice(0, 8),
              level: result.success ? "INFO" : "ERR",
              engine: name,
              message: `${result.output} (${result.latencyMs} ms)`,
            },
          ],
        });
      }
    } finally {
      set({ testingEngine: null });
    }
  },

  loadLogs: async () => {
    const logs = await tauriClient.getEngineLogs();
    set({ logs });
  },

  toggleLogsDrawer: (open) =>
    set((state) => ({
      isLogsDrawerOpen: open !== undefined ? open : !state.isLogsDrawerOpen,
    })),

  setLogFilterLevel: (logFilterLevel) => set({ logFilterLevel }),

  appendLog: (entry) =>
    set((state) => {
      if (state.logs.some((l) => l.id === entry.id)) return state;
      const next = [...state.logs, entry];
      return { logs: next.length > 500 ? next.slice(next.length - 500) : next };
    }),

  clearLogs: async () => {
    await tauriClient.clearEngineLogs();
    const logs = await tauriClient.getEngineLogs();
    set({ logs });
  },
}));
