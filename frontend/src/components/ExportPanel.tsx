"use client";

import { useState, useCallback, useEffect } from "react";
import { Download, Loader2, CheckCircle, AlertCircle, ChevronDown, ChevronUp, Stamp } from "lucide-react";
import type { AdjustParams } from "../lib/gl-renderer";
import { useAuth } from "@/context/AuthContext";

interface ExportPanelProps {
  photoId: number;
  adjustParams: AdjustParams;
}

type ExportFormat = "jpeg" | "png" | "webp" | "tiff";
type JobStatus = "idle" | "pending" | "processing" | "completed" | "failed";
type OverlayPosition = "bottom_right" | "bottom_left" | "top_right" | "top_left" | "bottom_center";

const FORMAT_LABELS: Record<ExportFormat, string> = {
  jpeg: "JPEG",
  png: "PNG",
  webp: "WebP",
  tiff: "TIFF",
};

const LONG_EDGE_OPTIONS = [
  { label: "Original", value: 0 },
  { label: "800px", value: 800 },
  { label: "1080px", value: 1080 },
  { label: "2048px", value: 2048 },
  { label: "4096px", value: 4096 },
];

const OVERLAY_POSITIONS: { label: string; value: OverlayPosition }[] = [
  { label: "右下", value: "bottom_right" },
  { label: "左下", value: "bottom_left" },
  { label: "右上", value: "top_right" },
  { label: "左上", value: "top_left" },
  { label: "居中下", value: "bottom_center" },
];

