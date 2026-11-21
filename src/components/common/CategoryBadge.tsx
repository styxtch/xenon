import React from "react";
import type { SuiteCategory } from "../../types/xenon";

interface CategoryBadgeProps {
  category: SuiteCategory;
  label: string;
}

const styleByCategory: Record<SuiteCategory, string> = {
  organize: "text-[#3B82F6] bg-[#3B82F6]/12 border-[#3B82F6]/30",
  optimize: "text-[#F59E0B] bg-[#F59E0B]/12 border-[#F59E0B]/30",
  convert: "text-[#8B5CF6] bg-[#8B5CF6]/12 border-[#8B5CF6]/30",
  security: "text-[#06B6D4] bg-[#06B6D4]/12 border-[#06B6D4]/30",
};

export const CategoryBadge: React.FC<CategoryBadgeProps> = ({ category, label }) => {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full font-label-default text-label-default border ${styleByCategory[category]}`}
    >
      {label}
    </span>
  );
};
