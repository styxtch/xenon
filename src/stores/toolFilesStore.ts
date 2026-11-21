import { create } from "zustand";

export interface CachedPreviewMeta {
  docId: string;
  pageCount: number;
}

interface ToolFilesState {
  activeToolKey: string;
  filesByTool: Record<string, string[]>;
  importedSignatures: Record<string, true>;
  previewMetaBySig: Record<string, CachedPreviewMeta>;
  compareLeftPath: string;
  compareRightPath: string;

  setActiveToolKey: (key: string) => void;
  setToolFiles: (key: string, paths: string[]) => void;
  addToolFiles: (key: string, paths: string[]) => void;
  removeToolFile: (key: string, path: string) => void;
  clearToolFiles: (key: string) => void;
  markToolFileImported: (key: string, path: string, meta?: CachedPreviewMeta) => void;

  setCompareLeftPath: (path: string) => void;
  setCompareRightPath: (path: string) => void;
  clearComparePaths: () => void;
}

export function toolFileSig(key: string, path: string): string {
  return `${key}::${path}`;
}

function pruneKeySignatures<T>(
  record: Record<string, T>,
  key: string,
  keepPaths?: Set<string>
): Record<string, T> {
  const prefix = `${key}::`;
  const next: Record<string, T> = {};
  for (const [k, v] of Object.entries(record)) {
    if (!k.startsWith(prefix)) {
      next[k] = v;
    } else if (keepPaths && keepPaths.has(k.slice(prefix.length))) {
      next[k] = v;
    }
  }
  return next;
}

function dedupeAppend(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing);
  const next = [...existing];
  for (const p of incoming) {
    if (p && !seen.has(p)) {
      seen.add(p);
      next.push(p);
    }
  }
  return next;
}

export const useToolFilesStore = create<ToolFilesState>((set) => ({
  activeToolKey: "optimize:compress",
  filesByTool: {},
  importedSignatures: {},
  previewMetaBySig: {},
  compareLeftPath: "",
  compareRightPath: "",

  setActiveToolKey: (activeToolKey) => set({ activeToolKey }),

  setToolFiles: (key, paths) =>
    set((state) => {
      const nextPaths = dedupeAppend([], paths);
      const keep = new Set(nextPaths);
      return {
        filesByTool: {
          ...state.filesByTool,
          [key]: nextPaths,
        },
        importedSignatures: pruneKeySignatures(state.importedSignatures, key, keep),
        previewMetaBySig: pruneKeySignatures(state.previewMetaBySig, key, keep),
      };
    }),

  addToolFiles: (key, paths) =>
    set((state) => ({
      filesByTool: {
        ...state.filesByTool,
        [key]: dedupeAppend(state.filesByTool[key] ?? [], paths),
      },
    })),

  removeToolFile: (key, path) =>
    set((state) => {
      const sig = toolFileSig(key, path);
      const nextImported = { ...state.importedSignatures };
      const nextMeta = { ...state.previewMetaBySig };
      delete nextImported[sig];
      delete nextMeta[sig];
      return {
        filesByTool: {
          ...state.filesByTool,
          [key]: (state.filesByTool[key] ?? []).filter((p) => p !== path),
        },
        importedSignatures: nextImported,
        previewMetaBySig: nextMeta,
      };
    }),

  clearToolFiles: (key) =>
    set((state) => ({
      filesByTool: {
        ...state.filesByTool,
        [key]: [],
      },
      importedSignatures: pruneKeySignatures(state.importedSignatures, key),
      previewMetaBySig: pruneKeySignatures(state.previewMetaBySig, key),
    })),

  markToolFileImported: (key, path, meta) =>
    set((state) => {
      const sig = toolFileSig(key, path);
      return {
        importedSignatures: { ...state.importedSignatures, [sig]: true },
        previewMetaBySig: meta
          ? { ...state.previewMetaBySig, [sig]: meta }
          : state.previewMetaBySig,
      };
    }),

  setCompareLeftPath: (compareLeftPath) => set({ compareLeftPath }),
  setCompareRightPath: (compareRightPath) => set({ compareRightPath }),
  clearComparePaths: () => set({ compareLeftPath: "", compareRightPath: "" }),
}));
