import React from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../../lib/tauriClient";
import { AppIcon } from "../common/AppIcon";

const COLOR_SWATCHES = ["#4EDEA3", "#06B6D4", "#EF4444", "#F59E0B", "#F5F5F5"];

interface WatermarkInspectorProps {
  kind: "text" | "image";
  text: string;
  imagePath: string;
  fontSizePts: number;
  colorHex: string;
  opacity: number;
  rotationDeg: number;
  layer: "foreground" | "background";
  targetPages: string;
  flattenAll: boolean;
  onChangeKind: (k: "text" | "image") => void;
  onChangeText: (t: string) => void;
  onChangeImagePath: (p: string) => void;
  onChangeFontSize: (s: number) => void;
  onChangeColor: (hex: string) => void;
  onChangeOpacity: (op: number) => void;
  onChangeRotation: (deg: number) => void;
  onChangeLayer: (l: "foreground" | "background") => void;
  onChangeTargetPages: (pages: string) => void;
  onToggleFlatten: (v: boolean) => void;
}

export const WatermarkInspector: React.FC<WatermarkInspectorProps> = ({
  kind,
  text,
  imagePath,
  fontSizePts,
  colorHex,
  opacity,
  rotationDeg,
  layer,
  targetPages,
  flattenAll,
  onChangeKind,
  onChangeText,
  onChangeImagePath,
  onChangeFontSize,
  onChangeColor,
  onChangeOpacity,
  onChangeRotation,
  onChangeLayer,
  onChangeTargetPages,
  onToggleFlatten,
}) => {
  const handlePickImage = async () => {
    if (!isTauriRuntime()) return;
    const picked = await open({
      multiple: false,
      filters: [{ name: "Watermark Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (typeof picked === "string") {
      onChangeImagePath(picked);
    }
  };
  return (
    <div className="bg-surface-card border border-border-default rounded-xl p-space-md flex flex-col gap-space-md">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AppIcon name="layers_clear" className="w-5 h-5 text-tag-security" />
          <h2 className="font-headline-sm text-headline-sm text-text-primary">
            Watermark &amp; Flatten
          </h2>
        </div>
        <div className="inline-flex p-0.5 rounded bg-surface-elevated border border-border-subtle">
          {(["text", "image"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onChangeKind(k)}
              className={`px-2 py-0.5 rounded text-caption capitalize ${
                kind === k ? "bg-surface-active text-primary" : "text-text-muted"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {kind === "text" ? (
        <div>
          <label className="block font-caption text-caption text-text-muted mb-1">
            Watermark Text
          </label>
          <input
            type="text"
            value={text}
            onChange={(e) => onChangeText(e.target.value)}
            className="w-full h-9 bg-surface-elevated border border-border-default rounded-lg px-3 font-body-sm text-body-sm text-text-primary focus:outline-none focus:border-primary-container"
          />
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-caption">
            <span className="text-text-muted">Watermark Image (PNG / JPG)</span>
            {imagePath && (
              <button
                type="button"
                onClick={() => onChangeImagePath("")}
                className="text-error hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => void handlePickImage()}
            className="w-full py-2 px-3 rounded-lg bg-surface-elevated hover:bg-surface-hover border border-border-default font-body-sm text-body-sm text-text-primary flex items-center justify-center gap-2"
          >
            <AppIcon name="upload_file" className="w-4 h-4 text-primary" />
            <span className="truncate">
              {imagePath
                ? imagePath.split(/[\\/]/).pop()
                : "Select Watermark Image (PNG / JPG)"}
            </span>
          </button>
        </div>
      )}

      {kind === "text" && (
        <div>
          <div className="flex justify-between font-caption text-caption mb-1">
            <span className="text-text-secondary">Font Size</span>
            <span className="font-mono-metric text-primary">{fontSizePts} pt</span>
          </div>
          <input
            type="range"
            min={18}
            max={96}
            value={fontSizePts}
            onChange={(e) => onChangeFontSize(Number(e.target.value))}
            className="w-full accent-tag-security"
          />
        </div>
      )}

      <div>
        <div className="flex justify-between font-caption text-caption mb-1">
          <span className="text-text-secondary">Opacity</span>
          <span className="font-mono-metric text-primary">
            {Math.round(opacity * 100)}%
          </span>
        </div>
        <input
          type="range"
          min={5}
          max={100}
          value={Math.round(opacity * 100)}
          onChange={(e) => onChangeOpacity(Number(e.target.value) / 100)}
          className="w-full accent-tag-security"
        />
      </div>

      <div>
        <div className="flex justify-between font-caption text-caption mb-1">
          <span className="text-text-secondary">Rotation Angle</span>
          <span className="font-mono-metric text-primary">{rotationDeg}°</span>
        </div>
        <input
          type="range"
          min={-90}
          max={90}
          value={rotationDeg}
          onChange={(e) => onChangeRotation(Number(e.target.value))}
          className="w-full accent-tag-security"
        />
      </div>

      {kind === "text" && (
        <div className="flex items-center justify-between">
          <span className="font-caption text-caption text-text-secondary">Color</span>
          <div className="flex items-center gap-1.5">
            {COLOR_SWATCHES.map((hex) => (
              <button
                key={hex}
                type="button"
                onClick={() => onChangeColor(hex)}
                aria-label={`Select color ${hex}`}
                className={`w-6 h-6 rounded-full border ${
                  colorHex === hex ? "ring-2 ring-white border-white" : "border-border-default"
                }`}
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {(["foreground", "background"] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => onChangeLayer(l)}
            className={`py-1.5 rounded-lg border font-body-sm text-body-sm capitalize ${
              layer === l
                ? "bg-surface-active border-tag-security text-text-primary font-medium"
                : "bg-surface-elevated border-border-subtle text-text-secondary"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      <div>
        <label className="block font-caption text-caption text-text-muted mb-1">
          Target Pages (e.g. all, 1-3, 5)
        </label>
        <input
          type="text"
          value={targetPages}
          onChange={(e) => onChangeTargetPages(e.target.value)}
          placeholder="all"
          className="w-full h-9 bg-surface-elevated border border-border-default rounded-lg px-3 font-mono-metric text-body-sm text-text-primary focus:outline-none focus:border-primary-container"
        />
      </div>

      <label className="flex items-center justify-between cursor-pointer p-2.5 rounded-lg bg-surface-elevated border border-border-subtle">
        <span className="font-body-sm text-body-sm text-text-primary">
          Flatten all annotations
        </span>
        <input
          type="checkbox"
          checked={flattenAll}
          onChange={(e) => onToggleFlatten(e.target.checked)}
          className="w-4 h-4 accent-primary"
        />
      </label>
    </div>
  );
};
