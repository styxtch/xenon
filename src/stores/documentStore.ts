import { arrayMove } from "@dnd-kit/sortable";
import { create } from "zustand";
import { runWithMinimumProgress } from "../lib/progressTiming";
import { tauriClient } from "../lib/tauriClient";
import type {
  MergeQueueItem,
  OpenedDocumentDto,
  OrganizeExecutionResult,
} from "../types/xenon";
import { useHistoryStore } from "./historyStore";
import { useImportProgressStore } from "./importProgressStore";
import { useProcessModalStore } from "./processModalStore";
import { useTelemetryStore } from "./telemetryStore";

export interface GridPageItem {
  id: string;
  sourceDocId: string;
  sourceFileName: string;
  originalPageNumber: number;
  rotationDelta: 0 | 90 | 180 | 270;
  cropBox?: [number, number, number, number];
  widthPts: number;
  heightPts: number;
  textPreview: string[];
  selected: boolean;
}

export type OrganizeSubTab = "grid" | "merge" | "split" | "crop";
export type SplitMode = "range" | "extract_selected" | "every_n_pages" | "burst";

interface DocumentState {
  documents: Record<string, OpenedDocumentDto>;
  initialPages: GridPageItem[];
  activeDocId: string;
  activeDocName: string;
  activeDocPath: string;
  totalBytes: number;
  pages: GridPageItem[];
  lastSelectedPageId: string | null;
  mergeQueue: MergeQueueItem[];
  splitDocId: string;
  splitDocName: string;
  splitDocPath: string;
  splitTotalBytes: number;
  splitPages: GridPageItem[];
  zoomPercent: number;
  previewPageId: string | null;
  isPasswordModalOpen: boolean;
  pendingProtectedPath: string | null;
  passwordError: string | null;
  undoStack: GridPageItem[][];
  redoStack: GridPageItem[][];

  retainBookmarksToc: boolean;
  standardizeToA4: boolean;
  pdfVersionProfile: "1.7" | "2.0" | "pdfa-2b";
  splitMode: SplitMode;
  splitRangeSpec: string;
  splitEveryN: number;
  mergeExtractedIntoSinglePdf: boolean;
  cropMargins: { top: number; bottom: number; left: number; right: number };
  outputFilename: string;

  isExecuting: boolean;
  executionTicks: number;
  lastResultMessage: string | null;
  lastError: string | null;

  initSampleDocument: () => Promise<void>;
  loadDemoSampleDocument: () => Promise<void>;
  clearActiveDocument: () => void;
  openPdfFile: (path: string, password?: string) => Promise<boolean>;
  insertFilesIntoGrid: (paths: string[]) => Promise<void>;
  addFilesToMergeQueue: (paths: string[]) => Promise<void>;
  removeMergeQueueItem: (docId: string) => void;
  reorderMergeQueue: (activeDocId: string, overDocId: string) => void;
  clearMergeQueue: () => void;
  openSplitPdfFile: (path: string, password?: string) => Promise<boolean>;
  toggleSplitPageSelection: (id: string) => void;
  selectAllSplitPages: () => void;
  clearSplitDocument: () => void;
  sendActiveDocToSplit: () => void;

  setZoomPercent: (zoom: number) => void;
  setPreviewPageId: (id: string | null) => void;
  togglePageSelection: (id: string, shiftKey?: boolean) => void;
  selectAllPages: () => void;
  invertSelection: () => void;
  resetOrder: () => void;
  reorderPages: (activeId: string, overId: string) => void;

  rotatePage: (id: string, delta: 90 | 270) => void;
  rotateSelectedRight: () => void;
  rotateSelectedLeft: () => void;
  duplicatePage: (id: string) => void;
  deletePage: (id: string) => void;
  deleteSelected: () => void;

  setCropMargins: (margins: Partial<DocumentState["cropMargins"]>) => void;
  applyCropToSelected: () => void;
  resetCropOnSelected: () => void;

  undo: () => void;
  redo: () => void;

