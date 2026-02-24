"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Save, Loader2, ArrowLeft, ChevronDown, Settings, Cpu, HardDrive, User, RefreshCw, CheckCircle } from "lucide-react";
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

type Tab = "general" | "ai" | "storage" | "account";

// ─── Component ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { authFetch, user } = useAuth();
  const [tab, setTab] = useState<Tab>("ai");

  // AI Config
  const [config, setConfig] = useState<AIConfig>({ Provider: "openai", BaseURL: "", APIKey: "", ModelName: "gpt-4o" });
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

  const isSuperAdmin = user?.role === "SuperAdmin";

  useEffect(() => {
    fetchConfig();
  }, []);

  useEffect(() => {
    if (tab === "storage" && isSuperAdmin) {
      fetchStorageConfig();
    }
  }, [tab, isSuperAdmin]);

  const fetchConfig = async () => {
    try {
      const res = await authFetch("/api/config/ai");
      if (res.ok) {
        const data = await res.json();
        if (data.APIKey) {
          setConfig({ Provider: data.Provider || "openai_compatible", BaseURL: data.BaseURL || "", APIKey: data.APIKey, ModelName: data.ModelName || "" });
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

  const TABS: { key: Tab; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
    { key: "general", label: "通用", icon: <Settings size={16} /> },
    { key: "ai", label: "AI API", icon: <Cpu size={16} /> },
    { key: "storage", label: "存储", icon: <HardDrive size={16} />, adminOnly: true },
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
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-4">
            <h2 className="text-lg font-semibold">账号信息</h2>
            {user && (
              <div className="space-y-3 text-sm">
                <div className="flex justify-between py-2 border-b border-zinc-800">
                  <span className="text-zinc-500">用户名</span>
                  <span className="font-medium">{user.username}</span>
                </div>
                <div className="flex justify-between py-2 border-b border-zinc-800">
                  <span className="text-zinc-500">邮箱</span>
                  <span>{user.email}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-zinc-500">角色</span>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${user.role === "SuperAdmin" ? "bg-amber-900/30 text-amber-400" : "bg-zinc-800 text-zinc-400"}`}>
                    {user.role}
                  </span>
                </div>
              </div>
            )}
            <p className="text-xs text-zinc-600 pt-2">更多账号设置（修改密码等）即将推出。</p>
          </div>
        )}
      </div>
    </div>
    </AuthGuard>
  );
}
