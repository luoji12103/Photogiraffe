"use client";

import { useState, useEffect, useCallback } from "react";
import { BarChart3, Camera, ZoomIn, Aperture, Star, Images, Sparkles } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";

interface DataRow {
  month?: string;
  camera?: string;
  bin?: string;
  count: number;
}

interface Summary {
  total_photos: number;
  total_favorites: number;
  total_albums: number;
  total_smart_albums: number;
}

/* ── Horizontal bar chart using pure CSS/SVG ── */
function BarChart({
  data,
  labelKey,
  color = "#8b5cf6",
  height = 320,
}: {
  data: DataRow[];
  labelKey: "month" | "camera" | "bin";
  color?: string;
  height?: number;
}) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-24 text-gray-400 text-sm">
        暂无数据
      </div>
    );
  }

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const barHeight = Math.max(Math.floor((height - data.length * 6) / data.length), 18);

  return (
    <div className="w-full space-y-1.5 overflow-x-auto">
      {data.map((row, i) => {
        const label = row[labelKey] ?? "";
        const pct = (row.count / maxCount) * 100;
        return (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span
              className="text-xs text-gray-500 dark:text-gray-400 shrink-0 text-right"
              style={{ width: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              title={label}
            >
              {label}
            </span>
            <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded overflow-hidden" style={{ height: barHeight }}>
              <div
                className="h-full rounded transition-all duration-700"
                style={{ width: `${pct}%`, background: color, minWidth: 2 }}
              />
            </div>
            <span className="text-xs font-mono text-gray-600 dark:text-gray-300 shrink-0 w-8 text-right">
              {row.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Stat card ── */
function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number | undefined;
  color: string;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 flex items-center gap-4">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: `${color}20` }}
      >
        <Icon className="w-6 h-6" style={{ color }} />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {value?.toLocaleString() ?? "—"}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
      </div>
    </div>
  );
}

/* ── Chart section wrapper ── */
function ChartSection({
  title,
  icon: Icon,
  children,
  loading,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  loading: boolean;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center gap-2 mb-5">
        <Icon className="w-5 h-5 text-purple-500" />
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
      </div>
      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-5 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          ))}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  const { authFetch, user } = useAuth();
  const { addToast } = useToast();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [monthly, setMonthly] = useState<DataRow[]>([]);
  const [camera, setCamera] = useState<DataRow[]>([]);
  const [focalLength, setFocalLength] = useState<DataRow[]>([]);
  const [iso, setIso] = useState<DataRow[]>([]);

  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingMonthly, setLoadingMonthly] = useState(true);
  const [loadingCamera, setLoadingCamera] = useState(true);
  const [loadingFocal, setLoadingFocal] = useState(true);
  const [loadingIso, setLoadingIso] = useState(true);

  const fetchStat = useCallback(
    async (type: string): Promise<DataRow[] | Summary | null> => {
      try {
        const res = await authFetch(`/api/analytics?type=${type}`);
        if (!res.ok) throw new Error("failed");
        return await res.json();
      } catch {
        addToast({ type: "error", title: `加载 ${type} 统计失败` });
        return null;
      }
    },
    [addToast, authFetch]
  );

  useEffect(() => {
    if (!user) return;

    fetchStat("summary").then((d) => {
      setSummary(d as Summary);
      setLoadingSummary(false);
    });
    fetchStat("monthly").then((d) => {
      setMonthly((d as DataRow[]) ?? []);
      setLoadingMonthly(false);
    });
    fetchStat("camera").then((d) => {
      setCamera((d as DataRow[]) ?? []);
      setLoadingCamera(false);
    });
    fetchStat("focal-length").then((d) => {
      setFocalLength((d as DataRow[]) ?? []);
      setLoadingFocal(false);
    });
    fetchStat("iso").then((d) => {
      setIso((d as DataRow[]) ?? []);
      setLoadingIso(false);
    });
  }, [user, fetchStat]);

  if (!user) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        请先登录
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart3 className="w-6 h-6 text-purple-500" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">统计分析</h1>
      </div>

      {/* Summary cards */}
      {loadingSummary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={BarChart3} label="照片总数" value={summary?.total_photos} color="#8b5cf6" />
          <StatCard icon={Star} label="收藏数" value={summary?.total_favorites} color="#f59e0b" />
          <StatCard icon={Images} label="相册数" value={summary?.total_albums} color="#3b82f6" />
          <StatCard icon={Sparkles} label="智能相册" value={summary?.total_smart_albums} color="#10b981" />
        </div>
      )}

      {/* Charts 2-column on desktop */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ChartSection title="每月上传趋势（近12个月）" icon={BarChart3} loading={loadingMonthly}>
          <BarChart data={monthly} labelKey="month" color="#8b5cf6" />
        </ChartSection>

        <ChartSection title="相机型号 Top 10" icon={Camera} loading={loadingCamera}>
          <BarChart data={camera} labelKey="camera" color="#3b82f6" />
        </ChartSection>

        <ChartSection title="焦距分布" icon={ZoomIn} loading={loadingFocal}>
          <BarChart data={focalLength} labelKey="bin" color="#10b981" />
        </ChartSection>

        <ChartSection title="ISO 分布" icon={Aperture} loading={loadingIso}>
          <BarChart data={iso} labelKey="bin" color="#f59e0b" />
        </ChartSection>
      </div>
    </div>
  );
}
