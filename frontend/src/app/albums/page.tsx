"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
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

  const inputStyle: React.CSSProperties = {
    background: "var(--pg-bg-elevated)",
    border: "1px solid var(--pg-border)",
    color: "var(--pg-text-primary)",
    borderRadius: "var(--pg-radius-md)",
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-6"
      >
        <div className="flex items-center gap-3">
          <Images className="w-6 h-6" style={{ color: "var(--pg-accent)" }} />
          <h1 className="text-xl font-semibold" style={{ color: "var(--pg-text-primary)" }}>我的相册</h1>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm transition-colors"
          style={{
            background: "var(--pg-accent)",
            color: "#fff",
            borderRadius: "var(--pg-radius-md)",
          }}
        >
          <Plus className="w-4 h-4" />
          新建相册
        </button>
      </motion.div>

      {/* Create form */}
      <AnimatePresence>
        {showForm && (
          <motion.form
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            onSubmit={handleCreate}
            className="mb-6 p-4 rounded-xl space-y-3 overflow-hidden"
            style={{ background: "var(--pg-bg-surface)", border: "1px solid var(--pg-border)" }}
          >
            <input
              type="text" placeholder="相册名称 *" value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 text-sm focus:outline-none" style={inputStyle}
              autoFocus required
            />
            <input
              type="text" placeholder="简介（可选）" value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="w-full px-3 py-2 text-sm focus:outline-none" style={inputStyle}
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button" onClick={() => setShowForm(false)}
                className="px-3 py-1.5 text-sm transition-colors"
                style={{ color: "var(--pg-text-tertiary)" }}
              >
                取消
              </button>
              <button
                type="submit" disabled={creating || !newName.trim()}
                className="px-4 py-1.5 text-sm disabled:opacity-50 transition-colors"
                style={{ background: "var(--pg-accent)", color: "#fff", borderRadius: "var(--pg-radius-md)" }}
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : "创建"}
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl overflow-hidden animate-pulse"
              style={{ background: "var(--pg-bg-elevated)" }}>
              <div className="aspect-video" style={{ background: "var(--pg-bg-hover)" }} />
              <div className="p-4 space-y-2">
                <div className="h-4 w-24 rounded" style={{ background: "var(--pg-bg-hover)" }} />
                <div className="h-3 w-16 rounded" style={{ background: "var(--pg-bg-hover)" }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && albums.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center justify-center py-20 gap-3"
        >
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: "var(--pg-accent-soft)" }}>
            <FolderOpen className="w-8 h-8" style={{ color: "var(--pg-accent)" }} />
          </div>
          <p className="text-sm" style={{ color: "var(--pg-text-tertiary)" }}>
            还没有相册，点击上方按钮新建
          </p>
        </motion.div>
      )}

      {/* Album grid */}
      {!loading && albums.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {albums.map((album, i) => (
            <motion.div
              key={album.ID}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.4 }}
              className="group relative rounded-xl overflow-hidden transition-all"
              style={{
                background: "var(--pg-bg-surface)",
                border: "1px solid var(--pg-border-subtle)",
                boxShadow: "var(--pg-shadow-sm)",
              }}
            >
              <div className="aspect-video flex items-center justify-center"
                style={{ background: "var(--pg-bg-elevated)" }}>
                <Images className="w-10 h-10" style={{ color: "var(--pg-text-muted)" }} />
              </div>

              <div className="p-4">
                <Link
                  href={`/albums/${album.ID}`}
                  className="block text-sm font-medium truncate leading-snug transition-colors"
                  style={{ color: "var(--pg-text-primary)" }}
                >
                  {album.Name}
                </Link>
                {album.Description && (
                  <p className="text-xs mt-1 truncate" style={{ color: "var(--pg-text-tertiary)" }}>
                    {album.Description}
                  </p>
                )}
                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs" style={{ color: "var(--pg-text-muted)" }}>
                    {album.PhotoCount ?? 0} 张照片
                  </span>
                  <div className="flex items-center gap-2">
                    {album.ShareToken && (
                      <span className="text-xs px-1.5 py-0.5 rounded"
                        style={{ color: "var(--pg-success)", background: "rgba(16,185,129,0.1)" }}>
                        已分享
                      </span>
                    )}
                    <button
                      onClick={() => handleDelete(album.ID, album.Name)}
                      className="opacity-0 group-hover:opacity-100 transition-all"
                      style={{ color: "var(--pg-text-muted)" }}
                      title="删除相册"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
