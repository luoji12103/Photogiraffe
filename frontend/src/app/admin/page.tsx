"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Users, ToggleLeft, ToggleRight, Shield, CircleCheck, CircleX } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import AuthGuard from "@/components/AuthGuard";

interface FeatureFlag {
  ID: number;
  FeatureName: string;
  IsEnabled: boolean;
  Description: string;
}

interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  created_at: string;
}

type Tab = "flags" | "users";

const FLAG_LABELS: Record<string, string> = {
  ai_analysis: "AI 分析",
  ai_infer_params: "AI 参数推断",
  export_engine: "导出引擎",
  preset_management: "预设管理",
  raw_decode: "RAW 解码",
  hdr_display: "HDR 显示",
};

export default function AdminPage() {
  const { authFetch } = useAuth();
  const [tab, setTab] = useState<Tab>("flags");

  // Feature Flags state
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [flagsLoading, setFlagsLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [flagMsg, setFlagMsg] = useState("");

  // Users state
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);

  const loadFlags = useCallback(() => {
    setFlagsLoading(true);
    authFetch("/api/admin/flags")
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setFlags(data))
      .finally(() => setFlagsLoading(false));
  }, [authFetch]);

  const loadUsers = useCallback(() => {
    setUsersLoading(true);
    authFetch("/api/admin/users")
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setUsers(data))
      .finally(() => setUsersLoading(false));
  }, [authFetch]);

  useEffect(() => { loadFlags(); }, [loadFlags]);
  useEffect(() => { if (tab === "users") loadUsers(); }, [tab, loadUsers]);

  const toggleFlag = async (flag: FeatureFlag) => {
    setToggling(flag.FeatureName);
    setFlagMsg("");
    try {
      const res = await authFetch(`/api/admin/flags/${flag.FeatureName}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_enabled: !flag.IsEnabled }),
      });
      if (res.ok) {
        setFlags((prev) =>
          prev.map((f) =>
            f.FeatureName === flag.FeatureName ? { ...f, IsEnabled: !f.IsEnabled } : f
          )
        );
        setFlagMsg(`"${FLAG_LABELS[flag.FeatureName] ?? flag.FeatureName}" ${!flag.IsEnabled ? "已启用" : "已禁用"}`);
        setTimeout(() => setFlagMsg(""), 3000);
      }
    } finally {
      setToggling(null);
    }
  };

  return (
    <AuthGuard adminOnly>
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          <header className="mb-8 flex items-center gap-4">
            <Link
              href="/"
              className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors shrink-0"
            >
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
                <Shield size={24} className="text-zinc-400 sm:hidden" />
                <Shield size={28} className="text-zinc-400 hidden sm:block" />
                Admin Panel
              </h1>
              <p className="text-zinc-500 dark:text-zinc-400 mt-1 text-sm">功能开关与用户管理</p>
            </div>
          </header>

          {/* Tabs */}
          <div className="flex gap-1 mb-6 sm:mb-8 bg-zinc-900 rounded-xl p-1 w-fit">
            {(["flags", "users"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex items-center gap-2 px-4 sm:px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === t
                    ? "bg-zinc-700 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {t === "flags" ? <ToggleRight size={16} /> : <Users size={16} />}
                {t === "flags" ? "功能开关" : "用户管理"}
              </button>
            ))}
          </div>

          {/* Feature Flags Tab */}
          {tab === "flags" && (
            <div>
              {flagMsg && (
                <div className="mb-4 px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-sm">
                  {flagMsg}
                </div>
              )}
              {flagsLoading ? (
                <div className="flex justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {flags.map((flag) => (
                    <div
                      key={flag.FeatureName}
                      className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 sm:p-5 flex items-start justify-between gap-4"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {flag.IsEnabled ? (
                            <CircleCheck size={16} className="text-green-500 shrink-0" />
                          ) : (
                            <CircleX size={16} className="text-zinc-500 shrink-0" />
                          )}
                          <span className="font-medium text-sm">
                            {FLAG_LABELS[flag.FeatureName] ?? flag.FeatureName}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-500 line-clamp-2">{flag.Description}</p>
                        <code className="text-xs text-zinc-600 mt-1 block">{flag.FeatureName}</code>
                      </div>
                      <button
                        onClick={() => toggleFlag(flag)}
                        disabled={toggling === flag.FeatureName}
                        title={flag.IsEnabled ? "点击禁用" : "点击启用"}
                        className={`shrink-0 transition-colors ${
                          toggling === flag.FeatureName ? "opacity-50" : "hover:opacity-80"
                        }`}
                      >
                        {toggling === flag.FeatureName ? (
                          <Loader2 size={28} className="animate-spin text-zinc-500" />
                        ) : flag.IsEnabled ? (
                          <ToggleRight size={32} className="text-green-500" />
                        ) : (
                          <ToggleLeft size={32} className="text-zinc-500" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Users Tab */}
          {tab === "users" && (
            <div>
              {usersLoading ? (
                <div className="flex justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
                </div>
              ) : (
                <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm min-w-[500px]">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-950/50">
                        <th className="text-left px-4 sm:px-5 py-3 text-zinc-500 font-medium w-12">ID</th>
                        <th className="text-left px-4 sm:px-5 py-3 text-zinc-500 font-medium">用户名</th>
                        <th className="text-left px-4 sm:px-5 py-3 text-zinc-500 font-medium hidden sm:table-cell">邮箱</th>
                        <th className="text-left px-4 sm:px-5 py-3 text-zinc-500 font-medium">角色</th>
                        <th className="text-left px-4 sm:px-5 py-3 text-zinc-500 font-medium hidden md:table-cell">注册时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u, idx) => (
                        <tr
                          key={u.id}
                          className={`border-b border-zinc-800/50 ${idx % 2 === 0 ? "" : "bg-zinc-950/30"}`}
                        >
                          <td className="px-4 sm:px-5 py-3 text-zinc-500">{u.id}</td>
                          <td className="px-4 sm:px-5 py-3 font-medium">{u.username}</td>
                          <td className="px-4 sm:px-5 py-3 text-zinc-400 hidden sm:table-cell">{u.email}</td>
                          <td className="px-4 sm:px-5 py-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                u.role === "SuperAdmin"
                                  ? "bg-amber-900/30 text-amber-400 border border-amber-800/50"
                                  : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                              }`}
                            >
                              {u.role}
                            </span>
                          </td>
                          <td className="px-4 sm:px-5 py-3 text-zinc-500 text-xs hidden md:table-cell" suppressHydrationWarning>
                            {u.created_at ? new Date(u.created_at).toLocaleDateString("zh-CN") : "—"}
                          </td>
                        </tr>
                      ))}
                      {users.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-5 py-10 text-center text-zinc-600">
                            暂无用户数据
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
