import React, { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { getXenonTileUrl } from "../../lib/tauriClient";
import { useDocumentStore } from "../../stores/documentStore";
import { AppIcon } from "../common/AppIcon";
import { InlineImportProgress } from "../common/InlineImportProgress";
import {
  PageThumbnailCard,
  PageThumbnailCardContent,
} from "./PageThumbnailCard";

interface VisualPageGridProps {
  onInsertFiles: () => void;
}

const VIRTUAL_WINDOW_STEP = 60;

export const VisualPageGrid: React.FC<VisualPageGridProps> = ({
  onInsertFiles,
}) => {
  const pages = useDocumentStore((s) => s.pages);
  const zoomPercent = useDocumentStore((s) => s.zoomPercent);
  const previewPageId = useDocumentStore((s) => s.previewPageId);
  const setZoomPercent = useDocumentStore((s) => s.setZoomPercent);
  const setPreviewPageId = useDocumentStore((s) => s.setPreviewPageId);
  const togglePageSelection = useDocumentStore((s) => s.togglePageSelection);
  const invertSelection = useDocumentStore((s) => s.invertSelection);
  const resetOrder = useDocumentStore((s) => s.resetOrder);
  const reorderPages = useDocumentStore((s) => s.reorderPages);
  const rotatePage = useDocumentStore((s) => s.rotatePage);
  const duplicatePage = useDocumentStore((s) => s.duplicatePage);
  const deletePage = useDocumentStore((s) => s.deletePage);

  const [visibleLimit, setVisibleLimit] = useState(VIRTUAL_WINDOW_STEP);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const gridColsClass = useMemo(() => {
    if (zoomPercent <= 35) return "grid-cols-3 md:grid-cols-4 lg:grid-cols-6";
    if (zoomPercent <= 60) return "grid-cols-2 md:grid-cols-4 lg:grid-cols-5";
    if (zoomPercent <= 90) return "grid-cols-2 md:grid-cols-3 lg:grid-cols-4";
    if (zoomPercent <= 125) return "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";
    return "grid-cols-1 md:grid-cols-2";
  }, [zoomPercent]);

  const visiblePages = useMemo(
    () => pages.slice(0, visibleLimit),
    [pages, visibleLimit]
  );

  const previewPage = useMemo(
    () => pages.find((p) => p.id === previewPageId) ?? null,
    [pages, previewPageId]
  );

  const activeDragIndex = useMemo(
    () => (activeDragId ? visiblePages.findIndex((p) => p.id === activeDragId) : -1),
    [visiblePages, activeDragId]
  );
  const activeDragPage = activeDragIndex >= 0 ? visiblePages[activeDragIndex] : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);
    if (over && active.id !== over.id) {
      reorderPages(String(active.id), String(over.id));
    }
  };

  const handleDragCancel = () => {
    setActiveDragId(null);
  };

  return (
    <div className="flex flex-col gap-space-md">
      {/* Grid Status Bar */}
      <div className="flex items-center justify-between px-space-sm flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="font-body-medium text-body-medium text-text-primary font-semibold">
            Visual Layout
          </span>
          <span className="font-caption text-caption text-text-muted">
            • Drag thumbnails to reorder • Click or Shift+Click to select
          </span>
        </div>
        <div className="flex items-center gap-space-sm text-text-muted font-body-sm text-body-sm">
          <span>Zoom:</span>
          <div className="inline-flex items-center gap-1 bg-surface-card border border-border-subtle px-2 py-0.5 rounded-md">
            <button
              type="button"
              onClick={() => setZoomPercent(zoomPercent - 25)}
              className="hover:text-text-primary"
              aria-label="Zoom out"
            >
              <AppIcon name="remove" className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono-metric text-mono-metric text-text-secondary px-1">
              {zoomPercent}%
            </span>
            <button
              type="button"
              onClick={() => setZoomPercent(zoomPercent + 25)}
              className="hover:text-text-primary"
              aria-label="Zoom in"
            >
              <AppIcon name="add" className="w-3.5 h-3.5" />
            </button>
          </div>
          <span className="text-text-disabled">|</span>
          <span className="font-mono-metric text-mono-metric text-primary">
            {visiblePages.length} of {pages.length} displayed
          </span>
        </div>
      </div>

      <InlineImportProgress />

      {/* Sortable Thumbnail Grid */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext
          items={visiblePages.map((p) => p.id)}
          strategy={rectSortingStrategy}
        >
          <div
            className={`grid ${gridColsClass} gap-space-md p-space-md bg-surface-card border border-border-default rounded-xl`}
          >
            {visiblePages.map((page, index) => (
              <PageThumbnailCard
                key={page.id}
                page={page}
                displayIndex={index}
                onSelect={togglePageSelection}
                onZoomPreview={setPreviewPageId}
                onRotateRight={(id) => rotatePage(id, 90)}
                onDuplicate={duplicatePage}
                onDelete={deletePage}
              />
            ))}

            <button
              type="button"
              onClick={onInsertFiles}
              className="flex flex-col items-center justify-center aspect-[1/1.414] rounded-lg bg-surface-elevated/60 hover:bg-surface-elevated border border-dashed border-border-default hover:border-primary-container transition-colors cursor-pointer p-4 text-center group"
            >
              <div className="w-10 h-10 rounded-full bg-surface-active flex items-center justify-center text-text-muted group-hover:text-primary transition-colors mb-2">
                <AppIcon name="add" className="w-5 h-5" />
              </div>
              <span className="font-body-sm text-body-sm text-text-secondary font-medium">
                Insert Document
              </span>
              <span className="font-caption text-caption text-text-muted mt-1 leading-snug">
                Add PDF, JPG, PNG, WebP, TIFF, or BMP
              </span>
            </button>
          </div>
        </SortableContext>

        <DragOverlay adjustScale={false}>
          {activeDragPage ? (
            <PageThumbnailCardContent
              page={activeDragPage}
              displayIndex={activeDragIndex}
              onSelect={() => {}}
              onZoomPreview={() => {}}
              onRotateRight={() => {}}
              onDuplicate={() => {}}
              onDelete={() => {}}
              isOverlay
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {pages.length > visiblePages.length && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setVisibleLimit((v) => v + VIRTUAL_WINDOW_STEP)}
            className="px-4 py-2 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default font-body-sm text-body-sm text-primary"
          >
            Load next {Math.min(VIRTUAL_WINDOW_STEP, pages.length - visiblePages.length)} pages
          </button>
        </div>
      )}

      {/* Quick Drag-Drop Hint Bar */}
      <div className="flex items-center justify-between p-space-md rounded-xl bg-surface-elevated/40 border border-border-subtle flex-wrap gap-2">
        <div className="flex items-center gap-space-sm text-text-muted font-body-sm text-body-sm">
          <AppIcon name="swap_horiz" className="w-[18px] h-[18px] text-tag-organize" />
          <span>
            Tip: Hold{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-surface-active text-text-primary font-mono-metric text-caption">
              Shift
            </kbd>{" "}
            to select continuous page intervals
          </span>
        </div>
        <div className="flex items-center gap-space-sm">
          <button
            type="button"
            onClick={resetOrder}
            className="font-caption text-caption text-text-secondary hover:text-text-primary"
          >
            Reset Order
          </button>
          <span className="text-text-disabled">•</span>
          <button
            type="button"
            onClick={invertSelection}
            className="font-caption text-caption text-primary hover:underline"
          >
            Invert Selection
          </button>
        </div>
      </div>

      {/* High-Res Zoom Preview Modal */}
      {previewPage && (
        <div
          onClick={() => setPreviewPageId(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl bg-surface-card border border-border-default rounded-xl p-5 shadow-2xl flex flex-col gap-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-headline-sm text-headline-sm text-text-primary">
                  Page Preview — {previewPage.sourceFileName} (p.{previewPage.originalPageNumber})
                </h3>
                <p className="font-mono-metric text-caption text-text-muted">
                  {Math.round(previewPage.widthPts)} × {Math.round(previewPage.heightPts)} pts • Rotation +{previewPage.rotationDelta}°
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewPageId(null)}
                className="w-8 h-8 rounded-lg bg-surface-elevated hover:bg-surface-hover flex items-center justify-center text-text-secondary hover:text-text-primary"
              >
                <AppIcon name="close" className="w-4 h-4" />
              </button>
            </div>

            <div className="w-full max-h-[65vh] overflow-auto bg-surface-container-lowest rounded-lg border border-border-subtle p-4 flex items-center justify-center">
              {getXenonTileUrl(
                previewPage.sourceDocId,
                previewPage.originalPageNumber,
                720,
                previewPage.rotationDelta
              ) ? (
                <img
                  src={
                    getXenonTileUrl(
                      previewPage.sourceDocId,
                      previewPage.originalPageNumber,
                      720,
                      previewPage.rotationDelta
                    ) ?? ""
                  }
                  alt={`Preview page ${previewPage.originalPageNumber}`}
                  className="max-h-[58vh] object-contain rounded"
                />
              ) : (
                <div className="w-full max-w-md aspect-[1/1.414] bg-surface-card border border-border-default rounded-lg p-6 flex flex-col justify-between">
                  <div className="space-y-2">
                    <span className="font-mono-metric text-caption text-primary">
                      Source Page {previewPage.originalPageNumber}
                    </span>
                    {previewPage.textPreview.map((line, i) => (
                      <p key={i} className="font-body-sm text-body-sm text-text-primary">
                        {line}
                      </p>
                    ))}
                  </div>
                  <span className="font-caption text-caption text-text-muted">
                    Rendered via XENON Local Tile Pipeline
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
