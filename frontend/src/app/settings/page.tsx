"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Save, Loader2, ArrowLeft, ChevronDown } from "lucide-react";

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
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
  },
  google: {
    label: "Google Gemini",
    models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-2.5-pro-preview", "gemini-2.0-flash-lite"],
  },
  anthropic: {
    label: "Anthropic Claude",
    models: ["claude-opus-4-5", "claude-3-5-sonnet-20241022", "claude-3-haiku-20240307"],
  },
  zhipu: {
    label: "智谱AI (GLM)",
    models: ["glm-4v-plus", "glm-4v"],
  },
  deepseek: {
    label: "DeepSeek",
    models: ["deepseek-chat"],
    note: "视觉支持取决于所选模型",
  },
  minimax: {
    label: "MiniMax",
    models: ["MiniMax-Text-01", "abab6.5s-chat"],
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [config, setConfig] = useState<AIConfig>({
    Provider: "openai",
    BaseURL: "",
    APIKey: "",
    ModelName: "gpt-4o",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/config/ai");
      if (res.ok) {
        const data = await res.json();
        if (data.APIKey) {
          setConfig({
            Provider: data.Provider || "openai_compatible",
            BaseURL: data.BaseURL || "",
            APIKey: data.APIKey,
            ModelName: data.ModelName || "",
          });
        }
      }
    } catch (error) {
      console.error("Failed to fetch config:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleProviderChange = (provider: string) => {
    const meta = PROVIDERS[provider];
    setConfig((prev) => ({
      ...prev,
      Provider: provider,
      ModelName: meta.models[0] ?? prev.ModelName,
      BaseURL: provider !== "openai_compatible" ? "" : prev.BaseURL,
    }));
    setModelDropdownOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage({ text: "", type: "" });
    try {
      const res = await fetch("/api/config/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        setMessage({ text: "配置已保存。", type: "success" });
      } else {
        const err = await res.json();
        setMessage({ text: err.error || "保存失败。", type: "error" });
      }
    } catch {
      setMessage({ text: "保存时发生错误。", type: "error" });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  const currentProvider = PROVIDERS[config.Provider] ?? PROVIDERS["openai_compatible"];

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans p-8">
      <div className="max-w-2xl mx-auto">
        <header className="mb-10 flex items-center gap-4">
          <Link
            href="/"
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
            <p className="text-zinc-500 dark:text-zinc-400 mt-1 text-sm">配置 AI 模型集成。</p>
          </div>
        </header>

        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 md:p-8 space-y-6">
            <h2 className="text-lg font-semibold">AI 分析配置</h2>

            {/* Provider selector */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                AI 服务商
              </label>
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
              {currentProvider.note && (
                <p className="text-xs text-yellow-500 mt-2">⚠ {currentProvider.note}</p>
              )}
            </div>

            {/* Model selector */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                模型
              </label>
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
                            onClick={() => {
                              setConfig((prev) => ({ ...prev, ModelName: m }));
                              setModelDropdownOpen(false);
                            }}
                            className={`w-full text-left px-4 py-2 text-sm hover:bg-zinc-800 transition-colors ${
                              config.ModelName === m ? "text-blue-400 font-medium" : "text-zinc-300"
                            }`}
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
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                API Key
              </label>
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

            {/* Base URL — only for openai_compatible */}
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

            {/* Feedback */}
            {message.text && (
              <div
                className={`p-3 rounded-lg text-sm ${
                  message.type === "success"
                    ? "bg-green-900/20 text-green-400"
                    : "bg-red-900/20 text-red-400"
                }`}
              >
                {message.text}
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
      </div>
    </div>
  );
}

