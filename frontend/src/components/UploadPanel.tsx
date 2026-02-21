"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Upload,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ImagePlus,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type FileStatus = "pending" | "uploading" | "done" | "error";

interface UploadItem {
  id: string;
  file: File;
  status: FileStatus;
  progress: number; // 0–100
  error?: string;
  photoId?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCEPTED_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".tiff", ".tif",
  ".heif", ".heic", ".hif",
  ".arw", ".cr2", ".cr3", ".nef", ".dng", ".raf",
]);

const ACCEPTED_MIME_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/tiff",
  "image/heif", "image/heic",
  "image/x-adobe-dng",
  // Many RAW files have no standard MIME; browser reports octet-stream
  "application/octet-stream",
].join(",");

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx).toLowerCase() : "";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── XHR-based upload (supports onprogress; fetch does not) ──────────────────

function uploadFile(
  file: File,
  onProgress: (pct: number) => void
): Promise<{ photo_id: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append("image", file);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          resolve({ photo_id: 0 });
        }
      } else {
        let message = `HTTP ${xhr.status}`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (body.error) message = body.error;
        } catch { /* ignore */ }
        reject(new Error(message));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error")));
    xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));

    xhr.open("POST", "/api/upload");
    xhr.send(formData);
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function UploadPanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Add files to the queue (deduplicate by name+size)
  const addFiles = useCallback((fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).filter((f) => {
      const ext = getExtension(f.name);
      return ACCEPTED_EXTENSIONS.has(ext);
    });
    if (incoming.length === 0) return;

    setItems((prev) => {
      const existingKeys = new Set(prev.map((i) => `${i.file.name}-${i.file.size}`));
      const fresh: UploadItem[] = incoming
        .filter((f) => !existingKeys.has(`${f.name}-${f.size}`))
        .map((f) => ({
          id: `${f.name}-${f.size}-${Date.now()}`,
          file: f,
          status: "pending",
          progress: 0,
        }));
      return [...prev, ...fresh];
    });
  }, []);

  // Update a single item immutably
  const updateItem = (id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  };

  // Upload all pending items sequentially
  const startUpload = async () => {
    const pending = items.filter((i) => i.status === "pending");
    if (pending.length === 0) return;
    setUploading(true);

    for (const item of pending) {
      updateItem(item.id, { status: "uploading", progress: 0 });
      try {
        const result = await uploadFile(item.file, (pct) => {
          updateItem(item.id, { progress: pct });
        });
        updateItem(item.id, { status: "done", progress: 100, photoId: result.photo_id });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        updateItem(item.id, { status: "error", error: msg });
      }
    }

    setUploading(false);
  };

  // Close panel and refresh gallery
  const handleDone = () => {
    setOpen(false);
    setItems([]);
    router.refresh();
  };

  // Drag & drop handlers
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };
  const onDragLeave = () => setDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  };

  const pendingCount = items.filter((i) => i.status === "pending").length;
  const doneCount = items.filter((i) => i.status === "done").length;
  const errorCount = items.filter((i) => i.status === "error").length;
  const allFinished = items.length > 0 && !uploading && pendingCount === 0;

  return (
    <div className="relative">
      {/* Toggle button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
          open
            ? "bg-blue-600 text-white hover:bg-blue-700"
            : "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700"
        }`}
      >
        <Upload size={15} />
        Upload
      </button>

      {/* Slide-down panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="upload-panel"
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="absolute right-0 top-12 z-40 w-[420px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
              <span className="font-semibold text-sm">Upload Photos</span>
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Drop zone */}
              <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed cursor-pointer select-none transition-colors py-8 ${
                  dragging
                    ? "border-blue-500 bg-blue-500/5"
                    : "border-zinc-300 dark:border-zinc-700 hover:border-zinc-400 dark:hover:border-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                }`}
              >
                <ImagePlus
                  size={28}
                  className={dragging ? "text-blue-500" : "text-zinc-400"}
                />
                <div className="text-center">
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    {dragging ? "Drop files here" : "Drag & drop or click to select"}
                  </p>
                  <p className="text-xs text-zinc-400 mt-1">
                    JPEG · PNG · WEBP · HEIF · ARW · NEF · CR2 · DNG · RAF
                  </p>
                </div>
              </div>

              <input
                ref={inputRef}
                type="file"
                multiple
                accept={ACCEPTED_MIME_TYPES + "," + Array.from(ACCEPTED_EXTENSIONS).join(",")}
                className="hidden"
                onChange={(e) => e.target.files && addFiles(e.target.files)}
              />

              {/* File list */}
              {items.length > 0 && (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {items.map((item) => (
                    <FileRow
                      key={item.id}
                      item={item}
                      onRemove={
                        item.status === "pending"
                          ? () =>
                              setItems((prev) =>
                                prev.filter((i) => i.id !== item.id)
                              )
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-zinc-400">
                  {items.length === 0
                    ? "No files selected"
                    : allFinished
                    ? `${doneCount} uploaded${errorCount ? `, ${errorCount} failed` : ""}`
                    : `${items.length} file${items.length > 1 ? "s" : ""} selected`}
                </span>
                <div className="flex gap-2">
                  {!allFinished && (
                    <button
                      onClick={startUpload}
                      disabled={uploading || pendingCount === 0}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      {uploading && <Loader2 size={13} className="animate-spin" />}
                      {uploading ? "Uploading…" : "Upload"}
                    </button>
                  )}
                  {allFinished && (
                    <button
                      onClick={handleDone}
                      className="flex items-center gap-1.5 px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      <CheckCircle2 size={13} />
                      Done
                    </button>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── FileRow sub-component ────────────────────────────────────────────────────

function FileRow({
  item,
  onRemove,
}: {
  item: UploadItem;
  onRemove?: () => void;
}) {
  const statusIcon = {
    pending: <span className="w-4 h-4 rounded-full border-2 border-zinc-300 dark:border-zinc-600" />,
    uploading: <Loader2 size={14} className="animate-spin text-blue-500" />,
    done: <CheckCircle2 size={14} className="text-green-500" />,
    error: <AlertCircle size={14} className="text-red-500" />,
  }[item.status];

  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-800/60">
      <div className="shrink-0">{statusIcon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">
          {item.file.name}
        </p>
        {item.status === "uploading" && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1 h-1 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-150 rounded-full"
                style={{ width: `${item.progress}%` }}
              />
            </div>
            <span className="text-[10px] text-zinc-400 tabular-nums shrink-0">
              {item.progress}%
            </span>
          </div>
        )}
        {item.status === "error" && (
          <p className="text-[10px] text-red-400 mt-0.5 truncate">{item.error}</p>
        )}
        {item.status !== "uploading" && (
          <p className="text-[10px] text-zinc-400 mt-0.5">
            {formatBytes(item.file.size)}
          </p>
        )}
      </div>
      {onRemove && (
        <button
          onClick={onRemove}
          className="shrink-0 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
