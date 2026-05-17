"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { Trash2, Eye, EyeOff, Tag, Heart, HeartOff, X, CheckSquare, Loader2, Images } from "lucide-react";
import AddToAlbumModal from "./AddToAlbumModal";

interface BulkActionBarProps {
  selectedIds: Set<number>;
  totalPhotos: number;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onRefresh: () => void;
}

export default function BulkActionBar({
  selectedIds,
  totalPhotos,
  onSelectAll,
  onDeselectAll,
  onRefresh,
}: BulkActionBarProps) {
  const { authFetch } = useAuth();
  const { addToast } = useToast();
  const [loading, setLoading] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [showTagInput, setShowTagInput] = useState<"add" | "remove" | null>(null);
  const [showAlbumModal, setShowAlbumModal] = useState(false);
  const count = selectedIds.size;

  const bulkAction = async (action: string, extra: Record<string, string> = {}) => {
    if (count === 0) return;
    setLoading(action);
    try {
      const res = await authFetch("/api/photos/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds), action, ...extra }),
      });
      if (res.ok) {
        const d = await res.json();
        addToast({ type: "success", title: `已对 ${d.count ?? count} 张照片执行"${action}"` });
        onRefresh();
      } else {
        addToast({ type: "error", title: "操作失败" });
      }
    } finally {
      setLoading(null);
      setShowTagInput(null);
      setTagInput("");
    }
  };

  const bulkDelete = async () => {
    if (count === 0) return;
    if (!confirm(`确定删除选中的 ${count} 张照片吗？此操作不可撤销。`)) return;
    setLoading("delete");
    try {
      const res = await authFetch("/api/photos/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (res.ok) {
        const d = await res.json();
        addToast({ type: "success", title: `已删除 ${d.deleted ?? count} 张照片` });
        onDeselectAll();
        onRefresh();
      } else {
        addToast({ type: "error", title: "删除失败" });
      }
    } finally {
      setLoading(null);
    }
  };

  const handleTagAction = (type: "add" | "remove") => {
    if (!tagInput.trim()) return;
    bulkAction(type === "add" ? "add_tag" : "remove_tag", { tag: tagInput.trim() });
  };

  if (count === 0) return null;

  return (
    <>
      <div
        className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-2xl"
        style={{ background: "var(--pg-bg-surface)", border: "1px solid var(--pg-border)", minWidth: 320 }}
      >
        {/* Count + select controls */}
        <div className="flex items-center gap-2 mr-2 shrink-0">
          <span className="text-sm font-semibold" style={{ color: "var(--pg-text-primary)" }}>
            {count} 已选
          </span>
          <button
            onClick={count === totalPhotos ? onDeselectAll : onSelectAll}
            className="text-xs px-2 py-1 rounded-lg transition-colors"
            style={{ background: "var(--pg-bg-elevated)", color: "var(--pg-text-secondary)" }}
            title={count === totalPhotos ? "取消全选" : "全选"}
          >
            <CheckSquare size={14} />
          </button>
        </div>

        <div className="w-px h-6 shrink-0" style={{ background: "var(--pg-border)" }} />

        {/* Action Buttons */}
        <div className="flex items-center gap-1">
          {/* Delete */}
          <ActionBtn
            onClick={bulkDelete}
            loading={loading === "delete"}
            title="删除"
            danger
          >
            <Trash2 size={15} />
          </ActionBtn>

          {/* Set Public */}
          <ActionBtn
            onClick={() => bulkAction("set_public")}
            loading={loading === "set_public"}
            title="设为公开"
          >
            <Eye size={15} />
          </ActionBtn>

          {/* Set Private */}
          <ActionBtn
            onClick={() => bulkAction("set_private")}
            loading={loading === "set_private"}
            title="设为私有"
          >
            <EyeOff size={15} />
          </ActionBtn>

          {/* Star */}
          <ActionBtn
            onClick={() => bulkAction("star")}
            loading={loading === "star"}
            title="批量收藏"
          >
            <Heart size={15} />
          </ActionBtn>

          {/* Unstar */}
          <ActionBtn
            onClick={() => bulkAction("unstar")}
            loading={loading === "unstar"}
            title="批量取消收藏"
          >
            <HeartOff size={15} />
          </ActionBtn>

          {/* Add Tag popup */}
          <div className="relative">
            <ActionBtn
              onClick={() => setShowTagInput(showTagInput === "add" ? null : "add")}
              loading={loading === "add_tag"}
              title="添加标签"
              active={showTagInput === "add"}
            >
              <Tag size={15} />
            </ActionBtn>
            {showTagInput === "add" && (
              <TagPopup
                placeholder="标签名…"
                value={tagInput}
                onChange={setTagInput}
                onConfirm={() => handleTagAction("add")}
                onCancel={() => { setShowTagInput(null); setTagInput(""); }}
                confirmLabel="添加"
              />
            )}
          </div>

          {/* Remove Tag popup */}
          <div className="relative">
            <ActionBtn
              onClick={() => setShowTagInput(showTagInput === "remove" ? null : "remove")}
              loading={loading === "remove_tag"}
              title="移除标签"
              active={showTagInput === "remove"}
            >
              <span className="text-xs font-bold">-T</span>
            </ActionBtn>
            {showTagInput === "remove" && (
              <TagPopup
                placeholder="标签名…"
                value={tagInput}
                onChange={setTagInput}
                onConfirm={() => handleTagAction("remove")}
                onCancel={() => { setShowTagInput(null); setTagInput(""); }}
                confirmLabel="移除"
              />
            )}
          </div>

          {/* Add to Album */}
          <ActionBtn
            onClick={() => setShowAlbumModal(true)}
            loading={false}
            title="加入相册"
          >
            <Images size={15} />
          </ActionBtn>
        </div>

        <div className="w-px h-6 shrink-0" style={{ background: "var(--pg-border)" }} />

        {/* Deselect */}
        <button
          onClick={onDeselectAll}
          className="p-1.5 rounded-lg transition-colors shrink-0"
          style={{ color: "var(--pg-text-tertiary)" }}
          title="取消选择"
        >
          <X size={16} />
        </button>
      </div>

      {showAlbumModal && (
        <AddToAlbumModal
          selectedIds={selectedIds}
          onClose={() => setShowAlbumModal(false)}
        />
      )}
    </>
  );
}

