import { create } from "zustand";
import { tauriClient } from "../lib/tauriClient";

export interface CompletionModalPayload {
  title: string;
  summary: string;
  outputPaths: string[];
  originalBytes?: number;
  outputBytes?: number;
  durationMs?: number;
  extraDetail?: string;
}

export type OverwriteChoice = "overwrite" | "copy" | "cancel";

interface OverwritePromptState {
  paths: string[];
  operationLabel: string;
  allowCopy: boolean;
  resolve: (choice: OverwriteChoice) => void;
}

interface ProcessModalState {
  overwritePrompt: OverwritePromptState | null;
  completionModal: CompletionModalPayload | null;
  confirmBeforeOverwrite: (paths: string[], operationLabel: string) => Promise<boolean>;
  confirmOrCopyPaths: (paths: string[], operationLabel: string) => Promise<string[] | null>;
  resolveOverwrite: (choice: OverwriteChoice) => void;
  showCompletion: (payload: CompletionModalPayload) => void;
  closeCompletion: () => void;
}

function appendCopyIndex(filePath: string, index: number): string {
  const lastDot = filePath.lastIndexOf(".");
  const lastSep = Math.max(filePath.lastIndexOf("\\"), filePath.lastIndexOf("/"));
  if (lastDot > lastSep) {
    return `${filePath.slice(0, lastDot)}_${index}${filePath.slice(lastDot)}`;
  }
  return `${filePath}_${index}`;
}

async function generateUniqueCopyPaths(paths: string[]): Promise<string[]> {
  const results: string[] = [];
  for (const original of paths) {
    let candidate = appendCopyIndex(original, 1);
    for (let i = 1; i <= 99; i++) {
      const attempt = appendCopyIndex(original, i);
      let existing: string[] = [];
      try {
        existing = await tauriClient.checkExistingPaths([attempt]);
      } catch {
        existing = [];
      }
      if (existing.length === 0) {
        candidate = attempt;
        break;
      }
    }
    results.push(candidate);
  }
  return results;
}

export const useProcessModalStore = create<ProcessModalState>((set, get) => ({
  overwritePrompt: null,
  completionModal: null,

  confirmBeforeOverwrite: async (paths, operationLabel) => {
    const cleanPaths = paths.filter((p) => p.trim().length > 0);
    if (cleanPaths.length === 0) return true;

    let existing: string[] = [];
    try {
      existing = await tauriClient.checkExistingPaths(cleanPaths);
    } catch {
      existing = [];
    }
    if (existing.length === 0) return true;

    const choice = await new Promise<OverwriteChoice>((resolve) => {
      set({
        overwritePrompt: {
          paths: existing,
          operationLabel,
          allowCopy: false,
          resolve,
        },
      });
    });
    return choice === "overwrite";
  },

  confirmOrCopyPaths: async (paths, operationLabel) => {
    const cleanPaths = paths.filter((p) => p.trim().length > 0);
    if (cleanPaths.length === 0) return cleanPaths;

    let existing: string[] = [];
    try {
      existing = await tauriClient.checkExistingPaths(cleanPaths);
    } catch {
      existing = [];
    }
    if (existing.length === 0) return cleanPaths;

    const choice = await new Promise<OverwriteChoice>((resolve) => {
      set({
        overwritePrompt: {
          paths: existing,
          operationLabel,
          allowCopy: true,
          resolve,
        },
      });
    });

    if (choice === "cancel") return null;
    if (choice === "copy") {
      return generateUniqueCopyPaths(cleanPaths);
    }
    return cleanPaths;
  },

  resolveOverwrite: (choice) => {
    const current = get().overwritePrompt;
    if (current) {
      set({ overwritePrompt: null });
      current.resolve(choice);
    }
  },

  showCompletion: (payload) => {
    set({ completionModal: payload });
  },

  closeCompletion: () => {
    set({ completionModal: null });
  },
}));
