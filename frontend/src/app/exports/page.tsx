"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import AuthGuard from "@/components/AuthGuard";
import {
  ArrowLeft, Download, Trash2, Loader2, RefreshCw,
  CheckCircle, Clock, XCircle, Hourglass,
} from "lucide-react";

interface ExportJob {
  ID: number;
  PhotoID: number;
  AlbumID?: number;
  JobType: string;
  Status: "pending" | "processing" | "completed" | "failed";
  ExportOptions: string; // JSON string
  OutputPath: string;
  ErrorMessage: string;
  CompletedAt?: string;
  CreatedAt: string;
  UpdatedAt: string;
  photo_thumbnail: string;
  photo_filename: string;
}

interface ExportListResponse {
  jobs: ExportJob[];
  total: number;
  page: number;
  limit: number;
}

const STATUS_FILTERS = [
  { key: "", label: "全部" },
  { key: "completed", label: "已完成" },
  { key: "processing", label: "处理中" },
  { key: "pending", label: "等待中" },
  { key: "failed", label: "失败" },
];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    completed: { label: "已完成", cls: "bg-green-900/30 text-green-400 border-green-800/40", icon: <CheckCircle size={12} /> },
    processing: { label: "处理中", cls: "bg-blue-900/30 text-blue-400 border-blue-800/40", icon: <Hourglass size={12} /> },
    pending:    { label: "等待中", cls: "bg-yellow-900/30 text-yellow-400 border-yellow-800/40", icon: <Clock size={12} /> },
    failed:     { label: "失败", cls: "bg-red-900/30 text-red-400 border-red-800/40", icon: <XCircle size={12} /> },
  };
  const info = map[status] ?? map.pending;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border font-medium ${info.cls}`}>
      {info.icon}{info.label}
    </span>
  );
}

function parseOptions(raw: string): Record<string, string | number | boolean> {
  try { return JSON.parse(raw); } catch { return {}; }
}

function OptionTags({ raw }: { raw: string }) {
  const opts = parseOptions(raw);
  const tags: string[] = [];
  if (opts.format) tags.push(String(opts.format).toUpperCase());
  if (opts.quality) tags.push(`Q${opts.quality}`);
  if (opts.frame_style && opts.frame_style !== "none" && opts.frame_style !== "") {
    tags.push("边框");
  }
  if (opts.watermark_type && opts.watermark_type !== "none" && opts.watermark_type !== "") {
    tags.push("水印");
  }
  if (opts.color_space) tags.push(String(opts.color_space).toUpperCase());
  if (!tags.length) tags.push("默认");
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded">{t}</span>
      ))}
    </div>
  );
}

export default function ExportsPage() {
  const { authFetch } = useAuth();
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (status) params.set("status", status);
      const res = await authFetch(`/api/exports?${params.toString()}`);
      if (res.ok) {
        const data: ExportListResponse = await res.json();
        setJobs(data.jobs ?? []);
        setTotal(data.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [authFetch, page, status]);

  useEffect(() => { load(); }, [load]);

  const handleDownload = async (job: ExportJob) => {
    setDownloadingId(job.ID);
    try {
      const res = await authFetch(`/api/exports/${job.ID}/download`);
      if (res.ok) {
        const data = await res.json();
        const a = document.createElement("a");
        a.href = data.url;
        a.download = "";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (job: ExportJob) => {
    if (!confirm("删除此导出记录？相关文件也将从存储中删除。")) return;
    setDeletingId(job.ID);
    try {
      const res = await authFetch(`/api/exports/${job.ID}`, { method: "DELETE" });
      if (res.ok) {
        setJobs((prev) => prev.filter((j) => j.ID !== job.ID));
        setTotal((t) => t - 1);
      }
    } finally {
      setDeletingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("zh-CN", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit",
      });
    } catch { return iso; }
  };

  return (
    <AuthGuard>
      <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          {/* Header */}
          <header className="mb-6 flex items-center gap-4">
            <Link href="/" className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors">
              <ArrowLeft size={20} />
            </Link>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold tracking-tight">导出历史</h1>
              <p className="text-zinc-500 text-sm mt-0.5">共 {total} 条导出记录</p>
            </div>
            <button
              onClick={load}
              className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
              title="刷新"
            >
              <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
            </button>
          </header>

          {/* Status filter tabs */}
          <div className="flex gap-1 mb-6 bg-zinc-900 rounded-xl p-1 w-fit flex-wrap">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => { setStatus(f.key); setPage(1); }}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  status === f.key
                    ? "bg-zinc-700 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Job list */}
          {loading ? (
            <div className="flex justify-center py-24">
              <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-24">
              <Download size={40} className="mx-auto text-zinc-700 mb-4" />
              <p className="text-zinc-500">
                {status ? `暂无"${STATUS_FILTERS.find(f => f.key === status)?.label}"状态的导出记录` : "暂无导出记录"}
              </p>
              <Link href="/" className="mt-4 inline-block text-sm text-zinc-400 hover:text-zinc-200 underline">
                前往画廊导出照片
              </Link>
            </div>
          ) : (
            <>
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                {jobs.map((job, i) => (
                  <div
                    key={job.ID}
                    className={`flex items-center gap-4 p-4 ${
                      i < jobs.length - 1 ? "border-b border-zinc-800/60" : ""
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="w-14 h-14 shrink-0 rounded-lg overflow-hidden bg-zinc-800">
                      {job.photo_thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/image?path=${encodeURIComponent(job.photo_thumbnail)}`}
                          alt={job.photo_filename}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-600">
                          <Download size={20} />
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="font-medium text-sm truncate max-w-[200px]">
                          {job.photo_filename || `照片 #${job.PhotoID}`}
                        </span>
                        {job.JobType === "album" && (
                          <span className="text-xs text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">相册</span>
                        )}
                        <StatusBadge status={job.Status} />
                      </div>
                      <OptionTags raw={job.ExportOptions} />
                      <p className="text-xs text-zinc-600 mt-1">
                        {formatDate(job.CreatedAt)}
                        {job.Status === "failed" && job.ErrorMessage && (
                          <span className="ml-2 text-red-500">↳ {job.ErrorMessage}</span>
                        )}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {job.Status === "completed" && (
                        <button
                          onClick={() => handleDownload(job)}
                          disabled={downloadingId === job.ID}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors disabled:opacity-50"
                          title="下载"
                        >
                          {downloadingId === job.ID ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Download size={14} />
                          )}
                          <span className="hidden sm:inline">下载</span>
                        </button>
                      )}
                      {(job.Status === "completed" || job.Status === "failed") && (
                        <button
                          onClick={() => handleDelete(job)}
                          disabled={deletingId === job.ID}
                          className="p-2 text-zinc-600 hover:text-red-400 transition-colors disabled:opacity-50 rounded-lg hover:bg-zinc-800"
                          title="删除记录"
                        >
                          {deletingId === job.ID ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <Trash2 size={15} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-4 mt-6">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-4 py-2 text-sm rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 transition-colors"
                  >
                    ← 上一页
                  </button>
                  <span className="text-sm text-zinc-500">
                    第 {page} / {totalPages} 页
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="px-4 py-2 text-sm rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 transition-colors"
                  >
                    下一页 →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
