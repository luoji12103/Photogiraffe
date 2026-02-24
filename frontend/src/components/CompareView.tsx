"use client";

import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { DEFAULT_ADJUST, type AdjustParams } from "@/lib/gl-renderer";
import GLCanvas from "@/components/GLCanvas";
import AdjustPanel from "@/components/AdjustPanel";
import { useDisplayDetect } from "@/lib/display-detect";

interface ExifData {
  CameraModel: string;
  LensModel: string;
  Aperture: string;
  ShutterSpeed: string;
  ISO: string;
  FocalLength: string;
  DateTimeOriginal: string;
  GPSLatitude: string;
  GPSLongitude: string;
  Software: string;
  ColorSpace: string;
  ICCProfileName?: string;
}

interface Photo {
  ID: number;
  OriginalFilename: string;
  MinioPath: string;
  Status: string;
  ExifData?: ExifData;
}

interface CompareViewProps {
  photoA: Photo;
  photoB: Photo;
}

function exifUrl(p: Photo) {
  const proxy = p.MinioPath.replace("raw/", "proxy/").replace(/\.[^/.]+$/, ".webp");
  return `/api/image?path=${encodeURIComponent(proxy)}`;
}

const EXIF_KEYS: { key: keyof ExifData; label: string }[] = [
  { key: "CameraModel", label: "相机" },
  { key: "LensModel", label: "镜头" },
  { key: "FocalLength", label: "焦距" },
  { key: "Aperture", label: "光圈" },
  { key: "ShutterSpeed", label: "快门" },
  { key: "ISO", label: "ISO" },
  { key: "ICCProfileName", label: "色彩空间" },
  { key: "Software", label: "软件" },
];

export default function CompareView({ photoA: initA, photoB: initB }: CompareViewProps) {
  const [a, setA] = useState(initA);
  const [b, setB] = useState(initB);
  const [paramsA, setParamsA] = useState<AdjustParams>(DEFAULT_ADJUST);
  const [paramsB, setParamsB] = useState<AdjustParams>(DEFAULT_ADJUST);
  const [showAdjust, setShowAdjust] = useState(false);
  const display = useDisplayDetect();

  const handleSwap = () => {
    setA(b);
    setB(a);
    setParamsA(paramsB);
    setParamsB(paramsA);
  };

  const renderDiff = (keyObj: { key: keyof ExifData; label: string }) => {
    const va = a.ExifData?.[keyObj.key] ?? "—";
    const vb = b.ExifData?.[keyObj.key] ?? "—";
    const same = va === vb;
    return (
      <tr key={keyObj.key} className={`${same ? "" : "bg-amber-500/5"}`}>
        <td className="py-1.5 px-3 text-xs text-zinc-500 whitespace-nowrap">{keyObj.label}</td>
        <td className={`py-1.5 px-3 text-xs ${same ? "text-zinc-300" : "text-amber-300"} truncate max-w-[180px]`}>{va || "—"}</td>
        <td className="py-1.5 px-3 text-center text-zinc-700 text-xs">{same ? "=" : "≠"}</td>
        <td className={`py-1.5 px-3 text-xs ${same ? "text-zinc-300" : "text-amber-300"} truncate max-w-[180px]`}>{vb || "—"}</td>
      </tr>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Images */}
      <div className="flex flex-1 min-h-0 divide-x divide-zinc-800">
        {/* Panel A */}
        <div className="flex-1 flex flex-col">
          <div className="px-4 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center gap-2">
            <span className="text-xs font-medium text-zinc-300 truncate">{a.OriginalFilename}</span>
            <span className="ml-auto text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">A</span>
          </div>
          <div className="flex-1 relative bg-zinc-950">
            <GLCanvas
              proxyUrl={exifUrl(a)}
              rawFrame={null}
              params={paramsA}
              colorSpace={display.targetColorSpace}
              alt={a.OriginalFilename}
            />
          </div>
          {showAdjust && (
            <div className="p-4 bg-zinc-900 border-t border-zinc-800">
              <AdjustPanel params={paramsA} onChange={setParamsA} />
            </div>
          )}
        </div>

        {/* Swap button overlay */}
        <div className="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none hidden md:block">
          <button
            onClick={handleSwap}
            className="pointer-events-auto bg-zinc-800/80 backdrop-blur-sm border border-zinc-700 rounded-full p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition-colors shadow-lg"
            title="交换左右"
          >
            <ArrowLeftRight className="w-4 h-4" />
          </button>
        </div>

        {/* Panel B */}
        <div className="flex-1 flex flex-col">
          <div className="px-4 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center gap-2">
            <span className="text-xs font-medium text-zinc-300 truncate">{b.OriginalFilename}</span>
            <span className="ml-auto text-xs text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded">B</span>
          </div>
          <div className="flex-1 relative bg-zinc-950">
            <GLCanvas
              proxyUrl={exifUrl(b)}
              rawFrame={null}
              params={paramsB}
              colorSpace={display.targetColorSpace}
              alt={b.OriginalFilename}
            />
          </div>
          {showAdjust && (
            <div className="p-4 bg-zinc-900 border-t border-zinc-800">
              <AdjustPanel params={paramsB} onChange={setParamsB} />
            </div>
          )}
        </div>
      </div>

      {/* EXIF diff table */}
      <div className="border-t border-zinc-800 bg-zinc-900/60 overflow-x-auto">
        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800">
          <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">EXIF 对比</h3>
          <div className="flex gap-2">
            <button
              onClick={handleSwap}
              className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors md:hidden"
            >
              <ArrowLeftRight className="w-3 h-3" /> 交换
            </button>
            <button
              onClick={() => setShowAdjust((s) => !s)}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {showAdjust ? "隐藏调整" : "显示调整面板"}
            </button>
          </div>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="py-1 px-3 text-left text-xs text-zinc-600 font-normal">参数</th>
              <th className="py-1 px-3 text-left text-xs text-blue-500 font-medium">A</th>
              <th className="py-1 px-3 text-center" />
              <th className="py-1 px-3 text-left text-xs text-purple-500 font-medium">B</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/50">
            {EXIF_KEYS.map(renderDiff)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
