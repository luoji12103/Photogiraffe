"use client";

import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  UserCircle, Loader2, Check, Upload, Pen, Globe, MapPin, Trash2,
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

export default function ProfilePage() {
  const { authFetch, user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
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
    authFetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: UserProfile | null) => {
        if (data) {
          setProfile(data);
          setBio(data.bio ?? "");
          setWebsite(data.website ?? "");
          setLocation(data.location ?? "");
          setAvatarPreview(data.avatar_url || null);
          setSignaturePreview(data.signature_url || null);
        }
      })
      .finally(() => setLoading(false));
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
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <UserCircle className="w-6 h-6 text-zinc-400" />
        <div>
          <h1 className="text-xl font-semibold text-zinc-200">摄影师档案</h1>
          <p className="text-xs text-zinc-600 mt-0.5">{user?.username}</p>
        </div>
      </div>

      <div className="space-y-8">
        {/* Avatar */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-zinc-400">头像</h2>
          <div className="flex items-center gap-5">
            <div className="w-20 h-20 rounded-full bg-zinc-800 border border-zinc-700 overflow-hidden flex items-center justify-center shrink-0">
              {avatarPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarPreview} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <UserCircle className="w-10 h-10 text-zinc-600" />
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
                  const local = URL.createObjectURL(f);
                  setAvatarPreview(local);
                  handleUpload(f, "/api/profile/avatar", "avatar", setUploadingAvatar, setAvatarPreview, "avatar_url");
                }}
              />
              <button
                onClick={() => avatarRef.current?.click()}
                disabled={uploadingAvatar}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-lg transition-colors disabled:opacity-50"
              >
                {uploadingAvatar ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploadingAvatar ? "上传中…" : "上传头像"}
              </button>
              <p className="text-xs text-zinc-600">支持 JPG、PNG、WEBP，建议方形图片</p>
            </div>
          </div>
        </section>

        {/* Bio, Website, Location */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-zinc-400">个人信息</h2>

          <div className="space-y-1">
            <label className="flex items-center gap-1.5 text-xs text-zinc-500">
              <Pen className="w-3 h-3" />
              摄影师简介
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              placeholder="介绍一下你的风格、装备和拍摄理念…"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
            />
          </div>

          <div className="space-y-1">
            <label className="flex items-center gap-1.5 text-xs text-zinc-500">
              <Globe className="w-3 h-3" />
              个人网站
            </label>
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://your.portfolio.com"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>

          <div className="space-y-1">
            <label className="flex items-center gap-1.5 text-xs text-zinc-500">
              <MapPin className="w-3 h-3" />
              所在城市
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Beijing · China"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4 text-emerald-400" /> : null}
            {saving ? "保存中…" : saved ? "已保存" : "保存"}
          </button>
        </section>

        {/* Signature */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium text-zinc-400">签名图</h2>
            <p className="text-xs text-zinc-600 mt-0.5">建议使用透明背景的 PNG 文件，导出照片时可叠加水印</p>
          </div>

          {/* Preview */}
          <div className="relative h-24 rounded-lg border border-zinc-700 bg-zinc-900 flex items-center justify-center overflow-hidden">
            {/* Checkered background to visualize transparency */}
            <div
              className="absolute inset-0 opacity-10"
              style={{ backgroundImage: "repeating-conic-gradient(#888 0% 25%, transparent 0% 50%)", backgroundSize: "16px 16px" }}
            />
            {signaturePreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={signaturePreview} alt="signature" className="relative max-h-20 max-w-full object-contain" />
            ) : (
              <p className="relative text-xs text-zinc-600">尚未上传签名图</p>
            )}
            {profile?.signature_path && (
              <button
                className="absolute top-2 right-2 p-1 bg-black/60 hover:bg-red-900/80 rounded-full text-zinc-400 hover:text-red-300 transition-colors"
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
              const local = URL.createObjectURL(f);
              setSignaturePreview(local);
              handleUpload(f, "/api/profile/signature", "signature", setUploadingSignature, setSignaturePreview, "signature_url");
            }}
          />
          <button
            onClick={() => signatureRef.current?.click()}
            disabled={uploadingSignature}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 rounded-lg transition-colors disabled:opacity-50"
          >
            {uploadingSignature ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploadingSignature ? "上传中…" : "上传签名图"}
          </button>
        </section>
      </div>
    </div>
  );
}
