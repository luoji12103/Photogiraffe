"use client";

import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { motion } from "framer-motion";
import {
  UserCircle, Loader2, Check, Upload, Pen, Globe, MapPin, Trash2, ExternalLink,
  Image as ImageIcon, Images, BookOpen,
} from "lucide-react";

interface UserProfile {
  user_id: number;
  bio: string;
  website: string;
  location: string;
  avatar_path: string;
  signature_path: string;
  avatar_url: string;
  signature_url: string;
  updated_at: string;
}

interface UserStats {
  total_photos: number;
  completed_photos: number;
  albums: number;
  presets: number;
}

const inputStyle: React.CSSProperties = {
  background: "var(--pg-bg-elevated)",
  border: "1px solid var(--pg-border)",
  color: "var(--pg-text-primary)",
  borderRadius: "var(--pg-radius-md)",
};

const labelStyle: React.CSSProperties = { color: "var(--pg-text-secondary)" };

export default function ProfilePage() {
  const { authFetch, user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [bio, setBio] = useState("");
  const [website, setWebsite] = useState("");
  const [location, setLocation] = useState("");

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingSignature, setUploadingSignature] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);

  const avatarRef = useRef<HTMLInputElement>(null);
  const signatureRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      authFetch("/api/profile").then((r) => r.ok ? r.json() : null),
      authFetch("/api/stats").then((r) => r.ok ? r.json() : null),
    ]).then(([profileData, statsData]) => {
      if (profileData) {
        setProfile(profileData);
        setBio(profileData.bio ?? "");
        setWebsite(profileData.website ?? "");
        setLocation(profileData.location ?? "");
        setAvatarPreview(profileData.avatar_url || null);
        setSignaturePreview(profileData.signature_url || null);
      }
      if (statsData) setStats(statsData);
    }).finally(() => setLoading(false));
  };

  useEffect(load, [authFetch]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await authFetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bio, website, location }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (
    file: File,
    endpoint: string,
    fieldName: string,
    setUploading: (v: boolean) => void,
    setPreview: (url: string) => void,
    urlKey: string,
  ) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append(fieldName, file);
      const res = await authFetch(endpoint, { method: "POST", body: form });
      if (res.ok) {
        const data = await res.json();
        setPreview(data[urlKey]);
      }
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--pg-bg-base)" }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--pg-accent)" }} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10" style={{ color: "var(--pg-text-primary)" }}>
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-start justify-between mb-8"
      >
        <div className="flex items-center gap-3">
          <UserCircle className="w-6 h-6" style={{ color: "var(--pg-accent)" }} />
          <div>
            <h1 className="text-xl font-semibold">摄影师档案</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--pg-text-muted)" }}>
              @{user?.username}
            </p>
          </div>
        </div>
        {user?.username && (
          <a
            href={`/p/${user.username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
            style={{
              background: "var(--pg-accent-soft)",
              color: "var(--pg-accent)",
              border: "1px solid var(--pg-accent)",
            }}
          >
            <ExternalLink className="w-3 h-3" />
            公开作品集
          </a>
        )}
      </motion.div>

      {/* Stats Row */}
      {stats && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-3 gap-3 mb-8"
        >
          {[
            { icon: ImageIcon, label: "照片", value: stats.completed_photos },
            { icon: Images, label: "相册", value: stats.albums },
            { icon: BookOpen, label: "预设", value: stats.presets },
          ].map(({ icon: Icon, label, value }) => (
            <div
              key={label}
              className="rounded-xl p-4 text-center"
              style={{
                background: "var(--pg-bg-elevated)",
                border: "1px solid var(--pg-border)",
              }}
            >
              <Icon className="w-4 h-4 mx-auto mb-1" style={{ color: "var(--pg-accent)" }} />
              <p className="text-xl font-bold">{value}</p>
              <p className="text-xs" style={{ color: "var(--pg-text-muted)" }}>{label}</p>
            </div>
          ))}
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="space-y-8"
      >
        {/* Avatar */}
        <section
          className="rounded-xl p-5 space-y-4"
          style={{ background: "var(--pg-bg-surface)", border: "1px solid var(--pg-border)" }}
        >
          <h2 className="text-sm font-semibold" style={{ color: "var(--pg-text-secondary)" }}>头像</h2>
          <div className="flex items-center gap-5">
            <div
              className="w-20 h-20 rounded-full overflow-hidden flex items-center justify-center shrink-0"
              style={{ background: "var(--pg-bg-elevated)", border: "2px solid var(--pg-border)" }}
            >
              {avatarPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarPreview} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <UserCircle className="w-10 h-10" style={{ color: "var(--pg-text-muted)" }} />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={avatarRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setAvatarPreview(URL.createObjectURL(f));
                  handleUpload(f, "/api/profile/avatar", "avatar", setUploadingAvatar, setAvatarPreview, "avatar_url");
                }}
              />
              <button
                onClick={() => avatarRef.current?.click()}
                disabled={uploadingAvatar}
                className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors disabled:opacity-50"
                style={{ background: "var(--pg-bg-elevated)", border: "1px solid var(--pg-border)", color: "var(--pg-text-secondary)" }}
              >
                {uploadingAvatar ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploadingAvatar ? "上传中…" : "上传头像"}
              </button>
              <p className="text-xs" style={{ color: "var(--pg-text-muted)" }}>支持 JPG、PNG、WEBP，建议方形图片</p>
            </div>
          </div>
        </section>

        {/* Bio, Website, Location */}
        <section
          className="rounded-xl p-5 space-y-4"
          style={{ background: "var(--pg-bg-surface)", border: "1px solid var(--pg-border)" }}
        >
          <h2 className="text-sm font-semibold" style={{ color: "var(--pg-text-secondary)" }}>个人信息</h2>

          <div className="space-y-1">
            <label className="flex items-center gap-1.5 text-xs" style={labelStyle}>
              <Pen className="w-3 h-3" />摄影师简介
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              placeholder="介绍一下你的风格、装备和拍摄理念…"
              className="w-full px-3 py-2 text-sm resize-none focus:outline-none"
              style={{ ...inputStyle, borderColor: "var(--pg-border)" }}
            />
          </div>

          <div className="space-y-1">
            <label className="flex items-center gap-1.5 text-xs" style={labelStyle}>
              <Globe className="w-3 h-3" />个人网站
            </label>
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://your.portfolio.com"
              className="w-full px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
            />
          </div>

          <div className="space-y-1">
            <label className="flex items-center gap-1.5 text-xs" style={labelStyle}>
              <MapPin className="w-3 h-3" />所在城市
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Beijing · China"
              className="w-full px-3 py-2 text-sm focus:outline-none"
              style={inputStyle}
            />
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-50"
            style={{
              background: saved ? "var(--pg-success)" : "var(--pg-accent)",
              color: "white",
              borderRadius: "var(--pg-radius-md)",
            }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null}
            {saving ? "保存中…" : saved ? "已保存" : "保存信息"}
          </button>
        </section>

        {/* Signature */}
        <section
          className="rounded-xl p-5 space-y-4"
          style={{ background: "var(--pg-bg-surface)", border: "1px solid var(--pg-border)" }}
        >
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "var(--pg-text-secondary)" }}>签名图</h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--pg-text-muted)" }}>
              建议使用透明背景的 PNG 文件，导出照片时可叠加水印
            </p>
          </div>

          <div
            className="relative h-24 rounded-lg flex items-center justify-center overflow-hidden"
            style={{ border: "1px solid var(--pg-border)", background: "var(--pg-bg-elevated)" }}
          >
            <div
              className="absolute inset-0 opacity-10"
              style={{ backgroundImage: "repeating-conic-gradient(#888 0% 25%, transparent 0% 50%)", backgroundSize: "16px 16px" }}
            />
            {signaturePreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={signaturePreview} alt="signature" className="relative max-h-20 max-w-full object-contain" />
            ) : (
              <p className="relative text-xs" style={{ color: "var(--pg-text-muted)" }}>尚未上传签名图</p>
            )}
            {profile?.signature_path && signaturePreview && (
              <button
                className="absolute top-2 right-2 p-1 rounded-full transition-colors"
                style={{ background: "rgba(0,0,0,0.5)", color: "var(--pg-error)" }}
                title="移除签名图"
                onClick={() => setSignaturePreview(null)}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>

          <input
            ref={signatureRef}
            type="file"
            accept="image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setSignaturePreview(URL.createObjectURL(f));
              handleUpload(f, "/api/profile/signature", "signature", setUploadingSignature, setSignaturePreview, "signature_url");
            }}
          />
          <button
            onClick={() => signatureRef.current?.click()}
            disabled={uploadingSignature}
            className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors disabled:opacity-50"
            style={{ background: "var(--pg-bg-elevated)", border: "1px solid var(--pg-border)", color: "var(--pg-text-secondary)" }}
          >
            {uploadingSignature ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploadingSignature ? "上传中…" : "上传签名图"}
          </button>
        </section>
      </motion.div>
    </div>
  );
}


