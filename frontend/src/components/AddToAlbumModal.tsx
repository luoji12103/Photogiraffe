"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { X, Images, Plus, Loader2, Check, FolderOpen } from "lucide-react";

interface Album {
  ID: number;
  Name: string;
  PhotoCount: number;
}

interface AddToAlbumModalProps {
  selectedIds: Set<number>;
  onClose: () => void;
}

export default function AddToAlbumModal({ selectedIds, onClose }: AddToAlbumModalProps) {
  const { authFetch } = useAuth();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<number | null>(null);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    authFetch("/api/albums")
      .then((r) => (r.ok ? r.json() : []))
      .then(setAlbums)
      .finally(() => setLoading(false));
  }, [authFetch]);

  const handleAdd = async (albumId: number) => {
    if (done.has(albumId)) return;
    setAdding(albumId);
    try {
      const res = await authFetch(`/api/albums/${albumId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_ids: Array.from(selectedIds) }),
      });
      if (res.ok) {
        setDone((prev) => new Set(prev).add(albumId));
      }
    } finally {
      setAdding(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await authFetch("/api/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        const album = await res.json();
        setAlbums((prev) => [{ ID: album.ID, Name: album.Name, PhotoCount: 0 }, ...prev]);
        setNewName("");
        setShowCreate(false);
        // Immediately add photos
        handleAdd(album.ID);
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full sm:w-96 bg-zinc-900 border border-zinc-700 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Images className="w-4 h-4 text-zinc-500" />
            <span className="text-sm font-medium text-zinc-200">添加到相册</span>
            <span className="text-xs text-zinc-600">（{selectedIds.size} 张）</span>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-80 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-zinc-600" />
            </div>
          )}

          {!loading && albums.length === 0 && !showCreate && (
            <div className="flex flex-col items-center justify-center py-8 text-zinc-600 gap-2">
              <FolderOpen className="w-10 h-10 opacity-40" />
              <p className="text-xs">还没有相册</p>
            </div>
          )}

          {!loading && albums.map((album) => (
            <button
              key={album.ID}
              onClick={() => handleAdd(album.ID)}
              disabled={adding === album.ID}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800 transition-colors text-left border-b border-zinc-800/50 last:border-0"
            >
              <div>
                <p className="text-sm text-zinc-200">{album.Name}</p>
                <p className="text-xs text-zinc-600">{album.PhotoCount} 张照片</p>
              </div>
              {adding === album.ID ? (
                <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
              ) : done.has(album.ID) ? (
                <Check className="w-4 h-4 text-emerald-400" />
              ) : (
                <Plus className="w-4 h-4 text-zinc-500" />
              )}
            </button>
          ))}
        </div>

        {/* Create new album */}
        <div className="border-t border-zinc-800 p-3">
          {showCreate ? (
            <form onSubmit={handleCreate} className="flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="新相册名称"
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                autoFocus
              />
              <button
                type="submit"
                disabled={creating || !newName.trim()}
                className="px-3 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg disabled:opacity-50 transition-colors"
              >
                {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : "创建并添加"}
              </button>
            </form>
          ) : (
            <button
              onClick={() => setShowCreate(true)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              新建相册
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
