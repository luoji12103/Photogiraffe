"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Save, Loader2, ArrowLeft, ChevronDown, Settings, Cpu, HardDrive, User, RefreshCw, CheckCircle, Mail } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import AuthGuard from "@/components/AuthGuard";

// ─── Provider catalogue ───────────────────────────────────────────────────────

interface ProviderMeta {
  label: string;
  models: string[];
  note?: string;
  needsBaseUrl?: boolean;
}

const PROVIDERS: Record<string, ProviderMeta> = {
  openai: {
    label: "OpenAI",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o4-mini", "o3"],
  },
  google: {
    label: "Google Gemini",
    models: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-2.5-pro-preview", "gemini-1.5-pro", "gemini-1.5-flash"],
  },
  anthropic: {
    label: "Anthropic Claude",
    models: ["claude-opus-4-5", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-haiku-20240307"],
  },
  kimi: {
    label: "Kimi (Moonshot)",
    models: [
      "kimi-k2.5",
      "moonshot-v1-32k-vision-preview",
      "moonshot-v1-8k-vision-preview",
      "moonshot-v1-128k-vision-preview",
      "kimi-k2-0905-preview",
      "kimi-k2-turbo-preview",
      "kimi-k2-thinking",
      "kimi-k2-thinking-turbo",
    ],
    note: "推荐使用 kimi-k2.5（原生多模态视觉）进行图片分析",
  },
  zhipu: {
    label: "智谱AI (GLM)",
    models: ["glm-4v-plus", "glm-4v-plus-0111", "glm-4v", "glm-4-plus"],
  },
  deepseek: {
    label: "DeepSeek",
    models: ["deepseek-chat", "deepseek-reasoner"],
    note: "DeepSeek 视觉 API 暂未开放，图片分析可能不可用",
  },
  minimax: {
    label: "MiniMax",
    models: ["MiniMax-VL-01", "MiniMax-Text-01", "abab6.5s-chat"],
  },
  openai_compatible: {
    label: "自定义 (OpenAI 兼容)",
    models: [],
    needsBaseUrl: true,
  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface AIConfig {
  Provider: string;
  BaseURL: string;
  APIKey: string;
  ModelName: string;
  PromptLanguage: string; // "en" | "zh"
}

interface StorageConfig {
  backend: string;
  endpoint: string;
  bucket: string;
  access_key: string;
  secret_key: string;
  root_path: string;
  use_ssl: boolean;
  region: string;
}

type Tab = "general" | "ai" | "storage" | "account" | "smtp";

// ─── Component ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { authFetch, user } = useAuth();
  const [tab, setTab] = useState<Tab>("ai");

  // AI Config
  const [config, setConfig] = useState<AIConfig>({ Provider: "openai", BaseURL: "", APIKey: "", ModelName: "gpt-4o", PromptLanguage: "en" });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [aiMessage, setAiMessage] = useState({ text: "", type: "" });
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

  // Storage Config
  const [storage, setStorage] = useState<StorageConfig>({ backend: "minio", endpoint: "", bucket: "", access_key: "", secret_key: "", root_path: "", use_ssl: true, region: "" });
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageSaving, setStorageSaving] = useState(false);
  const [storageTesting, setStorageTesting] = useState(false);
  const [storageMessage, setStorageMessage] = useState({ text: "", type: "" });
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  // Account — change password
  const [pwOld, setPwOld] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwNew2, setPwNew2] = useState("");
  const [pwMsg, setPwMsg] = useState({ text: "", type: "" });
  const [pwSaving, setPwSaving] = useState(false);

  // Account — update profile
  const [profUsername, setProfUsername] = useState("");
  const [profEmail, setProfEmail] = useState("");
  const [profMsg, setProfMsg] = useState({ text: "", type: "" });
  const [profSaving, setProfSaving] = useState(false);

  // Account — login history
  type LoginEntry = { ip: string; user_agent: string; success: boolean; at: string };
  const [loginHistory, setLoginHistory] = useState<LoginEntry[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  // Phase 33 — Storage Usage (own quota)
  type StorageUsage = { quota_bytes: number; used_bytes: number; available_bytes: number; percent: number };
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);

  // SMTP Config
  const [smtpCfg, setSmtpCfg] = useState({ host: "", port: 587, username: "", password: "", from_name: "Photogiraffe", use_tls: true, enabled: false });
  const [smtpLoading, setSmtpLoading] = useState(false);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpMsg, setSmtpMsg] = useState({ text: "", type: "" });

  const isSuperAdmin = user?.role === "SuperAdmin";

  useEffect(() => {
    fetchConfig();
  }, []);

  useEffect(() => {
    if (tab === "storage" && isSuperAdmin) {
      fetchStorageConfig();
    }
    if (tab === "smtp" && isSuperAdmin) {
      fetchSmtpConfig();
    }
    if (tab === "account") {
      fetchLoginHistory();
      if (user) { setProfUsername(user.username); setProfEmail(user.email); }
      authFetch("/api/storage/usage").then(r => r.ok ? r.json() : null).then(d => d && setStorageUsage(d));
    }
  }, [tab, isSuperAdmin]);

  const fetchConfig = async () => {
    try {
      const res = await authFetch("/api/config/ai");
      if (res.ok) {
        const data = await res.json();
        if (data.APIKey) {
          setConfig({ Provider: data.Provider || "openai_compatible", BaseURL: data.BaseURL || "", APIKey: data.APIKey, ModelName: data.ModelName || "", PromptLanguage: data.PromptLanguage || "en" });
        }
      }
    } catch (error) { console.error("Failed to fetch config:", error); }
    finally { setIsLoading(false); }
  };

  const fetchStorageConfig = async () => {
    setStorageLoading(true);
    try {
      const res = await authFetch("/api/admin/storage");
      if (res.ok) {
        const data = await res.json();
        setStorage({
          backend: data.Backend || "minio",
          endpoint: data.Endpoint || "",
          bucket: data.Bucket || "",
          access_key: data.AccessKey || "",
          secret_key: data.SecretKey || "",
          root_path: data.RootPath || "",
          use_ssl: data.UseSSL ?? true,
          region: data.Region || "",
        });
      }
    } catch (e) { console.error(e); }
    finally { setStorageLoading(false); }
  };

  const handleProviderChange = (provider: string) => {
    const meta = PROVIDERS[provider];
    setConfig((prev) => ({ ...prev, Provider: provider, ModelName: meta.models[0] ?? prev.ModelName, BaseURL: provider !== "openai_compatible" ? "" : prev.BaseURL }));
    setModelDropdownOpen(false);
  };

  const handleAiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setAiMessage({ text: "", type: "" });
    try {
      const res = await authFetch("/api/config/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
      if (res.ok) setAiMessage({ text: "配置已保存。", type: "success" });
      else { const err = await res.json(); setAiMessage({ text: err.error || "保存失败。", type: "error" }); }
    } catch { setAiMessage({ text: "保存时发生错误。", type: "error" }); }
    finally { setIsSaving(false); }
  };

  const handleStorageSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setStorageSaving(true);
    setStorageMessage({ text: "", type: "" });
    try {
      const res = await authFetch("/api/admin/storage", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(storage) });
      if (res.ok) setStorageMessage({ text: "存储配置已保存。", type: "success" });
      else { const err = await res.json(); setStorageMessage({ text: err.error || "保存失败。", type: "error" }); }
    } catch { setStorageMessage({ text: "保存时发生错误。", type: "error" }); }
    finally { setStorageSaving(false); }
  };

  const handleStorageTest = async () => {
    setStorageTesting(true);
    setTestResult(null);
    try {
      const res = await authFetch("/api/admin/storage/test", { method: "POST" });
      const data = await res.json();
      setTestResult({ ok: data.ok, error: data.error });
    } catch { setTestResult({ ok: false, error: "请求失败" }); }
    finally { setStorageTesting(false); }
  };

  const fetchLoginHistory = async () => {
    setHistLoading(true);
    try {
      const res = await authFetch("/api/auth/login-history");
      if (res.ok) setLoginHistory(await res.json());
    } catch { /* ignore */ }
    finally { setHistLoading(false); }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg({ text: "", type: "" });
    if (pwNew !== pwNew2) { setPwMsg({ text: "两次密码不一致", type: "error" }); return; }
    setPwSaving(true);
    try {
      const res = await authFetch("/api/auth/change-password", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ old_password: pwOld, new_password: pwNew }) });
      const data = await res.json();
      if (res.ok) { setPwMsg({ text: data.message || "密码已修改，请重新登录。", type: "success" }); setPwOld(""); setPwNew(""); setPwNew2(""); }
      else setPwMsg({ text: data.error || "修改失败", type: "error" });
    } catch { setPwMsg({ text: "请求失败", type: "error" }); }
    finally { setPwSaving(false); }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfMsg({ text: "", type: "" });
    setProfSaving(true);
    try {
      const res = await authFetch("/api/auth/update-profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: profUsername, email: profEmail }) });
      const data = await res.json();
      if (res.ok) setProfMsg({ text: "个人信息已更新。", type: "success" });
      else setProfMsg({ text: data.error || "更新失败", type: "error" });
    } catch { setProfMsg({ text: "请求失败", type: "error" }); }
    finally { setProfSaving(false); }
  };

  const fetchSmtpConfig = async () => {
    setSmtpLoading(true);
    try {
      const res = await authFetch("/api/admin/smtp");
      if (res.ok) {
        const d = await res.json();
        setSmtpCfg({ host: d.host || "", port: d.port || 587, username: d.username || "", password: "", from_name: d.from_name || "Photogiraffe", use_tls: d.use_tls ?? true, enabled: d.enabled ?? false });
      }
    } catch { /* ignore */ }
    finally { setSmtpLoading(false); }
  };

  const handleSmtpSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSmtpSaving(true);
    setSmtpMsg({ text: "", type: "" });
    try {
      const res = await authFetch("/api/admin/smtp", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(smtpCfg) });
      if (res.ok) setSmtpMsg({ text: "SMTP 配置已保存。", type: "success" });
      else { const err = await res.json(); setSmtpMsg({ text: err.error || "保存失败", type: "error" }); }
    } catch { setSmtpMsg({ text: "请求失败", type: "error" }); }
    finally { setSmtpSaving(false); }
  };

  const handleSmtpTest = async () => {
    setSmtpTesting(true);
    setSmtpMsg({ text: "", type: "" });
    try {
      const res = await authFetch("/api/admin/smtp/test", { method: "POST" });
      const d = await res.json();
      setSmtpMsg({ text: res.ok ? (d.message || "测试邮件已发送") : (d.error || "发送失败"), type: res.ok ? "success" : "error" });
    } catch { setSmtpMsg({ text: "请求失败", type: "error" }); }
    finally { setSmtpTesting(false); }
  };

  const TABS: { key: Tab; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
    { key: "general", label: "通用", icon: <Settings size={16} /> },
    { key: "ai", label: "AI API", icon: <Cpu size={16} /> },
    { key: "storage", label: "存储", icon: <HardDrive size={16} />, adminOnly: true },
    { key: "smtp", label: "SMTP", icon: <Mail size={16} />, adminOnly: true },
    { key: "account", label: "账号", icon: <User size={16} /> },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  const currentProvider = PROVIDERS[config.Provider] ?? PROVIDERS["openai_compatible"];

  return (
    <AuthGuard>
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans">
      <div className="max-w-3xl mx-auto px-4 sm:px-8 py-8">
        <header className="mb-8 flex items-center gap-4">
          <Link href="/" className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
            <p className="text-zinc-500 dark:text-zinc-400 mt-1 text-sm">应用配置与偏好设置</p>
          </div>
        </header>

        {/* Tabs */}
        <div className="flex gap-1 mb-8 bg-zinc-900 rounded-xl p-1 w-fit">
          {TABS.filter(t => !t.adminOnly || isSuperAdmin).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === key ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {icon}
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* General Tab */}
        {tab === "general" && (
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-4">
            <h2 className="text-lg font-semibold">通用设置</h2>
            <p className="text-sm text-zinc-500">应用主题、语言等通用偏好设置（即将推出）。</p>
          </div>
        )}

        {/* AI API Tab */}
        {tab === "ai" && (
          <AuthGuard adminOnly>
          <form onSubmit={handleAiSubmit} className="space-y-6">
            <section className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 md:p-8 space-y-6">
              <h2 className="text-lg font-semibold">AI 分析配置</h2>

              {/* Provider selector */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">AI 服务商</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {Object.entries(PROVIDERS).map(([key, meta]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleProviderChange(key)}
                      className={`px-3 py-2 rounded-lg text-sm text-left border transition-colors ${
                        config.Provider === key
                          ? "border-blue-500 bg-blue-500/10 text-blue-400 font-medium"
                          : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                      }`}
                    >
                      {meta.label}
                    </button>
                  ))}
                </div>
                {currentProvider.note && <p className="text-xs text-yellow-500 mt-2">⚠ {currentProvider.note}</p>}
              </div>

              {/* Model selector */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">模型</label>
                {currentProvider.models.length > 0 ? (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setModelDropdownOpen((o) => !o)}
                      className="w-full flex items-center justify-between px-4 py-2 rounded-lg border border-zinc-700 bg-transparent hover:border-zinc-500 transition-all text-sm"
                    >
                      <span>{config.ModelName || "选择模型"}</span>
                      <ChevronDown size={16} className={`transition-transform ${modelDropdownOpen ? "rotate-180" : ""}`} />
                    </button>
                    {modelDropdownOpen && (
                      <ul className="absolute z-10 w-full mt-1 bg-zinc-900 border border-zinc-700 rounded-lg overflow-hidden shadow-xl">
                        {currentProvider.models.map((m) => (
                          <li key={m}>
                            <button
                              type="button"
                              onClick={() => { setConfig((prev) => ({ ...prev, ModelName: m })); setModelDropdownOpen(false); }}
                              className={`w-full text-left px-4 py-2 text-sm hover:bg-zinc-800 transition-colors ${config.ModelName === m ? "text-blue-400 font-medium" : "text-zinc-300"}`}
                            >
                              {m}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={config.ModelName}
                    onChange={(e) => setConfig({ ...config, ModelName: e.target.value })}
                    placeholder="输入模型名称"
                    className="w-full px-4 py-2 rounded-lg border border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none text-sm transition-all"
                    required
                  />
                )}
              </div>

              {/* API Key */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">API Key</label>
                <input
                  type="password"
                  value={config.APIKey}
                  onChange={(e) => setConfig({ ...config, APIKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full px-4 py-2 rounded-lg border border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none text-sm transition-all"
                  required
                />
                <p className="text-xs text-zinc-500 mt-1">留空则保留当前密钥。</p>
              </div>

              {/* Prompt Language */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  AI 回复语言
                  <span className="ml-2 text-xs font-normal text-zinc-500">— 控制分析结果和调参建议使用的语言</span>
                </label>
                <div className="flex gap-2">
                  {(["en", "zh"] as const).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => setConfig((prev) => ({ ...prev, PromptLanguage: lang }))}
                      className={`px-5 py-2 rounded-lg text-sm border font-medium transition-colors ${
                        config.PromptLanguage === lang
                          ? "border-blue-500 bg-blue-500/10 text-blue-400"
                          : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                      }`}
                    >
                      {lang === "en" ? "🌐 English" : "🇨🇳 中文"}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-zinc-500 mt-1.5">
                  {config.PromptLanguage === "zh"
                    ? "大模型将使用中文提示词，分析结果以中文返回。"
                    : "The model will be prompted in English and return analysis in English."}
                </p>
              </div>

              {/* Base URL */}
              {currentProvider.needsBaseUrl && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                    Base URL <span className="text-zinc-500 font-normal">(OpenAI 兼容端点)</span>
                  </label>
                  <input
                    type="url"
                    value={config.BaseURL}
                    onChange={(e) => setConfig({ ...config, BaseURL: e.target.value })}
                    placeholder="https://your-provider.com/v1"
                    className="w-full px-4 py-2 rounded-lg border border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none text-sm transition-all"
                    required
                  />
                </div>
              )}

              {aiMessage.text && (
                <div className={`p-3 rounded-lg text-sm ${aiMessage.type === "success" ? "bg-green-900/20 text-green-400" : "bg-red-900/20 text-red-400"}`}>
                  {aiMessage.text}
                </div>
              )}

              <div className="pt-4 border-t border-zinc-800">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex items-center gap-2 px-6 py-2.5 bg-zinc-100 dark:bg-zinc-100 text-zinc-900 rounded-lg font-medium hover:bg-white transition-colors disabled:opacity-50 text-sm"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  保存配置
                </button>
              </div>
            </section>
          </form>
          </AuthGuard>
        )}

        {/* Storage Tab */}
        {tab === "storage" && isSuperAdmin && (
          <form onSubmit={handleStorageSave} className="space-y-6">
            <section className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 md:p-8 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">存储后端配置</h2>
                {storageLoading && <Loader2 size={16} className="animate-spin text-zinc-500" />}
              </div>

              {/* Backend selector */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">存储类型</label>
                <div className="flex gap-2">
                  {["minio", "s3", "webdav"].map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setStorage((s) => ({ ...s, backend: b }))}
                      className={`px-4 py-2 rounded-lg text-sm border transition-colors ${
                        storage.backend === b
                          ? "border-blue-500 bg-blue-500/10 text-blue-400 font-medium"
                          : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                      }`}
                    >
                      {b === "minio" ? "MinIO (当前)" : b === "s3" ? "AWS S3" : "WebDAV"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Endpoint */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  Endpoint{storage.backend === "webdav" ? " (WebDAV URL)" : " (Host:Port)"}
                </label>
                <input
                  type="text"
                  value={storage.endpoint}
                  onChange={(e) => setStorage((s) => ({ ...s, endpoint: e.target.value }))}
                  placeholder={storage.backend === "webdav" ? "https://dav.example.com" : "minio:9000"}
                  className="w-full px-4 py-2 rounded-lg border border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                />
              </div>

              {/* Bucket (not for WebDAV) */}
              {storage.backend !== "webdav" && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Bucket</label>
                  <input
                    type="text"
                    value={storage.bucket}
                    onChange={(e) => setStorage((s) => ({ ...s, bucket: e.target.value }))}
                    placeholder="photos"
                    className="w-full px-4 py-2 rounded-lg border border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  />
                </div>
              )}

              {/* Region (for S3) */}
              {storage.backend === "s3" && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Region</label>
                  <input
                    type="text"
                    value={storage.region}
                    onChange={(e) => setStorage((s) => ({ ...s, region: e.target.value }))}
                    placeholder="us-east-1"
                    className="w-full px-4 py-2 rounded-lg border border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  />
                </div>
              )}

              {/* Access Key */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  {storage.backend === "webdav" ? "用户名" : "Access Key"}
                </label>
                <input
                  type="text"
                  value={storage.access_key}
                  onChange={(e) => setStorage((s) => ({ ...s, access_key: e.target.value }))}
                  className="w-full px-4 py-2 rounded-lg border border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                />
              </div>

              {/* Secret Key */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  {storage.backend === "webdav" ? "密码" : "Secret Key"}
                </label>
                <input
                  type="password"
                  value={storage.secret_key}
                  onChange={(e) => setStorage((s) => ({ ...s, secret_key: e.target.value }))}
                  placeholder="留空则保留当前密钥"
                  className="w-full px-4 py-2 rounded-lg border border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                />
              </div>

              {/* Root Path */}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Root Path (可选)</label>
                <input
                  type="text"
                  value={storage.root_path}
                  onChange={(e) => setStorage((s) => ({ ...s, root_path: e.target.value }))}
                  placeholder="/photos"
                  className="w-full px-4 py-2 rounded-lg border border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                />
              </div>

              {/* Use SSL */}
              {storage.backend !== "webdav" && (
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={storage.use_ssl}
                    onChange={(e) => setStorage((s) => ({ ...s, use_ssl: e.target.checked }))}
                    className="w-4 h-4 rounded border-zinc-700 accent-blue-500"
                  />
                  <span className="text-sm text-zinc-300">使用 SSL/TLS 连接</span>
                </label>
              )}

              {/* Test connection result */}
              {testResult && (
                <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${testResult.ok ? "bg-green-900/20 text-green-400" : "bg-red-900/20 text-red-400"}`}>
                  {testResult.ok ? <CheckCircle size={16} /> : null}
                  {testResult.ok ? "连接测试成功" : `连接失败: ${testResult.error}`}
                </div>
              )}

              {storageMessage.text && (
                <div className={`p-3 rounded-lg text-sm ${storageMessage.type === "success" ? "bg-green-900/20 text-green-400" : "bg-red-900/20 text-red-400"}`}>
                  {storageMessage.text}
                </div>
              )}

              <div className="pt-4 border-t border-zinc-800 flex gap-3">
                <button
                  type="button"
                  onClick={handleStorageTest}
                  disabled={storageTesting}
                  className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {storageTesting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  测试连接
                </button>
                <button
                  type="submit"
                  disabled={storageSaving}
                  className="flex items-center gap-2 px-6 py-2 bg-zinc-100 dark:bg-zinc-100 text-zinc-900 rounded-lg font-medium hover:bg-white transition-colors disabled:opacity-50 text-sm"
                >
                  {storageSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  保存存储配置
                </button>
              </div>
            </section>
          </form>
        )}

        {/* Account Tab */}
        {tab === "account" && (
          <div className="space-y-6">
            {/* Update Profile */}
            <section className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-4">
              <h2 className="text-base font-semibold">个人信息</h2>
              <form onSubmit={handleUpdateProfile} className="space-y-4">
                <div>
                  <label className="block text-sm text-zinc-500 mb-1">用户名</label>
                  <input type="text" value={profUsername} onChange={e => setProfUsername(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-zinc-500 mb-1">邮箱</label>
                  <input type="email" value={profEmail} onChange={e => setProfEmail(e.target.value)} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                </div>
                {user && (
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <span>角色：</span>
                    <span className={`px-2 py-0.5 rounded font-medium ${user.role === "SuperAdmin" ? "bg-amber-900/30 text-amber-400" : "bg-zinc-800 text-zinc-400"}`}>{user.role}</span>
                  </div>
                )}
                {profMsg.text && <p className={`text-sm ${profMsg.type === "success" ? "text-green-400" : "text-red-400"}`}>{profMsg.text}</p>}
                <button type="submit" disabled={profSaving} className="bg-zinc-700 hover:bg-zinc-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">{profSaving ? "保存中…" : "保存信息"}</button>
              </form>
            </section>

            {/* Change Password */}
            <section className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-4">
              <h2 className="text-base font-semibold">修改密码</h2>
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div>
                  <label className="block text-sm text-zinc-500 mb-1">当前密码</label>
                  <input type="password" value={pwOld} onChange={e => setPwOld(e.target.value)} autoComplete="current-password" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-zinc-500 mb-1">新密码</label>
                  <input type="password" value={pwNew} onChange={e => setPwNew(e.target.value)} autoComplete="new-password" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-zinc-500 mb-1">确认新密码</label>
                  <input type="password" value={pwNew2} onChange={e => setPwNew2(e.target.value)} autoComplete="new-password" className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                </div>
                {pwMsg.text && <p className={`text-sm ${pwMsg.type === "success" ? "text-green-400" : "text-red-400"}`}>{pwMsg.text}</p>}
                <button type="submit" disabled={pwSaving} className="bg-zinc-700 hover:bg-zinc-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">{pwSaving ? "修改中…" : "修改密码"}</button>
              </form>
            </section>

            {/* Login History */}
            <section className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-3">
              <h2 className="text-base font-semibold">登录历史（最近 10 次）</h2>
              {histLoading ? <p className="text-sm text-zinc-500">加载中…</p> : loginHistory.length === 0 ? <p className="text-sm text-zinc-600">暂无记录</p> : (
                <ul className="space-y-1 text-xs text-zinc-400">
                  {loginHistory.map((h, i) => (
                    <li key={i} className="flex items-center gap-3 py-1.5 border-b border-zinc-800 last:border-0">
                      <span className={h.success ? "text-green-400" : "text-red-400"}>{h.success ? "✓" : "✗"}</span>
                      <span className="font-mono">{h.ip}</span>
                      <span className="truncate max-w-[200px] text-zinc-600">{h.user_agent}</span>
                      <span className="ml-auto shrink-0 text-zinc-600">{new Date(h.at).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        {/* SMTP Tab */}
        {tab === "smtp" && isSuperAdmin && (
          <section className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 md:p-8 space-y-6">
            <h2 className="text-lg font-semibold">SMTP 邮件配置</h2>
            {smtpLoading ? <p className="text-sm text-zinc-500">加载中…</p> : (
              <form onSubmit={handleSmtpSave} className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm text-zinc-500 mb-1">SMTP 主机</label>
                    <input type="text" placeholder="smtp.gmail.com" value={smtpCfg.host} onChange={e => setSmtpCfg(p => ({...p, host: e.target.value}))} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm text-zinc-500 mb-1">端口</label>
                    <input type="number" value={smtpCfg.port} onChange={e => setSmtpCfg(p => ({...p, port: Number(e.target.value)}))} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-zinc-500 mb-1">用户名（发件人邮箱）</label>
                  <input type="text" value={smtpCfg.username} onChange={e => setSmtpCfg(p => ({...p, username: e.target.value}))} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-zinc-500 mb-1">授权码 / 密码</label>
                  <input type="password" placeholder="留空则不更改" value={smtpCfg.password} onChange={e => setSmtpCfg(p => ({...p, password: e.target.value}))} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm text-zinc-500 mb-1">发件人名称</label>
                  <input type="text" value={smtpCfg.from_name} onChange={e => setSmtpCfg(p => ({...p, from_name: e.target.value}))} className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={smtpCfg.use_tls} onChange={e => setSmtpCfg(p => ({...p, use_tls: e.target.checked}))} className="accent-blue-500" />
                    STARTTLS
                  </label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={smtpCfg.enabled} onChange={e => setSmtpCfg(p => ({...p, enabled: e.target.checked}))} className="accent-blue-500" />
                    启用邮件功能
                  </label>
                </div>
                {smtpMsg.text && <p className={`text-sm ${smtpMsg.type === "success" ? "text-green-400" : "text-red-400"}`}>{smtpMsg.text}</p>}
                <div className="flex gap-3 pt-2">
                  <button type="submit" disabled={smtpSaving} className="bg-zinc-700 hover:bg-zinc-600 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">{smtpSaving ? "保存中…" : "保存配置"}</button>
                  <button type="button" onClick={handleSmtpTest} disabled={smtpTesting || !smtpCfg.enabled} className="bg-blue-900/50 hover:bg-blue-800/60 text-blue-300 px-4 py-2 rounded-lg text-sm disabled:opacity-40">{smtpTesting ? "发送中…" : "发送测试邮件"}</button>
                </div>
              </form>
            )}
          </section>
        )}
      </div>
    </div>
    </AuthGuard>
  );
}
