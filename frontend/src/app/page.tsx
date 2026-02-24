"use client";

import { useEffect, useState, useCallback } from "react";
import PhotoGrid from "@/components/PhotoGrid";
import UploadPanel from "@/components/UploadPanel";
import { useAuth } from "@/context/AuthContext";
import { LayoutGrid, Columns, ChevronDown } from "lucide-react";

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
      .then((data: Photo[]) => setPhotos(data))
      .catch((err) => console.error("Failed to load photos:", err))
      .finally(() => setLoading(false));
  }, [authFetch]);

  useEffect(() => {
    if (!user) return;
    loadPhotos(sort);
  }, [user, sort, loadPhotos]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans p-8">
      <header className="mb-8 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Photogiraffe Gallery</h1>
          <p className="text-zinc-500 dark:text-zinc-400 mt-2">Your high-quality photo collection.</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <UploadPanel onUploadComplete={() => loadPhotos(sort)} />
        </div>
      </header>

      {/* Controls bar */}
      <div className="flex items-center gap-3 mb-6">
        {/* Sort selector */}
        <div className="relative">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
            className="appearance-none bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm rounded-lg pl-3 pr-8 py-2 cursor-pointer focus:outline-none focus:ring-1 focus:ring-zinc-500"
          >
            {(Object.keys(SORT_LABELS) as SortOption[]).map((k) => (
              <option key={k} value={k}>{SORT_LABELS[k]}</option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500" />
        </div>

        {/* Layout switcher */}
        <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
          <button
            onClick={() => setLayout("grid")}
            title="网格布局"
            className={`p-1.5 rounded transition-colors ${layout === "grid" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => setLayout("masonry")}
            title="瀑布流布局"
            className={`p-1.5 rounded transition-colors ${layout === "masonry" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
          >
            <Columns size={16} />
          </button>
        </div>
      </div>

      <main>
        <PhotoGrid photos={photos} loading={loading} layout={layout} />
      </main>
    </div>
  );
}