  setRetainBookmarksToc: (val: boolean) => void;
  setStandardizeToA4: (val: boolean) => void;
  setPdfVersionProfile: (val: "1.7" | "2.0" | "pdfa-2b") => void;
  setSplitMode: (mode: SplitMode) => void;
  setSplitRangeSpec: (spec: string) => void;
  setSplitEveryN: (n: number) => void;
  setMergeExtractedIntoSinglePdf: (val: boolean) => void;
  setOutputFilename: (name: string) => void;

  openPasswordPrompt: (filePath: string) => void;
  closePasswordPrompt: () => void;

  executeActiveOperation: (
    subTab: OrganizeSubTab,
    outputDir: string,
    namingPattern: string
  ) => Promise<void>;
}

function dtoToGridPages(dto: OpenedDocumentDto, preselectDefaults = false): GridPageItem[] {
  return dto.pages.map((p, idx) => ({
    id: `${dto.docId}-p${p.pageNumber}-${Date.now()}-${idx}`,
    sourceDocId: dto.docId,
    sourceFileName: dto.fileName,
    originalPageNumber: p.pageNumber,
    rotationDelta: 0,
    cropBox: p.cropBox,
    widthPts: p.widthPts,
    heightPts: p.heightPts,
    textPreview: p.textPreview,
    selected: preselectDefaults && (idx === 1 || idx === 3 || idx === 6),
  }));
}

