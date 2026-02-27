"use client";

import { useState, useEffect, useCallback } from "react";
import { Sparkles, Plus, Trash2, ChevronRight, X, ChevronLeft } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useToast } from "@/context/ToastContext";
import { useAuth } from "@/context/AuthContext";

interface SmartAlbum {
  ID: number;
  Name: string;
  RuleType: string;
  RuleParams: string;
  CreatedAt: string;
}

interface Photo {
  ID: number;
  Filename: string;
  ThumbnailURL: string;
  FileURL: string;
  IsPublic: boolean;
}

const RULE_TYPES = [
  { value: "date_range", label: "日期范围" },
  { value: "tags_contain", label: "包含标签" },
  { value: "auto_tags_contain", label: "包含自动标签" },
  { value: "camera_model", label: "相机型号" },
  { value: "color_bucket", label: "主色调" },
];

function ruleParamsPlaceholder(ruleType: string): string {
  switch (ruleType) {
    case "date_range":
      return '{"from":"2024-01-01","to":"2024-12-31"}';
    case "tags_contain":
    case "auto_tags_contain":
      return '{"tags":["风景","旅行"]}';
    case "camera_model":
      return '{"model":"iPhone"}';
    case "color_bucket":
      return '{"bucket":"blue"}';
    default:
      return "{}";
  }
}

