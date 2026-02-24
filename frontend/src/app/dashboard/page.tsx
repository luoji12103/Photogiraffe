"use client";

import { useState, useEffect } from "react";
import {
  Image as ImageIcon, Star, Brain, Images, Bookmark,
  Camera, Aperture, Palette, TrendingUp, Loader2,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";

interface Stats {
  total_photos: number;
  completed_photos: number;
  ai_analyzed: number;
  albums: number;
  presets: number;
  recent_uploads: { date: string; count: number }[];
  top_cameras: { name: string; count: number }[];
  top_lenses: { name: string; count: number }[];
  color_spaces: { name: string; count: number }[];
}

function StatCard({
  icon: Icon, label, value, color,
}: { icon: React.ElementType; label: string; value: number; color: string }) {
  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <p className="text-2xl font-semibold text-zinc-100">{value.toLocaleString()}</p>
        <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function BarChart({ data }: { data: { name: string; count: number }[] }) {
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="space-y-2">
      {data.slice(0, 8).map(item => (
        <div key={item.name} className="flex items-center gap-2">
          <span className="text-xs text-zinc-400 w-36 truncate shrink-0" title={item.name}>
            {item.name || "Unknown"}
          </span>
          <div className="flex-1 bg-zinc-800 rounded-full h-2 overflow-hidden">
            <div
              className="h-2 rounded-full bg-blue-500 transition-all duration-500"
              style={{ width: `${(item.count / max) * 100}%` }}
            />
          </div>
          <span className="text-xs text-zinc-500 w-6 text-right">{item.count}</span>
        </div>
      ))}
    </div>
  );
}

function MiniBarChart({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="flex items-end gap-1 h-16">
      {data.map(d => (
        <div key={d.date} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}: ${d.count}`}>
          <div
            className="w-full bg-blue-500/70 rounded-sm transition-all duration-500"
            style={{ height: `${Math.max((d.count / max) * 52, 2)}px` }}
          />
          <span className="text-[8px] text-zinc-600 rotate-45 origin-left">{d.date.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { authFetch } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authFetch("/api/stats")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setStats(data); })
      .finally(() => setLoading(false));
  }, [authFetch]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-500 flex items-center justify-center">
        Failed to load statistics.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white px-6 py-8 max-w-7xl mx-auto space-y-8">
      <h1 className="text-2xl font-light tracking-wide text-zinc-200">Dashboard</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard icon={ImageIcon} label="Total Photos" value={stats.total_photos} color="bg-blue-600/80" />
        <StatCard icon={Star} label="Processed" value={stats.completed_photos} color="bg-emerald-600/80" />
        <StatCard icon={Brain} label="AI Analyzed" value={stats.ai_analyzed} color="bg-violet-600/80" />
        <StatCard icon={Images} label="Albums" value={stats.albums} color="bg-amber-600/80" />
        <StatCard icon={Bookmark} label="Presets" value={stats.presets} color="bg-sky-600/80" />
      </div>

      {/* Upload trend */}
      {stats.recent_uploads.length > 0 && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-medium text-zinc-300">Upload Trend (14 days)</h2>
          </div>
          <MiniBarChart data={stats.recent_uploads} />
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        {/* Top cameras */}
        {stats.top_cameras.length > 0 && (
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Camera className="w-4 h-4 text-blue-400" />
              <h2 className="text-sm font-medium text-zinc-300">Top Cameras</h2>
            </div>
            <BarChart data={stats.top_cameras} />
          </div>
        )}

        {/* Top lenses */}
        {stats.top_lenses.length > 0 && (
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Aperture className="w-4 h-4 text-blue-400" />
              <h2 className="text-sm font-medium text-zinc-300">Top Lenses</h2>
            </div>
            <BarChart data={stats.top_lenses} />
          </div>
        )}

        {/* Color spaces */}
        {stats.color_spaces.length > 0 && (
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Palette className="w-4 h-4 text-blue-400" />
              <h2 className="text-sm font-medium text-zinc-300">Color Spaces</h2>
            </div>
            <BarChart data={stats.color_spaces} />
          </div>
        )}
      </div>
    </div>
  );
}
