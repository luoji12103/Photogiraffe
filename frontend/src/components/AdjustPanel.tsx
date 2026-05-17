"use client";

import { useCallback } from "react";
import { AdjustParams, DEFAULT_ADJUST } from "../lib/gl-renderer";
import { RotateCcw, Sun, Sliders, Palette, Sparkles } from "lucide-react";

interface AdjustPanelProps {
  params: AdjustParams;
  onChange: (params: AdjustParams) => void;
}

/** Keys of AdjustParams that are numeric (used in sliders; excludes boolean fields) */
type NumericAdjustKey = "exposure" | "brightness" | "contrast" | "saturation";

interface SliderDef {
  key: NumericAdjustKey;
  label: string;
  icon: React.ReactNode;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  format: (v: number) => string;
}

const SLIDERS: SliderDef[] = [
  {
    key: "exposure",
    label: "Exposure",
    icon: <Sun className="w-3.5 h-3.5" />,
    min: -3,
    max: 3,
    step: 0.05,
    defaultValue: 0,
    format: (v) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2)),
  },
  {
    key: "brightness",
    label: "Brightness",
    icon: <Sparkles className="w-3.5 h-3.5" />,
    min: -1,
    max: 1,
    step: 0.02,
    defaultValue: 0,
    format: (v) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2)),
  },
  {
    key: "contrast",
    label: "Contrast",
    icon: <Sliders className="w-3.5 h-3.5" />,
    min: -1,
    max: 1,
    step: 0.02,
    defaultValue: 0,
    format: (v) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2)),
  },
  {
    key: "saturation",
    label: "Saturation",
    icon: <Palette className="w-3.5 h-3.5" />,
    min: 0,
    max: 2,
    step: 0.02,
    defaultValue: 1,
    format: (v) => v.toFixed(2),
  },
];

export default function AdjustPanel({ params, onChange }: AdjustPanelProps) {
  const isDefault =
    params.exposure === DEFAULT_ADJUST.exposure &&
    params.brightness === DEFAULT_ADJUST.brightness &&
    params.contrast === DEFAULT_ADJUST.contrast &&
    params.saturation === DEFAULT_ADJUST.saturation &&
    params.tonemap === DEFAULT_ADJUST.tonemap;

  const resetAll = useCallback(() => onChange({ ...DEFAULT_ADJUST }), [onChange]);

  const resetOne = useCallback(
    (key: NumericAdjustKey) => {
      onChange({ ...params, [key]: DEFAULT_ADJUST[key] });
    },
    [params, onChange]
  );

  const handleChange = useCallback(
    (key: NumericAdjustKey, value: number) => {
      onChange({ ...params, [key]: value });
    },
    [params, onChange]
  );

  const toggleTonemap = useCallback(() => {
    onChange({ ...params, tonemap: !params.tonemap });
  }, [params, onChange]);

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
          Adjustments
        </h3>
        {!isDefault && (
          <button
            onClick={resetAll}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Reset all"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        )}
      </div>

      {/* Sliders */}
      <div className="space-y-2.5">
        {SLIDERS.map(({ key, label, icon, min, max, step, defaultValue, format }) => {
          const val = params[key];
          const isChanged = val !== defaultValue;
          return (
            <div key={key} className="space-y-1">
              <div className="flex items-center justify-between">
                <div className={`flex items-center gap-1.5 text-xs ${isChanged ? "text-zinc-200" : "text-zinc-500"}`}>
                  <span className={isChanged ? "text-blue-400" : "text-zinc-600"}>{icon}</span>
                  {label}
                </div>
                <div className="flex items-center gap-1">
                  <span className={`text-xs tabular-nums ${isChanged ? "text-blue-400" : "text-zinc-600"}`}>
                    {format(val)}
                  </span>
                  {isChanged && (
                    <button
                      onClick={() => resetOne(key)}
                      className="text-zinc-600 hover:text-zinc-400 transition-colors ml-0.5"
                      title={`Reset ${label}`}
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              </div>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={val}
                onChange={(e) => handleChange(key, parseFloat(e.target.value))}
                onDoubleClick={() => resetOne(key)}
                className="w-full h-1.5 bg-zinc-700 rounded-full appearance-none cursor-pointer 
                  [&::-webkit-slider-thumb]:appearance-none 
                  [&::-webkit-slider-thumb]:w-3.5 
                  [&::-webkit-slider-thumb]:h-3.5 
                  [&::-webkit-slider-thumb]:rounded-full 
                  [&::-webkit-slider-thumb]:bg-white 
                  [&::-webkit-slider-thumb]:shadow-md
                  [&::-webkit-slider-thumb]:cursor-grab
                  [&::-moz-range-thumb]:w-3.5 
                  [&::-moz-range-thumb]:h-3.5 
                  [&::-moz-range-thumb]:rounded-full 
                  [&::-moz-range-thumb]:bg-white 
                  [&::-moz-range-thumb]:border-0"
              />
            </div>
          );
        })}
      </div>

      {/* ACES tone mapping toggle */}
      <div className="pt-1 border-t border-zinc-800">
        <label className="flex items-center justify-between cursor-pointer group">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 group-hover:text-zinc-300 transition-colors">
            <Sparkles className="w-3.5 h-3.5" />
            ACES Tone Map
          </div>
          <button
            role="switch"
            aria-checked={params.tonemap}
            onClick={toggleTonemap}
            className={`relative w-8 h-4 rounded-full transition-colors ${
              params.tonemap ? "bg-blue-500" : "bg-zinc-700"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${
                params.tonemap ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </label>
      </div>
    </div>
  );
}
