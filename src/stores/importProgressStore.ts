import { create } from "zustand";

const MIN_IMPORT_VISIBLE_MS = 3500;

export interface ImportProgressPayload {
  fileName: string;
  stage: string;
  current: number;
  total: number;
  percentage: number;
}

interface ImportProgressState extends ImportProgressPayload {
  isImporting: boolean;
  startImport: (stage: string, fileName?: string, total?: number) => void;
  updateFromEvent: (payload: ImportProgressPayload) => void;
  finishImport: () => void;
  finishImportAsync: () => Promise<void>;
  cancelImport: () => void;
}

let importSessionId = 0;
let importStartedAt = 0;
let activeTickTimer: ReturnType<typeof setInterval> | null = null;
let finishAnimTimer: ReturnType<typeof setInterval> | null = null;
let finishTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingResolve: (() => void) | null = null;

function clearImportTimers() {
  if (activeTickTimer !== null) {
    clearInterval(activeTickTimer);
    activeTickTimer = null;
  }
  if (finishAnimTimer !== null) {
    clearInterval(finishAnimTimer);
    finishAnimTimer = null;
  }
  if (finishTimeout !== null) {
    clearTimeout(finishTimeout);
    finishTimeout = null;
  }
  if (pendingResolve !== null) {
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve();
  }
}

export const useImportProgressStore = create<ImportProgressState>((set, get) => {
  const resetState = () => {
    clearImportTimers();
    set({
      isImporting: false,
      fileName: "",
      stage: "",
      current: 0,
      total: 0,
      percentage: 0,
    });
  };

  return {
    isImporting: false,
    fileName: "",
    stage: "",
    current: 0,
    total: 0,
    percentage: 0,

    startImport: (stage, fileName = "", total = 1) => {
      importSessionId += 1;
      clearImportTimers();
      importStartedAt = Date.now();
      set({
        isImporting: true,
        stage,
        fileName,
        current: 0,
        total,
        percentage: 8,
      });

      activeTickTimer = setInterval(() => {
        const state = get();
        if (!state.isImporting) return;
        const elapsed = Date.now() - importStartedAt;
        const easedTarget = Math.min(88, 8 + 80 * (1 - Math.exp(-elapsed / 1200)));
        if (easedTarget > state.percentage) {
          set({ percentage: Math.round(easedTarget) });
        }
      }, 60);
    },

    updateFromEvent: (payload) =>
      set((state) => {
        if (!state.isImporting) return state;
        return {
          ...payload,
          percentage: Math.max(state.percentage, Math.min(96, payload.percentage)),
        };
      }),

    cancelImport: () => {
      importSessionId += 1;
      resetState();
    },

    finishImportAsync: () => {
      if (activeTickTimer !== null) {
        clearInterval(activeTickTimer);
        activeTickTimer = null;
      }

      const mySession = importSessionId;
      const elapsed = Date.now() - importStartedAt;
      const remaining = Math.max(0, MIN_IMPORT_VISIBLE_MS - elapsed);

      if (remaining <= 0) {
        resetState();
        return Promise.resolve();
      }

      const startPct = Math.max(get().percentage, 12);
      const finishAnimStart = Date.now();

      return new Promise<void>((resolve) => {
        pendingResolve = resolve;
        finishAnimTimer = setInterval(() => {
          if (mySession !== importSessionId) return;
          const t = Math.min(1, (Date.now() - finishAnimStart) / remaining);
          const nextPct = Math.round(startPct + (100 - startPct) * t);
          set((state) => (state.isImporting ? { percentage: nextPct } : state));
        }, 45);

        finishTimeout = setTimeout(() => {
          if (mySession !== importSessionId) return;
          resetState();
        }, remaining);
      });
    },

    finishImport: () => {
      void get().finishImportAsync();
    },
  };
});
