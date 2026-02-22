"use client";

import { useEffect, useState } from "react";

export interface DisplayCapabilities {
  /** Display supports Display P3 (wide gamut) */
  isP3: boolean;
  /** Display supports Rec.2020 (very wide gamut) */
  isRec2020: boolean;
  /** Display supports HDR (high dynamic range) */
  prefersHDR: boolean;
  /** Recommended canvas color space for best quality */
  targetColorSpace: "srgb" | "display-p3";
}

const DEFAULT_CAPS: DisplayCapabilities = {
  isP3: false,
  isRec2020: false,
  prefersHDR: false,
  targetColorSpace: "srgb",
};

function queryCapabilities(): DisplayCapabilities {
  if (typeof window === "undefined")
    return DEFAULT_CAPS;

  const isP3 = window.matchMedia("(color-gamut: p3)").matches;
  const isRec2020 = window.matchMedia("(color-gamut: rec2020)").matches;
  const prefersHDR = window.matchMedia("(dynamic-range: high)").matches;

  return {
    isP3,
    isRec2020,
    prefersHDR,
    targetColorSpace: isP3 ? "display-p3" : "srgb",
  };
}

/**
 * useDisplayDetect — detects the current display's colour gamut and HDR capability.
 *
 * Updates reactively when the user connects/disconnects an external display
 * (hot-plug support via MediaQueryList `change` events).
 */
export function useDisplayDetect(): DisplayCapabilities {
  const [caps, setCaps] = useState<DisplayCapabilities>(DEFAULT_CAPS);

  useEffect(() => {
    const update = () => setCaps(queryCapabilities());
    update(); // initial read

    const mqs = [
      window.matchMedia("(color-gamut: p3)"),
      window.matchMedia("(color-gamut: rec2020)"),
      window.matchMedia("(dynamic-range: high)"),
    ];

    mqs.forEach((mq) => mq.addEventListener("change", update));
    return () => mqs.forEach((mq) => mq.removeEventListener("change", update));
  }, []);

  return caps;
}
