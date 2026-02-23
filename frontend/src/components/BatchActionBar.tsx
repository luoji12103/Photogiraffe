"use client";

import { Trash2, Download, X, Loader2 } from "lucide-react";

interface BatchActionBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onBatchDelete: () => void;
  onBatchExport: () => void;
  deleting: boolean;
  exporting: boolean;
}

export default function BatchActionBar({
  selectedCount,
  onClearSelection,
  onBatchDelete,
  onBatchExport,
  deleting,
  exporting,
}: BatchActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl shadow-black/60 backdrop-blur-sm">
      <span className="text-sm font-medium text-zinc-200">
        {selectedCount} selected
      </span>

      <div className="w-px h-5 bg-zinc-700" />

      <button
        onClick={onBatchExport}
        disabled={exporting || deleting}
        className="flex items-center gap-2 text-sm text-sky-300 hover:text-sky-200 disabled:opacity-50 transition-colors"
        title="Export selected as JPEG"
      >
        {exporting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Download className="w-4 h-4" />
        )}
        {exporting ? "Queuing…" : "Export"}
      </button>

      <button
        onClick={onBatchDelete}
        disabled={deleting || exporting}
        className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
        title="Delete selected photos"
      >
        {deleting ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Trash2 className="w-4 h-4" />
        )}
        {deleting ? "Deleting…" : "Delete"}
      </button>

      <div className="w-px h-5 bg-zinc-700" />

      <button
        onClick={onClearSelection}
        className="text-zinc-500 hover:text-zinc-300 transition-colors"
        aria-label="Clear selection"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
