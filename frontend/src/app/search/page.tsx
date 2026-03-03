"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Search, SlidersHorizontal, X, Camera, Aperture, Calendar, MapPin,
  Bookmark, BookmarkPlus, Trash2, ZoomIn, Heart, MapPinned, Star, Tags,
  Pencil, Merge, AlertCircle,
} from "lucide-react";
import { useEffect as _ue } from "react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";

interface SearchPhoto {
  ID: number;
  OriginalFilename: string;
  MinioPath: string;
  ThumbnailURL?: string;
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

interface SavedSearch {
  ID: number;
  Name: string;
  Params: string;
}

interface TagSuggestion {
  tag: string;
  count: number;
}

const PROXY = "/api/image";

export default function SearchPage() {
  const { authFetch } = useAuth();
  const { addToast } = useToast();
  const router = useRouter();

  // Core search
  const [q, setQ] = useState("");
  const [camera, setCamera] = useState("");
  const [lens, setLens] = useState("");
  const [isoMin, setIsoMin] = useState("");
  const [isoMax, setIsoMax] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [colorSpace, setColorSpace] = useState("");
  // Phase 29 — new filters
  const [focalMin, setFocalMin] = useState("");
  const [focalMax, setFocalMax] = useState("");
  const [hasGPS, setHasGPS] = useState("");   // ""|"true"|"false"
  const [isFavorited, setIsFavorited] = useState(false);
  // Phase 31 — rating & color label filters
  const [ratingMin, setRatingMin] = useState("");
  const [colorLabelFilter, setColorLabelFilter] = useState("");
  // Phase 32 — tag management
  const [showTagMgmt, setShowTagMgmt] = useState(false);
  const [tagList, setTagList] = useState<{ tag: string; count: number }[]>([]);
  const [tagListLoading, setTagListLoading] = useState(false);
  const [tagRenameOld, setTagRenameOld] = useState("");
  const [tagRenameNew, setTagRenameNew] = useState("");
  const [tagMergeSrc, setTagMergeSrc] = useState("");
  const [tagMergeDst, setTagMergeDst] = useState("");
  const [tagOpLoading, setTagOpLoading] = useState(false);

  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  // Saved searches
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [saveNameInput, setSaveNameInput] = useState("");
  const [savingSearch, setSavingSearch] = useState(false);

  // Tag autocomplete
  const [tagSuggestions, setTagSuggestions] = useState<TagSuggestion[]>([]);
  const tagDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSavedSearches = useCallback(async () => {
    try {
      const res = await authFetch("/api/saved-searches");
      if (res.ok) setSavedSearches(await res.json());
    } catch { /* ignore */ }
  }, [authFetch]);

  useEffect(() => { fetchSavedSearches(); }, [fetchSavedSearches]);

  const handleQChange = (val: string) => {
    setQ(val);
    if (tagDebounceRef.current) clearTimeout(tagDebounceRef.current);
    if (val.trim().length >= 1) {
      tagDebounceRef.current = setTimeout(async () => {
        try {
          const res = await authFetch(`/api/photos/tags/autocomplete?q=${encodeURIComponent(val.trim())}`);
          if (res.ok) setTagSuggestions(await res.json());
        } catch { /* ignore */ }
      }, 300);
    } else {
      setTagSuggestions([]);
    }
  };

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
    if (focalMin.trim()) params.set("focal_min", focalMin.trim());
    if (focalMax.trim()) params.set("focal_max", focalMax.trim());
    if (hasGPS) params.set("has_gps", hasGPS);
    if (isFavorited) params.set("is_favorited", "true");
    if (ratingMin) params.set("rating_min", ratingMin);
    if (colorLabelFilter) params.set("color_label", colorLabelFilter);
    params.set("page", String(p));
    params.set("limit", "24");
    return params.toString();
  }, [q, camera, lens, isoMin, isoMax, dateFrom, dateTo, colorSpace, focalMin, focalMax, hasGPS, isFavorited, ratingMin, colorLabelFilter]);

  const doSearch = useCallback(async (p = 1) => {
    setLoading(true);
    setPage(p);
    setTagSuggestions([]);
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
    setFocalMin(""); setFocalMax(""); setHasGPS(""); setIsFavorited(false);
    setRatingMin(""); setColorLabelFilter("");
  };

  const fetchTagList = async () => {
    setTagListLoading(true);
    try {
      const res = await authFetch("/api/tags");
      if (res.ok) setTagList(await res.json());
    } finally {
      setTagListLoading(false);
    }
  };

  const handleTagRename = async () => {
    if (!tagRenameOld || !tagRenameNew) return;
    setTagOpLoading(true);
    try {
      await authFetch("/api/tags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ old_name: tagRenameOld, new_name: tagRenameNew }),
      });
      addToast({ type: "success", title: `标签已重命名: ${tagRenameOld} → ${tagRenameNew}` });
      setTagRenameOld(""); setTagRenameNew("");
      fetchTagList();
    } finally {
      setTagOpLoading(false);
    }
  };

  const handleTagMerge = async () => {
    if (!tagMergeSrc || !tagMergeDst) return;
    setTagOpLoading(true);
    try {
      await authFetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: tagMergeSrc, target: tagMergeDst }),
      });
      addToast({ type: "success", title: `标签已合并: ${tagMergeSrc} → ${tagMergeDst}` });
      setTagMergeSrc(""); setTagMergeDst("");
      fetchTagList();
    } finally {
      setTagOpLoading(false);
    }
  };

  const handleTagDelete = async (tagName: string) => {
    if (!confirm(`确定删除标签「${tagName}」吗？此操作不可撤销。`)) return;
    setTagOpLoading(true);
    try {
      await authFetch(`/api/tags/${encodeURIComponent(tagName)}`, { method: "DELETE" });
      addToast({ type: "success", title: `标签已删除: ${tagName}` });
      fetchTagList();
    } finally {
      setTagOpLoading(false);
    }
  };

  const hasFilters = camera || lens || isoMin || isoMax || dateFrom || dateTo || colorSpace ||
    focalMin || focalMax || hasGPS || isFavorited || ratingMin || colorLabelFilter;

  const saveSearch = async () => {
    if (!saveNameInput.trim()) {
      addToast({ type: "error", title: "请输入搜索名称" });
      return;
    }
    setSavingSearch(true);
    try {
      const res = await authFetch("/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: saveNameInput.trim(), params: buildQuery() }),
      });
      if (res.ok) {
        addToast({ type: "success", title: "搜索已保存" });
        setSaveNameInput("");
        fetchSavedSearches();
      }
    } finally {
      setSavingSearch(false);
    }
  };

  const deleteSavedSearch = async (id: number) => {
    await authFetch(`/api/saved-searches/${id}`, { method: "DELETE" });
    fetchSavedSearches();
  };

  const loadSavedSearch = (ss: SavedSearch) => {
    const params = new URLSearchParams(ss.Params);
    setQ(params.get("q") ?? "");
    setCamera(params.get("camera") ?? "");
    setLens(params.get("lens") ?? "");
    setIsoMin(params.get("iso_min") ?? "");
    setIsoMax(params.get("iso_max") ?? "");
    setDateFrom(params.get("date_from") ?? "");
    setDateTo(params.get("date_to") ?? "");
    setColorSpace(params.get("color_space") ?? "");
    setFocalMin(params.get("focal_min") ?? "");
    setFocalMax(params.get("focal_max") ?? "");
    setHasGPS(params.get("has_gps") ?? "");
    setIsFavorited(params.get("is_favorited") === "true");
    setRatingMin(params.get("rating_min") ?? "");
    setColorLabelFilter(params.get("color_label") ?? "");
    setShowSaved(false);
    setShowFilters(true);
  };

  const inputCls =
    "w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500";

  return (
    <div className="px-6 py-8 max-w-7xl mx-auto" style={{ color: "var(--pg-text-primary)" }}>
      <h1 className="text-2xl font-light tracking-wide mb-6" style={{ color: "var(--pg-text-secondary)" }}>
        高级搜索
      </h1>

      {/* Search bar */}
      <div className="flex gap-2 mb-4 relative">
        <div className="flex-1 relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
            style={{ color: "var(--pg-text-muted)" }}
          />
          <input
            type="text"
            value={q}
            onChange={(e) => handleQChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch(1)}
            placeholder="搜索文件名 / 相机型号 / 镜头…"
            className="w-full pl-9 pr-4 py-2.5 text-sm placeholder-zinc-500 focus:outline-none"
            style={{
              background: "var(--pg-bg-surface)",
              border: "1px solid var(--pg-border)",
              color: "var(--pg-text-primary)",
              borderRadius: "var(--pg-radius-md)",
            }}
          />
          {/* Tag autocomplete dropdown */}
          {tagSuggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden">
              {tagSuggestions.map((t) => (
                <button
                  key={t.tag}
                  onClick={() => { setQ(t.tag); setTagSuggestions([]); }}
                  className="w-full flex items-center justify-between px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  <span>{t.tag.trim().replace(/"/g, "")}</span>
                  <span className="text-xs text-zinc-600">{t.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className="flex items-center gap-2 px-4 py-2.5 text-sm transition-colors"
          style={{
            borderRadius: "var(--pg-radius-md)",
            border: "1px solid",
            borderColor: showFilters || hasFilters ? "var(--pg-accent)" : "var(--pg-border)",
            background:
              showFilters || hasFilters
                ? "color-mix(in srgb, var(--pg-accent) 10%, transparent)"
                : "var(--pg-bg-surface)",
            color:
              showFilters || hasFilters ? "var(--pg-accent)" : "var(--pg-text-secondary)",
          }}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="hidden sm:inline">筛选</span>
          {hasFilters && (
            <span className="text-white text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--pg-accent)" }}>
              {[camera, lens, isoMin, isoMax, dateFrom, dateTo, colorSpace, focalMin, focalMax, hasGPS, isFavorited ? "1" : ""].filter(Boolean).length}
            </span>
          )}
        </button>
        <button
          onClick={() => setShowSaved((v) => !v)}
          className="flex items-center gap-2 px-3 py-2.5 text-sm transition-colors"
          style={{
            borderRadius: "var(--pg-radius-md)",
            border: "1px solid var(--pg-border)",
            background: showSaved ? "color-mix(in srgb, var(--pg-accent) 10%, transparent)" : "var(--pg-bg-surface)",
            color: showSaved ? "var(--pg-accent)" : "var(--pg-text-secondary)",
          }}
        >
          <Bookmark className="w-4 h-4" />
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

      {/* Saved searches panel */}
      {showSaved && (
        <div className="mb-4 p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-1.5">
              <Bookmark className="w-4 h-4" /> 保存的搜索
            </h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={saveNameInput}
                onChange={(e) => setSaveNameInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveSearch()}
                placeholder="保存当前搜索…"
                className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={saveSearch}
                disabled={savingSearch}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded"
              >
                <BookmarkPlus className="w-3 h-3" />
                保存
              </button>
            </div>
          </div>
          {savedSearches.length === 0 ? (
            <p className="text-xs text-zinc-600">暂无保存的搜索</p>
          ) : (
            <div className="space-y-1">
              {savedSearches.map((ss) => (
                <div
                  key={ss.ID}
                  className="flex items-center justify-between px-3 py-2 bg-zinc-800/60 hover:bg-zinc-800 rounded transition-colors"
                >
                  <button
                    onClick={() => loadSavedSearch(ss)}
                    className="flex-1 text-left text-sm text-zinc-300 hover:text-white transition-colors"
                  >
                    {ss.Name}
                  </button>
                  <button
                    onClick={() => deleteSavedSearch(ss.ID)}
                    className="p-1 text-zinc-600 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filter panel */}
      {showFilters && (
        <div className="mb-4 p-4 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] text-zinc-500 uppercase tracking-wider">
                <Camera className="w-3 h-3" /> Camera
              </span>
              <input
                type="text" value={camera} onChange={(e) => setCamera(e.target.value)}
                placeholder="Sony A7RV…" className={inputCls}
              />
            </label>
            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] text-zinc-500 uppercase tracking-wider">
                <Aperture className="w-3 h-3" /> Lens
              </span>
              <input
                type="text" value={lens} onChange={(e) => setLens(e.target.value)}
                placeholder="85mm / FE 24-70…" className={inputCls}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-zinc-500 uppercase tracking-wider">ISO Min</span>
              <input
                type="number" value={isoMin} onChange={(e) => setIsoMin(e.target.value)}
                placeholder="100" className={inputCls}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-zinc-500 uppercase tracking-wider">ISO Max</span>
              <input
                type="number" value={isoMax} onChange={(e) => setIsoMax(e.target.value)}
                placeholder="6400" className={inputCls}
              />
            </label>
            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] text-zinc-500 uppercase tracking-wider">
                <ZoomIn className="w-3 h-3" /> 焦距 Min (mm)
              </span>
              <input
                type="number" value={focalMin} onChange={(e) => setFocalMin(e.target.value)}
                placeholder="24" className={inputCls}
              />
            </label>
            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] text-zinc-500 uppercase tracking-wider">
                <ZoomIn className="w-3 h-3" /> 焦距 Max (mm)
              </span>
              <input
                type="number" value={focalMax} onChange={(e) => setFocalMax(e.target.value)}
                placeholder="200" className={inputCls}
              />
            </label>
            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] text-zinc-500 uppercase tracking-wider">
                <Calendar className="w-3 h-3" /> Date From
              </span>
              <input
                type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] text-zinc-500 uppercase tracking-wider">
                <Calendar className="w-3 h-3" /> Date To
              </span>
              <input
                type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] text-zinc-500 uppercase tracking-wider">
                <MapPin className="w-3 h-3" /> Color Space
              </span>
              <input
                type="text" value={colorSpace} onChange={(e) => setColorSpace(e.target.value)}
                placeholder="sRGB / Adobe RGB…" className={inputCls}
              />
            </label>
            <div className="space-y-1">
              <span className="flex items-center gap-1 text-[11px] text-zinc-500 uppercase tracking-wider">
                <MapPinned className="w-3 h-3" /> GPS
              </span>
              <select
                value={hasGPS}
                onChange={(e) => setHasGPS(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
              >
                <option value="">全部</option>
                <option value="true">有 GPS</option>
                <option value="false">无 GPS</option>
              </select>
            </div>
            <div className="space-y-1 flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isFavorited}
                  onChange={(e) => setIsFavorited(e.target.checked)}
                  className="rounded border-zinc-600"
                />
                <span className="flex items-center gap-1 text-xs text-zinc-300">
                  <Heart className="w-3 h-3 text-red-400" /> 仅收藏
                </span>
              </label>
            </div>
          </div>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <X className="w-3 h-3" /> 清除所有筛选
            </button>
          )}
        </div>
      )}

      {/* Results */}
      {results && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-zinc-500">
              {results.total === 0 ? "无结果" : `找到 ${results.total} 张照片`}
            </p>
            {results.total_pages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => doSearch(page - 1)}
                  className="px-3 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded"
                >
                  ‹ 上一页
                </button>
                <span className="text-xs text-zinc-500">
                  {page} / {results.total_pages}
                </span>
                <button
                  disabled={page >= results.total_pages}
                  onClick={() => doSearch(page + 1)}
                  className="px-3 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded"
                >
                  下一页 ›
                </button>
              </div>
            )}
          </div>

          {results.photos.length === 0 ? (
            <div className="text-center py-16 text-zinc-600">
              <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm">没有符合条件的照片</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {results.photos.map((photo) => (
                <div
                  key={photo.ID}
                  className="group relative aspect-square bg-zinc-900 rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500/50 transition-all"
                  onClick={() => router.push(`/photo/${photo.ID}`)}
                >
                  <img
                    src={
                      photo.ThumbnailURL ||
                      `${PROXY}?path=${encodeURIComponent(
                        photo.MinioPath.replace("raw/", "thumbnail/").replace(/\.[^.]+$/, ".webp")
                      )}`
                    }
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
          <p className="text-sm">输入搜索词或使用筛选条件查找照片</p>
        </div>
      )}
    </div>
  );
}
