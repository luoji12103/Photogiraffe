"use client";

import { useState, useEffect, useCallback } from "react";
import { Download, HardDrive, RefreshCw, Trash2, CheckCircle, Clock, AlertCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";

interface BackupJob {
  ID: number;
  UserID: number;
  Status: string; // pending | processing | completed | failed
  OutputPath: string;
  ErrorMessage: string;
  CompletedAt: string | null;
  CreatedAt: string;
  download_url?: string;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return (
        <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-xs font-medium">
          <CheckCircle className="w-3.5 h-3.5" /> 已完成
        </span>
      );
    case "processing":
      return (
        <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400 text-xs font-medium">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> 处理中
        </span>
      );
    case "pending":
      return (
        <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400 text-xs font-medium">
          <Clock className="w-3.5 h-3.5" /> 等待中
        </span>
      );
    case "failed":
      return (
        <span className="flex items-center gap-1 text-red-600 dark:text-red-400 text-xs font-medium">
          <AlertCircle className="w-3.5 h-3.5" /> 失败
        </span>
      );
    default:
      return <span className="text-xs text-gray-500">{status}</span>;
  }
}

export default function BackupPage() {
  const { user } = useAuth();
  const { addToast } = useToast();

  const [jobs, setJobs] = useState<BackupJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/backup");
      if (!res.ok) throw new Error("failed");
      setJobs(await res.json());
    } catch {
      addToast({ type: "error", title: "加载备份记录失败" });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchJobs();
    // Auto-refresh every 10s if there's a running job
    const interval = setInterval(() => {
      fetchJobs();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const triggerBackup = async () => {
    setTriggering(true);
    try {
      const res = await fetch("/api/backup", { method: "POST" });
      const data = await res.json();
      if (res.status === 409) {
        addToast({ type: "error", title: "已有备份任务正在进行中" });
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "创建失败");
      addToast({ type: "success", title: "备份任务已创建，正在后台处理" });
      fetchJobs();
    } catch (e: unknown) {
      addToast({ type: "error", title: e instanceof Error ? e.message : "备份失败" });
    } finally {
      setTriggering(false);
    }
  };

  const deleteJob = async (id: number) => {
    if (!confirm("确认删除此备份记录？")) return;
    try {
      const res = await fetch(`/api/backup/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      addToast({ type: "success", title: "已删除" });
      fetchJobs();
    } catch {
      addToast({ type: "error", title: "删除失败" });
    }
  };

  const downloadJob = async (id: number) => {
    try {
      const res = await fetch(`/api/backup/${id}`);
      if (!res.ok) throw new Error("failed");
      const data: BackupJob & { download_url?: string } = await res.json();
      if (data.download_url) {
        window.open(data.download_url, "_blank");
      } else {
        addToast({ type: "error", title: "下载链接不可用" });
      }
    } catch {
      addToast({ type: "error", title: "获取下载链接失败" });
    }
  };

  const hasRunning = jobs.some((j) => j.Status === "pending" || j.Status === "processing");

  if (!user) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        请先登录
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HardDrive className="w-6 h-6 text-blue-500" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">数据备份</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchJobs}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-500"
            title="刷新"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={triggerBackup}
            disabled={triggering || hasRunning}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm transition-colors"
          >
            {triggering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {hasRunning ? "备份进行中…" : "创建备份"}
          </button>
        </div>
      </div>

      {/* Description */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-300">
        <p className="font-medium mb-1">关于数据备份</p>
        <p>点击「创建备份」将生成一个包含全部照片元数据（EXIF、标签、注释等）的 <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">metadata.json</code> 压缩包，可在完成后下载。</p>
      </div>

      {/* Jobs list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <HardDrive className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p>还没有备份记录</p>
          <p className="text-sm mt-1">点击「创建备份」开始</p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <div
              key={job.ID}
              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <StatusBadge status={job.Status} />
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    #{job.ID}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  创建于 {new Date(job.CreatedAt).toLocaleString("zh-CN")}
                  {job.CompletedAt && (
                    <> · 完成于 {new Date(job.CompletedAt).toLocaleString("zh-CN")}</>
                  )}
                </p>
                {job.ErrorMessage && (
                  <p className="text-xs text-red-500">{job.ErrorMessage}</p>
                )}
              </div>

              <div className="flex items-center gap-2">
                {job.Status === "completed" && (
                  <button
                    onClick={() => downloadJob(job.ID)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    下载
                  </button>
                )}
                <button
                  onClick={() => deleteJob(job.ID)}
                  className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900 text-red-500 rounded-lg transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
