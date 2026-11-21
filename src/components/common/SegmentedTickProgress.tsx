import React from "react";
import type { SuiteCategory } from "../../types/xenon";

interface SegmentedTickProgressProps {
  completedTicks: number; // 0..10
  percentage: number; // 0..100
  status: "queued" | "processing" | "paused" | "completed" | "failed";
  category?: SuiteCategory;
}

const activeColorMap: Record<SuiteCategory, string> = {
  organize: "bg-tag-organize",
  optimize: "bg-tag-optimize",
  convert: "bg-tag-convert",
  security: "bg-tag-security",
};

const activeTextMap: Record<SuiteCategory, string> = {
  organize: "text-tag-organize",
  optimize: "text-tag-optimize",
  convert: "text-tag-convert",
  security: "text-tag-security",
};

export const SegmentedTickProgress: React.FC<SegmentedTickProgressProps> = ({
  completedTicks,
  percentage,
  status,
  category = "organize",
}) => {
  const filledColor =
    status === "completed"
      ? category === "security"
        ? "bg-tag-security"
        : "bg-status-success"
      : status === "failed"
        ? "bg-status-danger"
        : activeColorMap[category];

  const textColor =
    status === "completed"
      ? category === "security"
        ? "text-tag-security"
        : "text-status-success"
      : status === "failed"
        ? "text-status-danger"
        : activeTextMap[category];

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5" aria-label={`Progress ${percentage}%`}>
        {Array.from({ length: 10 }, (_, idx) => {
          const isFilled = idx < completedTicks;
          return (
            <div
              key={idx}
              className={`w-1 h-3 rounded-sm transition-colors ${
                isFilled ? filledColor : "bg-surface-active"
              }`}
            />
          );
        })}
      </div>
      <span className={`font-mono-metric text-mono-metric font-medium ${textColor}`}>
        {status === "failed" ? "Err" : `${percentage}%`}
      </span>
    </div>
  );
};
