"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { Aperture, Loader2, KeyRound } from "lucide-react";

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [requireInvite, setRequireInvite] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/feature/require_invite")
      .then((r) => r.json())
      .then((d) => { if (d?.enabled) setRequireInvite(true); })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await register(username, email, password, requireInvite ? inviteCode : undefined);
      router.replace("/");
    } catch (err: any) {
      setError(err.message || "Registration failed");
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
          <p className="text-sm" style={{ color: "var(--pg-text-tertiary)" }}>创建你的账户</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs mb-1.5" style={{ color: "var(--pg-text-secondary)" }}>用户名</label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
              required autoFocus className="w-full px-3.5 py-2.5 text-sm focus:outline-none transition-colors"
              style={inputStyle} placeholder="your_username" />
          </div>
          <div>
            <label className="block text-xs mb-1.5" style={{ color: "var(--pg-text-secondary)" }}>邮箱</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              required className="w-full px-3.5 py-2.5 text-sm focus:outline-none transition-colors"
              style={inputStyle} placeholder="you@example.com" />
          </div>
          <div>
            <label className="block text-xs mb-1.5" style={{ color: "var(--pg-text-secondary)" }}>密码</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              required minLength={8} className="w-full px-3.5 py-2.5 text-sm focus:outline-none transition-colors"
              style={inputStyle} placeholder="至少 8 位字符" />
          </div>

          {requireInvite && (
            <div>
              <label className="block text-xs mb-1.5 flex items-center gap-1.5" style={{ color: "var(--pg-text-secondary)" }}>
                <KeyRound className="w-3.5 h-3.5" />
                邀请码
              </label>
              <input type="text" value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                required className="w-full px-3.5 py-2.5 text-sm focus:outline-none transition-colors font-mono tracking-widest"
                style={{ ...inputStyle, borderColor: "var(--pg-warning)" }}
                placeholder="XXXXXXXXXXXXXXXX" maxLength={16} />
              <p className="text-xs mt-1" style={{ color: "var(--pg-text-muted)" }}>注册需要邀请码。</p>
            </div>
          )}

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
            style={{ background: "var(--pg-accent)", color: "#fff", borderRadius: "var(--pg-radius-md)" }}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                注册中…
              </>
            ) : (
              "注 册"
            )}
          </button>
        </form>

        <p className="text-center text-sm mt-6" style={{ color: "var(--pg-text-muted)" }}>
          已有账户？{" "}
          <Link href="/login" className="transition-colors" style={{ color: "var(--pg-accent)" }}>
            登录
          </Link>
        </p>
      </motion.div>
    </div>
  );
}