export default function ExportPanel({ photoId, adjustParams }: ExportPanelProps) {
  const { authFetch } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("jpeg");
  const [quality, setQuality] = useState(90);
  const [longEdge, setLongEdge] = useState(0);
  const [denoiseLevel, setDenoiseLevel] = useState(0);
  const [jobStatus, setJobStatus] = useState<JobStatus>("idle");
  const [jobId, setJobId] = useState<number | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  // v9.1 — Overlay state
  const [overlayExpanded, setOverlayExpanded] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [hasAvatar, setHasAvatar] = useState(false);
  const [overlaySignature, setOverlaySignature] = useState(false);
  const [overlayAvatar, setOverlayAvatar] = useState(false);
  const [overlayExif, setOverlayExif] = useState(false);
  const [overlayDescription, setOverlayDescription] = useState(false);
  const [overlayPosition, setOverlayPosition] = useState<OverlayPosition>("bottom_right");
  const [overlayOpacity, setOverlayOpacity] = useState(0.8);

  const supportsQuality = format === "jpeg" || format === "webp";

  // Fetch overlay availability when panel expands
  useEffect(() => {
    if (!expanded) return;
    authFetch("/api/profile/overlays").then(r => r.json()).then(d => {
      setHasSignature(!!d.has_signature);
      setHasAvatar(!!d.has_avatar);
    }).catch(() => {});
  }, [expanded, authFetch]);

  const pollStatus = useCallback(async (id: number) => {
    const interval = setInterval(async () => {
      try {
        const res = await authFetch(`/api/exports/${id}`);
        if (!res.ok) return;
        const job = await res.json();

        if (job.Status === "completed") {
          clearInterval(interval);
          setJobStatus("completed");
          // Fetch download URL
          const dlRes = await authFetch(`/api/exports/${id}/download`);
          if (dlRes.ok) {
            const dlData = await dlRes.json();
            setDownloadUrl(dlData.url);
          }
        } else if (job.Status === "failed") {
          clearInterval(interval);
          setJobStatus("failed");
          setErrorMsg(job.ErrorMessage || "Export failed");
        }
      } catch (e) {
        console.error("[ExportPanel] poll error", e);
      }
    }, 3000);

    // Timeout after 5 minutes
    setTimeout(() => {
      clearInterval(interval);
      setJobStatus((prev) => {
        if (prev === "pending" || prev === "processing") {
          setErrorMsg("Export timed out. Please try again.");
          return "failed";
        }
        return prev;
      });
    }, 5 * 60 * 1000);
  }, []);

  const handleExport = useCallback(async () => {
    setJobStatus("pending");
    setDownloadUrl(null);
    setErrorMsg("");

    try {
      const res = await authFetch(`/api/photos/${photoId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          quality,
          long_edge: longEdge,
          denoise_level: denoiseLevel,
          embed_exif: true,
          // v9.1 overlays
          overlay_signature:   overlaySignature,
          overlay_avatar:      overlayAvatar,
          overlay_exif:        overlayExif,
          overlay_description: overlayDescription,
          overlay_position:    overlayPosition,
          overlay_opacity:     overlayOpacity,
          adjust: {
            exposure:   adjustParams.exposure,
            brightness: adjustParams.brightness,
            contrast:   adjustParams.contrast,
            saturation: adjustParams.saturation,
            tonemap:    adjustParams.tonemap,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create export job");
      }

      setJobId(data.job_id);
      setJobStatus("processing");
      pollStatus(data.job_id);
    } catch (e: unknown) {
      setJobStatus("failed");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
}, [photoId, format, quality, longEdge, denoiseLevel,
     overlaySignature, overlayAvatar, overlayExif, overlayDescription,
     overlayPosition, overlayOpacity, adjustParams, pollStatus]);

  const handleReset = () => {
    setJobStatus("idle");
    setJobId(null);
    setDownloadUrl(null);
    setErrorMsg("");
  };

  return (
    <div className="border-t border-zinc-800 pt-4 space-y-3">
      {/* Section header */}
      <button
        className="w-full flex items-center justify-between text-xs font-medium text-zinc-500 uppercase tracking-wider hover:text-zinc-300 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span>Export</span>
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {expanded && (
        <div className="space-y-3">
          {/* Format */}
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500">Format</label>
            <div className="grid grid-cols-4 gap-1">
              {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`py-1 rounded text-xs font-medium transition-colors ${
                    format === f
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}
                >
                  {FORMAT_LABELS[f]}
                </button>
              ))}
            </div>
          </div>

          {/* Quality (JPEG / WebP only) */}
          {supportsQuality && (
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <label className="text-xs text-zinc-500">Quality</label>
                <span className="text-xs tabular-nums text-zinc-400">{quality}</span>
              </div>
              <input
                type="range" min={30} max={100} step={1} value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="w-full h-1.5 bg-zinc-700 rounded-full appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none
                  [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
              />
            </div>
          )}

          {/* Long edge */}
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500">Max long edge</label>
            <div className="flex flex-wrap gap-1">
              {LONG_EDGE_OPTIONS.map(({ label, value }) => (
                <button
                  key={value}
                  onClick={() => setLongEdge(value)}
                  className={`px-2 py-0.5 rounded text-xs transition-colors ${
                    longEdge === value
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* AI Denoise */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs text-zinc-500">AI Denoising</label>
              {denoiseLevel > 0 && (
                <span className="text-xs text-violet-400">
                  {["", "轻度", "中度", "强力"][denoiseLevel]}
                </span>
              )}
            </div>
            <div className="grid grid-cols-4 gap-1">
              {([0,1,2,3] as const).map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setDenoiseLevel(lvl)}
                  className={`py-1 rounded text-xs font-medium transition-colors ${
                    denoiseLevel === lvl
                      ? lvl === 0 ? "bg-zinc-600 text-white" : "bg-violet-600 text-white"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}
                >
                  {lvl === 0 ? "关闭" : lvl === 1 ? "轻" : lvl === 2 ? "中" : "强"}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-zinc-600 leading-tight">
              使用 AI 算法减少照片噪点，强度越高处理越慢
            </p>
          </div>

          {/* v9.1 — Watermark & Overlays */}
          <div className="space-y-2 border-t border-zinc-800 pt-3">
            <button
              className="w-full flex items-center justify-between text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              onClick={() => setOverlayExpanded(v => !v)}
            >
              <span className="flex items-center gap-1.5"><Stamp className="w-3 h-3" />水印与叠加</span>
              {overlayExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {overlayExpanded && (
              <div className="space-y-2 pl-1">
                {/* Overlay toggles */}
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { key: "signature", label: "摄影师签名", state: overlaySignature, set: setOverlaySignature, disabled: !hasSignature },
                    { key: "avatar",    label: "头像",       state: overlayAvatar,    set: setOverlayAvatar,    disabled: !hasAvatar },
                    { key: "exif",      label: "EXIF 参数",  state: overlayExif,      set: setOverlayExif,      disabled: false },
                    { key: "desc",      label: "照片描述",   state: overlayDescription, set: setOverlayDescription, disabled: false },
                  ].map(({ key, label, state, set, disabled }) => (
                    <button
                      key={key}
                      disabled={disabled}
                      onClick={() => set(!state)}
                      className={`py-1 px-2 rounded text-xs transition-colors text-left ${
                        disabled ? "opacity-30 cursor-not-allowed bg-zinc-800 text-zinc-600"
                          : state ? "bg-amber-600/80 text-white"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      }`}
                    >
                      {state ? "✓ " : ""}{label}
                      {disabled && <span className="ml-1 text-zinc-600">(未上传)</span>}
                    </button>
                  ))}
                </div>
                {/* Position */}
                {(overlaySignature || overlayAvatar || overlayExif) && (
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-600">叠加位置</label>
                    <div className="flex flex-wrap gap-1">
                      {OVERLAY_POSITIONS.map(({ label, value }) => (
                        <button
                          key={value}
                          onClick={() => setOverlayPosition(value)}
                          className={`px-2 py-0.5 rounded text-xs transition-colors ${
                            overlayPosition === value ? "bg-amber-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* Opacity */}
                {(overlaySignature || overlayAvatar || overlayExif || overlayDescription) && (
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <label className="text-xs text-zinc-600">不透明度</label>
                      <span className="text-xs tabular-nums text-zinc-400">{Math.round(overlayOpacity * 100)}%</span>
                    </div>
                    <input
                      type="range" min={0.2} max={1} step={0.05} value={overlayOpacity}
                      onChange={e => setOverlayOpacity(Number(e.target.value))}
                      className="w-full h-1.5 bg-zinc-700 rounded-full appearance-none cursor-pointer
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3
                        [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full
                        [&::-webkit-slider-thumb]:bg-amber-500"
                    />
                  </div>
                )}
                {!hasSignature && !hasAvatar && (
                  <p className="text-[10px] text-zinc-600 leading-tight">
                    在个人主页上传签名/头像后可叠加到导出图片上
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Status / Action */}
          {jobStatus === "idle" && (
            <button
              onClick={handleExport}
              className="w-full flex items-center justify-center gap-2 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
          )}

          {(jobStatus === "pending" || jobStatus === "processing") && (
            <div className="flex items-center gap-2 py-2 text-zinc-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>
                {jobStatus === "pending" ? "Queuing…" : "Processing…"}
                {jobId && <span className="text-zinc-600 ml-1">#{jobId}</span>}
              </span>
            </div>
          )}

          {jobStatus === "completed" && downloadUrl && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-emerald-400 text-sm">
                <CheckCircle className="w-4 h-4" />
                <span>Export ready!</span>
              </div>
              <a
                href={downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <Download className="w-4 h-4" />
                Download
              </a>
              <button
                onClick={handleReset}
                className="w-full py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Export again
              </button>
            </div>
          )}

          {jobStatus === "failed" && (
            <div className="space-y-2">
              <div className="flex items-start gap-1.5 text-red-400 text-xs">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{errorMsg || "Export failed"}</span>
              </div>
              <button
                onClick={handleReset}
                className="w-full py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
