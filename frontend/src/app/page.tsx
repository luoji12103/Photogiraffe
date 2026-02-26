"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import PhotoGrid from "@/components/PhotoGrid";
import UploadPanel from "@/components/UploadPanel";
import { useAuth } from "@/context/AuthContext";
import { LayoutGrid, Columns, ChevronDown, Camera, Loader2 } from "lucide-react";

const PAGE_LIMIT = 24;
const SCROLL_KEY = "pg-gallery-scroll";

interface Photo {
  ID: number;
  OriginalFilename: string;
  MinioPath: string;
  Status: string;
  UploadedAt: string;
  DominantColors?: string | null;
}

type SortOption = "date_desc" | "date_asc" | "filename" | "camera" | "iso";
type LayoutOption = "grid" | "masonry";
type ColorBucket = "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "purple" | "pink" | "white" | "gray" | "black";

const SORT_LABELS: Record<SortOption, string> = {
  date_desc: "最新上传",
  date_asc:  "最早上传",
  filename:  "文件名",
  camera:    "相机型号",
  iso:       "ISO 值",
};

const COLOR_BUCKETS: { key: ColorBucket; hex: string; label: string }[] = [
  { key: "red",    hex: "#e53e3e", label: "红" },
  { key: "orange", hex: "#dd6b20", label: "橙" },
  { key: "yellow", hex: "#d69e2e", label: "黄" },
  { key: "green",  hex: "#38a169", label: "绿" },
  { key: "teal",   hex: "#319795", label: "青" },
  { key: "blue",   hex: "#3182ce", label: "蓝" },
  { key: "purple", hex: "#805ad5", label: "紫" },
  { key: "pink",   hex: "#d53f8c", label: "粉" },
  { key: "white",  hex: "#e2e8f0", label: "白" },
  { key: "gray",   hex: "#718096", label: "灰" },
  { key: "black",  hex: "#2d3748", label: "黑" },
];

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
      <h2 className="text-xl font-semibold mb-2" style={{ color: "var(--pg-text-primary)" }}>
        开始你的摄影之旅
      </h2>
      <p className="text-sm max-w-md text-center mb-6" style={{ color: "var(--pg-text-tertiary)" }}>
        上传你的第一张照片，支持 RAW（ARW/CR2/CR3/NEF）、HEIF、JPEG 等格式。
        系统会自动提取 EXIF 数据并生成缩略图。
      </p>
      <UploadPanel onUploadComplete={onUpload || (() => {})} />
    </motion.div>
  );
}

