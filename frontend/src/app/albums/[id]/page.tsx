"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import {
  ArrowLeft, Trash2, Loader2, Share2, Link2, Link2Off,
  Pencil, Check, X, Images, Plus, Archive, Download, AlertCircle, CheckCircle
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

  // v14.5 — album export state
  type ExportFmt = "zip" | "pdf";
  type PrintSpec = "none" | "4x6" | "5x7" | "a4" | "square";
  type AlbumJobStatus = "idle" | "processing" | "completed" | "failed";
  const [exportFmt, setExportFmt] = useState<ExportFmt>("zip");
  const [exportSpec, setExportSpec] = useState<PrintSpec>("none");
  const [albumJobStatus, setAlbumJobStatus] = useState<AlbumJobStatus>("idle");
  const [albumJobId, setAlbumJobId] = useState<number | null>(null);
  const [albumDownloadUrl, setAlbumDownloadUrl] = useState<string | null>(null);
  const [albumExportError, setAlbumExportError] = useState("");

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

  // v14.5 — album export handlers
  const pollAlbumExport = useCallback((jobId: number) => {
    const timer = setInterval(async () => {
      try {
        const res = await authFetch(`/api/exports/${jobId}`);
        if (!res.ok) return;
        const job = await res.json();
        if (job.Status === "completed") {
          clearInterval(timer);
          setAlbumJobStatus("completed");
          const dlRes = await authFetch(`/api/exports/${jobId}/download`);
          if (dlRes.ok) {
            const dlData = await dlRes.json();
            setAlbumDownloadUrl(dlData.url);
          }
        } else if (job.Status === "failed") {
          clearInterval(timer);
          setAlbumJobStatus("failed");
          setAlbumExportError(job.ErrorMessage || "导出失败");
        }
      } catch { /* ignore */ }
    }, 3000);
    setTimeout(() => {
      clearInterval(timer);
      setAlbumJobStatus(prev => {
        if (prev === "processing") { setAlbumExportError("导出超时，请重试"); return "failed"; }
        return prev;
      });
    }, 10 * 60 * 1000);
  }, [authFetch]);

  const handleAlbumExport = useCallback(async () => {
    if (!album) return;
    setAlbumJobStatus("processing");
    setAlbumDownloadUrl(null);
    setAlbumExportError("");
    try {
      const res = await authFetch(`/api/albums/${id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format: exportFmt,
          print_spec: exportSpec === "none" ? "" : exportSpec,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      setAlbumJobId(data.job_id);
      pollAlbumExport(data.job_id);
    } catch (e: unknown) {
      setAlbumJobStatus("failed");
      setAlbumExportError(e instanceof Error ? e.message : String(e));
    }
  }, [album, id, exportFmt, exportSpec, authFetch, pollAlbumExport]);

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
      {/* v14.5 — Album Export Panel */}
      <div className="mt-8 border-t border-zinc-800 pt-6">
        <div className="flex items-center gap-2 mb-4">
          <Archive className="w-4 h-4 text-zinc-500" />
          <h2 className="text-sm font-medium text-zinc-400">导出相册</h2>
        </div>
        <div className="space-y-3 max-w-sm">
          {/* Format */}
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500">格式</label>
            <div className="flex gap-2">
              {(["zip", "pdf"] as const).map(f => (
                <button key={f} onClick={() => setExportFmt(f)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    exportFmt === f ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-zinc-600">
              {exportFmt === "zip" ? "将相册所有照片打包为 ZIP 压缩包" : "将相册所有照片生成 PDF 文档（含封面与 EXIF 摘要）"}
            </p>
          </div>
          {/* Print spec */}
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500">冲印规格裁切</label>
            <div className="flex flex-wrap gap-1">
              {([
                { label: "不裁切", value: "none" },
                { label: "4×6\"", value: "4x6" },
                { label: "5×7\"", value: "5x7" },
                { label: "A4",    value: "a4"  },
                { label: "正方形", value: "square" },
              ] as const).map(({ label, value }) => (
                <button key={value} onClick={() => setExportSpec(value)}
                  className={`px-2 py-0.5 rounded text-xs transition-colors ${
                    exportSpec === value ? "bg-teal-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Action / Status */}
          {albumJobStatus === "idle" && (
            <button onClick={handleAlbumExport}
              disabled={!album.Photos?.length}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors">
              <Archive className="w-4 h-4" />
              导出相册
            </button>
          )}

          {albumJobStatus === "processing" && (
            <div className="flex items-center gap-2 text-zinc-400 text-sm py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>处理中…{albumJobId && <span className="text-zinc-600 ml-1">#{albumJobId}</span>}</span>
            </div>
          )}

          {albumJobStatus === "completed" && albumDownloadUrl && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-emerald-400 text-sm">
                <CheckCircle className="w-4 h-4" />
                <span>导出完成！</span>
              </div>
              <a href={albumDownloadUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors">
                <Download className="w-4 h-4" />
                下载
              </a>
              <button onClick={() => setAlbumJobStatus("idle")}
                className="block text-xs text-zinc-500 hover:text-zinc-300 transition-colors mt-1">
                重新导出
              </button>
            </div>
          )}

          {albumJobStatus === "failed" && (
            <div className="space-y-2">
              <div className="flex items-start gap-1.5 text-red-400 text-xs">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{albumExportError || "导出失败"}</span>
              </div>
              <button onClick={() => setAlbumJobStatus("idle")}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                重试
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
