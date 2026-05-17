"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";

/**
 * SSEListener — mounts once in ClientLayout, maintains a single EventSource
 * connection to /api/events/stream and converts server-sent events into toasts.
 *
 * The browser EventSource API cannot set custom headers, so we pass the
 * access token as a query parameter (?token=...). The server validates it
 * the same as the Authorization header.
 */
export default function SSEListener() {
  const { accessToken } = useAuth();
  const { addToast } = useToast();
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!accessToken) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }

    // Prevent duplicate connections (e.g. React StrictMode double-effect)
    if (esRef.current) return;

    const url = `/api/events/stream?token=${encodeURIComponent(accessToken)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("connected", () => {
      console.log("[SSE] connected");
    });

    /** Export job completed */
    es.addEventListener("export_completed", (e) => {
      try {
        const d = JSON.parse(e.data) as { job_id: number; photo_id: number };
        addToast({
          type: "success",
          title: "导出完成",
          message: `照片 #${d.photo_id} 的导出任务已完成，可前往下载。`,
        });
      } catch {}
    });

    /** Export job failed */
    es.addEventListener("export_failed", (e) => {
      try {
        const d = JSON.parse(e.data) as { job_id: number; photo_id: number };
        addToast({
          type: "error",
          title: "导出失败",
          message: `照片 #${d.photo_id} 的导出任务失败，请重试。`,
        });
      } catch {}
    });

    /** Backup job completed */
    es.addEventListener("backup_completed", (e) => {
      try {
        const d = JSON.parse(e.data) as { job_id: number };
        addToast({
          type: "success",
          title: "备份已完成",
          message: `备份任务 #${d.job_id} 已生成，可前往下载。`,
        });
      } catch {}
    });

    /** Backup job failed */
    es.addEventListener("backup_failed", (e) => {
      try {
        const d = JSON.parse(e.data) as { job_id: number; error_message?: string };
        addToast({
          type: "error",
          title: "备份失败",
          message: d.error_message || `备份任务 #${d.job_id} 失败，请重试。`,
        });
      } catch {}
    });

    /** AI analysis done */
    es.addEventListener("ai_analysis_done", (e) => {
      try {
        const d = JSON.parse(e.data) as { photo_id: number };
        addToast({
          type: "info",
          title: "AI 分析完成",
          message: `照片 #${d.photo_id} 的 AI 分析结果已就绪。`,
        });
      } catch {}
    });

    /** AI parameter inference done */
    es.addEventListener("infer_params_done", (e) => {
      try {
        const d = JSON.parse(e.data) as { photo_id: number };
        addToast({
          type: "success",
          title: "AI 参数推断完成",
          message: `照片 #${d.photo_id} 的调色参数已自动推断，可一键应用。`,
        });
      } catch {}
    });

    es.onerror = () => {
      // On error, close and let the next render re-establish
      es.close();
      esRef.current = null;
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [accessToken, addToast]);

  return null;
}
