"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import PhotoGrid from "@/components/PhotoGrid";
import UploadPanel from "@/components/UploadPanel";
import { useAuth } from "@/context/AuthContext";
import { Search, Filter, ChevronLeft, ChevronRight } from "lucide-react";

interface Photo {
  ID: number;
  OriginalFilename: string;
  MinioPath: string;
  Status: string;
  UploadedAt: string;
}

interface PhotosResponse {
  photos: Photo[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "completed", label: "Completed" },
  { value: "processing", label: "Processing" },
  { value: "failed", label: "Failed" },
];

const LIMIT = 20;

export default function Home() {
  const { authFetch, user } = useAuth();

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");

  // Debounce search input
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchInput(val);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setSearch(val);
      setPage(1);
    }, 400);
  };

  const fetchPhotos = useCallback(
    (p: number) => {
      if (!user) return;
      setLoading(true);
      const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);

      authFetch(`/api/photos?${params.toString()}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
        .then((data: PhotosResponse) => {
          setPhotos(data.photos ?? []);
          setTotal(data.total ?? 0);
          setTotalPages(data.total_pages ?? 0);
        })
        .catch((err) => console.error("Failed to load photos:", err))
        .finally(() => setLoading(false));
    },
    [user, authFetch, search, statusFilter]
  );

  useEffect(() => {
    fetchPhotos(page);
  }, [fetchPhotos, page]);

  // Reset to page 1 when filter/search changes
  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  const handleUploadComplete = () => {
    setPage(1);
    setSearch("");
    setSearchInput("");
    setStatusFilter("");
    fetchPhotos(1);
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <header className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Photogiraffe Gallery</h1>
            <p className="text-zinc-500 dark:text-zinc-400 mt-1 text-sm">
              {total > 0 ? `${total} photo${total !== 1 ? "s" : ""}` : "Your high-quality photo collection."}
            </p>
          </div>
          <UploadPanel onUploadComplete={handleUploadComplete} />
        </header>

        {/* Search & Filter Bar */}
        <div className="mb-6 flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              value={searchInput}
              onChange={handleSearchChange}
              placeholder="Search by filename…"
              className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700
                         bg-white dark:bg-zinc-900 text-sm
                         focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-500
                         placeholder-zinc-400"
            />
          </div>

          {/* Status Filter */}
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="pl-9 pr-8 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700
                         bg-white dark:bg-zinc-900 text-sm appearance-none
                         focus:outline-none focus:ring-2 focus:ring-zinc-400 dark:focus:ring-zinc-500
                         cursor-pointer min-w-[140px]"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Grid */}
        <main>
          <PhotoGrid photos={photos} loading={loading} />
        </main>

        {/* Empty state */}
        {!loading && photos.length === 0 && (
          <div className="text-center py-24 text-zinc-400 dark:text-zinc-500">
            {search || statusFilter
              ? "No photos match your search."
              : "No photos uploaded yet. Use the Upload button to get started."}
          </div>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="mt-10 flex items-center justify-between">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Page {page} of {totalPages} ({total} total)
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700
                           bg-white dark:bg-zinc-900 text-sm font-medium
                           disabled:opacity-40 disabled:cursor-not-allowed
                           hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                Prev
              </button>

              {/* Page number buttons (sliding window of 5) */}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                const pageNum = start + i;
                if (pageNum < 1 || pageNum > totalPages) return null;
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`w-9 h-9 rounded-xl border text-sm font-medium transition-colors
                      ${pageNum === page
                        ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-100"
                        : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      }`}
                  >
                    {pageNum}
                  </button>
                );
              })}

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex items-center gap-1 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700
                           bg-white dark:bg-zinc-900 text-sm font-medium
                           disabled:opacity-40 disabled:cursor-not-allowed
                           hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

