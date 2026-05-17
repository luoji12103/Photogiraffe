"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { Copy, Trash2, Loader2, CheckCircle2 } from "lucide-react";
import Image from "next/image";

interface Photo {
  ID: number;
  OriginalFilename: string;
  MinioPath: string;
  UploadedAt: string;
  FileSize: number;
  PHash: string | null;
}

interface DupGroup {
  photos: Photo[];
}

interface DuplicatesResponse {
  groups: DupGroup[];
  total_groups: number;
}

function thumbUrl(minioPath: string): string {
  const thumbPath = minioPath.replace("raw/", "thumb/").replace(/\.[^/.]+$/, ".webp");
  return `/api/image?path=${encodeURIComponent(thumbPath)}`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function DuplicatesPage() {
  const { authFetch } = useAuth();
  const [groups, setGroups] = useState<DupGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    authFetch("/api/photos/duplicates")
      .then((r) => (r.ok ? r.json() : { groups: [], total_groups: 0 }))
      .then((data: DuplicatesResponse) => setGroups(data.groups ?? []))
      .catch(() => setGroups([]))
      .finally(() => setLoading(false));
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (photoId: number) => {
    if (!confirm("确认删除该照片？此操作不可撤销。")) return;
    setDeletingId(photoId);
    try {
      const res = await authFetch(`/api/photos/${photoId}`, { method: "DELETE" });
      if (res.ok) {
        // Remove from groups, removing groups that become singletons
        setGroups((prev) =>
          prev
            .map((g) => ({ ...g, photos: g.photos.filter((p) => p.ID !== photoId) }))
            .filter((g) => g.photos.length >= 2)
        );
      }
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3 mb-8"
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: "var(--pg-accent-primary)20", color: "var(--pg-accent-primary)" }}
        >
          <Copy className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--pg-text-primary)" }}>
            重复照片
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "var(--pg-text-tertiary)" }}>
            基于感知哈希 (pHash) 检测的近似重复照片
          </p>
        </div>
        {!loading && (
          <span
            className="ml-auto text-sm font-medium px-3 py-1 rounded-full"
            style={{
              background: "var(--pg-bg-elevated)",
              color: "var(--pg-text-secondary)",
              border: "1px solid var(--pg-border-subtle)",
            }}
          >
            {groups.length} 组重复
          </span>
        )}
      </motion.div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--pg-text-tertiary)" }} />
        </div>
      )}

      {/* Empty state */}
      {!loading && groups.length === 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center justify-center py-24 gap-4"
        >
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: "#10b98120" }}
          >
            <CheckCircle2 className="w-8 h-8" style={{ color: "#10b981" }} />
          </div>
          <div className="text-center">
            <p className="text-lg font-medium" style={{ color: "var(--pg-text-primary)" }}>
              未发现重复照片
            </p>
            <p className="text-sm mt-1" style={{ color: "var(--pg-text-tertiary)" }}>
              所有照片均是唯一的，或尚未完成 pHash 计算
            </p>
          </div>
        </motion.div>
      )}

      {/* Duplicate groups */}
      <AnimatePresence>
        {groups.map((group, gi) => (
          <motion.div
            key={`group-${gi}`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ delay: gi * 0.04 }}
            className="mb-6 rounded-2xl overflow-hidden"
            style={{
              background: "var(--pg-bg-surface)",
              border: "1px solid var(--pg-border-subtle)",
              boxShadow: "var(--pg-shadow-sm)",
            }}
          >
            {/* Group header */}
            <div
              className="px-5 py-3 flex items-center justify-between"
              style={{
                borderBottom: "1px solid var(--pg-border-subtle)",
                background: "var(--pg-bg-elevated)",
              }}
            >
              <div className="flex items-center gap-2">
                <Copy className="w-4 h-4" style={{ color: "var(--pg-text-tertiary)" }} />
                <span className="text-sm font-medium" style={{ color: "var(--pg-text-primary)" }}>
                  重复组 #{gi + 1}
                </span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{
                    background: "var(--pg-accent-primary)20",
                    color: "var(--pg-accent-primary)",
                  }}
                >
                  {group.photos.length} 张
                </span>
              </div>
            </div>

            {/* Photo thumbnails */}
            <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {group.photos.map((photo) => (
                <motion.div
                  key={photo.ID}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="relative group rounded-xl overflow-hidden aspect-square"
                  style={{
                    background: "var(--pg-bg-base)",
                    border: "1px solid var(--pg-border-subtle)",
                  }}
                >
                  {/* Thumbnail */}
                  <Image
                    src={thumbUrl(photo.MinioPath)}
                    alt={photo.OriginalFilename}
                    fill
                    sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 20vw"
                    className="object-cover"
                    unoptimized
                  />

                  {/* Overlay on hover */}
                  <div
                    className="absolute inset-0 flex flex-col justify-between p-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: "rgba(0,0,0,0.6)" }}
                  >
                    <p
                      className="text-xs leading-tight line-clamp-2 select-none"
                      style={{ color: "rgba(255,255,255,0.9)" }}
                    >
                      {photo.OriginalFilename}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: "rgba(255,255,255,0.7)" }}>
                        {formatBytes(photo.FileSize)}
                      </span>
                      <button
                        onClick={() => handleDelete(photo.ID)}
                        disabled={deletingId === photo.ID}
                        className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-red-600"
                        style={{ background: "rgba(239,68,68,0.8)" }}
                        title="删除此照片"
                      >
                        {deletingId === photo.ID ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5 text-white" />
                        )}
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
