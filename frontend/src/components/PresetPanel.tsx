"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Bookmark, BookmarkCheck, Trash2, ChevronDown, ChevronUp,
  Plus, Loader2, Download, Upload, Tag,
} from "lucide-react";
import type { AdjustParams } from "../lib/gl-renderer";
import { useAuth } from "@/context/AuthContext";

const PLATFORM_OPTIONS = ["Lightroom", "Capture One", "Darktable", "RawTherapee", "Pixelmator", "Affinity Photo"];

interface PresetRecord {
  ID: number;
  Name: string;
  Description: string;
  AdjustParams: string; // raw JSON string
  Platforms: string;   // raw JSON array string
  FilePath: string;
  CreatedAt: string;
}

interface PresetPanelProps {
  params: AdjustParams;
  onApply: (params: AdjustParams) => void;
  photoId?: number;   // if provided, "apply" will persist to backend
}

function parseAdjust(raw: string): AdjustParams | null {
  try { return JSON.parse(raw) as AdjustParams; }
  catch { return null; }
}

function parsePlatforms(raw: string): string[] {
  try { return JSON.parse(raw) as string[]; }
  catch { return []; }
}

export default function PresetPanel({ params, onApply, photoId }: PresetPanelProps) {
  const { authFetch } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [presets, setPresets] = useState<PresetRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newPlatforms, setNewPlatforms] = useState<string[]>([]);
  const [appliedId, setAppliedId] = useState<number | null>(null);
  const [uploadingFileId, setUploadingFileId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadPresetIdRef = useRef<number | null>(null);

  const fetchPresets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/presets");
      if (res.ok) {
        const data = await res.json();
        setPresets(Array.isArray(data) ? data : []);
      }
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (expanded) fetchPresets();
  }, [expanded, fetchPresets]);

  const handleApply = async (preset: PresetRecord) => {
    const adjust = parseAdjust(preset.AdjustParams);
    if (adjust) {
      onApply(adjust);
      setAppliedId(preset.ID);
      // Persist to backend if photoId is provided
      if (photoId) {
        authFetch(`/api/presets/${preset.ID}/apply/${photoId}`, { method: "POST" }).catch(() => null);
      }
    }
  };

  const handleDelete = async (id: number) => {
    const res = await authFetch(`/api/presets/${id}`, { method: "DELETE" });
    if (res.ok) {
      setPresets((prev) => prev.filter((p) => p.ID !== id));
      if (appliedId === id) setAppliedId(null);
    }
  };

  const handleSave = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await authFetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim(),
          adjust_params: JSON.stringify(params),
          platforms: JSON.stringify(newPlatforms),
        }),
      });
      if (res.ok) {
        setNewName(""); setNewDesc(""); setNewPlatforms([]);
        setShowSaveForm(false);
        fetchPresets();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleUploadFile = async (file: File, presetId: number) => {
    setUploadingFileId(presetId);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await authFetch(`/api/presets/${presetId}/file`, { method: "POST", body: form });
      if (res.ok) {
        fetchPresets();
      }
    } finally {
      setUploadingFileId(null);
    }
  };

  const handleDownload = async (presetId: number, presetName: string) => {
    const res = await authFetch(`/api/presets/${presetId}/file`);
    if (res.ok) {
      const data = await res.json();
      window.open(data.download_url, "_blank");
    }
  };

  const togglePlatform = (p: string) => {
    setNewPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  };

  return (
    <div className="border-t border-zinc-800 pt-4 space-y-3">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between text-xs font-medium text-zinc-500 uppercase tracking-wider hover:text-zinc-300 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span>Presets</span>
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {expanded && (
        <div className="space-y-2">
          {/* Preset list */}
          {loading ? (
            <div className="flex items-center gap-2 py-2 text-zinc-500 text-xs">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading...
            </div>
          ) : presets.length === 0 ? (
            <p className="text-xs text-zinc-600 italic py-1">No presets saved yet.</p>
          ) : (
            <div className="space-y-1">
              {presets.map((preset) => {
                const isActive = appliedId === preset.ID;
                const platforms = parsePlatforms(preset.Platforms);
                return (
                  <div
                    key={preset.ID}
                    className={`px-2.5 py-2 rounded-lg border transition-colors ${
                      isActive
                        ? "bg-blue-600/20 border-blue-500/30"
                        : "bg-zinc-800/50 hover:bg-zinc-800 border-transparent"
                    }`}
                  >
                    <div
                      className="flex items-center justify-between cursor-pointer"
                      onClick={() => handleApply(preset)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isActive ? (
                          <BookmarkCheck className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                        ) : (
                          <Bookmark className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" />
                        )}
                        <span className={`text-xs truncate ${isActive ? "text-blue-300" : "text-zinc-300"}`}>
                          {preset.Name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        {/* File download */}
                        {preset.FilePath ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownload(preset.ID, preset.Name); }}
                            className="text-zinc-500 hover:text-sky-400 transition-colors"
                            title="下载预设文件"
                          >
                            <Download className="w-3 h-3" />
                          </button>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              uploadPresetIdRef.current = preset.ID;
                              fileInputRef.current?.click();
                            }}
                            disabled={uploadingFileId === preset.ID}
                            className="text-zinc-600 hover:text-zinc-400 transition-colors"
                            title="上传预设文件"
                          >
                            {uploadingFileId === preset.ID ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Upload className="w-3 h-3" />
                            )}
                          </button>
                        )}
                        {/* Delete */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(preset.ID); }}
                          className="text-zinc-600 hover:text-red-400 transition-colors"
                          title="Delete preset"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Platform chips */}
                    {platforms.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5 ml-5">
                        {platforms.map((p) => (
                          <span key={p} className="text-[10px] px-1.5 py-0.5 bg-zinc-700/60 text-zinc-400 rounded">
                            {p}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Hidden file input for preset file upload */}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              const pid = uploadPresetIdRef.current;
              if (f && pid) handleUploadFile(f, pid);
              e.target.value = "";
            }}
          />

          {/* Save form */}
          {showSaveForm ? (
            <div className="space-y-2 p-2 bg-zinc-800/50 rounded-lg border border-zinc-700">
              <input
                type="text"
                placeholder="Preset name…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setShowSaveForm(false); }}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                autoFocus
              />
              <input
                type="text"
                placeholder="Description (optional)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
              />
              {/* Platform tags */}
              <div>
                <p className="flex items-center gap-1 text-[10px] text-zinc-600 mb-1">
                  <Tag className="w-2.5 h-2.5" /> 适用软件（可多选）
                </p>
                <div className="flex flex-wrap gap-1">
                  {PLATFORM_OPTIONS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => togglePlatform(p)}
                      className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                        newPlatforms.includes(p)
                          ? "bg-blue-600/30 border-blue-500/50 text-blue-300"
                          : "bg-zinc-800 border-zinc-700 text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={!newName.trim() || saving}
                  className="flex-1 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded text-xs transition-colors"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : "Save"}
                </button>
                <button
                  onClick={() => { setShowSaveForm(false); setNewName(""); setNewDesc(""); setNewPlatforms([]); }}
                  className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-xs transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowSaveForm(true)}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 border border-dashed border-zinc-700 hover:border-zinc-500 text-zinc-500 hover:text-zinc-300 rounded-lg text-xs transition-colors"
            >
              <Plus className="w-3 h-3" />
              Save current as preset
            </button>
          )}
        </div>
      )}
    </div>
  );
}

