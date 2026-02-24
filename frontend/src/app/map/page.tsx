"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, MapPin, Loader2, ImageOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import AuthGuard from "@/components/AuthGuard";
import type { MapPhoto } from "@/components/PhotoMapLeaflet";

// Dynamic import — Leaflet requires browser APIs, disable SSR
const PhotoMapLeaflet = dynamic(
  () => import("@/components/PhotoMapLeaflet"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full text-zinc-500">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> 加载地图…
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
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 sm:px-6 py-4 border-b border-zinc-800">
          <Link
            href="/"
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft size={18} />
          </Link>
          <MapPin className="w-5 h-5 text-zinc-400" />
          <h1 className="text-lg font-semibold tracking-tight">照片地图</h1>
          {!loading && (
            <span className="text-sm text-zinc-500">
              {photos.length} 张有位置信息的照片
            </span>
          )}
        </div>

        {/* Map */}
        <div className="flex-1 relative" style={{ minHeight: "calc(100vh - 120px)" }}>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-500">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              <span>加载中…</span>
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center text-red-400">
              <p>{error}</p>
            </div>
          )}
          {!loading && !error && photos.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 gap-3">
              <ImageOff className="w-10 h-10" />
              <p className="text-sm">没有包含 GPS 信息的照片</p>
              <p className="text-xs text-zinc-600">请确认照片 EXIF 中包含地理位置数据</p>
            </div>
          )}
          {!loading && !error && photos.length > 0 && (
            <PhotoMapLeaflet photos={photos} />
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
