"use client";

import { useState, useEffect } from "react";
import { Save, Loader2 } from "lucide-react";

interface AIConfig {
  BaseURL: string;
  APIKey: string;
  ModelName: string;
}

export default function SettingsPage() {
  const [config, setConfig] = useState<AIConfig>({
    BaseURL: "",
    APIKey: "",
    ModelName: "",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/config/ai");
      if (res.ok) {
        const data = await res.json();
        if (data.BaseURL) {
          setConfig(data);
        }
      }
    } catch (error) {
      console.error("Failed to fetch config:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage({ text: "", type: "" });

    try {
      const res = await fetch("/api/config/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(config),
      });

      if (res.ok) {
        setMessage({ text: "Settings saved successfully!", type: "success" });
      } else {
        setMessage({ text: "Failed to save settings.", type: "error" });
      }
    } catch (error) {
      setMessage({ text: "An error occurred while saving.", type: "error" });
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

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans p-8">
      <div className="max-w-2xl mx-auto">
        <header className="mb-12">
          <h1 className="text-4xl font-bold tracking-tight">Settings</h1>
          <p className="text-zinc-500 dark:text-zinc-400 mt-2">Configure your AI integration.</p>
        </header>

        <main>
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 md:p-8">
            <h2 className="text-xl font-semibold mb-6">AI Model Configuration</h2>
            
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="baseURL" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  Base URL
                </label>
                <input
                  type="url"
                  id="baseURL"
                  value={config.BaseURL}
                  onChange={(e) => setConfig({ ...config, BaseURL: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  className="w-full px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  required
                />
                <p className="text-xs text-zinc-500 mt-2">The API endpoint for your chosen AI provider.</p>
              </div>

              <div>
                <label htmlFor="apiKey" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  API Key
                </label>
                <input
                  type="password"
                  id="apiKey"
                  value={config.APIKey}
                  onChange={(e) => setConfig({ ...config, APIKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  required
                />
                <p className="text-xs text-zinc-500 mt-2">Your secret API key. It will be stored securely.</p>
              </div>

              <div>
                <label htmlFor="modelName" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                  Model Name
                </label>
                <input
                  type="text"
                  id="modelName"
                  value={config.ModelName}
                  onChange={(e) => setConfig({ ...config, ModelName: e.target.value })}
                  placeholder="gpt-4o"
                  className="w-full px-4 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  required
                />
                <p className="text-xs text-zinc-500 mt-2">The specific model to use for image analysis (e.g., gpt-4o, claude-3-5-sonnet-20240620).</p>
              </div>

              {message.text && (
                <div className={`p-4 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
                  {message.text}
                </div>
              )}

              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-2.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50"
                >
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save Configuration
                </button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
