"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft, Loader2, Users, ToggleLeft, ToggleRight, Shield,
  CircleCheck, CircleX, KeyRound, Plus, Copy, Check,
  BarChart2, Trash2, UserCog, ImageIcon, ChevronDown, Gauge, RefreshCw,
} from "lucide-react";
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
  public_id: string;
  username: string;
  email: string;
  role: string;
  created_at: string;
  photo_count: number;
}

interface StatsData {
  total_users: number;
  total_photos: number;
  pending_photos: number;
  total_albums: number;
  total_presets: number;
  recent_users: number;
  top_users: { username: string; photo_count: number }[];
}

type Tab = "stats" | "flags" | "users" | "invites" | "ratelimits" | "jobs";

interface AsyncTask {
  ID: number;
  TaskType: string;
  ResourceType: string;
  ResourceID: number;
  Status: string;
  AttemptCount: number;
  MaxAttempts: number;
  LastError: string;
  NextAttemptAt: string | null;
  LeaseExpiresAt: string | null;
  CreatedAt: string;
}

interface AIRateLimit {
  ID: number;
  TargetType: string;
  TargetUserID: number | null;
  target_username?: string;
  Window: string;
  MaxRequests: number;
  Enabled: boolean;
  Note: string;
}

interface InviteCode {
  ID: number;
  Code: string;
  CreatedBy: number;
  UsedBy: number | null;
  UsedAt: string | null;
  ExpiresAt: string | null;
  CreatedAt: string;
}

const FLAG_LABELS: Record<string, string> = {
  ai_analysis: "AI 分析",
  ai_infer_params: "AI 参数推断",
  export_engine: "导出引擎",
  preset_management: "预设管理",
  raw_decode: "RAW 解码",
  hdr_display: "HDR 显示",
  require_invite: "邀请码注册",
};

