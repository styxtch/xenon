import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getXenonTileUrl } from "../../lib/tauriClient";
import type { GridPageItem } from "../../stores/documentStore";
import { AppIcon } from "../common/AppIcon";

interface PageThumbnailCardProps {
  page: GridPageItem;
  displayIndex: number;
  onSelect: (id: string, shiftKey: boolean) => void;
  onZoomPreview: (id: string) => void;
  onRotateRight: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  isOverlay?: boolean;
}

interface PageThumbnailCardContentProps extends PageThumbnailCardProps {
  cardRef?: (node: HTMLDivElement | null) => void;
  cardStyle?: React.CSSProperties;
  isDragging?: boolean;
  isOver?: boolean;
  dragAttributes?: Record<string, unknown>;
  dragListeners?: Record<string, unknown>;
}

export const PageThumbnailCardContent: React.FC<PageThumbnailCardContentProps> = ({
  page,
  displayIndex,
  onSelect,
  onZoomPreview,
  onRotateRight,
  onDuplicate,
  onDelete,
  isOverlay = false,
  cardRef,
  cardStyle,
  isDragging = false,
  isOver = false,
  dragAttributes,
  dragListeners,
}) => {
  const tileUrl = getXenonTileUrl(
    page.sourceDocId,
    page.originalPageNumber,
    320,
    page.rotationDelta
  );

  return (
    <div
      ref={cardRef}
      style={cardStyle}
      {...(dragAttributes ?? {})}
      {...(dragListeners ?? {})}
      onClick={isOverlay ? undefined : (e) => onSelect(page.id, e.shiftKey)}
      className={`group relative flex flex-col bg-surface-elevated rounded-lg p-2.5 transition-[box-shadow,border-color,opacity] select-none touch-none ${
        isOverlay
          ? "cursor-grabbing shadow-2xl ring-2 ring-primary opacity-95 rotate-[1deg]"
          : isDragging
            ? "cursor-grabbing opacity-35 border-2 border-dashed border-primary z-20"
            : page.selected
              ? "cursor-grab shadow-md ring-2 ring-primary"
              : "cursor-grab border border-border-subtle hover:border-border-default hover:shadow-md"
      }`}
    >
      {/* Glowing Blue Drag Insertion Indicator */}
      {isOver && !isDragging && !isOverlay && (
        <div className="absolute -left-2 top-0 bottom-0 w-1 bg-tag-organize rounded-full shadow-[0_0_8px_rgba(59,130,246,0.8)] z-10 flex items-center justify-center pointer-events-none">
          <span className="w-3 h-3 rounded-full bg-tag-organize shadow" />
        </div>
      )}

      <div className="flex items-center justify-between mb-2 gap-1">
        <div className="flex items-center gap-1 min-w-0">
          <AppIcon
            name="drag_indicator"
            className="w-3.5 h-3.5 text-text-muted shrink-0"
          />
          <span
            className={`font-caption text-caption px-1.5 py-0.5 rounded font-semibold tabular-nums ${
              page.selected
                ? "bg-primary-container text-on-primary-container"
                : "bg-surface-active text-text-muted"
            }`}
          >
            Page {displayIndex + 1}
          </span>
          {page.rotationDelta > 0 && (
            <span className="font-mono-metric text-[10px] px-1 py-0.5 rounded bg-surface-card text-tag-optimize border border-border-subtle">
              +{page.rotationDelta}°
            </span>
          )}
          {page.cropBox && (
            <span className="font-mono-metric text-[10px] px-1 py-0.5 rounded bg-surface-card text-tag-convert border border-border-subtle">
              Crop
            </span>
          )}
        </div>
        <input
          type="checkbox"
          checked={page.selected}
          readOnly={isOverlay}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            if (isOverlay) return;
            e.stopPropagation();
            onSelect(page.id, (e.nativeEvent as MouseEvent).shiftKey ?? false);
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-4 h-4 rounded bg-surface-active accent-primary cursor-pointer"
        />
      </div>

      <div className="aspect-[1/1.414] w-full bg-surface-container rounded overflow-hidden relative shadow-inner border border-border-subtle/60">
        {tileUrl ? (
          <img
            src={tileUrl}
            alt={`Page ${page.originalPageNumber}`}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="w-full h-full object-contain bg-surface-container"
          />
        ) : (
          <div
            className="w-full h-full p-3 flex flex-col justify-between transition-transform duration-200"
            style={{
              transform: page.rotationDelta
                ? `rotate(${page.rotationDelta}deg)`
                : undefined,
            }}
          >
            <div className="space-y-1.5">
              <div className="w-12 h-2 rounded bg-tag-organize/50" />
              <p className="font-caption text-[10px] text-text-primary font-medium leading-tight line-clamp-2">
                {page.textPreview[0] ?? `Page ${page.originalPageNumber}`}
              </p>
              <p className="font-caption text-[9px] text-text-muted leading-tight line-clamp-2">
                {page.textPreview[1] ?? page.sourceFileName}
              </p>
            </div>
            <div className="w-full h-12 bg-surface-elevated rounded flex items-center justify-center border border-border-subtle">
              <AppIcon name="description" className="w-5 h-5 text-text-disabled" />
            </div>
            <div className="flex items-center justify-between text-[9px] font-mono-metric text-text-muted">
              <span>src p.{page.originalPageNumber}</span>
              <span>
                {Math.round(page.widthPts)}×{Math.round(page.heightPts)}
              </span>
            </div>
          </div>
        )}

        {page.cropBox && (
          <div className="absolute inset-2 border border-dashed border-tag-convert/80 rounded pointer-events-none" />
        )}
      </div>

      {/* Hover Quick Actions Overlay */}
      {!isOverlay && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-x-2.5 bottom-2.5 py-1.5 px-2 rounded-b bg-bg-sidebar/95 backdrop-blur-sm opacity-0 group-hover:opacity-100 flex items-center justify-around transition-opacity border-t border-border-subtle z-10"
        >
          <button
            type="button"
            onClick={() => onZoomPreview(page.id)}
            title="Zoom Preview"
            className="text-text-muted hover:text-text-primary p-0.5"
          >
            <AppIcon name="zoom_in" className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onRotateRight(page.id)}
            title="Rotate 90° CW"
            className="text-text-muted hover:text-text-primary p-0.5"
          >
            <AppIcon name="rotate_right" className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onDuplicate(page.id)}
            title="Duplicate Page"
            className="text-text-muted hover:text-text-primary p-0.5"
          >
            <AppIcon name="content_copy" className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(page.id)}
            title="Delete Page"
            className="text-text-muted hover:text-error p-0.5"
          >
            <AppIcon name="delete" className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};

export const PageThumbnailCard: React.FC<PageThumbnailCardProps> = (props) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: props.page.id, disabled: Boolean(props.isOverlay) });

  if (props.isOverlay) {
    return <PageThumbnailCardContent {...props} isOverlay />;
  }

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <PageThumbnailCardContent
      {...props}
      cardRef={setNodeRef}
      cardStyle={style}
      isDragging={isDragging}
      isOver={isOver}
      dragAttributes={attributes as unknown as Record<string, unknown>}
      dragListeners={listeners as unknown as Record<string, unknown>}
    />
  );
};