/* ── Small Action Button ── */
function ActionBtn({
  children, onClick, loading, title, danger = false, active = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  loading: boolean;
  title: string;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      title={title}
      className="p-1.5 rounded-lg transition-all duration-150 disabled:opacity-50"
      style={{
        background: active
          ? "var(--pg-accent-soft)"
          : danger
          ? "rgba(239,68,68,0.1)"
          : "var(--pg-bg-elevated)",
        color: danger
          ? "#ef4444"
          : active
          ? "var(--pg-accent)"
          : "var(--pg-text-secondary)",
      }}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : children}
    </button>
  );
}

/* ── Tag Popup ── */
function TagPopup({
  placeholder, value, onChange, onConfirm, onCancel, confirmLabel,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel: string;
}) {
  return (
    <div
      className="absolute bottom-10 left-0 flex items-center gap-1.5 p-2 rounded-xl shadow-xl z-50"
      style={{ background: "var(--pg-bg-surface)", border: "1px solid var(--pg-border)", minWidth: 180 }}
    >
      <input
        autoFocus
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onConfirm();
          if (e.key === "Escape") onCancel();
        }}
        className="flex-1 text-sm rounded-lg px-2 py-1.5 outline-none"
        style={{ background: "var(--pg-bg-elevated)", color: "var(--pg-text-primary)", border: "1px solid var(--pg-border)" }}
      />
      <button
        onClick={onConfirm}
        className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors"
        style={{ background: "var(--pg-accent)", color: "#fff" }}
      >
        {confirmLabel}
      </button>
    </div>
  );
}
