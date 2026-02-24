"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import {
  ArrowLeft, Trash2, Loader2, Share2, Link2, Link2Off,
  Pencil, Check, X, Images, Plus
} from "lucide-react";

interface Photo {
  ID: number;
  OriginalFilename: string;
  MinioPath: string;
  Status: string;
}

interface Album {
  ID: number;
  Name: string;
  Description: string;
  CoverPhotoID: number | null;
  ShareToken: string;
  Photos: Photo[];
  CreatedAt: string;
}

function thumbUrl(photo: Photo) {
  const p = photo.MinioPath.replace("raw/", "thumb/").replace(/\.[^/.]+$/, ".webp");
  return `/api/image?path=${encodeURIComponent(p)}`;
}

export default function AlbumDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { authFetch } = useAuth();

  const [album, setAlbum] = useState<Album | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    authFetch(`/api/albums/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setAlbum(data);
        if (data) { setEditName(data.Name); setEditDesc(data.Description); }
      })
      .finally(() => setLoading(false));
  }, [id, authFetch]);

  useEffect(load, [load]);

  const handleSave = async () => {
    if (!editName.trim() || !album) return;
    setSaving(true);
    try {
      const res = await authFetch(`/api/albums/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), description: editDesc.trim() }),
      });
      if (res.ok) {
        const updated = await res.json();
        setAlbum((prev) => prev ? { ...prev, Name: updated.Name, Description: updated.Description } : null);
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRemovePhoto = async (photoId: number) => {
    if (!album) return;
    await authFetch(`/api/albums/${id}/photos/${photoId}`, { method: "DELETE" });
    setAlbum((prev) => prev ? { ...prev, Photos: prev.Photos.filter((p) => p.ID !== photoId) } : null);
  };

  const handleShare = async () => {
    if (!album) return;
    setSharing(true);
    try {
      const res = await authFetch(`/api/albums/${id}/share`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setAlbum((prev) => prev ? { ...prev, ShareToken: data.share_token } : null);
      }
    } finally {
      setSharing(false);
    }
  };

  const handleRevokeShare = async () => {
    if (!album || !confirm("撤销分享链接？原链接将立即失效。")) return;
    await authFetch(`/api/albums/${id}/share`, { method: "DELETE" });
    setAlbum((prev) => prev ? { ...prev, ShareToken: "" } : null);
  };

  const handleCopyLink = () => {
    if (!album?.ShareToken) return;
    const url = `${window.location.origin}/share/album/${album.ShareToken}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!album) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-500 text-sm">
        相册不存在
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Back */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        相册列表
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex-1">
          {editing ? (
            <div className="space-y-2">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-lg font-semibold text-zinc-200 focus:outline-none focus:border-zinc-500"
                autoFocus
              />
              <input
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-400 focus:outline-none focus:border-zinc-500"
                placeholder="相册简介（可选）"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving || !editName.trim()}
                  className="flex items-center gap-1 px-3 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 rounded-lg text-zinc-200 disabled:opacity-50 transition-colors"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  保存
                </button>
                <button
                  onClick={() => { setEditing(false); setEditName(album.Name); setEditDesc(album.Description); }}
                  className="flex items-center gap-1 px-3 py-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <X className="w-3 h-3" /> 取消
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold text-zinc-200">{album.Name}</h1>
                <button onClick={() => setEditing(true)} className="text-zinc-600 hover:text-zinc-400 transition-colors">
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
              {album.Description && <p className="text-sm text-zinc-500 mt-1">{album.Description}</p>}
              <p className="text-xs text-zinc-600 mt-1">{album.Photos?.length ?? 0} 张照片</p>
            </div>
          )}
        </div>

        {/* Share controls */}
        <div className="flex items-center gap-2 shrink-0">
          {album.ShareToken ? (
            <>
              <button
                onClick={handleCopyLink}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/20 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
                {copied ? "已复制" : "复制链接"}
              </button>
              <button
                onClick={handleRevokeShare}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-500 hover:text-red-400 border border-zinc-700 rounded-lg transition-colors"
                title="撤销分享"
              >
                <Link2Off className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <button
              onClick={handleShare}
              disabled={sharing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 rounded-lg transition-colors disabled:opacity-50"
            >
              {sharing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
              生成分享链接
            </button>
          )}
        </div>
      </div>

      {/* Add photos hint */}
      <div className="mb-4 flex items-center gap-2 text-xs text-zinc-600">
        <Plus className="w-3.5 h-3.5" />
        在主页选中照片后，可通过批量操作栏将照片添加到相册
      </div>

      {/* Photos grid */}
      {album.Photos?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-600 gap-3">
          <Images className="w-14 h-14 opacity-40" />
          <p className="text-sm">相册中还没有照片</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {album.Photos?.map((photo) => (
            <div key={photo.ID} className="group relative aspect-square bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800">
              <Link href={`/photo/${photo.ID}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbUrl(photo)}
                  alt={photo.OriginalFilename}
                  className="w-full h-full object-cover"
                />
              </Link>
              <button
                onClick={() => handleRemovePhoto(photo.ID)}
                className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 bg-black/60 hover:bg-red-900/80 text-zinc-300 hover:text-red-200 rounded-full p-1 transition-all"
                title="从相册移除"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
