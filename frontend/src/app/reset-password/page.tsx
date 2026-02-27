"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Aperture, Loader2 } from "lucide-react";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [pwNew, setPwNew] = useState("");
  const [pwNew2, setPwNew2] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });

  useEffect(() => {
    if (!token) setMessage({ text: "无效的重置链接。", type: "error" });
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwNew !== pwNew2) {
      setMessage({ text: "两次密码不一致", type: "error" });
      return;
    }
    if (pwNew.length < 8) {
      setMessage({ text: "密码至少需要 8 位", type: "error" });
      return;
    }
    setLoading(true);
    setMessage({ text: "", type: "" });
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: pwNew }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ text: data.message || "密码已重置，正在跳转…", type: "success" });
        setTimeout(() => router.push("/login"), 1500);
      } else {
        setMessage({ text: data.error || "重置失败，链接可能已过期。", type: "error" });
      }
    } catch {
      setMessage({ text: "请求失败，请稍后重试。", type: "error" });
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
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2.5 mb-3">
            <Aperture className="w-8 h-8" style={{ color: "var(--pg-accent)" }} />
            <span className="text-2xl font-semibold tracking-tight" style={{ color: "var(--pg-text-primary)" }}>
              Photogiraffe
            </span>
          </div>
          <p className="text-sm" style={{ color: "var(--pg-text-tertiary)" }}>设置新密码</p>
        </div>

        {!token ? (
          <div className="text-center space-y-4">
            <p className="text-sm text-red-400">无效的重置链接。</p>
            <Link href="/forgot-password" style={{ color: "var(--pg-accent)" }} className="text-sm">
              重新申请重置
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs mb-1.5" style={{ color: "var(--pg-text-secondary)" }}>新密码</label>
              <input
                type="password"
                value={pwNew}
                onChange={(e) => setPwNew(e.target.value)}
                required
                autoFocus
                autoComplete="new-password"
                className="w-full px-3.5 py-2.5 text-sm focus:outline-none transition-colors"
                style={inputStyle}
                placeholder="至少 8 位"
              />
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={{ color: "var(--pg-text-secondary)" }}>确认新密码</label>
              <input
                type="password"
                value={pwNew2}
                onChange={(e) => setPwNew2(e.target.value)}
                required
                autoComplete="new-password"
                className="w-full px-3.5 py-2.5 text-sm focus:outline-none transition-colors"
                style={inputStyle}
                placeholder="••••••••"
              />
            </div>

            {message.text && (
              <p className={`text-sm ${message.type === "success" ? "text-green-400" : "text-red-400"}`}>
                {message.text}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !token}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-xl transition-colors disabled:opacity-60"
              style={{ background: "var(--pg-accent)", color: "#fff" }}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              确认重置密码
            </button>

            <p className="text-center text-xs" style={{ color: "var(--pg-text-tertiary)" }}>
              <Link href="/login" style={{ color: "var(--pg-accent)" }}>返回登录</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
