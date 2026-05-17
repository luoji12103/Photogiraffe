"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, MapPin, Loader2, ImageOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import AuthGuard from "@/components/AuthGuard";
import type { MapPhoto } from "@/components/PhotoMapLeaflet";

const PhotoMapLeaflet = dynamic(
  () => import("@/components/PhotoMapLeaflet"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full" style={{ color: "var(--pg-text-muted)" }}>
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">加载地图…</span>
      </div>
    ),
  }
);

export default function MapPage() {
  const { authFetch } = useAuth();
  const [photos, setPhotos] = useState<MapPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    authFetch("/api/photos/map")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setPhotos(data);
        else setError(data.error || "获取数据失败");
      })
      .catch(() => setError("网络错误"))
      .finally(() => setLoading(false));
  }, [authFetch]);

  return (
    <AuthGuard>
      <div
        className="min-h-screen flex flex-col"
        style={{ background: "var(--pg-bg-base)", color: "var(--pg-text-primary)" }}
      >
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex items-center gap-3 px-4 sm:px-6 py-4"
          style={{ borderBottom: "1px solid var(--pg-border)", background: "var(--pg-bg-surface)" }}
        >
          <Link href="/" className="p-1.5 rounded-lg transition-colors" style={{ color: "var(--pg-text-tertiary)" }}>
            <ArrowLeft size={18} />
          </Link>
          <MapPin className="w-4 h-4" style={{ color: "var(--pg-accent)" }} />
          <h1 className="text-base font-semibold tracking-tight">照片地图</h1>
          {!loading && (
            <span className="text-sm ml-1" style={{ color: "var(--pg-text-muted)" }}>
              {photos.length} 张有位置信息的照片
            </span>
          )}
        </motion.div>

        <div className="flex-1 relative" style={{ minHeight: "calc(100vh - 64px)" }}>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center" style={{ color: "var(--pg-text-muted)" }}>
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              <span className="text-sm">加载中…</span>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: "var(--pg-error)" }}>
              {error}
            </div>
          )}
          {!loading && !error && photos.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3"
              style={{ color: "var(--pg-text-muted)" }}
            >
              <ImageOff className="w-10 h-10" />
              <p className="text-sm">没有包含 GPS 信息的照片</p>
              <p className="text-xs">请确认照片 EXIF 中包含地理位置数据</p>
            </motion.div>
          )}
          {!loading && !error && photos.length > 0 && (
            <PhotoMapLeaflet photos={photos} />
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
