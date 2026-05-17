"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Image as ImageIcon, Star, Brain, Images, Bookmark,
  Camera, Aperture, Palette, TrendingUp, Loader2, BarChart3,
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

const STAT_COLORS = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#06b6d4"];

function StatCard({
  icon: Icon, label, value, color, index,
}: { icon: React.ElementType; label: string; value: number; color: string; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.4 }}
      className="rounded-xl p-5 flex items-center gap-4"
      style={{
        background: "var(--pg-bg-surface)",
        border: "1px solid var(--pg-border-subtle)",
        boxShadow: "var(--pg-shadow-sm)",
      }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center"
        style={{ background: `${color}20`, color }}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-2xl font-semibold" style={{ color: "var(--pg-text-primary)" }}>{value.toLocaleString()}</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--pg-text-tertiary)" }}>{label}</p>
      </div>
    </motion.div>
  );
}

function BarChart({ data }: { data: { name: string; count: number }[] }) {
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="space-y-2.5">
      {data.slice(0, 8).map(item => (
        <div key={item.name} className="flex items-center gap-2">
          <span className="text-xs w-36 truncate shrink-0" style={{ color: "var(--pg-text-secondary)" }} title={item.name}>
            {item.name || "Unknown"}
          </span>
          <div className="flex-1 rounded-full h-2 overflow-hidden" style={{ background: "var(--pg-bg-elevated)" }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(item.count / max) * 100}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="h-2 rounded-full"
              style={{ background: "var(--pg-accent)" }}
            />
          </div>
          <span className="text-xs w-6 text-right" style={{ color: "var(--pg-text-muted)" }}>{item.count}</span>
        </div>
      ))}
    </div>
  );
}

function MiniBarChart({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="flex items-end gap-1 h-16">
      {data.map((d, i) => (
        <motion.div
          key={d.date}
          className="flex-1 flex flex-col items-center gap-1"
          title={`${d.date}: ${d.count}`}
          initial={{ opacity: 0, scaleY: 0 }}
          animate={{ opacity: 1, scaleY: 1 }}
          transition={{ delay: i * 0.03, duration: 0.4 }}
          style={{ transformOrigin: "bottom" }}
        >
          <div
            className="w-full rounded-sm"
            style={{
              height: `${Math.max((d.count / max) * 52, 2)}px`,
              background: "var(--pg-accent)",
              opacity: 0.7,
            }}
          />
          <span className="text-[8px] rotate-45 origin-left" style={{ color: "var(--pg-text-muted)" }}>
            {d.date.slice(5)}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

// Skeleton for dashboard loading
function DashboardSkeleton() {
  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      <div className="h-8 w-32 rounded-lg animate-pulse" style={{ background: "var(--pg-bg-elevated)" }} />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-xl p-5 h-20 animate-pulse" style={{ background: "var(--pg-bg-elevated)" }} />
        ))}
      </div>
      <div className="rounded-xl h-40 animate-pulse" style={{ background: "var(--pg-bg-elevated)" }} />
      <div className="grid md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl h-48 animate-pulse" style={{ background: "var(--pg-bg-elevated)" }} />
        ))}
      </div>
    </div>
  );
}

function ChartCard({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: "var(--pg-bg-surface)",
        border: "1px solid var(--pg-border-subtle)",
        boxShadow: "var(--pg-shadow-sm)",
      }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4" style={{ color: "var(--pg-accent)" }} />
        <h2 className="text-sm font-medium" style={{ color: "var(--pg-text-secondary)" }}>{title}</h2>
      </div>
      {children}
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

  if (loading) return <DashboardSkeleton />;

  if (!stats) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <BarChart3 className="w-10 h-10" style={{ color: "var(--pg-text-muted)" }} />
        <p style={{ color: "var(--pg-text-tertiary)" }}>无法加载统计数据</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      <motion.h1
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-2xl font-semibold tracking-tight"
        style={{ color: "var(--pg-text-primary)" }}
      >
        仪表盘
      </motion.h1>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard icon={ImageIcon} label="总照片" value={stats.total_photos} color={STAT_COLORS[0]} index={0} />
        <StatCard icon={Star} label="已处理" value={stats.completed_photos} color={STAT_COLORS[1]} index={1} />
        <StatCard icon={Brain} label="AI 分析" value={stats.ai_analyzed} color={STAT_COLORS[2]} index={2} />
        <StatCard icon={Images} label="相册" value={stats.albums} color={STAT_COLORS[3]} index={3} />
        <StatCard icon={Bookmark} label="预设" value={stats.presets} color={STAT_COLORS[4]} index={4} />
      </div>

      {stats.recent_uploads.length > 0 && (
        <ChartCard icon={TrendingUp} title="上传趋势 (14 天)">
          <MiniBarChart data={stats.recent_uploads} />
        </ChartCard>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        {stats.top_cameras.length > 0 && (
          <ChartCard icon={Camera} title="常用相机"><BarChart data={stats.top_cameras} /></ChartCard>
        )}
        {stats.top_lenses.length > 0 && (
          <ChartCard icon={Aperture} title="常用镜头"><BarChart data={stats.top_lenses} /></ChartCard>
        )}
        {stats.color_spaces.length > 0 && (
          <ChartCard icon={Palette} title="色彩空间"><BarChart data={stats.color_spaces} /></ChartCard>
        )}
      </div>
    </div>
  );
}
