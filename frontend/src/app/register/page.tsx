"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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

  // Check whether the server requires an invite code for registration
  useEffect(() => {
    fetch("/api/feature/require_invite")
      .then((r) => r.json())
      .then((d) => {
        if (d?.enabled) setRequireInvite(true);
      })
      .catch(() => {/* ignore — assume not required */});
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

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Aperture className="w-8 h-8 text-zinc-300" />
            <span className="text-2xl font-semibold text-zinc-100 tracking-tight">Photogiraffe</span>
          </div>
          <p className="text-zinc-500 text-sm">Create your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
              placeholder="your_username"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors"
              placeholder="at least 8 characters"
            />
          </div>

          {requireInvite && (
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5" />
                Invite Code
              </label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                required
                className="w-full bg-zinc-900 border border-amber-700/60 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-amber-500 transition-colors font-mono tracking-widest"
                placeholder="XXXXXXXXXXXXXXXX"
                maxLength={16}
              />
              <p className="text-xs text-zinc-600 mt-1">An invite code is required to create an account.</p>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg p-3">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-zinc-100 hover:bg-white text-zinc-900 font-medium py-2.5 px-4 rounded-lg text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating account…
              </>
            ) : (
              "Create Account"
            )}
          </button>
        </form>

        <p className="text-center text-zinc-600 text-sm mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-zinc-400 hover:text-zinc-200 transition-colors">
            Sign In
          </Link>
        </p>
      </div>
    </div>
  );
}

