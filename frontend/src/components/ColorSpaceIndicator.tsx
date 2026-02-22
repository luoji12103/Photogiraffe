"use client";

import { Monitor } from "lucide-react";
import type { DisplayCapabilities } from "../lib/display-detect";

interface ColorSpaceIndicatorProps {
  caps: DisplayCapabilities;
  /** Override label — if not set, derived from caps */
  label?: string;
  className?: string;
}

/**
 * ColorSpaceIndicator — a small badge showing the active rendering colour space.
 * Positioned absolutely (call sites wrap it in a relative container).
 */
export default function ColorSpaceIndicator({
  caps,
  label,
  className = "",
}: ColorSpaceIndicatorProps) {
  const displayLabel = label ?? (caps.targetColorSpace === "display-p3" ? "Display P3" : "sRGB");
  const isWideGamut = caps.isP3 || caps.isRec2020;

  const colorClass = isWideGamut
    ? "bg-purple-500/20 text-purple-300 border-purple-500/30"
    : "bg-blue-500/20 text-blue-300 border-blue-500/30";

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium backdrop-blur-sm ${colorClass} ${className}`}
      title={`Rendering colour space: ${displayLabel}${caps.prefersHDR ? " · HDR display" : ""}`}
    >
      <Monitor className="w-3 h-3" />
      <span>{displayLabel}</span>
      {caps.prefersHDR && (
        <span className="text-amber-400 text-[10px] font-semibold leading-none">HDR</span>
      )}
    </div>
  );
}
