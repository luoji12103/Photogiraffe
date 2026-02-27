"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/context/AuthContext";
import AuthGuard from "@/components/AuthGuard";
import { Loader2, Heart, ArrowLeft, ImageOff } from "lucide-react";

interface FavoritePhoto {
  ID: number;
  OriginalFilename: string;
  MinioPath: string;
  Status: string;
  UploadedAt: string;
  is_favorited: boolean;
}

export default function FavoritesPage() {
  const { authFetch } = useAuth();
  const [photos, setPhotos] = useState<FavoritePhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const LIMIT = 24;

  const loadPage = useCallback(
    (p: number) => {
      setLoading(true);
      authFetch(`/api/photos/favorites?page=${p}&limit=${LIMIT}`)
        .then((res) => (res.ok ? res.json() : { photos: [], total: 0, total_pages: 1 }))
        .then((data) => {
          setPhotos(data.photos ?? []);
          setTotal(data.total ?? 0);
          setTotalPages(data.total_pages ?? 1);
        })
        .finally(() => setLoading(false));
    },
    [authFetch]
  );

  useEffect(() => {
    loadPage(page);
  }, [page, loadPage]);

  const handleUnfavorite = async (photoId: number) => {
    await authFetch(`/api/photos/${photoId}/favorite`, { method: "DELETE" });
    setPhotos((prev) => prev.filter((p) => p.ID !== photoId));
    setTotal((prev) => Math.max(0, prev - 1));
  };

  return (
    <AuthGuard>
      <div className="min-h-screen font-sans" style={{ background: "var(--pg-bg-base)", color: "var(--pg-text-primary)" }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
          {/* Header */}
          <header className="mb-8 flex items-center gap-4">
            <Link
              href="/"
              className="p-2 rounded-lg transition-colors"
              style={{ color: "var(--pg-text-tertiary)" }}
            >
              <ArrowLeft size={20} />
            </Link>
            <div className="flex items-center gap-3">
              <Heart className="w-6 h-6" style={{ color: "var(--pg-accent)" }} />
              <div>
                <h1 className="text-2xl font-bold tracking-tight">我的收藏</h1>
                {!loading && (
                  <p className="text-sm mt-0.5" style={{ color: "var(--pg-text-tertiary)" }}>
                    共 {total} 张照片
                  </p>
                )}
              </div>
            </div>
          </header>

          {/* Content */}
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--pg-text-tertiary)" }} />
            </div>
          ) : photos.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <ImageOff className="w-12 h-12" style={{ color: "var(--pg-text-tertiary)" }} />
              <p style={{ color: "var(--pg-text-secondary)" }}>暂无收藏</p>
              <Link
                href="/"
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ background: "var(--pg-accent)", color: "#fff" }}
              >
                去浏览照片
              </Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {photos.map((photo) => {
                  const thumbPath = photo.MinioPath.replace("raw/", "thumb/").replace(/\.[^/.]+$/, ".webp");
                  const imageUrl = `/api/image?path=${encodeURIComponent(thumbPath)}`;
                  return (
                    <div
                      key={photo.ID}
                      className="group relative rounded-xl overflow-hidden"
                      style={{
                        aspectRatio: "1/1",
                        background: "var(--pg-bg-elevated)",
                        border: "1px solid var(--pg-border-subtle)",
                      }}
                    >
                      <Link href={`/photo/${photo.ID}`}>
                        <Image
                          src={imageUrl}
                          alt={photo.OriginalFilename}
                          fill
                          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
                          className="object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      </Link>
                      {/* Unfavorite button overlay */}
                      <button
                        onClick={() => handleUnfavorite(photo.ID)}
                        className="absolute top-2 right-2 p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200"
                        style={{ background: "rgba(0,0,0,0.6)" }}
                        title="取消收藏"
                      >
                        <Heart className="w-4 h-4 fill-rose-500 text-rose-500" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-8">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40 transition-colors"
                    style={{ background: "var(--pg-bg-elevated)", color: "var(--pg-text-primary)" }}
                  >
                    上一页
                  </button>
                  <span className="text-sm" style={{ color: "var(--pg-text-tertiary)" }}>
                    {page} / {totalPages}
                  </span>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40 transition-colors"
                    style={{ background: "var(--pg-bg-elevated)", color: "var(--pg-text-primary)" }}
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
