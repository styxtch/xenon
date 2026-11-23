import React, { useEffect, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { open } from "@tauri-apps/plugin-dialog";
import { AppIcon } from "../components/common/AppIcon";
import { DropZoneWell } from "../components/common/DropZoneWell";
import { OrganizeInspector } from "../components/organize/OrganizeInspector";
import { VisualPageGrid } from "../components/organize/VisualPageGrid";
import { formatBytes, getXenonTileUrl, isTauriRuntime } from "../lib/tauriClient";
import {
  isPdfOrImagePath,
  isPdfPath,
  useDragDropStore,
} from "../stores/dragDropStore";
import {
  useDocumentStore,
  type OrganizeSubTab,
} from "../stores/documentStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { MergeQueueItem } from "../types/xenon";

interface SortableMergeRowProps {
  item: MergeQueueItem;
  index: number;
  onRemove: (docId: string) => void;
}

const SortableMergeRow: React.FC<SortableMergeRowProps> = ({
  item,
  index,
  onRemove,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.docId });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`bg-surface-elevated border rounded-lg px-3.5 py-2.5 flex items-center justify-between gap-3 transition-[box-shadow,border-color,opacity] select-none touch-none ${
        isDragging
          ? "opacity-50 border-primary shadow-lg cursor-grabbing z-10"
          : "border-border-subtle hover:border-border-default cursor-grab"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <AppIcon
          name="drag_indicator"
          className="w-4 h-4 text-text-muted shrink-0"
        />
        <span className="font-mono-metric text-caption px-2 py-0.5 rounded bg-surface-card text-tag-organize border border-border-subtle">
          #{index + 1}
        </span>
        <div className="min-w-0">
          <div className="font-body-medium text-body-medium text-text-primary truncate">
            {item.fileName}
          </div>
          <div className="font-mono-metric text-caption text-text-muted truncate">
            {item.pageCount} pages • {formatBytes(item.fileSizeBytes)}
          </div>
        </div>
      </div>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(item.docId);
        }}
        className="p-1.5 rounded hover:bg-surface-card text-text-muted hover:text-error"
        title="Remove from merge queue"
      >
        <AppIcon name="delete" className="w-4 h-4" />
      </button>
    </div>
  );
};

interface OrganizeViewProps {
  onOpenFiles: () => void;
}

export const OrganizeView: React.FC<OrganizeViewProps> = ({ onOpenFiles }) => {
  const [subTab, setSubTab] = useState<OrganizeSubTab>("grid");

  const activeDocName = useDocumentStore((s) => s.activeDocName);
  const totalBytes = useDocumentStore((s) => s.totalBytes);
  const pages = useDocumentStore((s) => s.pages);
  const mergeQueue = useDocumentStore((s) => s.mergeQueue);
  const splitDocName = useDocumentStore((s) => s.splitDocName);
  const splitTotalBytes = useDocumentStore((s) => s.splitTotalBytes);
  const splitPages = useDocumentStore((s) => s.splitPages);
  const splitMode = useDocumentStore((s) => s.splitMode);
  const splitRangeSpec = useDocumentStore((s) => s.splitRangeSpec);
  const mergeExtractedIntoSinglePdf = useDocumentStore(
    (s) => s.mergeExtractedIntoSinglePdf
  );
  const cropMargins = useDocumentStore((s) => s.cropMargins);
  const setOutputFilename = useDocumentStore((s) => s.setOutputFilename);

  const initSampleDocument = useDocumentStore((s) => s.initSampleDocument);
  const clearActiveDocument = useDocumentStore((s) => s.clearActiveDocument);
  const openPdfFile = useDocumentStore((s) => s.openPdfFile);
  const insertFilesIntoGrid = useDocumentStore((s) => s.insertFilesIntoGrid);
  const addFilesToMergeQueue = useDocumentStore((s) => s.addFilesToMergeQueue);
  const removeMergeQueueItem = useDocumentStore((s) => s.removeMergeQueueItem);
  const reorderMergeQueue = useDocumentStore((s) => s.reorderMergeQueue);
  const clearMergeQueue = useDocumentStore((s) => s.clearMergeQueue);
  const openSplitPdfFile = useDocumentStore((s) => s.openSplitPdfFile);
  const toggleSplitPageSelection = useDocumentStore(
    (s) => s.toggleSplitPageSelection
  );
  const selectAllSplitPages = useDocumentStore((s) => s.selectAllSplitPages);
  const clearSplitDocument = useDocumentStore((s) => s.clearSplitDocument);
  const selectAllPages = useDocumentStore((s) => s.selectAllPages);
  const rotateSelectedLeft = useDocumentStore((s) => s.rotateSelectedLeft);
  const rotateSelectedRight = useDocumentStore((s) => s.rotateSelectedRight);
  const deleteSelected = useDocumentStore((s) => s.deleteSelected);
  const executeActiveOperation = useDocumentStore(
    (s) => s.executeActiveOperation
  );

  const settings = useSettingsStore((s) => s.settings);

  const mergeSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  useEffect(() => {
    void initSampleDocument();
  }, [initSampleDocument]);

  useEffect(() => {
    const cleanStem = (name: string) =>
      name.split(/[\\/]/).pop()?.replace(/\.pdf$/i, "") || "";
    if (subTab === "merge") {
      const firstMerge = mergeQueue[0]?.fileName || "";
      const stem = cleanStem(firstMerge);
      setOutputFilename(stem ? `${stem}_merged.pdf` : "");
    } else if (subTab === "split") {
      const stem = cleanStem(splitDocName);
      if (!stem) {
        setOutputFilename("");
      } else if (splitMode === "extract_selected" || mergeExtractedIntoSinglePdf) {
        setOutputFilename(`${stem}_extracted.pdf`);
      } else {
        setOutputFilename(`${stem}_split`);
      }
    } else {
      const stem = cleanStem(activeDocName);
      setOutputFilename(stem ? `${stem}_organized.pdf` : "");
    }
  }, [
    subTab,
    activeDocName,
    splitDocName,
    mergeQueue,
    splitMode,
    mergeExtractedIntoSinglePdf,
    setOutputFilename,
  ]);

  useEffect(() => {
    const hint =
      subTab === "merge"
        ? "Drop PDF files to append to Merge Files Queue"
        : subTab === "split"
          ? "Drop a PDF file to load into Split & Extract"
          : "Drop PDF or image files to add into Organize Workspace";

    return useDragDropStore.getState().registerHandler(async (droppedPaths) => {
      if (subTab === "merge") {
        const pdfs = droppedPaths.filter(isPdfPath);
        if (pdfs.length > 0) {
          await addFilesToMergeQueue(pdfs);
        }
        return;
      }

      if (subTab === "split") {
        const pdfs = droppedPaths.filter(isPdfPath);
        if (pdfs.length > 0) {
          await openSplitPdfFile(pdfs[0]);
        }
        return;
      }

      const supported = droppedPaths.filter(isPdfOrImagePath);
      if (supported.length === 0) return;
      if (pages.length === 0 && isPdfPath(supported[0])) {
        await openPdfFile(supported[0]);
        if (supported.length > 1) {
          await insertFilesIntoGrid(supported.slice(1));
        }
      } else {
        await insertFilesIntoGrid(supported);
      }
    }, hint);
  }, [
    subTab,
    pages.length,
    openPdfFile,
    openSplitPdfFile,
    insertFilesIntoGrid,
    addFilesToMergeQueue,
  ]);

  const selectedCount = pages.filter((p) => p.selected).length;

  const handlePickSplitPdf = async () => {
    if (!isTauriRuntime()) return;
    const picked = await open({
      multiple: false,
      filters: [{ name: "PDF Files", extensions: ["pdf"] }],
    });
    if (typeof picked === "string") {
      await openSplitPdfFile(picked);
    }
  };

  const handleInsertDocumentsOrImages = async () => {
    if (subTab === "split") {
      await handlePickSplitPdf();
      return;
    }
    if (!isTauriRuntime()) {
      await insertFilesIntoGrid(["Inserted_Scan.png"]);
      return;
    }
    const picked = await open({
      multiple: subTab === "merge" || subTab === "grid" || subTab === "crop",
      filters:
        subTab === "merge"
          ? [{ name: "PDF Files", extensions: ["pdf"] }]
          : [
              {
                name: "PDF & Images",
                extensions: ["pdf", "jpg", "jpeg", "png", "webp", "tiff", "bmp"],
              },
            ],
    });
    const list = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (list.length > 0) {
      if (subTab === "merge") {
        await addFilesToMergeQueue(list);
      } else {
        await insertFilesIntoGrid(list);
      }
    }
  };

  const handleExecute = () => {
    void executeActiveOperation(
      subTab,
      settings.primaryDestinationFolder,
      settings.outputNamingPattern
    );
  };

  return (
    <div className="flex flex-col w-full gap-space-lg">
      {/* Top Workspace Toolbar */}
      <div className="flex flex-col gap-space-md bg-surface-card border border-border-default rounded-xl p-space-md shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-space-md">
          <div className="flex items-center gap-space-md">
            <div className="w-10 h-10 rounded-lg bg-tag-organize/15 border border-tag-organize/30 flex items-center justify-center text-tag-organize">
              <AppIcon name="grid_view" className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-headline-md text-headline-md text-text-primary tracking-tight">
                  Organize &amp; Manage PDF Pages
                </h1>
                <span className="font-caption text-caption px-2 py-0.5 rounded-full bg-tag-organize/15 text-tag-organize font-medium border border-tag-organize/30">
                  QPDF v12.4 + PDFium + Lopdf
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-text-muted mt-0.5">
                Active File:{" "}
                <span className="font-mono-metric text-text-primary font-medium">
                  {subTab === "merge"
                    ? mergeQueue.length > 0
                      ? `${mergeQueue.length} file(s) queued`
                      : "No files in merge queue"
                    : subTab === "split"
                      ? splitDocName || "No PDF loaded"
                      : activeDocName || "No PDF loaded"}
                </span>{" "}
                {subTab === "merge"
                  ? mergeQueue.length > 0 &&
                    `(${mergeQueue.reduce((acc, m) => acc + m.pageCount, 0)} Total Pages)`
                  : subTab === "split"
                    ? splitPages.length > 0 &&
                      `(${splitPages.length} Pages • ${formatBytes(splitTotalBytes)})`
                    : pages.length > 0 &&
                      `(${pages.length} Pages • ${formatBytes(totalBytes)})`}
              </p>
            </div>
          </div>

          {((subTab === "merge" && mergeQueue.length > 0) ||
            (subTab === "split" && splitPages.length > 0) ||
            ((subTab === "grid" || subTab === "crop") && pages.length > 0)) && (
            <div className="flex items-center gap-space-sm flex-wrap">
              <button
                type="button"
                onClick={
                  subTab === "merge"
                    ? clearMergeQueue
                    : subTab === "split"
                      ? clearSplitDocument
                      : clearActiveDocument
                }
                title="Remove loaded file(s) from this tool"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover text-text-secondary border border-border-default hover:border-status-danger/50 hover:text-error font-body-sm text-body-sm transition-colors"
              >
                <AppIcon name="close" className="w-4 h-4" />
                <span>{subTab === "merge" && mergeQueue.length > 1 ? "Clear All" : "Remove File"}</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  subTab === "merge" || subTab === "split"
                    ? void handleInsertDocumentsOrImages()
                    : onOpenFiles()
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover text-text-primary border border-border-default font-body-sm text-body-sm font-medium transition-colors"
              >
                <AppIcon name="file_open" className="w-4 h-4 text-tag-organize" />
                <span>
                  {subTab === "split"
                    ? "Select PDF"
                    : subTab === "merge"
                      ? "Select PDFs"
                      : "Select PDF / Images"}
                </span>
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-space-md pt-2 border-t border-border-subtle">
          <div className="inline-flex p-1 bg-surface-elevated rounded-lg border border-border-subtle flex-wrap">
            {(
              [
                { id: "grid", label: "Visual Page Grid", icon: "auto_awesome_mosaic" },
                { id: "merge", label: "Merge Files Queue", icon: "call_merge" },
                { id: "split", label: "Split by Range", icon: "call_split" },
                { id: "crop", label: "Crop & Rotate", icon: "crop_rotate" },
              ] as const
            ).map((t) => {
              const active = subTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSubTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-body-sm text-body-sm transition-all ${
                    active
                      ? "bg-surface-active text-text-primary font-medium shadow-sm"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  <AppIcon
                    name={t.icon}
                    className={`w-4 h-4 ${active ? "text-tag-organize" : ""}`}
                  />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          {((subTab === "grid" || subTab === "crop") && pages.length > 0) ||
          (subTab === "merge" && mergeQueue.length > 0) ||
          (subTab === "split" && splitPages.length > 0) ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={handleInsertDocumentsOrImages}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover text-text-primary border border-border-subtle font-body-sm text-body-sm transition-colors"
              >
                <AppIcon name="add_circle" className="w-4 h-4 text-primary" />
                <span>
                  {subTab === "split"
                    ? "Change PDF"
                    : subTab === "merge"
                      ? "Add PDFs"
                      : "Add PDF / Images"}
                </span>
              </button>
              {subTab === "split" && (
                <button
                  type="button"
                  onClick={selectAllSplitPages}
                  disabled={splitPages.length === 0}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed text-text-secondary hover:text-text-primary border border-border-subtle font-body-sm text-body-sm transition-colors"
                >
                  <AppIcon name="select_all" className="w-4 h-4" />
                  <span>Select All</span>
                </button>
              )}
              {(subTab === "grid" || subTab === "crop") && (
                <>
                  <button
                    type="button"
                    onClick={selectAllPages}
                    disabled={pages.length === 0}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed text-text-secondary hover:text-text-primary border border-border-subtle font-body-sm text-body-sm transition-colors"
                  >
                    <AppIcon name="select_all" className="w-4 h-4" />
                    <span>Select All</span>
                  </button>
                  <div className="w-px h-5 bg-border-subtle mx-1" />
                  <button
                    type="button"
                    onClick={rotateSelectedLeft}
                    disabled={selectedCount === 0}
                    title="Rotate Selected Left 90°"
                    className="w-8 h-8 rounded-lg bg-surface-elevated hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed border border-border-subtle flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
                  >
                    <AppIcon name="rotate_left" className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={rotateSelectedRight}
                    disabled={selectedCount === 0}
                    title="Rotate Selected Right 90° (Ctrl+R)"
                    className="w-8 h-8 rounded-lg bg-surface-elevated hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed border border-border-subtle flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
                  >
                    <AppIcon name="rotate_right" className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={deleteSelected}
                    disabled={selectedCount === 0}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-error-container/40 hover:bg-error-container/70 disabled:opacity-40 disabled:cursor-not-allowed text-error font-body-sm text-body-sm transition-colors"
                  >
                    <AppIcon name="delete" className="w-4 h-4" />
                    <span>Delete Selected ({selectedCount})</span>
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Main Split Workbench Area */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-lg items-start">
        <div className="xl:col-span-8">
          {subTab === "grid" &&
            (pages.length === 0 ? (
              <div className="bg-surface-card border border-border-default rounded-xl p-space-xl">
                <DropZoneWell
                  title="Drop PDF or image files here, or click to open (Ctrl+O)"
                  subtitle="Drag & drop from Windows Explorer or click to browse PDF, JPG, PNG, WebP, TIFF, or BMP."
                  onSelectFiles={onOpenFiles}
                  accentClass="text-tag-organize"
                />
              </div>
            ) : (
              <VisualPageGrid onInsertFiles={handleInsertDocumentsOrImages} />
            ))}

          {subTab === "merge" && (
            <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col gap-space-md">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-headline-sm text-headline-sm text-text-primary">
                    Merge Files Queue ({mergeQueue.length} files)
                  </h2>
                  <p className="font-caption text-caption text-text-muted">
                    Drag rows to reorder merge sequence — files concatenate top-to-bottom using atomic `.part` assembly
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {mergeQueue.length > 0 && (
                    <button
                      type="button"
                      onClick={clearMergeQueue}
                      className="px-3 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default hover:border-status-danger/50 font-body-sm text-body-sm text-text-secondary hover:text-error transition-colors"
                    >
                      Clear Queue
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleInsertDocumentsOrImages}
                    className="px-3 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default font-body-sm text-body-sm text-primary"
                  >
                    + Add PDFs to Queue
                  </button>
                </div>
              </div>

              <DndContext
                sensors={mergeSensors}
                collisionDetection={closestCenter}
                onDragEnd={(event: DragEndEvent) => {
                  const { active, over } = event;
                  if (over && active.id !== over.id) {
                    reorderMergeQueue(String(active.id), String(over.id));
                  }
                }}
              >
                <SortableContext
                  items={mergeQueue.map((item) => item.docId)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {mergeQueue.map((item, idx) => (
                      <SortableMergeRow
                        key={item.docId}
                        item={item}
                        index={idx}
                        onRemove={removeMergeQueueItem}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              <DropZoneWell
                title="Drag & drop PDF files here or click to add to merge queue"
                subtitle="Bookmarks & TOC hierarchy can be retained from the right-hand Arrangement Rules panel."
                onSelectFiles={() => void handleInsertDocumentsOrImages()}
                accentClass="text-tag-organize"
              />
            </div>
          )}

          {subTab === "split" && (
            <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col gap-space-md">
              <div>
                <h2 className="font-headline-sm text-headline-sm text-text-primary">
                  Split Plan Preview ({splitMode})
                </h2>
                <p className="font-caption text-caption text-text-muted">
                  Configure range, burst, or selected page extraction in the Split Parameters inspector.
                </p>
              </div>
              <div className="p-4 rounded-lg bg-surface-elevated border border-border-subtle font-mono-metric text-body-sm text-text-primary">
                Mode: <span className="text-tag-organize">{splitMode}</span>
                {splitMode === "range" && (
                  <span className="ml-3 text-text-secondary">
                    Ranges: <strong className="text-primary">{splitRangeSpec}</strong>
                  </span>
                )}
              </div>
              {splitPages.length === 0 ? (
                <DropZoneWell
                  title="Drag & drop a PDF file here, or click to select for Split & Extract"
                  subtitle="Files opened here stay independent from Visual Page Grid and Merge Queue."
                  onSelectFiles={() => void handlePickSplitPdf()}
                  accentClass="text-tag-organize"
                />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-space-md p-space-md bg-surface-elevated/50 border border-border-subtle rounded-xl">
                  {splitPages.map((sp, idx) => (
                    <button
                      key={sp.id}
                      type="button"
                      onClick={() => toggleSplitPageSelection(sp.id)}
                      className={`group flex flex-col rounded-xl border p-2 text-left transition-all ${
                        sp.selected
                          ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                          : "border-border-default bg-surface-card hover:border-primary/40"
                      }`}
                    >
                      <div className="w-full aspect-[1/1.35] rounded-lg bg-bg-canvas border border-border-subtle overflow-hidden flex items-center justify-center">
                        {isTauriRuntime() ? (
                          <img
                            src={
                              getXenonTileUrl(
                                sp.sourceDocId,
                                sp.originalPageNumber,
                                240,
                                0
                              ) ?? undefined
                            }
                            alt={`Page ${idx + 1}`}
                            className="w-full h-full object-contain"
                            loading="lazy"
                          />
                        ) : (
                          <span className="font-mono-metric text-caption text-text-muted">
                            Page {sp.originalPageNumber}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-1 px-0.5">
                        <span className="font-mono-metric text-caption text-text-primary font-semibold">
                          Page {sp.originalPageNumber}
                        </span>
                        {sp.selected && (
                          <span className="font-caption text-[11px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-medium">
                            Selected
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {subTab === "crop" && (
            <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col gap-space-md">
              <div className="p-4 rounded-lg bg-surface-elevated border border-border-subtle flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h2 className="font-headline-sm text-headline-sm text-text-primary">
                    CropBox &amp; Orientation Stage
                  </h2>
                  <p className="font-caption text-caption text-text-muted">
                    Current margins: Top {cropMargins.top}pt • Bottom {cropMargins.bottom}pt • Left {cropMargins.left}pt • Right {cropMargins.right}pt
                  </p>
                </div>
                <span className="font-mono-metric text-caption px-2.5 py-1 rounded bg-surface-card text-tag-convert border border-border-subtle">
                  {selectedCount} page(s) targeted
                </span>
              </div>
              {pages.length === 0 ? (
                <DropZoneWell
                  title="Drop PDF or image files here, or click to open (Ctrl+O)"
                  subtitle="Load a document first to adjust CropBox margins and page orientation."
                  onSelectFiles={onOpenFiles}
                  accentClass="text-tag-organize"
                />
              ) : (
                <VisualPageGrid onInsertFiles={handleInsertDocumentsOrImages} />
              )}
            </div>
          )}
        </div>

        <div className="xl:col-span-4">
          <OrganizeInspector
            activeSubTab={subTab}
            onExecute={handleExecute}
            onSwitchSubTab={setSubTab}
          />
        </div>
      </div>
    </div>
  );
};
