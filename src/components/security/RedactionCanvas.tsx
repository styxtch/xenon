import React, { useRef, useState } from "react";
import { getXenonTileUrl, tauriClient } from "../../lib/tauriClient";
import type { RedactionBox } from "../../types/xenon";

interface RedactionCanvasProps {
  docId?: string;
  inputPdfPath?: string;
  pageCount?: number;
  boxes: RedactionBox[];
  preserveUnredactedText: boolean;
  outputTargetCard?: React.ReactNode;
  onAddBox: (box: RedactionBox) => void;
  onAddBoxes?: (boxes: RedactionBox[]) => void;
  onUpdateBox?: (index: number, nextBox: RedactionBox) => void;
  onRemoveBox: (index: number) => void;
  onClearBoxes?: () => void;
  onTogglePreserveText: (val: boolean) => void;
}

export const RedactionCanvas: React.FC<RedactionCanvasProps> = ({
  docId,
  inputPdfPath,
  pageCount = 1,
  boxes,
  preserveUnredactedText,
  outputTargetCard,
  onAddBox,
  onAddBoxes,
  onUpdateBox,
  onRemoveBox,
  onClearBoxes,
  onTogglePreserveText,
}) => {
  const [fillColor, setFillColor] = useState("#000000");
  const [pageNumber, setPageNumber] = useState(1);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [autoMode, setAutoMode] = useState<"text" | "phone" | "email" | "digits">("text");
  const [autoQuery, setAutoQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchFeedback, setSearchFeedback] = useState<string | null>(null);
  const [dragBox, setDragBox] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const totalPages = Math.max(1, pageCount);
  const safePage = Math.min(pageNumber, totalPages);
  const tileUrl = docId ? getXenonTileUrl(docId, safePage, 720, 0) : null;

  const handleBoxMovePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    idx: number,
    box: RedactionBox
  ) => {
    e.stopPropagation();
    setSelectedIdx(idx);
    const container = canvasRef.current;
    if (!container || !onUpdateBox) return;
    const rect = container.getBoundingClientRect();
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const origX = box.x;
    const origY = box.y;

    const onMove = (mv: PointerEvent) => {
      const dxPts = ((mv.clientX - startClientX) / rect.width) * 595.28;
      const dyPts = ((mv.clientY - startClientY) / rect.height) * 841.89;
      const nextX = Math.max(0, Math.min(595.28 - box.width, Math.round(origX + dxPts)));
      const nextY = Math.max(0, Math.min(841.89 - box.height, Math.round(origY + dyPts)));
      onUpdateBox(idx, { ...box, x: nextX, y: nextY });
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleBoxResizePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    idx: number,
    box: RedactionBox
  ) => {
    e.stopPropagation();
    setSelectedIdx(idx);
    const container = canvasRef.current;
    if (!container || !onUpdateBox) return;
    const rect = container.getBoundingClientRect();
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const origW = box.width;
    const origH = box.height;

    const onMove = (mv: PointerEvent) => {
      const dxPts = ((mv.clientX - startClientX) / rect.width) * 595.28;
      const dyPts = ((mv.clientY - startClientY) / rect.height) * 841.89;
      const nextW = Math.max(14, Math.min(595.28 - box.x, Math.round(origW + dxPts)));
      const nextH = Math.max(12, Math.min(841.89 - box.y, Math.round(origH + dyPts)));
      onUpdateBox(idx, { ...box, width: nextW, height: nextH });
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleAutoRedactSearch = async () => {
    if (!inputPdfPath) {
      setSearchFeedback("Select a PDF file first.");
      return;
    }
    if (autoMode === "text" && !autoQuery.trim()) {
      setSearchFeedback("Enter text or phone number to search.");
      return;
    }
    setIsSearching(true);
    setSearchFeedback(null);
    try {
      const matches = await tauriClient.findTextRedactionBoxes({
        inputPath: inputPdfPath,
        query: autoQuery,
        mode: autoMode,
        caseSensitive,
        fillColorHex: fillColor,
      });
      if (matches.length === 0) {
        setSearchFeedback("No matching text found in PDF.");
      } else {
        if (onAddBoxes) {
          onAddBoxes(matches);
        } else {
          matches.forEach((m) => onAddBox(m));
        }
        const firstPage = matches[0]?.pageNumber ?? safePage;
        setPageNumber(firstPage);
        setSearchFeedback(`Marked ${matches.length} match(es) across PDF.`);
      }
    } catch (err) {
      setSearchFeedback(String((err as { message?: string })?.message ?? err));
    } finally {
      setIsSearching(false);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const container = canvasRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const startX = ((e.clientX - rect.left) / rect.width) * 595.28;
    const startY = ((e.clientY - rect.top) / rect.height) * 841.89;
    let moved = false;

    const onPointerMove = (moveEvt: PointerEvent) => {
      const curX = Math.max(0, Math.min(595.28, ((moveEvt.clientX - rect.left) / rect.width) * 595.28));
      const curY = Math.max(0, Math.min(841.89, ((moveEvt.clientY - rect.top) / rect.height) * 841.89));
      if (Math.abs(curX - startX) > 6 || Math.abs(curY - startY) > 6) {
        moved = true;
      }
      setDragBox({
        x: Math.min(startX, curX),
        y: Math.min(startY, curY),
        width: Math.max(12, Math.abs(curX - startX)),
        height: Math.max(12, Math.abs(curY - startY)),
      });
    };

    const onPointerUp = (upEvt: PointerEvent) => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      setDragBox(null);

      const endX = Math.max(0, Math.min(595.28, ((upEvt.clientX - rect.left) / rect.width) * 595.28));
      const endY = Math.max(0, Math.min(841.89, ((upEvt.clientY - rect.top) / rect.height) * 841.89));

      if (moved && Math.abs(endX - startX) >= 8 && Math.abs(endY - startY) >= 8) {
        onAddBox({
          pageNumber: safePage,
          x: Math.round(Math.min(startX, endX)),
          y: Math.round(Math.min(startY, endY)),
          width: Math.round(Math.abs(endX - startX)),
          height: Math.round(Math.abs(endY - startY)),
          fillColorHex: fillColor,
          label: "REDACTED",
        });
      } else {
        onAddBox({
          pageNumber: safePage,
          x: Math.max(16, Math.round(startX - 90)),
          y: Math.max(16, Math.round(startY - 14)),
          width: 220,
          height: 28,
          fillColorHex: fillColor,
          label: "REDACTED",
        });
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-lg items-start">
      <div className="xl:col-span-8 bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col gap-space-md">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-headline-sm text-headline-sm text-text-primary">
              High-DPI True Redaction Stage (Click or Drag Area)
            </h2>
            <p className="font-caption text-caption text-text-muted">
              Drag to draw custom redaction rectangle or click to place standard box — 300 DPI pixel burn-in
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
              className="px-2 py-1 rounded bg-surface-elevated border border-border-default text-text-secondary hover:text-text-primary disabled:opacity-40 text-xs"
            >
              &lt;
            </button>
            <label className="font-caption text-caption text-text-muted">Page:</label>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={safePage}
              onChange={(e) =>
                setPageNumber(Math.min(totalPages, Math.max(1, Number(e.target.value))))
              }
              className="w-14 h-8 bg-surface-elevated border border-border-default rounded px-2 font-mono-metric text-caption text-text-primary"
            />
            <span className="font-mono-metric text-caption text-text-muted">
              / {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPageNumber((p) => Math.min(totalPages, p + 1))}
              className="px-2 py-1 rounded bg-surface-elevated border border-border-default text-text-secondary hover:text-text-primary disabled:opacity-40 text-xs"
            >
              &gt;
            </button>
          </div>
        </div>

        <div
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          className="w-full max-w-[500px] mx-auto aspect-[1/1.414] bg-surface-container border border-border-default rounded-lg relative overflow-hidden cursor-crosshair select-none shadow-inner"
        >
          {tileUrl ? (
            <img
              src={tileUrl}
              alt={`Page ${safePage} Redaction Preview`}
              draggable={false}
              className="w-full h-full object-contain pointer-events-none select-none bg-white"
            />
          ) : (
            <div className="p-6 space-y-3 opacity-70 pointer-events-none">
              <div className="w-40 h-3 rounded bg-tag-security/50" />
              <div className="w-full h-2 rounded bg-text-disabled/40" />
              <div className="w-5/6 h-2 rounded bg-text-disabled/40" />
              <div className="w-3/4 h-2 rounded bg-text-disabled/30" />
              <div className="h-6" />
              <div className="w-full h-2 rounded bg-text-disabled/40" />
              <div className="w-4/5 h-2 rounded bg-text-disabled/30" />
            </div>
          )}

          {dragBox && (
            <div
              style={{
                left: `${(dragBox.x / 595.28) * 100}%`,
                top: `${(dragBox.y / 841.89) * 100}%`,
                width: `${(dragBox.width / 595.28) * 100}%`,
                height: `${(dragBox.height / 841.89) * 100}%`,
              }}
              className="absolute border-2 border-dashed border-red-400 bg-red-500/20 pointer-events-none"
            />
          )}

          {boxes
            .map((box, idx) => ({ box, idx }))
            .filter(({ box }) => box.pageNumber === safePage)
            .map(({ box, idx }) => {
              const isSelected = selectedIdx === idx;
              return (
                <div
                  key={idx}
                  onPointerDown={(e) => handleBoxMovePointerDown(e, idx, box)}
                  style={{
                    left: `${(box.x / 595.28) * 100}%`,
                    top: `${(box.y / 841.89) * 100}%`,
                    width: `${(box.width / 595.28) * 100}%`,
                    height: `${(box.height / 841.89) * 100}%`,
                    backgroundColor: box.fillColorHex ?? "#000000",
                  }}
                  className={`absolute flex items-center justify-center text-[9px] font-mono-metric text-error cursor-move group ${
                    isSelected
                      ? "border-2 border-primary ring-2 ring-primary/40 z-20"
                      : "border border-error z-10"
                  }`}
                >
                  <span className="pointer-events-none truncate px-1">
                    {box.label ?? "REDACTED"}
                  </span>
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedIdx(null);
                      onRemoveBox(idx);
                    }}
                    title="Remove redaction box"
                    className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-error text-white text-[10px] leading-none hidden group-hover:flex items-center justify-center shadow"
                  >
                    ×
                  </button>
                  <div
                    onPointerDown={(e) => handleBoxResizePointerDown(e, idx, box)}
                    title="Drag to resize"
                    className="absolute -bottom-1 -right-1 w-3 h-3 rounded-sm bg-primary border border-white cursor-nwse-resize opacity-80 hover:opacity-100"
                  />
                </div>
              );
            })}
        </div>
      </div>

      <div className="xl:col-span-4 flex flex-col gap-space-md">
        <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col gap-space-md">
          <div className="flex items-center justify-between">
            <h3 className="font-headline-sm text-headline-sm text-text-primary">
              Redaction Boxes ({boxes.length})
            </h3>
            <div className="flex items-center gap-1.5">
              {boxes.length > 0 && onClearBoxes && (
                <button
                  type="button"
                  onClick={onClearBoxes}
                  className="px-2 py-1 rounded bg-surface-elevated hover:bg-surface-hover border border-border-default font-caption text-caption text-error"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  onAddBox({
                    pageNumber: safePage,
                    x: 40,
                    y: 55,
                    width: 420,
                    height: 30,
                    fillColorHex: fillColor,
                    label: "REDACTED",
                  })
                }
                className="px-2.5 py-1 rounded bg-surface-elevated hover:bg-surface-hover border border-border-default font-caption text-caption text-primary"
              >
                + Add Header Box
              </button>
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-surface-elevated border border-border-subtle space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-caption text-caption text-text-primary font-semibold">
                Auto-Redact Across All Pages
              </span>
              <span className="font-mono-metric text-[10px] text-text-muted">
                All Pages
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {(
                [
                  { id: "text", label: "Text" },
                  { id: "phone", label: "Phone" },
                  { id: "email", label: "Email" },
                  { id: "digits", label: "ID/NIK" },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setAutoMode(m.id)}
                  className={`py-1 rounded text-[11px] font-medium border transition-colors ${
                    autoMode === m.id
                      ? "bg-primary/20 border-primary/50 text-primary"
                      : "bg-surface-card border-border-subtle text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {autoMode === "text" && (
              <div className="space-y-1.5">
                <input
                  type="text"
                  value={autoQuery}
                  onChange={(e) => setAutoQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleAutoRedactSearch();
                    }
                  }}
                  placeholder="e.g. 0812-3456-7890 or Confidential"
                  className="w-full h-8 bg-surface-card border border-border-default rounded px-2.5 font-body-sm text-body-sm text-text-primary"
                />
                <label className="flex items-center gap-2 font-caption text-caption text-text-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={caseSensitive}
                    onChange={(e) => setCaseSensitive(e.target.checked)}
                    className="w-3.5 h-3.5 accent-primary"
                  />
                  <span>Case-sensitive match</span>
                </label>
              </div>
            )}
            <button
              type="button"
              onClick={() => void handleAutoRedactSearch()}
              disabled={isSearching || !inputPdfPath}
              className="w-full py-1.5 rounded-lg bg-surface-card hover:bg-surface-hover disabled:opacity-50 border border-border-default text-primary font-body-sm text-body-sm font-medium transition-colors"
            >
              {isSearching ? "Scanning all pages..." : "Find & Mark All Pages"}
            </button>
            {searchFeedback && (
              <p className="font-caption text-[11px] text-text-secondary">
                {searchFeedback}
              </p>
            )}
          </div>

        <div className="flex items-center justify-between">
          <span className="font-caption text-caption text-text-secondary">
            Burn-in Fill Color
          </span>
          <div className="flex items-center gap-1.5">
            {["#000000", "#1F1F21", "#93000A"].map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => setFillColor(hex)}
                className={`w-6 h-6 rounded-full border ${
                  fillColor === hex ? "ring-2 ring-white border-white" : "border-border-default"
                }`}
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between p-2.5 rounded-lg bg-surface-elevated border border-border-subtle cursor-pointer">
          <span className="font-body-sm text-body-sm text-text-primary">
            Preserve unredacted text (3 Tr)
          </span>
          <input
            type="checkbox"
            checked={preserveUnredactedText}
            onChange={(e) => onTogglePreserveText(e.target.checked)}
            className="w-4 h-4 accent-primary"
          />
        </label>

        <div className="max-h-48 overflow-y-auto space-y-1.5">
          {boxes.map((b, idx) => (
            <div
              key={idx}
              className="p-2 rounded bg-surface-elevated border border-border-subtle flex items-center justify-between font-mono-metric text-[11px]"
            >
              <span className="text-text-secondary">
                p.{b.pageNumber} [{Math.round(b.x)}, {Math.round(b.y)}, {Math.round(b.width)}×{Math.round(b.height)}]
              </span>
              <button
                type="button"
                onClick={() => onRemoveBox(idx)}
                className="text-error hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        </div>

        {outputTargetCard}
      </div>
    </div>
  );
};