export default function Home() {
  const { authFetch, user } = useAuth();

  const [photos, setPhotos]         = useState<Photo[]>([]);
  const [loading, setLoading]       = useState(true);    // first-page load
  const [loadingMore, setLoadingMore] = useState(false); // subsequent pages
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages]   = useState(1);
  const [total, setTotal]             = useState(0);
  const [hasMore, setHasMore]         = useState(false);
  const [sort, setSort]             = useState<SortOption>("date_desc");
  const [layout, setLayout]         = useState<LayoutOption>("grid");
  const [colorBucket, setColorBucket] = useState<ColorBucket | "">("");

  // Ref for the IntersectionObserver sentinel
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Prevent duplicate fetches
  const fetchingRef = useRef(false);

  /* ── Fetch a specific page, optionally appending ── */
  const fetchPage = useCallback(
    async (page: number, sortParam: SortOption, append: boolean, bucket = "") => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;

      if (append) setLoadingMore(true);
      else        setLoading(true);

      try {
        const colorParam = bucket ? `&color_bucket=${encodeURIComponent(bucket)}` : "";
        const res = await authFetch(
          `/api/photos?sort=${sortParam}&page=${page}&limit=${PAGE_LIMIT}${colorParam}`
        );
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();

        const list: Photo[] = Array.isArray(data?.photos) ? data.photos : [];
        const tp: number    = data?.total_pages ?? 1;
        const tot: number   = data?.total       ?? list.length;

        setPhotos((prev) => append ? [...prev, ...list] : list);
        setCurrentPage(page);
        setTotalPages(tp);
        setTotal(tot);
        setHasMore(page < tp);
      } catch (err) {
        console.error("Failed to load photos:", err);
      } finally {
        fetchingRef.current = false;
        if (append) setLoadingMore(false);
        else        setLoading(false);
      }
    },
    [authFetch]
  );

  /* ── Initial load / sort change / colour filter change → reset to page 1 ── */
  useEffect(() => {
    if (!user) return;
    setPhotos([]);
    setCurrentPage(1);
    setHasMore(false);
    fetchPage(1, sort, false, colorBucket);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, sort, colorBucket]);

  /* ── Restore scroll position after initial render ── */
  useEffect(() => {
    if (loading) return;
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved) {
      window.scrollTo({ top: parseInt(saved, 10), behavior: "instant" });
      sessionStorage.removeItem(SCROLL_KEY);
    }
  }, [loading]);

  /* ── Save scroll position on unmount (SPA navigation) and page close ── */
  useEffect(() => {
    const save = () => sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
    window.addEventListener("beforeunload", save);
    return () => {
      save();                                          // save on component unmount
      window.removeEventListener("beforeunload", save);
    };
  }, []);

  /* ── IntersectionObserver: load next page when sentinel enters viewport ── */
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !fetchingRef.current) {
          fetchPage(currentPage + 1, sort, true, colorBucket);
        }
      },
      { rootMargin: "200px" } // trigger 200px before bottom
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, currentPage, sort, colorBucket, fetchPage]);

  /* ── Layout preference persistence ── */
  useEffect(() => {
    const stored = localStorage.getItem("pg-gallery-layout") as LayoutOption | null;
    if (stored && (stored === "grid" || stored === "masonry")) setLayout(stored);
  }, []);

  const handleLayoutChange = (l: LayoutOption) => {
    setLayout(l);
    localStorage.setItem("pg-gallery-layout", l);
  };

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
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">照片库</h1>
          <p className="text-sm mt-1" style={{ color: "var(--pg-text-tertiary)" }}>
            {loading
              ? "加载中…"
              : total > 0
              ? `共 ${total} 张 · 已加载 ${photos.length} 张`
              : "暂无照片"}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <UploadPanel onUploadComplete={() => { setPhotos([]); fetchPage(1, sort, false); }} />
        </div>
      </motion.header>

      {/* Controls Bar */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="flex flex-col gap-3 mb-6"
      >
        {/* Colour bucket filter row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs shrink-0" style={{ color: "var(--pg-text-muted)" }}>主色调</span>
          {colorBucket && (
            <button
              onClick={() => setColorBucket("")}
              className="text-xs px-2 py-0.5 rounded-full transition-colors"
              style={{
                background: "var(--pg-accent-soft)",
                color: "var(--pg-accent)",
                border: "1px solid var(--pg-accent)",
              }}
            >
              × 清除
            </button>
          )}
          {COLOR_BUCKETS.map(({ key, hex, label }) => (
            <button
              key={key}
              title={label}
              onClick={() => setColorBucket(colorBucket === key ? "" : key)}
              className="w-6 h-6 rounded-full transition-all duration-200 shrink-0"
              style={{
                background: hex,
                border: colorBucket === key
                  ? "2.5px solid var(--pg-text-primary)"
                  : "2px solid var(--pg-border)",
                transform: colorBucket === key ? "scale(1.25)" : "scale(1)",
                boxShadow: key === "white" ? "inset 0 0 0 1px var(--pg-border)" : undefined,
              }}
            />
          ))}
        </div>

        {/* Sort + Layout row */}
        <div className="flex items-center gap-3">
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
            { key: "grid"    as LayoutOption, icon: LayoutGrid, label: "网格布局" },
            { key: "masonry" as LayoutOption, icon: Columns,    label: "瀑布流布局" },
          ]).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => handleLayoutChange(key)}
              title={label}
              className="p-1.5 rounded-md transition-all duration-200"
              style={{
                background:  layout === key ? "var(--pg-bg-surface)" : "transparent",
                color:       layout === key ? "var(--pg-text-primary)" : "var(--pg-text-muted)",
                boxShadow:   layout === key ? "var(--pg-shadow-sm)" : "none",
              }}
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
        </div>  {/* end Sort+Layout row */}
      </motion.div>

      {/* Content */}
      <main>
        {!loading && photos.length === 0 ? (
          <EmptyGallery onUpload={() => { setPhotos([]); fetchPage(1, sort, false); }} />
        ) : (
          <>
            <PhotoGrid photos={photos} loading={loading} layout={layout} />

            {/* Sentinel + loading-more indicator */}
            <div ref={sentinelRef} className="h-12 flex items-center justify-center mt-4">
              {loadingMore && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center gap-2 text-sm"
                  style={{ color: "var(--pg-text-muted)" }}
                >
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>加载更多…</span>
                </motion.div>
              )}
              {!hasMore && !loading && photos.length > 0 && (
                <p className="text-xs" style={{ color: "var(--pg-text-muted)" }}>
                  — 已加载全部 {total} 张照片 —
                </p>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

