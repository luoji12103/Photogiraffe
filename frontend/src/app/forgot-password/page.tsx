"use client";

import { useState } from "react";
import Link from "next/link";
import { Aperture, Loader2 } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // ignore errors — always show success (anti-enumeration)
    } finally {
      setLoading(false);
      setDone(true);
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
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2.5 mb-3">
            <Aperture className="w-8 h-8" style={{ color: "var(--pg-accent)" }} />
            <span className="text-2xl font-semibold tracking-tight" style={{ color: "var(--pg-text-primary)" }}>
              Photogiraffe
            </span>
          </div>
          <p className="text-sm" style={{ color: "var(--pg-text-tertiary)" }}>重置密码</p>
        </div>

        {done ? (
          <div className="text-center space-y-4">
            <div className="p-4 rounded-xl text-sm" style={{ background: "var(--pg-bg-elevated)", color: "var(--pg-text-secondary)" }}>
              如果该邮箱已注册，你将在几分钟内收到重置邮件。请检查你的收件箱（以及垃圾邮件文件夹）。
            </div>
            <Link href="/login" className="block text-sm" style={{ color: "var(--pg-accent)" }}>
              返回登录
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs mb-1.5" style={{ color: "var(--pg-text-secondary)" }}>注册邮箱</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                className="w-full px-3.5 py-2.5 text-sm focus:outline-none transition-colors"
                style={inputStyle}
                placeholder="you@example.com"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-xl transition-colors disabled:opacity-60"
              style={{ background: "var(--pg-accent)", color: "#fff" }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              发送重置邮件
            </button>

            <p className="text-center text-xs" style={{ color: "var(--pg-text-tertiary)" }}>
              想起密码了？{" "}
              <Link href="/login" style={{ color: "var(--pg-accent)" }}>
                返回登录
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
