"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { Images, Plus, Trash2, Loader2, FolderOpen } from "lucide-react";

interface Album {
  ID: number;
  Name: string;
  Description: string;
  CoverPhotoID: number | null;
  ShareToken: string;
  PhotoCount: number;
  CreatedAt: string;
}

export default function AlbumsPage() {
  const { authFetch } = useAuth();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [showForm, setShowForm] = useState(false);

  const load = () => {
    setLoading(true);
    authFetch("/api/albums")
      .then((r) => (r.ok ? r.json() : []))
      .then(setAlbums)
      .finally(() => setLoading(false));
  };

  useEffect(load, [authFetch]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await authFetch("/api/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() }),
      });
      if (res.ok) {
        setNewName("");
        setNewDesc("");
        setShowForm(false);
        load();
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`删除相册「${name}」？照片不会被删除。`)) return;
    await authFetch(`/api/albums/${id}`, { method: "DELETE" });
    setAlbums((prev) => prev.filter((a) => a.ID !== id));
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Images className="w-6 h-6 text-zinc-400" />
          <h1 className="text-xl font-semibold text-zinc-200">我的相册</h1>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm rounded-lg border border-zinc-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          新建相册
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="mb-6 p-4 bg-zinc-900 border border-zinc-700 rounded-xl space-y-3"
        >
          <input
            type="text"
            placeholder="相册名称 *"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            autoFocus
            required
          />
          <input
            type="text"
            placeholder="简介（可选）"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="px-4 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg disabled:opacity-50 transition-colors"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : "创建"}
            </button>
          </div>
        </form>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-7 h-7 animate-spin text-zinc-600" />
        </div>
      )}

      {/* Empty state */}
      {!loading && albums.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-600 gap-3">
          <FolderOpen className="w-14 h-14 opacity-40" />
          <p className="text-sm">还没有相册，点击右上角新建</p>
        </div>
      )}

      {/* Album grid */}
      {!loading && albums.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {albums.map((album) => (
            <div
              key={album.ID}
              className="group relative bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden hover:border-zinc-700 transition-colors"
            >
              {/* Cover placeholder */}
              <div className="aspect-video bg-zinc-800 flex items-center justify-center">
                <Images className="w-10 h-10 text-zinc-700" />
              </div>

              <div className="p-4">
                <Link
                  href={`/albums/${album.ID}`}
                  className="block text-sm font-medium text-zinc-200 hover:text-zinc-100 truncate leading-snug"
                >
                  {album.Name}
                </Link>
                {album.Description && (
                  <p className="text-xs text-zinc-500 mt-1 truncate">{album.Description}</p>
                )}
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-zinc-600">
                    {album.PhotoCount ?? 0} 张照片
                  </span>
                  <div className="flex items-center gap-2">
                    {album.ShareToken && (
                      <span className="text-xs text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">已分享</span>
                    )}
                    <button
                      onClick={() => handleDelete(album.ID, album.Name)}
                      className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all"
                      title="删除相册"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
