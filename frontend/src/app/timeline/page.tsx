"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/context/AuthContext";
import AuthGuard from "@/components/AuthGuard";
import { Loader2, CalendarDays, ArrowLeft } from "lucide-react";

interface TimelinePhoto {
  id: number;
  original_filename: string;
  thumbnail_url: string;
  shot_at: string;
  uploaded_at: string;
}

interface MonthGroup {
  year_month: string; // "2024-03"
  photos: TimelinePhoto[];
}

function formatYearMonth(ym: string): string {
  const [year, month] = ym.split("-");
  const months = ["一月","二月","三月","四月","五月","六月","七月","八月","九月","十月","十一月","十二月"];
  const m = parseInt(month, 10);
  return `${year} 年 ${months[m - 1] || month} 月`;
}

export default function TimelinePage() {
  const { authFetch } = useAuth();
  const [groups, setGroups] = useState<MonthGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authFetch("/api/photos/timeline")
      .then(res => res.ok ? res.json() : [])
      .then(data => setGroups(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, [authFetch]);

  const totalPhotos = groups.reduce((sum, g) => sum + g.photos.length, 0);

  return (
    <AuthGuard>
      <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
        <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8">
          <header className="mb-8 flex items-center gap-4">
            <Link href="/" className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                <CalendarDays className="w-8 h-8 text-blue-400" />
                时间轴
              </h1>
              <p className="text-zinc-500 mt-1 text-sm">
                {loading ? "加载中…" : `共 ${totalPhotos} 张照片 · ${groups.length} 个月份`}
              </p>
            </div>
          </header>

          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
            </div>
          ) : groups.length === 0 ? (
            <div className="text-center py-24 text-zinc-600">
              <CalendarDays className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p>尚无照片。</p>
            </div>
          ) : (
            <div className="space-y-12">
              {groups.map(group => (
                <section key={group.year_month}>
                  {/* Month header with timeline line */}
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-3 h-3 rounded-full bg-blue-400 shrink-0" />
                    <h2 className="text-lg font-semibold text-zinc-200">
                      {formatYearMonth(group.year_month)}
                    </h2>
                    <span className="text-xs text-zinc-600 bg-zinc-800 px-2 py-0.5 rounded-full">
                      {group.photos.length} 张
                    </span>
                    <div className="flex-1 h-px bg-zinc-800" />
                  </div>

                  {/* Photo grid */}
                  <div className="ml-7 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                    {group.photos.map(photo => (
                      <Link
                        key={photo.id}
                        href={`/photo/${photo.id}`}
                        className="group relative aspect-square overflow-hidden rounded-lg bg-zinc-800 hover:ring-2 hover:ring-blue-500 transition-all"
                        title={photo.original_filename}
                      >
                        <Image
                          src={photo.thumbnail_url}
                          alt={photo.original_filename}
                          fill
                          className="object-cover group-hover:scale-105 transition-transform duration-300"
                          sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw"
                          unoptimized
                        />
                        {/* Overlay with date */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                          <p className="absolute bottom-1.5 left-2 text-[10px] text-white truncate max-w-[90%]">
                            {photo.shot_at
                              ? new Date(photo.shot_at).toLocaleDateString()
                              : new Date(photo.uploaded_at).toLocaleDateString()}
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
