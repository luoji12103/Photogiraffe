"use client";

import { useState, useCallback } from "react";
import { Download, Loader2, CheckCircle, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import type { AdjustParams } from "../lib/gl-renderer";

interface ExportPanelProps {
  photoId: number;
  adjustParams: AdjustParams;
}

type ExportFormat = "jpeg" | "png" | "webp" | "tiff";
type JobStatus = "idle" | "pending" | "processing" | "completed" | "failed";

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

export default function ExportPanel({ photoId, adjustParams }: ExportPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("jpeg");
  const [quality, setQuality] = useState(90);
  const [longEdge, setLongEdge] = useState(0);
  const [jobStatus, setJobStatus] = useState<JobStatus>("idle");
  const [jobId, setJobId] = useState<number | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const supportsQuality = format === "jpeg" || format === "webp";

  const pollStatus = useCallback(async (id: number) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/exports/${id}`);
        if (!res.ok) return;
        const job = await res.json();

        if (job.Status === "completed") {
          clearInterval(interval);
          setJobStatus("completed");
          // Fetch download URL
          const dlRes = await fetch(`/api/exports/${id}/download`);
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
      const res = await fetch(`/api/photos/${photoId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          quality,
          long_edge: longEdge,
          embed_exif: true,
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
  }, [photoId, format, quality, longEdge, adjustParams, pollStatus]);

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