export default function SmartAlbumsPage() {
  const { addToast } = useToast();
  const { user } = useAuth();

  const [albums, setAlbums] = useState<SmartAlbum[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [ruleType, setRuleType] = useState("date_range");
  const [ruleParams, setRuleParams] = useState('{"from":"","to":""}');
  const [creating, setCreating] = useState(false);

  // Album photos view
  const [selectedAlbum, setSelectedAlbum] = useState<SmartAlbum | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoTotal, setPhotoTotal] = useState(0);
  const [photoPage, setPhotoPage] = useState(1);
  const [photoTotalPages, setPhotoTotalPages] = useState(1);
  const [loadingPhotos, setLoadingPhotos] = useState(false);

  const fetchAlbums = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/smart-albums");
      if (!res.ok) throw new Error("failed");
      setAlbums(await res.json());
    } catch {
      addToast({ type: "error", title: "加载智能相册失败" });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchAlbums();
  }, [fetchAlbums]);

  const handleCreate = async () => {
    if (!name.trim()) {
      addToast({ type: "error", title: "请输入相册名称" });
      return;
    }
    try {
      JSON.parse(ruleParams);
    } catch {
      addToast({ type: "error", title: "规则参数不是合法的 JSON" });
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/smart-albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, rule_type: ruleType, rule_params: ruleParams }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "创建失败");
      }
      addToast({ type: "success", title: "智能相册已创建" });
      setName("");
      setRuleType("date_range");
      setRuleParams('{"from":"","to":""}');
      setShowCreate(false);
      fetchAlbums();
    } catch (e: unknown) {
      addToast({ type: "error", title: e instanceof Error ? e.message : "创建失败" });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (album: SmartAlbum) => {
    if (!confirm(`确认删除智能相册「${album.Name}」？`)) return;
    try {
      const res = await fetch(`/api/smart-albums/${album.ID}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      addToast({ type: "success", title: "已删除" });
      if (selectedAlbum?.ID === album.ID) setSelectedAlbum(null);
      fetchAlbums();
    } catch {
      addToast({ type: "error", title: "删除失败" });
    }
  };

  const loadPhotos = useCallback(
    async (album: SmartAlbum, page = 1) => {
      setLoadingPhotos(true);
      try {
        const res = await fetch(`/api/smart-albums/${album.ID}/photos?page=${page}&limit=20`);
        if (!res.ok) throw new Error("failed");
        const data = await res.json();
        setPhotos(data.photos ?? []);
        setPhotoTotal(data.total ?? 0);
        setPhotoTotalPages(data.total_pages ?? 1);
        setPhotoPage(page);
      } catch {
        addToast({ type: "error", title: "加载照片失败" });
      } finally {
        setLoadingPhotos(false);
      }
    },
    [addToast]
  );

  const openAlbum = (album: SmartAlbum) => {
    setSelectedAlbum(album);
    loadPhotos(album, 1);
  };

  // Sync rule params placeholder when rule type changes in create form
  const handleRuleTypeChange = (t: string) => {
    setRuleType(t);
    setRuleParams(ruleParamsPlaceholder(t));
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        请先登录
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Sparkles className="w-6 h-6 text-purple-500" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">智能相册</h1>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm transition-colors"
        >
          <Plus className="w-4 h-4" />
          新建智能相册
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">新建智能相册</h2>

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
              相册名称
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：2024 年旅行"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
              规则类型
            </label>
            <select
              value={ruleType}
              onChange={(e) => handleRuleTypeChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {RULE_TYPES.map((rt) => (
                <option key={rt.value} value={rt.value}>
                  {rt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
              规则参数 (JSON)
            </label>
            <textarea
              value={ruleParams}
              onChange={(e) => setRuleParams(e.target.value)}
              rows={3}
              placeholder={ruleParamsPlaceholder(ruleType)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg text-sm transition-colors"
            >
              {creating ? "创建中…" : "创建"}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Album list */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-24 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse"
            />
          ))}
        </div>
      ) : albums.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-30" />
          <p className="text-lg">还没有智能相册</p>
          <p className="text-sm mt-1">点击「新建智能相册」按规则自动归集照片</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {albums.map((album) => {
            const ruleLabel = RULE_TYPES.find((r) => r.value === album.RuleType)?.label ?? album.RuleType;
            return (
              <div
                key={album.ID}
                className={`group relative bg-white dark:bg-gray-800 rounded-xl border transition-all cursor-pointer hover:shadow-md ${
                  selectedAlbum?.ID === album.ID
                    ? "border-purple-500 ring-2 ring-purple-200 dark:ring-purple-800"
                    : "border-gray-200 dark:border-gray-700"
                }`}
                onClick={() => openAlbum(album)}
              >
                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {album.Name}
                      </p>
                      <span className="inline-block mt-1 text-xs px-2 py-0.5 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded-full">
                        {ruleLabel}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 ml-2 shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(album);
                        }}
                        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900 text-red-500 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
                    {album.RuleParams}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Album photos panel */}
      {selectedAlbum && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {selectedAlbum.Name}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                共 {photoTotal} 张照片
              </p>
            </div>
            <button
              onClick={() => setSelectedAlbum(null)}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {loadingPhotos ? (
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
              {[...Array(16)].map((_, i) => (
                <div
                  key={i}
                  className="aspect-square bg-gray-200 dark:bg-gray-700 rounded animate-pulse"
                />
              ))}
            </div>
          ) : photos.length === 0 ? (
            <div className="text-center py-10 text-gray-500">没有符合规则的照片</div>
          ) : (
            <>
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                {photos.map((photo) => (
                  <Link
                    key={photo.ID}
                    href={`/photo/${photo.ID}`}
                    className="aspect-square relative rounded overflow-hidden hover:opacity-90 transition-opacity"
                  >
                    <Image
                      src={photo.ThumbnailURL || photo.FileURL}
                      alt={photo.Filename}
                      fill
                      className="object-cover"
                      sizes="80px"
                    />
                  </Link>
                ))}
              </div>

              {/* Pagination */}
              {photoTotalPages > 1 && (
                <div className="flex items-center justify-center gap-3">
                  <button
                    disabled={photoPage <= 1}
                    onClick={() => loadPhotos(selectedAlbum, photoPage - 1)}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {photoPage} / {photoTotalPages}
                  </span>
                  <button
                    disabled={photoPage >= photoTotalPages}
                    onClick={() => loadPhotos(selectedAlbum, photoPage + 1)}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
