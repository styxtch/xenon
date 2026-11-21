import React from "react";
import { formatBytes } from "../../lib/tauriClient";
import type { SizeEstimateResult } from "../../types/xenon";
import { AppIcon } from "../common/AppIcon";

export type CompressProfile = "screen" | "ebook" | "printer" | "prepress" | "custom";

interface CompressInspectorProps {
  profile: CompressProfile;
  customDpi: number;
  customJpegQuality: number;
  linearizeFastWeb: boolean;
  sanitizeMetadata: boolean;
  onChangeProfile: (p: CompressProfile) => void;
  onChangeCustomDpi: (dpi: number) => void;
  onChangeCustomQuality: (q: number) => void;
  onToggleLinearize: (v: boolean) => void;
  onToggleSanitize: (v: boolean) => void;
}

const PROFILES: { id: CompressProfile; title: string; subtitle: string }[] = [
  { id: "screen", title: "Screen (72 DPI)", subtitle: "Maximum reduction for email/web" },
  { id: "ebook", title: "Ebook (150 DPI)", subtitle: "Optimal clarity & 50–75% savings" },
  { id: "printer", title: "Printer (300 DPI)", subtitle: "Crisp office print output" },
  { id: "prepress", title: "Prepress (300 DPI)", subtitle: "Color preserve commercial standard" },
  { id: "custom", title: "Custom DPI", subtitle: "Manual DPI & JPEG quality sliders" },
];

export const CompressInspector: React.FC<CompressInspectorProps> = ({
  profile,
  customDpi,
  customJpegQuality,
  linearizeFastWeb,
  sanitizeMetadata,
  onChangeProfile,
  onChangeCustomDpi,
  onChangeCustomQuality,
  onToggleLinearize,
  onToggleSanitize,
}) => {
  return (
    <div className="bg-surface-card border border-border-default rounded-xl p-space-md shadow-sm flex flex-col gap-space-md">
      <div className="flex items-center gap-2">
        <AppIcon name="compress" className="w-5 h-5 text-tag-optimize" />
        <h2 className="font-headline-sm text-headline-sm text-text-primary">
          Ghostscript Compression Profile
        </h2>
      </div>

      <div className="space-y-2">
        {PROFILES.map((item) => {
          const active = profile === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChangeProfile(item.id)}
              className={`w-full p-2.5 rounded-lg border text-left transition-colors flex items-center justify-between ${
                active
                  ? "bg-surface-active border-tag-optimize text-text-primary"
                  : "bg-surface-elevated border-border-subtle text-text-secondary hover:text-text-primary hover:bg-surface-hover"
              }`}
            >
              <div>
                <div className="font-body-sm text-body-sm font-medium">{item.title}</div>
                <div className="font-caption text-caption text-text-muted">{item.subtitle}</div>
              </div>
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  active ? "bg-tag-optimize" : "bg-surface-card border border-border-default"
                }`}
              />
            </button>
          );
        })}
      </div>

      {profile === "custom" && (
        <div className="space-y-3 pt-2 border-t border-border-subtle">
          <div>
            <div className="flex justify-between font-caption text-caption mb-1">
              <span className="text-text-secondary">Target Image DPI</span>
              <span className="font-mono-metric text-primary">{customDpi} DPI</span>
            </div>
            <input
              type="range"
              min={72}
              max={600}
              step={12}
              value={customDpi}
              onChange={(e) => onChangeCustomDpi(Number(e.target.value))}
              className="w-full accent-tag-optimize"
            />
          </div>
          <div>
            <div className="flex justify-between font-caption text-caption mb-1">
              <span className="text-text-secondary">JPEG Quality</span>
              <span className="font-mono-metric text-primary">{customJpegQuality}%</span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              value={customJpegQuality}
              onChange={(e) => onChangeCustomQuality(Number(e.target.value))}
              className="w-full accent-tag-optimize"
            />
          </div>
        </div>
      )}

      <div className="space-y-2 pt-2 border-t border-border-subtle">
        <label className="flex items-center justify-between cursor-pointer p-2 rounded-lg bg-surface-elevated border border-border-subtle">
          <span className="font-body-sm text-body-sm text-text-primary">
            Linearize (Fast Web View)
          </span>
          <input
            type="checkbox"
            checked={linearizeFastWeb}
            onChange={(e) => onToggleLinearize(e.target.checked)}
            className="w-4 h-4 accent-primary"
          />
        </label>
        <label className="flex items-center justify-between cursor-pointer p-2 rounded-lg bg-surface-elevated border border-border-subtle">
          <span className="font-body-sm text-body-sm text-text-primary">
            Sanitize hidden XMP metadata
          </span>
          <input
            type="checkbox"
            checked={sanitizeMetadata}
            onChange={(e) => onToggleSanitize(e.target.checked)}
            className="w-4 h-4 accent-primary"
          />
        </label>
      </div>
    </div>
  );
};

interface CompressEstimateSummaryProps {
  estimate: SizeEstimateResult | null;
}

export const CompressEstimateSummary: React.FC<CompressEstimateSummaryProps> = ({
  estimate,
}) => {
  if (!estimate) return null;

  return (
    <div className="p-3 bg-surface-container border border-border-subtle rounded-lg space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AppIcon name="speed" className="w-[18px] h-[18px] text-tag-optimize" />
          <span className="font-body-sm text-body-sm text-text-primary font-medium">
            Estimated Size
          </span>
        </div>
        <span className="font-mono-metric text-caption px-2 py-0.5 rounded bg-status-success/10 text-status-success border border-status-success/30">
          -{estimate.estimatedReductionPercent}% projected
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 font-mono-metric text-caption">
        <div className="p-2 rounded bg-surface-elevated border border-border-subtle">
          <div className="text-text-muted">Original</div>
          <div className="text-text-primary font-semibold mt-0.5">
            {formatBytes(estimate.originalBytes)}
          </div>
        </div>
        <div className="p-2 rounded bg-surface-elevated border border-border-subtle">
          <div className="text-text-muted">Estimated Output</div>
          <div className="text-primary font-semibold mt-0.5">
            ~{formatBytes(estimate.estimatedBytes)}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between font-mono-metric text-caption pt-1 border-t border-border-subtle/60">
        <span className="text-text-muted">Detected /Image Streams</span>
        <span className="text-text-secondary">
          {formatBytes(estimate.imageStreamBytes)}
        </span>
      </div>
    </div>
  );
};