export default function AdminPage() {
  const { authFetch } = useAuth();
  const [tab, setTab] = useState<Tab>("stats");

  // Stats state
  const [stats, setStats] = useState<StatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Feature Flags state
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [flagsLoading, setFlagsLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [flagMsg, setFlagMsg] = useState("");

  // Users state
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [roleChanging, setRoleChanging] = useState<number | null>(null);
  const [deletingUser, setDeletingUser] = useState<number | null>(null);
  const [userMsg, setUserMsg] = useState("");

  // Invite Codes state
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // AI Rate Limits state
  const [rateLimits, setRateLimits] = useState<AIRateLimit[]>([]);
  const [rlLoading, setRlLoading] = useState(true);
  const [rlMsg, setRlMsg] = useState("");
  const [rlForm, setRlForm] = useState({ targetType: "all", targetUserId: "", window: "minute", maxRequests: "10", note: "", enabled: true });
  const [rlCreating, setRlCreating] = useState(false);

  // Async jobs state
  const [jobs, setJobs] = useState<AsyncTask[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [jobStatusFilter, setJobStatusFilter] = useState("");
  const [jobTypeFilter, setJobTypeFilter] = useState("");
  const [retryingJob, setRetryingJob] = useState<number | null>(null);
  const [jobMsg, setJobMsg] = useState("");

  const loadStats = useCallback(() => {
    setStatsLoading(true);
    authFetch("/api/admin/stats")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => setStats(data))
      .finally(() => setStatsLoading(false));
  }, [authFetch]);

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
      .then((data) => setUsers(Array.isArray(data) ? data : []))
      .finally(() => setUsersLoading(false));
  }, [authFetch]);

  const loadInviteCodes = useCallback(() => {
    setInvitesLoading(true);
    authFetch("/api/admin/invite-codes")
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setInviteCodes(Array.isArray(data) ? data : []))
      .finally(() => setInvitesLoading(false));
  }, [authFetch]);

  const loadRateLimits = useCallback(() => {
    setRlLoading(true);
    authFetch("/api/admin/ai-rate-limits")
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setRateLimits(Array.isArray(data) ? data : []))
      .finally(() => setRlLoading(false));
  }, [authFetch]);

  const loadJobs = useCallback(() => {
    setJobsLoading(true);
    const params = new URLSearchParams({ limit: "50" });
    if (jobStatusFilter) params.set("status", jobStatusFilter);
    if (jobTypeFilter) params.set("task_type", jobTypeFilter);

    authFetch(`/api/admin/jobs?${params.toString()}`)
      .then((r) => r.ok ? r.json() : { jobs: [], total: 0 })
      .then((data) => {
        setJobs(Array.isArray(data.jobs) ? data.jobs : []);
        setJobsTotal(typeof data.total === "number" ? data.total : 0);
      })
      .finally(() => setJobsLoading(false));
  }, [authFetch, jobStatusFilter, jobTypeFilter]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { if (tab === "flags") loadFlags(); }, [tab, loadFlags]);
  useEffect(() => { if (tab === "users") loadUsers(); }, [tab, loadUsers]);
  useEffect(() => { if (tab === "invites") loadInviteCodes(); }, [tab, loadInviteCodes]);
  useEffect(() => { if (tab === "ratelimits") loadRateLimits(); }, [tab, loadRateLimits]);
  useEffect(() => { if (tab === "jobs") loadJobs(); }, [tab, loadJobs]);

  const handleCreateRateLimit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rlForm.window || !rlForm.maxRequests) return;
    setRlCreating(true);
    setRlMsg("");
    try {
      const body: Record<string, unknown> = {
        target_type: rlForm.targetType,
        window: rlForm.window,
        max_requests: parseInt(rlForm.maxRequests),
        enabled: rlForm.enabled,
        note: rlForm.note,
      };
      if (rlForm.targetType === "user" && rlForm.targetUserId) {
        body.target_user_id = parseInt(rlForm.targetUserId);
      }
      const res = await authFetch("/api/admin/ai-rate-limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setRlMsg("规则已创建");
        setTimeout(() => setRlMsg(""), 3000);
        setRlForm({ targetType: "all", targetUserId: "", window: "minute", maxRequests: "10", note: "", enabled: true });
        loadRateLimits();
      } else {
        const d = await res.json();
        setRlMsg(d.error || "创建失败");
      }
    } finally {
      setRlCreating(false);
    }
  };

  const handleToggleRateLimit = async (rl: AIRateLimit) => {
    const res = await authFetch(`/api/admin/ai-rate-limits/${rl.ID}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !rl.Enabled }),
    });
    if (res.ok) {
      setRateLimits((prev) => prev.map((r) => r.ID === rl.ID ? { ...r, Enabled: !r.Enabled } : r));
    }
  };

  const handleDeleteRateLimit = async (id: number) => {
    if (!confirm("确定删除该限速规则？")) return;
    const res = await authFetch(`/api/admin/ai-rate-limits/${id}`, { method: "DELETE" });
    if (res.ok) {
      setRateLimits((prev) => prev.filter((r) => r.ID !== id));
      setRlMsg("规则已删除");
      setTimeout(() => setRlMsg(""), 3000);
    }
  };

  const handleRetryJob = async (jobId: number) => {
    if (!confirm(`确定重试任务 #${jobId} 吗？`)) return;
    setRetryingJob(jobId);
    setJobMsg("");
    try {
      const res = await authFetch(`/api/admin/jobs/${jobId}/retry`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok || res.status === 202) {
        setJobMsg(data.warning || "任务已重新加入队列");
        setTimeout(() => setJobMsg(""), 4000);
        loadJobs();
      } else {
        setJobMsg(data.error || "重试失败");
      }
    } finally {
      setRetryingJob(null);
    }
  };

  const handleCreateInvite = async () => {
    setCreatingInvite(true);
    try {
      const res = await authFetch("/api/admin/invite-codes", { method: "POST" });
      if (res.ok) loadInviteCodes();
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleCopyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

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

  const handleRoleChange = async (userId: number, newRole: string) => {
    setRoleChanging(userId);
    setUserMsg("");
    try {
      const res = await authFetch(`/api/admin/users/${userId}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role: newRole } : u));
        setUserMsg("角色已更新");
        setTimeout(() => setUserMsg(""), 3000);
      }
    } finally {
      setRoleChanging(null);
    }
  };

  const handleDeleteUser = async (userId: number, username: string) => {
    if (!confirm(`确定要删除用户 "${username}" 及其所有数据吗？此操作不可撤销。`)) return;
    setDeletingUser(userId);
    setUserMsg("");
    try {
      const res = await authFetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      if (res.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== userId));
        setUserMsg(`用户 ${username} 已删除`);
        setTimeout(() => setUserMsg(""), 3000);
      }
    } finally {
      setDeletingUser(null);
    }
  };

  const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "stats", label: "系统统计", icon: <BarChart2 size={16} /> },
    { key: "flags", label: "功能开关", icon: <ToggleRight size={16} /> },
    { key: "users", label: "用户管理", icon: <Users size={16} /> },
    { key: "invites", label: "邀请码", icon: <KeyRound size={16} /> },
    { key: "ratelimits", label: "AI 限速", icon: <Gauge size={16} /> },
    { key: "jobs", label: "异步任务", icon: <RefreshCw size={16} /> },
  ];

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
              <p className="text-zinc-500 dark:text-zinc-400 mt-1 text-sm">系统管理与配置</p>
            </div>
          </header>

          {/* Tabs */}
          <div className="flex flex-wrap gap-1 mb-6 sm:mb-8 bg-zinc-900 rounded-xl p-1 w-fit">
            {TABS.map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-2 px-4 sm:px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tab === key
                    ? "bg-zinc-700 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {icon}
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

          {/* Stats Tab */}
          {tab === "stats" && (
            <div>
              {statsLoading ? (
                <div className="flex justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
                </div>
              ) : stats ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {[
                      { label: "总用户数", value: stats.total_users, sub: `近30天新增 ${stats.recent_users}` },
                      { label: "总照片数", value: stats.total_photos, sub: `处理中 ${stats.pending_photos}` },
                      { label: "相册数", value: stats.total_albums, sub: "" },
                      { label: "预设数", value: stats.total_presets, sub: "" },
                    ].map(({ label, value, sub }) => (
                      <div key={label} className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5">
                        <div className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</div>
                        <div className="text-sm font-medium text-zinc-400 mt-1">{label}</div>
                        {sub && <div className="text-xs text-zinc-600 mt-0.5">{sub}</div>}
                      </div>
                    ))}
                  </div>
                  {stats.top_users && stats.top_users.length > 0 && (
                    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5">
                      <h3 className="text-sm font-semibold text-zinc-400 mb-4 uppercase tracking-wide">上传最多的用户</h3>
                      <div className="space-y-3">
                        {stats.top_users.map((u, i) => (
                          <div key={u.username} className="flex items-center gap-3">
                            <span className="text-zinc-600 text-sm w-5 text-right">{i + 1}</span>
                            <div className="flex-1 flex items-center gap-2">
                              <span className="text-sm font-medium min-w-[80px]">{u.username}</span>
                              <div className="flex-1 bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                                <div
                                  className="bg-zinc-400 h-full"
                                  style={{ width: `${stats.top_users[0].photo_count > 0 ? (u.photo_count / stats.top_users[0].photo_count) * 100 : 0}%` }}
                                />
                              </div>
                            </div>
                            <span className="text-sm text-zinc-500 tabular-nums">{u.photo_count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-16 text-zinc-600">无法加载统计数据</div>
              )}
            </div>
          )}

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
              {userMsg && (
                <div className="mb-4 px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-sm">
                  {userMsg}
                </div>
              )}
              {usersLoading ? (
                <div className="flex justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
                </div>
              ) : (
                <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-950/50">
                        <th className="text-left px-4 sm:px-5 py-3 text-zinc-500 font-medium w-12">ID</th>
                        <th className="text-left px-4 sm:px-5 py-3 text-zinc-500 font-medium">用户名</th>
                        <th className="text-left px-4 sm:px-5 py-3 text-zinc-500 font-medium hidden sm:table-cell">邮箱</th>
                        <th className="text-left px-4 sm:px-5 py-3 text-zinc-500 font-medium">角色</th>
                        <th className="text-left px-4 sm:px-5 py-3 text-zinc-500 font-medium hidden md:table-cell">照片</th>
                        <th className="text-left px-4 sm:px-5 py-3 text-zinc-500 font-medium hidden md:table-cell">注册时间</th>
                        <th className="text-right px-4 sm:px-5 py-3 text-zinc-500 font-medium">操作</th>
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
                          <td className="px-4 sm:px-5 py-3 text-zinc-400 hidden sm:table-cell truncate max-w-[160px]">{u.email}</td>
                          <td className="px-4 sm:px-5 py-3">
                            <div className="relative inline-block">
                              <select
                                value={u.role}
                                disabled={roleChanging === u.id}
                                onChange={(e) => handleRoleChange(u.id, e.target.value)}
                                className={`appearance-none text-xs font-medium px-2 py-1 pr-6 rounded border cursor-pointer transition-colors
                                  ${u.role === "SuperAdmin"
                                    ? "border-amber-700 text-amber-400 bg-amber-900/20"
                                    : "border-zinc-700 text-zinc-400 bg-zinc-800/50"
                                  }`}
                              >
                                <option value="StandardUser">StandardUser</option>
                                <option value="SuperAdmin">SuperAdmin</option>
                              </select>
                              <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500" />
                            </div>
                          </td>
                          <td className="px-4 sm:px-5 py-3 hidden md:table-cell">
                            <div className="flex items-center gap-1 text-zinc-400">
                              <ImageIcon size={12} />
                              <span>{u.photo_count}</span>
                            </div>
                          </td>
                          <td className="px-4 sm:px-5 py-3 text-zinc-500 text-xs hidden md:table-cell" suppressHydrationWarning>
                            {u.created_at ? new Date(u.created_at).toLocaleDateString("zh-CN") : "—"}
                          </td>
                          <td className="px-4 sm:px-5 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Link
                                href={`/admin/users/${u.id}/photos`}
                                className="p-1.5 text-zinc-500 hover:text-zinc-200 transition-colors rounded"
                                title="查看用户照片"
                              >
                                <UserCog size={15} />
                              </Link>
                              <button
                                onClick={() => handleDeleteUser(u.id, u.username)}
                                disabled={deletingUser === u.id}
                                className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors rounded disabled:opacity-50"
                                title="删除用户"
                              >
                                {deletingUser === u.id
                                  ? <Loader2 size={15} className="animate-spin" />
                                  : <Trash2 size={15} />
                                }
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {users.length === 0 && (
                        <tr>
                          <td colSpan={7} className="px-5 py-10 text-center text-zinc-600">
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

          {/* Invite Codes Tab */}
          {tab === "invites" && (
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
                <p className="text-sm text-zinc-500">
                  单次使用邀请码，供新用户注册（需启用 &quot;require_invite&quot; 功能开关）
                </p>
                <button
                  onClick={handleCreateInvite}
                  disabled={creatingInvite}
                  className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 shrink-0"
                >
                  {creatingInvite ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  生成邀请码
                </button>
              </div>

              {invitesLoading ? (
                <div className="flex justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
                </div>
              ) : inviteCodes.length === 0 ? (
                <div className="text-center py-16 text-zinc-600">
                  暂无邀请码，点击 &quot;生成邀请码&quot; 创建
                </div>
              ) : (
                <div className="space-y-2">
                  {inviteCodes.map((ic) => (
                    <div
                      key={ic.ID}
                      className={`flex items-center justify-between px-4 py-3 rounded-xl border ${
                        ic.UsedBy
                          ? "bg-zinc-950/50 border-zinc-800 opacity-50"
                          : "bg-zinc-900 border-zinc-700"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <KeyRound className="w-4 h-4 text-zinc-500 shrink-0" />
                        <span className="font-mono text-sm tracking-widest text-zinc-200">{ic.Code}</span>
                        {ic.UsedBy ? (
                          <span className="text-xs text-zinc-600 bg-zinc-800 px-2 py-0.5 rounded">已使用</span>
                        ) : (
                          <span className="text-xs text-green-700 bg-green-900/20 px-2 py-0.5 rounded border border-green-800/30">未使用</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-600 hidden sm:block" suppressHydrationWarning>
                          {new Date(ic.CreatedAt).toLocaleDateString("zh-CN")}
                        </span>
                        {!ic.UsedBy && (
                          <button
                            onClick={() => handleCopyCode(ic.Code)}
                            className="p-1.5 text-zinc-500 hover:text-zinc-200 transition-colors"
                            title="复制邀请码"
                          >
                            {copiedCode === ic.Code ? (
                              <Check className="w-4 h-4 text-green-400" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* AI Rate Limits Tab */}
          {tab === "ratelimits" && (
            <div className="space-y-6">
              {rlMsg && (
                <div className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-sm">
                  {rlMsg}
                </div>
              )}

              {/* Create rule form */}
              <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5">
                <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-4">
                  添加限速规则
                </h3>
                <form onSubmit={handleCreateRateLimit} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {/* Target type */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-zinc-500">生效范围</label>
                    <select
                      value={rlForm.targetType}
                      onChange={(e) => setRlForm((f) => ({ ...f, targetType: e.target.value }))}
                      className="text-sm bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 py-2"
                    >
                      <option value="all">全局（所有用户）</option>
                      <option value="user">指定用户</option>
                    </select>
                  </div>
                  {/* Target user ID (only when user scope) */}
                  {rlForm.targetType === "user" && (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-zinc-500">用户 ID</label>
                      <input
                        type="number"
                        min={1}
                        placeholder="用户数字 ID"
                        value={rlForm.targetUserId}
                        onChange={(e) => setRlForm((f) => ({ ...f, targetUserId: e.target.value }))}
                        required
                        className="text-sm bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 py-2"
                      />
                    </div>
                  )}
                  {/* Window */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-zinc-500">时间窗口</label>
                    <select
                      value={rlForm.window}
                      onChange={(e) => setRlForm((f) => ({ ...f, window: e.target.value }))}
                      className="text-sm bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 py-2"
                    >
                      <option value="second">每秒</option>
                      <option value="minute">每分钟</option>
                      <option value="hour">每小时</option>
                      <option value="day">每天</option>
                      <option value="week">每周</option>
                      <option value="month">每月</option>
                    </select>
                  </div>
                  {/* Max requests */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-zinc-500">最大次数</label>
                    <input
                      type="number"
                      min={1}
                      placeholder="如：10"
                      value={rlForm.maxRequests}
                      onChange={(e) => setRlForm((f) => ({ ...f, maxRequests: e.target.value }))}
                      required
                      className="text-sm bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 py-2"
                    />
                  </div>
                  {/* Note */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-zinc-500">备注（可选）</label>
                    <input
                      type="text"
                      placeholder="管理员备注"
                      value={rlForm.note}
                      onChange={(e) => setRlForm((f) => ({ ...f, note: e.target.value }))}
                      className="text-sm bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 py-2"
                    />
                  </div>
                  {/* Enabled + submit */}
                  <div className="flex items-end gap-3">
                    <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rlForm.enabled}
                        onChange={(e) => setRlForm((f) => ({ ...f, enabled: e.target.checked }))}
                        className="w-4 h-4 rounded accent-blue-500"
                      />
                      立即启用
                    </label>
                    <button
                      type="submit"
                      disabled={rlCreating}
                      className="flex items-center gap-2 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      {rlCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      添加规则
                    </button>
                  </div>
                </form>
              </div>

              {/* Rules list */}
              {rlLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
                </div>
              ) : rateLimits.length === 0 ? (
                <div className="text-center py-16 text-zinc-600">
                  暂无限速规则，添加后对 AI 分析请求生效
                </div>
              ) : (
                <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-950/50">
                        <th className="text-left px-4 py-3 text-zinc-500 font-medium">生效范围</th>
                        <th className="text-left px-4 py-3 text-zinc-500 font-medium">时间窗口</th>
                        <th className="text-left px-4 py-3 text-zinc-500 font-medium">最大次数</th>
                        <th className="text-left px-4 py-3 text-zinc-500 font-medium hidden md:table-cell">备注</th>
                        <th className="text-left px-4 py-3 text-zinc-500 font-medium">状态</th>
                        <th className="text-right px-4 py-3 text-zinc-500 font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rateLimits.map((rl) => {
                        const windowLabels: Record<string, string> = {
                          second: "每秒", minute: "每分钟", hour: "每小时",
                          day: "每天", week: "每周", month: "每月",
                        };
                        return (
                          <tr key={rl.ID} className="border-b border-zinc-800/50 last:border-0">
                            <td className="px-4 py-3 font-medium">
                              {rl.TargetType === "all"
                                ? "全局"
                                : <span className="text-blue-400">{rl.target_username || `用户 #${rl.TargetUserID}`}</span>}
                            </td>
                            <td className="px-4 py-3 text-zinc-400">
                              {windowLabels[rl.Window] ?? rl.Window}
                            </td>
                            <td className="px-4 py-3 font-mono tabular-nums">
                              {rl.MaxRequests} 次
                            </td>
                            <td className="px-4 py-3 text-zinc-500 hidden md:table-cell truncate max-w-[160px]">
                              {rl.Note || "—"}
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => handleToggleRateLimit(rl)}
                                className={`text-xs px-2 py-0.5 rounded font-medium transition-colors ${
                                  rl.Enabled
                                    ? "bg-green-900/30 text-green-400 border border-green-800/40 hover:bg-red-900/30 hover:text-red-400 hover:border-red-800/40"
                                    : "bg-zinc-800 text-zinc-500 border border-zinc-700 hover:bg-green-900/30 hover:text-green-400 hover:border-green-800/40"
                                }`}
                              >
                                {rl.Enabled ? "已启用" : "已禁用"}
                              </button>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => handleDeleteRateLimit(rl.ID)}
                                className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors"
                                title="删除规则"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Async Jobs Tab */}
          {tab === "jobs" && (
            <div className="space-y-6">
              {jobMsg && (
                <div className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-sm">
                  {jobMsg}
                </div>
              )}

              <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide">异步任务控制台</h3>
                    <p className="text-sm text-zinc-500 mt-1">查看重试、死信和租约回收状态。当前共 {jobsTotal} 条任务记录。</p>
                  </div>
                  <button
                    onClick={loadJobs}
                    disabled={jobsLoading}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {jobsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    刷新
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-zinc-500">状态筛选</span>
                    <select
                      value={jobStatusFilter}
                      onChange={(e) => setJobStatusFilter(e.target.value)}
                      className="text-sm bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 py-2"
                    >
                      <option value="">全部状态</option>
                      <option value="pending">pending</option>
                      <option value="processing">processing</option>
                      <option value="retry_scheduled">retry_scheduled</option>
                      <option value="completed">completed</option>
                      <option value="dead_letter">dead_letter</option>
                      <option value="cancelled">cancelled</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-zinc-500">任务类型</span>
                    <select
                      value={jobTypeFilter}
                      onChange={(e) => setJobTypeFilter(e.target.value)}
                      className="text-sm bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg px-3 py-2"
                    >
                      <option value="">全部任务</option>
                      <option value="image_processing">image_processing</option>
                      <option value="ai_analysis">ai_analysis</option>
                      <option value="infer_params">infer_params</option>
                      <option value="auto_tag">auto_tag</option>
                      <option value="export_photo">export_photo</option>
                      <option value="export_album">export_album</option>
                      <option value="backup_export">backup_export</option>
                    </select>
                  </label>
                </div>
              </div>

              {jobsLoading ? (
                <div className="flex justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
                </div>
              ) : jobs.length === 0 ? (
                <div className="text-center py-16 text-zinc-600">
                  当前筛选条件下没有任务记录
                </div>
              ) : (
                <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm min-w-[920px]">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-950/50">
                        <th className="text-left px-4 py-3 text-zinc-500 font-medium">ID</th>
                        <th className="text-left px-4 py-3 text-zinc-500 font-medium">任务</th>
                        <th className="text-left px-4 py-3 text-zinc-500 font-medium">资源</th>
                        <th className="text-left px-4 py-3 text-zinc-500 font-medium">状态</th>
                        <th className="text-left px-4 py-3 text-zinc-500 font-medium">尝试</th>
                        <th className="text-left px-4 py-3 text-zinc-500 font-medium">下次重试 / 租约</th>
                        <th className="text-left px-4 py-3 text-zinc-500 font-medium">错误</th>
                        <th className="text-right px-4 py-3 text-zinc-500 font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((job) => (
                        <tr key={job.ID} className="border-b border-zinc-800/50 last:border-0">
                          <td className="px-4 py-3 text-zinc-500 tabular-nums">{job.ID}</td>
                          <td className="px-4 py-3">
                            <div className="font-medium">{job.TaskType}</div>
                            <div className="text-xs text-zinc-500" suppressHydrationWarning>
                              {job.CreatedAt ? new Date(job.CreatedAt).toLocaleString("zh-CN") : "—"}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-zinc-400">
                            {job.ResourceType} #{job.ResourceID}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${
                              job.Status === "dead_letter"
                                ? "border-red-800/40 bg-red-900/20 text-red-300"
                                : job.Status === "retry_scheduled"
                                  ? "border-amber-800/40 bg-amber-900/20 text-amber-300"
                                  : job.Status === "completed"
                                    ? "border-green-800/40 bg-green-900/20 text-green-300"
                                    : "border-zinc-700 bg-zinc-800 text-zinc-300"
                            }`}>
                              {job.Status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-zinc-400 tabular-nums">
                            {job.AttemptCount} / {job.MaxAttempts}
                          </td>
                          <td className="px-4 py-3 text-zinc-500 text-xs" suppressHydrationWarning>
                            {job.NextAttemptAt
                              ? `重试：${new Date(job.NextAttemptAt).toLocaleString("zh-CN")}`
                              : job.LeaseExpiresAt
                                ? `租约：${new Date(job.LeaseExpiresAt).toLocaleString("zh-CN")}`
                                : "—"}
                          </td>
                          <td className="px-4 py-3 text-zinc-500 max-w-[280px] truncate" title={job.LastError || ""}>
                            {job.LastError || "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {job.Status === "dead_letter" ? (
                              <button
                                onClick={() => handleRetryJob(job.ID)}
                                disabled={retryingJob === job.ID}
                                className="inline-flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                              >
                                {retryingJob === job.ID
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  : <RefreshCw className="w-3.5 h-3.5" />}
                                重试
                              </button>
                            ) : (
                              <span className="text-zinc-600 text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
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
