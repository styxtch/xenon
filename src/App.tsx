import React, { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { AppIcon } from "./components/common/AppIcon";
import { ImportProgressToast } from "./components/shell/ImportProgressToast";
import { LogsTerminalDrawer } from "./components/shell/LogsTerminalDrawer";
import { PasswordPromptModal } from "./components/shell/PasswordPromptModal";
import { ProcessFeedbackModal } from "./components/shell/ProcessFeedbackModal";
import { Sidebar } from "./components/shell/Sidebar";
import { WorkspaceHeader } from "./components/shell/WorkspaceHeader";
import { isTauriRuntime } from "./lib/tauriClient";
import {
  isImagePath,
  isPdfOrImagePath,
  isPdfPath,
  useDragDropStore,
} from "./stores/dragDropStore";
import { useDocumentStore } from "./stores/documentStore";
import { useToolFilesStore } from "./stores/toolFilesStore";
import { useHistoryStore } from "./stores/historyStore";
import {
  useImportProgressStore,
  type ImportProgressPayload,
} from "./stores/importProgressStore";
import { useQueueStore } from "./stores/queueStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useTelemetryStore } from "./stores/telemetryStore";
import type { ActiveViewId, EngineLogEntry, JobTickEvent } from "./types/xenon";
import { BatchQueueView } from "./views/BatchQueueView";
import { ConvertOcrView } from "./views/ConvertOcrView";
import { DashboardView } from "./views/DashboardView";
import { OptimizeView } from "./views/OptimizeView";
import { OrganizeView } from "./views/OrganizeView";
import { SecuritySignView } from "./views/SecuritySignView";
import { SettingsView } from "./views/SettingsView";

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<ActiveViewId>("dashboard");
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const fetchDashboardMetrics = useHistoryStore((s) => s.fetchDashboardMetrics);
  const recentDocuments = useHistoryStore((s) => s.metrics.recentDocuments);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const settings = useSettingsStore((s) => s.settings);
  const refreshTelemetry = useTelemetryStore((s) => s.refreshTelemetry);
  const runDiagnostics = useTelemetryStore((s) => s.runDiagnostics);
  const loadLogs = useTelemetryStore((s) => s.loadLogs);
  const appendLog = useTelemetryStore((s) => s.appendLog);
  const toggleLogsDrawer = useTelemetryStore((s) => s.toggleLogsDrawer);
  const seedFromRecent = useQueueStore((s) => s.seedFromRecent);

  const openPdfFile = useDocumentStore((s) => s.openPdfFile);
  const insertFilesIntoGrid = useDocumentStore((s) => s.insertFilesIntoGrid);
  const undo = useDocumentStore((s) => s.undo);
  const redo = useDocumentStore((s) => s.redo);
  const selectAllPages = useDocumentStore((s) => s.selectAllPages);
  const rotateSelectedRight = useDocumentStore((s) => s.rotateSelectedRight);
  const deleteSelected = useDocumentStore((s) => s.deleteSelected);
  const executeActiveOperation = useDocumentStore(
    (s) => s.executeActiveOperation
  );

  const isDraggingFiles = useDragDropStore((s) => s.isDraggingFiles);
  const draggedPaths = useDragDropStore((s) => s.draggedPaths);
  const activeDropHint = useDragDropStore((s) => s.activeDropHint);

  useEffect(() => {
    const preventBrowserDrop = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener("dragover", preventBrowserDrop);
    window.addEventListener("drop", preventBrowserDrop);

    let disposed = false;
    let unlistenDragDrop: (() => void) | undefined;

    if (isTauriRuntime()) {
      void getCurrentWebview()
        .onDragDropEvent(async (event) => {
          if (disposed) return;
          const store = useDragDropStore.getState();
          const payload = event.payload;
          if (payload.type === "enter") {
            store.setDragging(true, payload.paths);
          } else if (payload.type === "over") {
            if (!store.isDraggingFiles) {
              store.setDragging(true);
            }
          } else if (payload.type === "leave") {
            store.setDragging(false);
          } else if (payload.type === "drop") {
            store.setDragging(false);
            const droppedPaths = payload.paths ?? [];
            if (droppedPaths.length === 0) return;

            if (store.handler) {
              await store.handler(droppedPaths);
              return;
            }

            const supported = droppedPaths.filter(isPdfOrImagePath);
            if (supported.length === 0) return;

            const docStore = useDocumentStore.getState();
            if (isPdfPath(supported[0])) {
              await docStore.openPdfFile(supported[0]);
              if (supported.length > 1) {
                await docStore.insertFilesIntoGrid(supported.slice(1));
              }
            } else {
              await docStore.insertFilesIntoGrid(supported);
            }
            setActiveView("organize-pdf");
          }
        })
        .then((fn) => {
          if (disposed) {
            void fn();
          } else {
            unlistenDragDrop = fn;
          }
        });
    }

    return () => {
      disposed = true;
      window.removeEventListener("dragover", preventBrowserDrop);
      window.removeEventListener("drop", preventBrowserDrop);
      if (unlistenDragDrop) {
        void unlistenDragDrop();
      }
    };
  }, []);

  useEffect(() => {
    void fetchDashboardMetrics();
    void loadSettings();
    void refreshTelemetry();
    void runDiagnostics();
    void loadLogs();

    const timer = window.setInterval(() => {
      void refreshTelemetry();
    }, 4000);

    let unlisten: (() => void) | undefined;
    let unlistenTicks: (() => void) | undefined;
    let unlistenImport: (() => void) | undefined;
    if (isTauriRuntime()) {
      void listen<EngineLogEntry>("engine-log-line", (event) => {
        appendLog(event.payload);
      }).then((fn) => {
        unlisten = fn;
      });
      void listen<JobTickEvent>("job-tick-progress", (event) => {
        useQueueStore.getState().upsertFromTick(event.payload);
      }).then((fn) => {
        unlistenTicks = fn;
      });
      void listen<ImportProgressPayload>("import-progress", (event) => {
        useImportProgressStore.getState().updateFromEvent(event.payload);
      }).then((fn) => {
        unlistenImport = fn;
      });
    }

    return () => {
      window.clearInterval(timer);
      if (unlisten) unlisten();
      if (unlistenTicks) unlistenTicks();
      if (unlistenImport) unlistenImport();
    };
  }, [
    appendLog,
    fetchDashboardMetrics,
    loadLogs,
    loadSettings,
    refreshTelemetry,
    runDiagnostics,
  ]);

  useEffect(() => {
    if (recentDocuments.length > 0) {
      seedFromRecent(recentDocuments);
    }
  }, [recentDocuments, seedFromRecent]);

  const handleOpenFiles = async () => {
    if (!isTauriRuntime()) {
      if (
        activeView !== "optimize-repair" &&
        activeView !== "convert-ocr" &&
        activeView !== "security-sign"
      ) {
        setActiveView("organize-pdf");
      }
      return;
    }

    const filters =
      activeView === "optimize-repair" || activeView === "security-sign"
        ? [{ name: "PDF Documents", extensions: ["pdf"] }]
        : [
            {
              name: "PDF & Images",
              extensions: ["pdf", "jpg", "jpeg", "png", "webp", "tiff", "bmp"],
            },
          ];

    const selected = await open({
      multiple: activeView !== "security-sign",
      filters,
    });
    const files: string[] = Array.isArray(selected)
      ? selected
      : typeof selected === "string"
        ? [selected]
        : [];
    if (files.length === 0) return;

    const toolStore = useToolFilesStore.getState();
    if (activeView === "optimize-repair") {
      const pdfs = files.filter(isPdfPath);
      const key = toolStore.activeToolKey.startsWith("optimize:")
        ? toolStore.activeToolKey
        : "optimize:compress";
      if (pdfs.length > 0) toolStore.addToolFiles(key, pdfs);
      return;
    }
    if (activeView === "convert-ocr") {
      const pdfs = files.filter(isPdfPath);
      const images = files.filter(isImagePath);
      if (toolStore.activeToolKey === "convert:img2pdf") {
        if (images.length > 0) toolStore.addToolFiles("convert:img2pdf", images);
      } else {
        const key = toolStore.activeToolKey.startsWith("convert:")
          ? toolStore.activeToolKey
          : "convert:pdf2img";
        if (pdfs.length > 0) toolStore.setToolFiles(key, [pdfs[0]]);
      }
      return;
    }
    if (activeView === "security-sign") {
      const pdfs = files.filter(isPdfPath);
      const key = toolStore.activeToolKey.startsWith("security:")
        ? toolStore.activeToolKey
        : "security:protect";
      if (pdfs.length > 0) toolStore.setToolFiles(key, [pdfs[0]]);
      return;
    }

    if (files[0].toLowerCase().endsWith(".pdf")) {
      await openPdfFile(files[0]);
      if (files.length > 1) {
        await insertFilesIntoGrid(files.slice(1));
      }
    } else {
      await insertFilesIntoGrid(files);
    }
    setActiveView("organize-pdf");
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT";

      const mod = e.ctrlKey || e.metaKey;

      if (activeView === "organize-pdf" && !isInput) {
        if ((e.key === "Delete" || e.key === "Backspace") && !mod) {
          e.preventDefault();
          deleteSelected();
          return;
        }
        if (mod) {
          const key = e.key.toLowerCase();
          if (key === "z" && e.shiftKey) {
            e.preventDefault();
            redo();
            return;
          }
          if (key === "z") {
            e.preventDefault();
            undo();
            return;
          }
          if (key === "y") {
            e.preventDefault();
            redo();
            return;
          }
          if (key === "a") {
            e.preventDefault();
            selectAllPages();
            return;
          }
          if (key === "r") {
            e.preventDefault();
            rotateSelectedRight();
            return;
          }
          if (key === "e") {
            e.preventDefault();
            void executeActiveOperation(
              "grid",
              settings.primaryDestinationFolder,
              settings.outputNamingPattern
            );
            return;
          }
        }
      }

      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (key === "l") {
        e.preventDefault();
        toggleLogsDrawer();
      } else if (key === ",") {
        e.preventDefault();
        setActiveView("settings");
      } else if (key === "o") {
        e.preventDefault();
        void handleOpenFiles();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const renderActiveView = () => {
    switch (activeView) {
      case "dashboard":
        return (
          <DashboardView
            onNavigate={setActiveView}
            onOpenFiles={handleOpenFiles}
          />
        );
      case "batch-queue":
        return <BatchQueueView />;
      case "organize-pdf":
        return <OrganizeView onOpenFiles={handleOpenFiles} />;
      case "optimize-repair":
        return <OptimizeView onOpenFiles={handleOpenFiles} />;
      case "convert-ocr":
        return <ConvertOcrView onOpenFiles={handleOpenFiles} />;
      case "security-sign":
        return <SecuritySignView onOpenFiles={handleOpenFiles} />;
      case "settings":
        return <SettingsView />;
    }
  };

  return (
    <div className="min-h-screen bg-bg-canvas text-text-primary">
      <Sidebar
        activeView={activeView}
        onNavigate={setActiveView}
        searchInputRef={searchInputRef}
      />
      <div className="pl-[250px]">
        <WorkspaceHeader
          activeView={activeView}
          onOpenFiles={handleOpenFiles}
        />
        <main className="w-full pt-16 min-h-screen px-space-xl pb-space-2xl bg-bg-canvas">
          {renderActiveView()}
        </main>
      </div>
      <LogsTerminalDrawer />
      <PasswordPromptModal />
      <ProcessFeedbackModal />
      <ImportProgressToast />

      {isDraggingFiles && (
        <div className="pointer-events-none fixed inset-0 z-[100] bg-bg-canvas/75 backdrop-blur-[2px] p-6 flex items-center justify-center">
          <div className="w-full h-full rounded-2xl border-2 border-dashed border-primary bg-primary/5 flex flex-col items-center justify-center gap-3 text-center px-6">
            <div className="w-16 h-16 rounded-2xl bg-primary/15 border border-primary/40 flex items-center justify-center text-primary shadow-lg">
              <AppIcon name="upload_file" className="w-8 h-8" />
            </div>
            <h2 className="font-headline-md text-headline-md text-text-primary">
              Drop {draggedPaths.length > 0 ? `${draggedPaths.length} ` : ""}file(s) into XENON
            </h2>
            <p className="font-body-sm text-body-sm text-text-secondary max-w-md">
              {activeDropHint ||
                "Drop PDF or image files to open in Organize PDF Workspace"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
