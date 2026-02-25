"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import PhotoGrid from "@/components/PhotoGrid";
import UploadPanel from "@/components/UploadPanel";
import { useAuth } from "@/context/AuthContext";
import { LayoutGrid, Columns, ChevronDown, ImagePlus, Camera } from "lucide-react";

interface Photo {
  ID: number;
  OriginalFilename: string;
  MinioPath: string;
  Status: string;
  UploadedAt: string;
}

type SortOption = "date_desc" | "date_asc" | "filename" | "camera" | "iso";
type LayoutOption = "grid" | "masonry";

const SORT_LABELS: Record<SortOption, string> = {
  date_desc: "最新上传",
  date_asc: "最早上传",
  filename: "文件名",
  camera: "相机型号",
  iso: "ISO 值",
};

/* ── Empty State ── */
function EmptyGallery({ onUpload }: { onUpload?: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="flex flex-col items-center justify-center py-24 px-6"
    >
      <div
        className="w-20 h-20 rounded-2xl flex items-center justify-center mb-6"
        style={{ background: "var(--pg-accent-soft)" }}
      >
        <Camera className="w-10 h-10" style={{ color: "var(--pg-accent)" }} />
      </div>
      <h2
        className="text-xl font-semibold mb-2"
        style={{ color: "var(--pg-text-primary)" }}
      >
        开始你的摄影之旅
      </h2>
      <p
        className="text-sm max-w-md text-center mb-6"
        style={{ color: "var(--pg-text-tertiary)" }}
      >
        上传你的第一张照片，支持 RAW（ARW/CR2/CR3/NEF）、HEIF、JPEG 等格式。
        系统会自动提取 EXIF 数据并生成缩略图。
      </p>
      <div className="flex items-center gap-3">
        <UploadPanel onUploadComplete={onUpload || (() => {})} />
      </div>
    </motion.div>
  );
}

export default function Home() {
  const { authFetch, user } = useAuth();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortOption>("date_desc");
  const [layout, setLayout] = useState<LayoutOption>("grid");

  const loadPhotos = useCallback((sortParam: SortOption) => {
    setLoading(true);
    authFetch(`/api/photos?sort=${sortParam}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data) => {
        const list: Photo[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.photos)
          ? data.photos
          : [];
        setPhotos(list);
      })
      .catch((err) => console.error("Failed to load photos:", err))
      .finally(() => setLoading(false));
  }, [authFetch]);

  useEffect(() => {
    if (!user) return;
    loadPhotos(sort);
  }, [user, sort, loadPhotos]);

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8" style={{ color: "var(--pg-text-primary)" }}>
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-6 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4"
      >
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            照片库
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--pg-text-tertiary)" }}>
            {loading ? "加载中…" : `${photos.length} 张照片`}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <UploadPanel onUploadComplete={() => loadPhotos(sort)} />
        </div>
      </motion.header>

      {/* Controls Bar */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="flex items-center gap-3 mb-6"
      >
        {/* Sort Selector */}
        <div className="relative">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="appearance-none text-sm rounded-lg pl-3 pr-8 py-2 cursor-pointer transition-colors focus:outline-none"
            style={{
              background: "var(--pg-bg-elevated)",
              border: "1px solid var(--pg-border)",
              color: "var(--pg-text-secondary)",
            }}
          >
            {(Object.keys(SORT_LABELS) as SortOption[]).map((k) => (
              <option key={k} value={k}>{SORT_LABELS[k]}</option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "var(--pg-text-muted)" }}
          />
        </div>

        {/* Layout Switcher */}
        <div
          className="flex gap-1 rounded-lg p-1"
          style={{ background: "var(--pg-bg-elevated)", border: "1px solid var(--pg-border)" }}
        >
          {([
            { key: "grid" as LayoutOption, icon: LayoutGrid, label: "网格布局" },
            { key: "masonry" as LayoutOption, icon: Columns, label: "瀑布流布局" },
          ]).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setLayout(key)}
              title={label}
              className="p-1.5 rounded-md transition-all duration-200"
              style={{
                background: layout === key ? "var(--pg-bg-surface)" : "transparent",
                color: layout === key ? "var(--pg-text-primary)" : "var(--pg-text-muted)",
                boxShadow: layout === key ? "var(--pg-shadow-sm)" : "none",
              }}
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
      </motion.div>

      {/* Content */}
      <main>
        {!loading && photos.length === 0 ? (
          <EmptyGallery onUpload={() => loadPhotos(sort)} />
        ) : (
          <PhotoGrid photos={photos} loading={loading} layout={layout} />
        )}
      </main>
    </div>
  );
}

