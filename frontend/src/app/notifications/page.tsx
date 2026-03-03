"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import AuthGuard from "@/components/AuthGuard";
import { Bell, ArrowLeft, CheckCheck, Trash2, Loader2, BellOff } from "lucide-react";

interface Notification {
  ID: number;
  Type: string;
  Title: string;
  Body: string;
  IsRead: boolean;
  CreatedAt: string;
}

const TYPE_LABEL: Record<string, { label: string; color: string }> = {
  ai_done:     { label: "AI", color: "bg-violet-500/20 text-violet-300 border-violet-500/30" },
  export_done: { label: "导出", color: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  backup_done: { label: "备份", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
  info:        { label: "通知", color: "bg-zinc-700/40 text-zinc-300 border-zinc-600/30" },
};

export default function NotificationsPage() {
  const { authFetch } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const LIMIT = 20;

  const loadPage = useCallback(
    (p: number, unreadFilter: boolean) => {
      setLoading(true);
      authFetch(`/api/notifications?page=${p}&limit=${LIMIT}${unreadFilter ? "&unread_only=true" : ""}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          setNotifications(data.notifications ?? []);
          setUnread(data.unread ?? 0);
          const total = data.total ?? 0;
          setTotalPages(Math.max(1, Math.ceil(total / LIMIT)));
        })
        .finally(() => setLoading(false));
    },
    [authFetch]
  );

  useEffect(() => {
    loadPage(page, unreadOnly);
  }, [page, unreadOnly, loadPage]);

  const handleMarkRead = async (id: number) => {
    const res = await authFetch(`/api/notifications/${id}`, { method: "PUT" });
    if (res.ok) {
      setNotifications((prev) =>
        prev.map((n) => (n.ID === id ? { ...n, IsRead: true } : n))
      );
      setUnread((u) => Math.max(0, u - 1));
    }
  };

  const handleDelete = async (id: number) => {
    const res = await authFetch(`/api/notifications/${id}`, { method: "DELETE" });
    if (res.ok) {
      const target = notifications.find((n) => n.ID === id);
      if (target && !target.IsRead) setUnread((u) => Math.max(0, u - 1));
      setNotifications((prev) => prev.filter((n) => n.ID !== id));
    }
  };

  const handleReadAll = async () => {
    const res = await authFetch("/api/notifications", { method: "PUT" });
    if (res.ok) {
      setNotifications((prev) => prev.map((n) => ({ ...n, IsRead: true })));
      setUnread(0);
    }
  };

  return (
    <AuthGuard>
      <div
        className="min-h-screen font-sans"
        style={{ background: "var(--pg-bg-base)", color: "var(--pg-text-primary)" }}
      >
        <div className="max-w-3xl mx-auto px-4 sm:px-8 py-8">
          {/* Header */}
          <header className="mb-8 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="flex items-center gap-2 text-sm transition-colors"
                style={{ color: "var(--pg-text-muted)" }}
              >
                <ArrowLeft className="w-4 h-4" />
                返回
              </Link>
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5" style={{ color: "var(--pg-accent)" }} />
                <h1 className="text-2xl font-semibold">通知中心</h1>
                {unread > 0 && (
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold text-white bg-red-500">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer" style={{ color: "var(--pg-text-muted)" }}>
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={(e) => { setUnreadOnly(e.target.checked); setPage(1); }}
                  className="accent-blue-500"
                />
                仅未读
              </label>
              {unread > 0 && (
                <button
                  onClick={handleReadAll}
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors"
                  style={{ background: "var(--pg-bg-elevated)", color: "var(--pg-text-muted)" }}
                >
                  <CheckCheck className="w-4 h-4" />
                  全部已读
                </button>
              )}
            </div>
          </header>

          {/* Content */}
          {loading ? (
            <div className="flex justify-center py-24">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--pg-accent)" }} />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-24" style={{ color: "var(--pg-text-muted)" }}>
              <BellOff className="w-12 h-12 opacity-40" />
              <p className="text-lg">暂无通知</p>
            </div>
          ) : (
            <div className="space-y-2">
              {notifications.map((n) => {
                const meta = TYPE_LABEL[n.Type] ?? TYPE_LABEL.info;
                return (
                  <div
                    key={n.ID}
                    className="flex items-start gap-4 p-4 rounded-xl border transition-colors"
                    style={{
                      background: n.IsRead ? "var(--pg-bg-elevated)" : "var(--pg-bg-elevated-hover, var(--pg-bg-elevated))",
                      borderColor: n.IsRead ? "var(--pg-border-subtle)" : "var(--pg-accent)",
                      opacity: n.IsRead ? 0.8 : 1,
                    }}
                  >
                    <span
                      className={`mt-0.5 inline-block text-xs font-medium px-2 py-0.5 rounded border shrink-0 ${meta.color}`}
                    >
                      {meta.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: "var(--pg-text-primary)" }}>
                        {n.Title}
                      </p>
                      {n.Body && (
                        <p className="text-xs mt-0.5 truncate" style={{ color: "var(--pg-text-muted)" }}>
                          {n.Body}
                        </p>
                      )}
                      <p
                        className="text-xs mt-1"
                        style={{ color: "var(--pg-text-muted)" }}
                        suppressHydrationWarning
                      >
                        {new Date(n.CreatedAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!n.IsRead && (
                        <button
                          onClick={() => handleMarkRead(n.ID)}
                          title="标记已读"
                          className="p-1.5 rounded-lg hover:bg-zinc-700/40 transition-colors"
                          style={{ color: "var(--pg-text-muted)" }}
                        >
                          <CheckCheck className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(n.ID)}
                        title="删除"
                        className="p-1.5 rounded-lg hover:bg-red-500/20 hover:text-red-400 transition-colors"
                        style={{ color: "var(--pg-text-muted)" }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-8">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 rounded-lg text-sm disabled:opacity-40 transition-colors"
                style={{ background: "var(--pg-bg-elevated)", color: "var(--pg-text-muted)" }}
              >
                上一页
              </button>
              <span className="px-3 py-1.5 text-sm" style={{ color: "var(--pg-text-muted)" }}>
                {page} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 rounded-lg text-sm disabled:opacity-40 transition-colors"
                style={{ background: "var(--pg-bg-elevated)", color: "var(--pg-text-muted)" }}
              >
                下一页
              </button>
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
