"use client";

import { useState, useEffect, useCallback } from "react";
import { Bookmark, BookmarkCheck, Trash2, ChevronDown, ChevronUp, Plus, Loader2 } from "lucide-react";
import type { AdjustParams } from "../lib/gl-renderer";

interface PresetRecord {
  ID: number;
  Name: string;
  Description: string;
  AdjustParams: string; // raw JSON string
  CreatedAt: string;
}

interface PresetPanelProps {
  params: AdjustParams;
  onApply: (params: AdjustParams) => void;
}

function parseAdjust(raw: string): AdjustParams | null {
  try {
    return JSON.parse(raw) as AdjustParams;
  } catch {
    return null;
  }
}

export default function PresetPanel({ params, onApply }: PresetPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [presets, setPresets] = useState<PresetRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [appliedId, setAppliedId] = useState<number | null>(null);

  const fetchPresets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/presets");
      if (res.ok) {
        const data = await res.json();
        setPresets(Array.isArray(data) ? data : []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (expanded) fetchPresets();
  }, [expanded, fetchPresets]);

  const handleApply = (preset: PresetRecord) => {
    const adjust = parseAdjust(preset.AdjustParams);
    if (adjust) {
      onApply(adjust);
      setAppliedId(preset.ID);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await fetch(`/api/presets/${id}`, { method: "DELETE" });
    if (res.ok) {
      setPresets((prev) => prev.filter((p) => p.ID !== id));
      if (appliedId === id) setAppliedId(null);
    }
  };

  const handleSave = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim(),
          adjust_params: JSON.stringify(params),
        }),
      });
      if (res.ok) {
        setNewName("");
        setNewDesc("");
        setShowSaveForm(false);
        fetchPresets();
      }
    } finally {
      setSaving(false);
    }
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
                return (
                  <div
                    key={preset.ID}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer group transition-colors ${
                      isActive
                        ? "bg-blue-600/20 border border-blue-500/30"
                        : "bg-zinc-800/50 hover:bg-zinc-800 border border-transparent"
                    }`}
                    onClick={() => handleApply(preset)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isActive ? (
                        <BookmarkCheck className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                      ) : (
                        <Bookmark className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-300 flex-shrink-0" />
                      )}
                      <span
                        className={`text-xs truncate ${isActive ? "text-blue-300" : "text-zinc-300"}`}
                        title={preset.Name}
                      >
                        {preset.Name}
                      </span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(preset.ID); }}
                      className="text-zinc-600 hover:text-red-400 transition-colors ml-2 flex-shrink-0 opacity-0 group-hover:opacity-100"
                      title="Delete preset"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

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
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={!newName.trim() || saving}
                  className="flex-1 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded text-xs transition-colors"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : "Save"}
                </button>
                <button
                  onClick={() => { setShowSaveForm(false); setNewName(""); setNewDesc(""); }}
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
