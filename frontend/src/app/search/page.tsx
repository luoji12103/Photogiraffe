"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, SlidersHorizontal, X, Camera, Aperture, Calendar, MapPin } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import Image from "next/image";

interface SearchPhoto {
  ID: number;
  OriginalFilename: string;
  MinioPath: string;
  Status: string;
  ExifData?: {
    CameraModel: string;
    LensModel: string;
    ISO: string;
    Aperture: string;
    ShutterSpeed: string;
    DateTimeOriginal: string;
    GPSLatitude: string;
    GPSLongitude: string;
  };
}

interface SearchResult {
  photos: SearchPhoto[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

const PROXY = "/api/image";

export default function SearchPage() {
  const { authFetch } = useAuth();
  const router = useRouter();

  const [q, setQ] = useState("");
  const [camera, setCamera] = useState("");
  const [lens, setLens] = useState("");
  const [isoMin, setIsoMin] = useState("");
  const [isoMax, setIsoMax] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [colorSpace, setColorSpace] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  const buildQuery = useCallback((p = 1) => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (camera.trim()) params.set("camera", camera.trim());
    if (lens.trim()) params.set("lens", lens.trim());
    if (isoMin.trim()) params.set("iso_min", isoMin.trim());
    if (isoMax.trim()) params.set("iso_max", isoMax.trim());
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    if (colorSpace.trim()) params.set("color_space", colorSpace.trim());
    params.set("page", String(p));
    params.set("limit", "24");
    return params.toString();
  }, [q, camera, lens, isoMin, isoMax, dateFrom, dateTo, colorSpace]);

  const doSearch = useCallback(async (p = 1) => {
    setLoading(true);
    setPage(p);
    try {
      const res = await authFetch(`/api/photos/search?${buildQuery(p)}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data);
      }
    } finally {
      setLoading(false);
    }
  }, [authFetch, buildQuery]);

  const clearFilters = () => {
    setCamera(""); setLens(""); setIsoMin(""); setIsoMax("");
    setDateFrom(""); setDateTo(""); setColorSpace("");
  };

  const hasFilters = camera || lens || isoMin || isoMax || dateFrom || dateTo || colorSpace;

  const inputStyle: React.CSSProperties = {
    background: "var(--pg-bg-surface)",
    border: "1px solid var(--pg-border)",
    color: "var(--pg-text-primary)",
    borderRadius: "var(--pg-radius-md)",
  };

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto" style={{ color: "var(--pg-text-primary)" }}>
      <h1 className="text-2xl font-light tracking-wide mb-6" style={{ color: "var(--pg-text-secondary)" }}>高级搜索</h1>

      {/* Search bar */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--pg-text-muted)" }} />
          <input
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === "Enter" && doSearch(1)}
            placeholder="搜索文件名 / 相机型号 / 镜头…"
            className="w-full pl-9 pr-4 py-2.5 text-sm placeholder-zinc-500 focus:outline-none"
            style={{ ...inputStyle, borderColor: undefined }}
          />
        </div>
        <button
          onClick={() => setShowFilters(v => !v)}
          className="flex items-center gap-2 px-4 py-2.5 text-sm transition-colors"
          style={{
            borderRadius: "var(--pg-radius-md)",
            border: "1px solid",
            borderColor: showFilters || hasFilters ? "var(--pg-accent)" : "var(--pg-border)",
            background: showFilters || hasFilters ? "color-mix(in srgb, var(--pg-accent) 10%, transparent)" : "var(--pg-bg-surface)",
            color: showFilters || hasFilters ? "var(--pg-accent)" : "var(--pg-text-secondary)",
          }}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span>筛选</span>
          {hasFilters && (
            <span className="text-white text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--pg-accent)" }}>
              {[camera, lens, isoMin, isoMax, dateFrom, dateTo, colorSpace].filter(Boolean).length}
            </span>
          )}
        </button>
        <button
          onClick={() => doSearch(1)}
          disabled={loading}
          className="px-5 py-2.5 disabled:opacity-50 text-white text-sm font-medium transition-colors"
          style={{ background: "var(--pg-accent)", borderRadius: "var(--pg-radius-md)" }}
        >
          {loading ? "…" : "搜索"}
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="mb-4 p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] text-zinc-500 uppercase tracking-wider">
                <Camera className="w-3 h-3" /> Camera
              </span>
              <input
                type="text" value={camera} onChange={e => setCamera(e.target.value)}
                placeholder="Sony A7RV…"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
              />
            </label>
            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] text-zinc-500 uppercase tracking-wider">
                <Aperture className="w-3 h-3" /> Lens
              </span>
              <input
                type="text" value={lens} onChange={e => setLens(e.target.value)}
                placeholder="85mm / FE 24-70…"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-zinc-500 uppercase tracking-wider">ISO Min</span>
              <input
                type="number" value={isoMin} onChange={e => setIsoMin(e.target.value)}
                placeholder="100"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-zinc-500 uppercase tracking-wider">ISO Max</span>
              <input
                type="number" value={isoMax} onChange={e => setIsoMax(e.target.value)}
                placeholder="6400"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
              />
            </label>
            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] text-zinc-500 uppercase tracking-wider">
                <Calendar className="w-3 h-3" /> Date From
              </span>
              <input
                type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
              />
            </label>
            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] text-zinc-500 uppercase tracking-wider">
                <Calendar className="w-3 h-3" /> Date To
              </span>
              <input
                type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
              />
            </label>
            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] text-zinc-500 uppercase tracking-wider">
                <MapPin className="w-3 h-3" /> Color Space
              </span>
              <input
                type="text" value={colorSpace} onChange={e => setColorSpace(e.target.value)}
                placeholder="sRGB / Adobe RGB…"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
              />
            </label>
          </div>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <X className="w-3 h-3" /> Clear all filters
            </button>
          )}
        </div>
      )}

      {/* Results */}
      {results && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-zinc-500">
              {results.total === 0 ? "No results" : `${results.total} photo${results.total !== 1 ? "s" : ""} found`}
            </p>
            {results.total_pages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => doSearch(page - 1)}
                  className="px-3 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded"
                >
                  ‹ Prev
                </button>
                <span className="text-xs text-zinc-500">{page} / {results.total_pages}</span>
                <button
                  disabled={page >= results.total_pages}
                  onClick={() => doSearch(page + 1)}
                  className="px-3 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded"
                >
                  Next ›
                </button>
              </div>
            )}
          </div>

          {results.photos.length === 0 ? (
            <div className="text-center py-16 text-zinc-600">
              <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No photos match your search criteria</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {results.photos.map(photo => (
                <div
                  key={photo.ID}
                  className="group relative aspect-square bg-zinc-900 rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500/50 transition-all"
                  onClick={() => router.push(`/photo/${photo.ID}`)}
                >
                  <img
                    src={`${PROXY}?path=${encodeURIComponent(photo.MinioPath.replace("raw/", "thumbnail/").replace(/\.[^.]+$/, ".webp"))}`}
                    alt={photo.OriginalFilename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                    <p className="text-[10px] text-white/90 truncate">{photo.OriginalFilename}</p>
                    {photo.ExifData?.CameraModel && (
                      <p className="text-[9px] text-white/60 truncate">{photo.ExifData.CameraModel}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!results && !loading && (
        <div className="text-center py-20 text-zinc-700">
          <Search className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <p className="text-sm">Enter a search term or apply filters to find photos</p>
        </div>
      )}
    </div>
  );
}
