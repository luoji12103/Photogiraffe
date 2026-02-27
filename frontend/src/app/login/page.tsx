"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { Aperture, Loader2 } from "lucide-react";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      router.replace("/");
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--pg-bg-elevated)",
    border: "1px solid var(--pg-border)",
    color: "var(--pg-text-primary)",
    borderRadius: "var(--pg-radius-md)",
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--pg-bg-base)" }}>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-sm"
      >
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2.5 mb-3">
            <Aperture className="w-8 h-8" style={{ color: "var(--pg-accent)" }} />
            <span className="text-2xl font-semibold tracking-tight" style={{ color: "var(--pg-text-primary)" }}>
              Photogiraffe
            </span>
          </div>
          <p className="text-sm" style={{ color: "var(--pg-text-tertiary)" }}>登录你的账户</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs mb-1.5" style={{ color: "var(--pg-text-secondary)" }}>用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              className="w-full px-3.5 py-2.5 text-sm focus:outline-none transition-colors"
              style={inputStyle}
              placeholder="your_username"
            />
          </div>
          <div>
            <label className="block text-xs mb-1.5" style={{ color: "var(--pg-text-secondary)" }}>密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 text-sm focus:outline-none transition-colors"
              style={inputStyle}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-sm p-3"
              style={{
                color: "var(--pg-error)",
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.15)",
                borderRadius: "var(--pg-radius-md)",
              }}
            >
              {error}
            </motion.div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full font-medium py-2.5 px-4 text-sm transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            style={{
              background: "var(--pg-accent)",
              color: "#fff",
              borderRadius: "var(--pg-radius-md)",
            }}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                登录中…
              </>
            ) : (
              "登 录"
            )}
          </button>
        </form>

        <p className="text-center text-sm mt-6" style={{ color: "var(--pg-text-muted)" }}>
          <Link href="/forgot-password" className="transition-colors" style={{ color: "var(--pg-accent)" }}>
            忘记密码？
          </Link>
        </p>
        <p className="text-center text-sm mt-2" style={{ color: "var(--pg-text-muted)" }}>
          没有账户？{" "}
          <Link href="/register" className="transition-colors" style={{ color: "var(--pg-accent)" }}>
            注册
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
