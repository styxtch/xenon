import React, { useEffect, useRef, useState } from "react";
import { runWithMinimumProgress } from "../../lib/progressTiming";
import { getXenonTileUrl, tauriClient } from "../../lib/tauriClient";
import { useProcessModalStore } from "../../stores/processModalStore";
import { useSettingsStore } from "../../stores/settingsStore";
import type { FormFieldSpec } from "../../types/xenon";
import { AppIcon } from "../common/AppIcon";
import {
  OutputTargetCard,
  resolveOutputPath,
} from "../common/OutputTargetCard";

interface FormEditorCanvasProps {
  docId?: string;
  pageCount?: number;
  inputPath: string;
  outputDir: string;
  outputFilename: string;
  onChangeOutputFilename: (name: string) => void;
  onSaved: (message: string) => void;
}

export const FormEditorCanvas: React.FC<FormEditorCanvasProps> = ({
  docId,
  pageCount = 1,
  inputPath,
  outputDir,
  outputFilename,
  onChangeOutputFilename,
  onSaved,
}) => {
  const defaultFlatten = useSettingsStore((s) => s.settings.autoFlattenOnSave);
  const [fields, setFields] = useState<FormFieldSpec[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePage, setActivePage] = useState(1);
  const [flattenOnSave, setFlattenOnSave] = useState(defaultFlatten);
  const [isSaving, setIsSaving] = useState(false);
  const [savingPercent, setSavingPercent] = useState(0);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const totalPages = Math.max(1, pageCount);
  const tileUrl = docId ? getXenonTileUrl(docId, activePage, 720, 0) : null;

  useEffect(() => {
    setActivePage(1);
  }, [inputPath]);

  useEffect(() => {
    if (!inputPath) {
      setFields([]);
      setSelectedId(null);
      return;
    }
    let cancelled = false;
    void tauriClient
      .getFormFields(inputPath)
      .then((loaded) => {
        if (cancelled) return;
        setFields(loaded);
        setSelectedId(loaded.length > 0 ? loaded[0].id : null);
      })
      .catch(() => {
        if (!cancelled) {
          setFields([]);
          setSelectedId(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [inputPath]);

  const addWidget = (fieldType: FormFieldSpec["fieldType"]) => {
    const pageFields = fields.filter((f) => f.pageNumber === activePage);
    const idx = pageFields.length + 1;
    const newField: FormFieldSpec = {
      id: `widget-new-${Date.now()}`,
      name: `${fieldType}_${fields.length + 1}`,
      fieldType,
      pageNumber: activePage,
      rect: [
        72,
        Math.max(120, 680 - idx * 42),
        fieldType === "checkbox" || fieldType === "radio" ? 22 : 200,
        fieldType === "checkbox" || fieldType === "radio" ? 22 : 26,
      ],
      value: fieldType === "checkbox" || fieldType === "radio" ? false : `Sample ${fieldType}`,
      options: fieldType === "dropdown" ? ["Option A", "Option B", "Option C"] : undefined,
      required: false,
      readOnly: false,
    };
    setFields((prev) => [...prev, newField]);
    setSelectedId(newField.id);
  };

  const handleWidgetPointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    field: FormFieldSpec
  ) => {
    e.stopPropagation();
    setSelectedId(field.id);
    const container = canvasRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const [origX, origY, w, h] = field.rect;

    const onPointerMove = (moveEvt: PointerEvent) => {
      const dxPts = ((moveEvt.clientX - startClientX) / rect.width) * 595.28;
      const dyPts = ((moveEvt.clientY - startClientY) / rect.height) * 841.89;
      const nextX = Math.round(Math.max(8, Math.min(595.28 - w - 8, origX + dxPts)));
      const nextY = Math.round(Math.max(8, Math.min(841.89 - h - 8, origY - dyPts)));
      setFields((prev) =>
        prev.map((f) =>
          f.id === field.id ? { ...f, rect: [nextX, nextY, w, h] } : f
        )
      );
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  const selectedField = fields.find((f) => f.id === selectedId) ?? null;

  const updateSelected = (patch: Partial<FormFieldSpec>) => {
    if (!selectedField) return;
    setFields((prev) =>
      prev.map((f) => (f.id === selectedField.id ? { ...f, ...patch } : f))
    );
  };

  const handleSave = async () => {
    const outPath = resolveOutputPath(
      outputDir || "Exports",
      outputFilename,
      "AcroForm_Edited.pdf"
    );
    const modalStore = useProcessModalStore.getState();
    const resolved = await modalStore.confirmOrCopyPaths(
      [outPath],
      flattenOnSave ? "Flatten & Save Form" : "Save AcroForm PDF"
    );
    if (!resolved) return;
    const finalOutPath = resolved[0];

    setIsSaving(true);
    setSavingPercent(8);
    try {
      const res = await runWithMinimumProgress(
        () =>
          tauriClient.saveFormFields(
            inputPath,
            finalOutPath,
            fields,
            flattenOnSave
          ),
        setSavingPercent
      );
      onSaved(`${res.summary} -> ${res.outputPath}`);
      modalStore.showCompletion({
        title: flattenOnSave ? "Flattened Form Saved" : "AcroForm Saved",
        summary: res.summary,
        outputPaths: [res.outputPath],
        originalBytes: res.originalBytes,
        outputBytes: res.outputBytes,
        durationMs: res.durationMs,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-lg items-start">
      <div className="xl:col-span-8 bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col gap-space-md">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {(
              [
                { type: "text", label: "+ Text Field" },
                { type: "checkbox", label: "+ Checkbox" },
                { type: "radio", label: "+ Radio" },
                { type: "dropdown", label: "+ Dropdown" },
              ] as const
            ).map((btn) => (
              <button
                key={btn.type}
                type="button"
                onClick={() => addWidget(btn.type)}
                className="px-3 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default font-body-sm text-body-sm text-text-primary"
              >
                {btn.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={activePage <= 1}
                  onClick={() => setActivePage((p) => Math.max(1, p - 1))}
                  className="px-2 py-0.5 rounded bg-surface-elevated border border-border-default text-text-secondary hover:text-text-primary disabled:opacity-40 text-xs"
                >
                  &lt;
                </button>
                <span className="font-mono-metric text-caption text-text-secondary px-1">
                  Page {activePage} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={activePage >= totalPages}
                  onClick={() => setActivePage((p) => Math.min(totalPages, p + 1))}
                  className="px-2 py-0.5 rounded bg-surface-elevated border border-border-default text-text-secondary hover:text-text-primary disabled:opacity-40 text-xs"
                >
                  &gt;
                </button>
              </div>
            )}
            <span className="font-mono-metric text-caption text-tag-convert">
              {fields.length} Widget(s)
            </span>
          </div>
        </div>

        {/* Visual Form Placement Canvas (A4 proportion) */}
        <div
          ref={canvasRef}
          className="w-full max-w-[540px] mx-auto aspect-[1/1.414] bg-surface-container border border-border-default rounded-lg relative overflow-hidden shadow-inner select-none"
        >
          {tileUrl ? (
            <img
              src={tileUrl}
              alt={`Page ${activePage} AcroForm Preview`}
              draggable={false}
              className="w-full h-full object-contain pointer-events-none select-none bg-white"
            />
          ) : (
            <div className="p-4 font-caption text-caption text-text-muted mb-2">
              Page {activePage} Interactive AcroForm Overlay (595 × 842 pts)
            </div>
          )}
          {fields
            .filter((field) => field.pageNumber === activePage)
            .map((field) => {
            const [x, y, w, h] = field.rect;
            const leftPct = Math.min(92, Math.max(1, (x / 595.28) * 100));
            const topPct = Math.min(92, Math.max(1, ((841.89 - y - h) / 841.89) * 100));
            const widthPct = Math.min(90, Math.max(3.5, (w / 595.28) * 100));
            const heightPct = Math.min(20, Math.max(3.2, (h / 841.89) * 100));
            const isSel = field.id === selectedId;
            return (
              <button
                key={field.id}
                type="button"
                onPointerDown={(e) => handleWidgetPointerDown(e, field)}
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  width: `${widthPct}%`,
                  height: `${heightPct}%`,
                }}
                title="Drag to reposition widget"
                className={`absolute rounded px-1.5 flex items-center text-left font-mono-metric text-[10px] truncate cursor-grab active:cursor-grabbing ${isSel
                    ? "bg-primary/25 border-2 border-primary text-text-primary shadow-md"
                    : "bg-tag-convert/20 border border-tag-convert/60 text-text-secondary"
                  }`}
              >
                {field.fieldType === "checkbox" || field.fieldType === "radio"
                  ? field.value
                    ? "☑"
                    : "☐"
                  : String(field.value || field.name)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="xl:col-span-4 flex flex-col gap-space-md">
        <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col gap-space-md">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AppIcon name="edit" className="w-5 h-5 text-tag-convert" />
              <h2 className="font-headline-sm text-headline-sm text-text-primary">
                Widget Properties
              </h2>
            </div>
            {selectedField && (
              <button
                type="button"
                onClick={() => {
                  setFields((prev) => prev.filter((f) => f.id !== selectedField.id));
                  setSelectedId(null);
                }}
                title="Delete selected widget"
                className="px-2 py-1 rounded bg-error-container/40 hover:bg-error-container/70 text-error font-caption text-caption flex items-center gap-1 transition-colors"
              >
                <AppIcon name="delete" className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            )}
          </div>

          {selectedField ? (
            <div className="space-y-3">
              <div>
                <label className="block font-caption text-caption text-text-muted mb-1">
                  Field Name (/T)
                </label>
                <input
                  type="text"
                  value={selectedField.name}
                  onChange={(e) => updateSelected({ name: e.target.value })}
                  className="w-full h-8 bg-surface-elevated border border-border-default rounded-lg px-2.5 font-mono-metric text-caption text-text-primary"
                />
              </div>

              <div>
                <label className="block font-caption text-caption text-text-muted mb-1">
                  Value (/V)
                </label>
                {typeof selectedField.value === "boolean" ? (
                  <label className="flex items-center gap-2 p-2 rounded bg-surface-elevated border border-border-subtle">
                    <input
                      type="checkbox"
                      checked={selectedField.value}
                      onChange={(e) => updateSelected({ value: e.target.checked })}
                      className="w-4 h-4 accent-primary"
                    />
                    <span className="font-body-sm text-body-sm text-text-primary">
                      Checked
                    </span>
                  </label>
                ) : (
                  <input
                    type="text"
                    value={String(selectedField.value)}
                    onChange={(e) => updateSelected({ value: e.target.value })}
                    className="w-full h-8 bg-surface-elevated border border-border-default rounded-lg px-2.5 font-body-sm text-body-sm text-text-primary"
                  />
                )}
              </div>

              {selectedField.fieldType === "dropdown" && (
                <div>
                  <label className="block font-caption text-caption text-text-muted mb-1">
                    Dropdown Options (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={(selectedField.options ?? []).join(", ")}
                    onChange={(e) =>
                      updateSelected({
                        options: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder="Option A, Option B, Option C"
                    className="w-full h-8 bg-surface-elevated border border-border-default rounded-lg px-2.5 font-body-sm text-body-sm text-text-primary"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-caption text-caption text-text-muted mb-1">
                    X (pts)
                  </label>
                  <input
                    type="number"
                    value={selectedField.rect[0]}
                    onChange={(e) =>
                      updateSelected({
                        rect: [
                          Number(e.target.value),
                          selectedField.rect[1],
                          selectedField.rect[2],
                          selectedField.rect[3],
                        ],
                      })
                    }
                    className="w-full h-8 bg-surface-elevated border border-border-default rounded-lg px-2 font-mono-metric text-caption text-text-primary"
                  />
                </div>
                <div>
                  <label className="block font-caption text-caption text-text-muted mb-1">
                    Y (pts)
                  </label>
                  <input
                    type="number"
                    value={selectedField.rect[1]}
                    onChange={(e) =>
                      updateSelected({
                        rect: [
                          selectedField.rect[0],
                          Number(e.target.value),
                          selectedField.rect[2],
                          selectedField.rect[3],
                        ],
                      })
                    }
                    className="w-full h-8 bg-surface-elevated border border-border-default rounded-lg px-2 font-mono-metric text-caption text-text-primary"
                  />
                </div>
              </div>
            </div>
          ) : (
            <p className="font-caption text-caption text-text-muted">
              Add or click a form widget on the canvas to edit its properties.
            </p>
          )}

          <label className="flex items-center justify-between p-2.5 rounded-lg bg-surface-elevated border border-border-subtle cursor-pointer">
            <span className="font-body-sm text-body-sm text-text-primary">
              Flatten fields upon saving
            </span>
            <input
              type="checkbox"
              checked={flattenOnSave}
              onChange={(e) => setFlattenOnSave(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
          </label>
        </div>

        <OutputTargetCard
          outputFilename={outputFilename}
          onChangeOutputFilename={onChangeOutputFilename}
          disabled={!inputPath}
          isProcessing={isSaving}
          processingPercent={savingPercent}
          processingLabel={
            flattenOnSave ? "Flattening form fields..." : "Saving AcroForm PDF..."
          }
        >
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || !inputPath || fields.length === 0}
            className="w-full py-3 rounded-lg bg-primary-container hover:bg-primary-fixed disabled:opacity-50 text-on-primary-container font-headline-sm text-headline-sm font-semibold flex items-center justify-center gap-2 shadow-md transition-all"
          >
            <AppIcon
              name={isSaving ? "refresh" : "save"}
              className={`w-5 h-5 ${isSaving ? "animate-spin" : ""}`}
            />
            <span>{isSaving ? "Saving AcroForm..." : "Save AcroForm PDF"}</span>
          </button>
        </OutputTargetCard>
      </div>
    </div>
  );
};