function extractErrorKindAndMsg(err: unknown): { isPassword: boolean; message: string } {
  if (typeof err === "object" && err !== null) {
    const obj = err as { kind?: string; message?: string };
    if (obj.kind === "PasswordRequired") {
      return { isPassword: true, message: "Password required to unlock PDF." };
    }
    if (obj.message) {
      return { isPassword: false, message: obj.message };
    }
  }
  const msg = String(err);
  return {
    isPassword: msg.toLowerCase().includes("passwordrequired"),
    message: msg,
  };
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  documents: {},
  initialPages: [],
  activeDocId: "",
  activeDocName: "",
  activeDocPath: "",
  totalBytes: 0,
  pages: [],
  lastSelectedPageId: null,
  mergeQueue: [],
  splitDocId: "",
  splitDocName: "",
  splitDocPath: "",
  splitTotalBytes: 0,
  splitPages: [],
  zoomPercent: 75,
  previewPageId: null,
  isPasswordModalOpen: false,
  pendingProtectedPath: null,
  passwordError: null,
  undoStack: [],
  redoStack: [],

  retainBookmarksToc: true,
  standardizeToA4: false,
  pdfVersionProfile: "1.7",
  splitMode: "range",
  splitRangeSpec: "1-4, 5-8",
  splitEveryN: 3,
  mergeExtractedIntoSinglePdf: false,
  cropMargins: { top: 24, bottom: 24, left: 24, right: 24 },
  outputFilename: "",

  isExecuting: false,
  executionTicks: 0,
  lastResultMessage: null,
  lastError: null,

  initSampleDocument: async () => {
    if (get().pages.length > 0) return;
    const demoEnabled = await tauriClient.getDemoShowcaseMode();
    if (demoEnabled) {
      await get().loadDemoSampleDocument();
    }
  },

  loadDemoSampleDocument: async () => {
    const dto = await tauriClient.getInitialSamplePdf();
    const pages = dtoToGridPages(dto, true);
    set({
      documents: { [dto.docId]: dto },
      initialPages: pages,
      activeDocId: dto.docId,
      activeDocName: dto.fileName,
      activeDocPath: dto.filePath,
      totalBytes: dto.fileSizeBytes,
      pages,
      outputFilename: dto.fileName.replace(/\.pdf$/i, "_organized.pdf"),
      lastResultMessage: null,
      lastError: null,
    });
  },

  clearActiveDocument: () =>
    set({
      documents: {},
      initialPages: [],
      activeDocId: "",
      activeDocName: "",
      activeDocPath: "",
      totalBytes: 0,
      pages: [],
      lastSelectedPageId: null,
      undoStack: [],
      redoStack: [],
      outputFilename: "",
      lastResultMessage: null,
      lastError: null,
    }),

  openPdfFile: async (path, password) => {
    const fileName = path.split(/[\\/]/).pop() ?? "Document.pdf";
    useImportProgressStore
      .getState()
      .startImport("Opening PDF document...", fileName, 1);
    try {
      const dto = await tauriClient.openPdf(path, password);
      await useImportProgressStore.getState().finishImportAsync();
      const pages = dtoToGridPages(dto, false);
      set((state) => ({
        documents: { ...state.documents, [dto.docId]: dto },
        initialPages: pages,
        activeDocId: dto.docId,
        activeDocName: dto.fileName,
        activeDocPath: dto.filePath,
        totalBytes: dto.fileSizeBytes,
        pages,
        lastSelectedPageId: null,
        undoStack: [],
        redoStack: [],
        outputFilename: dto.fileName.replace(/\.pdf$/i, "_organized.pdf"),
        isPasswordModalOpen: false,
        pendingProtectedPath: null,
        passwordError: null,
        lastError: null,
      }));
      return true;
    } catch (err) {
      useImportProgressStore.getState().cancelImport();
      const { isPassword, message } = extractErrorKindAndMsg(err);
      if (isPassword) {
        set({
          isPasswordModalOpen: true,
          pendingProtectedPath: path,
          passwordError: password ? "Incorrect password. Please try again." : null,
        });
      } else {
        set({
          passwordError: password ? message : null,
          lastError: message,
        });
      }
      return false;
    }
  },

  insertFilesIntoGrid: async (paths) => {
    if (paths.length === 0) return;
    const firstFile = paths[0].split(/[\\/]/).pop() ?? "File";
    useImportProgressStore
      .getState()
      .startImport("Importing files into grid...", firstFile, paths.length);
    try {
      const insertedDocs = await tauriClient.insertImagesOrPdf(paths);
      await useImportProgressStore.getState().finishImportAsync();
      set((state) => {
        const nextDocs = { ...state.documents };
        const addedPages: GridPageItem[] = [];
        let addedBytes = 0;
        for (const dto of insertedDocs) {
          nextDocs[dto.docId] = dto;
          addedPages.push(...dtoToGridPages(dto, false));
          addedBytes += dto.fileSizeBytes;
        }
        const hadActiveDoc = Boolean(state.activeDocId);
        const firstDoc = insertedDocs[0];
        const nextPages = [...state.pages, ...addedPages];
        return {
          documents: nextDocs,
          initialPages:
            !hadActiveDoc && state.initialPages.length === 0
              ? nextPages
              : state.initialPages,
          activeDocId: hadActiveDoc ? state.activeDocId : (firstDoc?.docId ?? ""),
          activeDocName: hadActiveDoc
            ? state.activeDocName
            : (firstDoc?.fileName ?? ""),
          activeDocPath: hadActiveDoc
            ? state.activeDocPath
            : (firstDoc?.filePath ?? ""),
          totalBytes: state.totalBytes + addedBytes,
          outputFilename:
            !hadActiveDoc && firstDoc
              ? firstDoc.fileName.replace(/\.pdf$/i, "_organized.pdf")
              : state.outputFilename,
          undoStack: [...state.undoStack.slice(-29), state.pages],
          redoStack: [],
          pages: nextPages,
          lastError: null,
        };
      });
    } catch (err) {
      useImportProgressStore.getState().cancelImport();
      const { message } = extractErrorKindAndMsg(err);
      set({ lastError: message });
    }
  },

  addFilesToMergeQueue: async (paths) => {
    if (paths.length === 0) return;
    const firstFile = paths[0].split(/[\\/]/).pop() ?? "Document.pdf";
    useImportProgressStore
      .getState()
      .startImport("Adding PDF(s) to merge queue...", firstFile, paths.length);
    try {
      const openedDtos: OpenedDocumentDto[] = [];
      for (const p of paths) {
        const dto = await tauriClient.openPdf(p);
        openedDtos.push(dto);
      }
      await useImportProgressStore.getState().finishImportAsync();
      set((state) => {
        const nextDocs = { ...state.documents };
        const nextQueue = [...state.mergeQueue];
        for (const dto of openedDtos) {
          nextDocs[dto.docId] = dto;
          if (!nextQueue.some((m) => m.filePath === dto.filePath)) {
            nextQueue.push({
              docId: dto.docId,
              filePath: dto.filePath,
              fileName: dto.fileName,
              pageCount: dto.pageCount,
              fileSizeBytes: dto.fileSizeBytes,
            });
          }
        }
        return {
          documents: nextDocs,
          mergeQueue: nextQueue,
          lastError: null,
        };
      });
    } catch (err) {
      useImportProgressStore.getState().cancelImport();
      const { message } = extractErrorKindAndMsg(err);
      set({ lastError: message });
    }
  },

  clearMergeQueue: () => set({ mergeQueue: [], lastError: null }),

  openSplitPdfFile: async (path, password) => {
    const fileName = path.split(/[\\/]/).pop() ?? "Document.pdf";
    useImportProgressStore
      .getState()
      .startImport("Loading PDF for Split...", fileName, 1);
    try {
      const dto = await tauriClient.openPdf(path, password);
      await useImportProgressStore.getState().finishImportAsync();
      const splitPages = dtoToGridPages(dto, false);
      set((state) => ({
        documents: { ...state.documents, [dto.docId]: dto },
        splitDocId: dto.docId,
        splitDocName: dto.fileName,
        splitDocPath: dto.filePath,
        splitTotalBytes: dto.fileSizeBytes,
        splitPages,
        lastError: null,
      }));
      return true;
    } catch (err) {
      useImportProgressStore.getState().cancelImport();
      const { message } = extractErrorKindAndMsg(err);
      set({ lastError: message });
      return false;
    }
  },

  toggleSplitPageSelection: (id) =>
    set((state) => ({
      splitPages: state.splitPages.map((p) =>
        p.id === id ? { ...p, selected: !p.selected } : p
      ),
    })),

  selectAllSplitPages: () =>
    set((state) => {
      const allSelected =
        state.splitPages.length > 0 && state.splitPages.every((p) => p.selected);
      return {
        splitPages: state.splitPages.map((p) => ({ ...p, selected: !allSelected })),
      };
    }),

  clearSplitDocument: () =>
    set({
      splitDocId: "",
      splitDocName: "",
      splitDocPath: "",
      splitTotalBytes: 0,
      splitPages: [],
      lastError: null,
    }),

  sendActiveDocToSplit: () =>
    set((state) => ({
      splitDocId: state.activeDocId,
      splitDocName: state.activeDocName,
      splitDocPath: state.activeDocPath,
      splitTotalBytes: state.totalBytes,
      splitPages: state.pages.map((p) => ({ ...p })),
      lastError: null,
    })),

  removeMergeQueueItem: (docId) =>
    set((state) => ({
      mergeQueue: state.mergeQueue.filter((item) => item.docId !== docId),
    })),

  reorderMergeQueue: (activeDocId, overDocId) =>
    set((state) => {
      const oldIdx = state.mergeQueue.findIndex((m) => m.docId === activeDocId);
      const newIdx = state.mergeQueue.findIndex((m) => m.docId === overDocId);
      if (oldIdx < 0 || newIdx < 0 || oldIdx === newIdx) return state;
      return { mergeQueue: arrayMove(state.mergeQueue, oldIdx, newIdx) };
    }),

  setZoomPercent: (zoom) =>
    set({ zoomPercent: Math.min(200, Math.max(25, zoom)) }),

  setPreviewPageId: (previewPageId) => set({ previewPageId }),

  togglePageSelection: (id, shiftKey = false) =>
    set((state) => {
      if (shiftKey && state.lastSelectedPageId) {
        const anchorIdx = state.pages.findIndex(
          (p) => p.id === state.lastSelectedPageId
        );
        const targetIdx = state.pages.findIndex((p) => p.id === id);
        if (anchorIdx >= 0 && targetIdx >= 0) {
          const [start, end] =
            anchorIdx <= targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
          return {
            lastSelectedPageId: id,
            pages: state.pages.map((p, idx) =>
              idx >= start && idx <= end ? { ...p, selected: true } : p
            ),
          };
        }
      }
      return {
        lastSelectedPageId: id,
        pages: state.pages.map((p) =>
          p.id === id ? { ...p, selected: !p.selected } : p
        ),
      };
    }),

  selectAllPages: () =>
    set((state) => ({
      pages: state.pages.map((p) => ({ ...p, selected: true })),
    })),

  invertSelection: () =>
    set((state) => ({
      pages: state.pages.map((p) => ({ ...p, selected: !p.selected })),
    })),

  resetOrder: () =>
    set((state) => ({
      undoStack: [...state.undoStack.slice(-29), state.pages],
      redoStack: [],
      pages:
        state.initialPages.length > 0 ? state.initialPages : state.pages,
    })),

  reorderPages: (activeId, overId) =>
    set((state) => {
      const oldIndex = state.pages.findIndex((p) => p.id === activeId);
      const newIndex = state.pages.findIndex((p) => p.id === overId);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return state;
      return {
        undoStack: [...state.undoStack.slice(-29), state.pages],
        redoStack: [],
        pages: arrayMove(state.pages, oldIndex, newIndex),
      };
    }),

  rotatePage: (id, delta) =>
    set((state) => ({
      undoStack: [...state.undoStack.slice(-29), state.pages],
      redoStack: [],
      pages: state.pages.map((p) =>
        p.id === id
          ? {
              ...p,
              rotationDelta: (((p.rotationDelta + delta) % 360) as
                | 0
                | 90
                | 180
                | 270),
            }
          : p
      ),
    })),

  rotateSelectedRight: () =>
    set((state) => {
      if (!state.pages.some((p) => p.selected)) return state;
      return {
        undoStack: [...state.undoStack.slice(-29), state.pages],
        redoStack: [],
        pages: state.pages.map((p) =>
          p.selected
            ? {
                ...p,
                rotationDelta: (((p.rotationDelta + 90) % 360) as
                  | 0
                  | 90
                  | 180
                  | 270),
              }
            : p
        ),
      };
    }),

  rotateSelectedLeft: () =>
    set((state) => {
      if (!state.pages.some((p) => p.selected)) return state;
      return {
        undoStack: [...state.undoStack.slice(-29), state.pages],
        redoStack: [],
        pages: state.pages.map((p) =>
          p.selected
            ? {
                ...p,
                rotationDelta: (((p.rotationDelta + 270) % 360) as
                  | 0
                  | 90
                  | 180
                  | 270),
              }
            : p
        ),
      };
    }),

  duplicatePage: (id) =>
    set((state) => {
      const idx = state.pages.findIndex((p) => p.id === id);
      if (idx < 0) return state;
      const src = state.pages[idx];
      const copy: GridPageItem = {
        ...src,
        id: `${src.sourceDocId}-p${src.originalPageNumber}-dup-${Date.now()}`,
        selected: false,
      };
      const next = [...state.pages];
      next.splice(idx + 1, 0, copy);
      return {
        undoStack: [...state.undoStack.slice(-29), state.pages],
        redoStack: [],
        pages: next,
      };
    }),

  deletePage: (id) =>
    set((state) => {
      if (state.pages.length <= 1) return state;
      return {
        undoStack: [...state.undoStack.slice(-29), state.pages],
        redoStack: [],
        pages: state.pages.filter((p) => p.id !== id),
      };
    }),

  deleteSelected: () =>
    set((state) => {
      const remaining = state.pages.filter((p) => !p.selected);
      if (remaining.length === state.pages.length || remaining.length === 0) {
        return state;
      }
      return {
        undoStack: [...state.undoStack.slice(-29), state.pages],
        redoStack: [],
        pages: remaining,
      };
    }),

  setCropMargins: (margins) =>
    set((state) => ({
      cropMargins: { ...state.cropMargins, ...margins },
    })),

  applyCropToSelected: () =>
    set((state) => {
      const { top, bottom, left, right } = state.cropMargins;
      const hasSel = state.pages.some((p) => p.selected);
      return {
        undoStack: [...state.undoStack.slice(-29), state.pages],
        redoStack: [],
        pages: state.pages.map((p) => {
          if (hasSel && !p.selected) return p;
          const box: [number, number, number, number] = [
            Math.max(0, left),
            Math.max(0, bottom),
            Math.max(left + 72, p.widthPts - right),
            Math.max(bottom + 72, p.heightPts - top),
          ];
          return { ...p, cropBox: box };
        }),
      };
    }),

  resetCropOnSelected: () =>
    set((state) => ({
      undoStack: [...state.undoStack.slice(-29), state.pages],
      redoStack: [],
      pages: state.pages.map((p) =>
        p.selected ? { ...p, cropBox: undefined } : p
      ),
    })),

  undo: () =>
    set((state) => {
      if (state.undoStack.length === 0) return state;
      const prev = state.undoStack[state.undoStack.length - 1];
      return {
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, state.pages],
        pages: prev,
      };
    }),

  redo: () =>
    set((state) => {
      if (state.redoStack.length === 0) return state;
      const next = state.redoStack[state.redoStack.length - 1];
      return {
        undoStack: [...state.undoStack.slice(-29), state.pages],
        redoStack: state.redoStack.slice(0, -1),
        pages: next,
      };
    }),

  setRetainBookmarksToc: (retainBookmarksToc) => set({ retainBookmarksToc }),
  setStandardizeToA4: (standardizeToA4) => set({ standardizeToA4 }),
  setPdfVersionProfile: (pdfVersionProfile) => set({ pdfVersionProfile }),
  setSplitMode: (splitMode) => set({ splitMode }),
  setSplitRangeSpec: (splitRangeSpec) => set({ splitRangeSpec }),
  setSplitEveryN: (splitEveryN) => set({ splitEveryN: Math.max(1, splitEveryN) }),
  setMergeExtractedIntoSinglePdf: (mergeExtractedIntoSinglePdf) =>
    set({ mergeExtractedIntoSinglePdf }),
  setOutputFilename: (outputFilename) => set({ outputFilename }),

  openPasswordPrompt: (filePath) =>
    set({
      isPasswordModalOpen: true,
      pendingProtectedPath: filePath,
      passwordError: null,
    }),

  closePasswordPrompt: () =>
    set({
      isPasswordModalOpen: false,
      pendingProtectedPath: null,
      passwordError: null,
    }),

  executeActiveOperation: async (subTab, outputDir, namingPattern) => {
    const state = get();
    const safeOutDir = outputDir || "Exports";
    const sep = safeOutDir.includes("\\") ? "\\" : "/";
    const rawName = state.outputFilename.trim() || "XENON_organized.pdf";
    const needsPdfExt = subTab !== "split" || state.mergeExtractedIntoSinglePdf;
    const cleanName =
      needsPdfExt && !rawName.toLowerCase().endsWith(".pdf")
        ? `${rawName}.pdf`
        : rawName;
    let outPath = `${safeOutDir}${sep}${cleanName}`;

    const modalStore = useProcessModalStore.getState();
    if (subTab !== "split") {
      const opLabel = subTab === "merge" ? "Merge PDFs" : "Organize & Export PDF";
      const resolved = await modalStore.confirmOrCopyPaths([outPath], opLabel);
      if (!resolved) return;
      outPath = resolved[0];
    } else if (state.mergeExtractedIntoSinglePdf) {
      const resolved = await modalStore.confirmOrCopyPaths([outPath], "Extract Pages to PDF");
      if (!resolved) return;
      outPath = resolved[0];
    }

    set({
      isExecuting: true,
      executionTicks: 3,
      lastResultMessage: null,
      lastError: null,
    });

    try {
      const updateTicks = (pct: number) =>
        set({ executionTicks: Math.max(1, Math.min(10, Math.round(pct / 10))) });

      if (subTab === "merge") {
        const res = await runWithMinimumProgress(
          () =>
            tauriClient.executeMergePdfs(
              state.mergeQueue.map((m) => m.filePath),
              state.retainBookmarksToc,
              state.standardizeToA4,
              state.pdfVersionProfile,
              outPath
            ),
          updateTicks
        );
        set({
          executionTicks: 10,
          lastResultMessage: `Merged ${state.mergeQueue.length} file(s) -> ${res.pageCount} pages saved (${res.durationMs} ms)`,
        });
        modalStore.showCompletion({
          title: "Merge PDF Completed",
          summary: `Merged ${state.mergeQueue.length} file(s) into ${res.pageCount} page(s).`,
          outputPaths: [res.outputPath],
          outputBytes: res.outputBytes,
          durationMs: res.durationMs,
        });
      } else if (subTab === "split") {
        const selectedPageNums = state.splitPages
          .filter((p) => p.selected)
          .map((p) => p.originalPageNumber);
        const results: OrganizeExecutionResult[] = await runWithMinimumProgress(
          () =>
            tauriClient.executeSplitPdf({
              inputPath: state.splitDocPath,
              mode: state.splitMode,
              rangeSpec: state.splitRangeSpec,
              everyNPages: state.splitEveryN,
              selectedPages: selectedPageNums,
              mergeExtractedIntoSinglePdf: state.mergeExtractedIntoSinglePdf,
              outputDir: safeOutDir,
              namingPattern,
            }),
          updateTicks
        );
        const totalPages = results.reduce((acc, r) => acc + r.pageCount, 0);
        const totalBytes = results.reduce((acc, r) => acc + (r.outputBytes ?? 0), 0);
        const totalDuration = results.reduce((acc, r) => acc + (r.durationMs ?? 0), 0);
        set({
          executionTicks: 10,
          lastResultMessage: `Split complete: created ${results.length} PDF file(s) in ${safeOutDir}`,
        });
        modalStore.showCompletion({
          title: "Split PDF Completed",
          summary: `Created ${results.length} PDF file(s) (${totalPages} total pages).`,
          outputPaths: results.map((r) => r.outputPath),
          outputBytes: totalBytes || undefined,
          durationMs: totalDuration || undefined,
        });
      } else {
        const res = await runWithMinimumProgress(
          () =>
            tauriClient.executeOrganizePdf({
              pages: state.pages.map((p) => ({
                sourceDocId: p.sourceDocId,
                originalPageNumber: p.originalPageNumber,
                rotationDelta: p.rotationDelta,
                cropBox: p.cropBox,
              })),
              retainBookmarksToc: state.retainBookmarksToc,
              standardizeToA4: state.standardizeToA4,
              pdfVersionProfile: state.pdfVersionProfile,
              outputPath: outPath,
            }),
          updateTicks
        );
        set({
          executionTicks: 10,
          lastResultMessage: `Exported ${res.pageCount} page(s) to ${res.outputPath} (${res.durationMs} ms)`,
        });
        modalStore.showCompletion({
          title: "Organize & Export Completed",
          summary: `Exported ${res.pageCount} page(s) successfully.`,
          outputPaths: [res.outputPath],
          outputBytes: res.outputBytes,
          durationMs: res.durationMs,
        });
      }

      await useHistoryStore.getState().fetchDashboardMetrics();
      await useTelemetryStore.getState().loadLogs();
    } catch (err) {
      const { message } = extractErrorKindAndMsg(err);
      set({ executionTicks: 0, lastError: message });
    } finally {
      set({ isExecuting: false });
    }
  },
}));
