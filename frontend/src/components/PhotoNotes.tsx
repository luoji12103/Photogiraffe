"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { Loader2, Plus, Pencil, Trash2, Check, X } from "lucide-react";

interface Note {
  id: number;
  content: string;
  user_id: number;
  created_at: string;
  updated_at: string;
}

interface Props {
  photoId: number;
}

export default function PhotoNotes({ photoId }: Props) {
  const { authFetch, user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [newContent, setNewContent] = useState("");
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fetchNotes = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/photos/${photoId}/notes`);
      if (res.ok) setNotes(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchNotes(); }, [photoId]);

  const handleAdd = async () => {
    if (!newContent.trim()) return;
    setAdding(true);
    try {
      const res = await authFetch(`/api/photos/${photoId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newContent.trim() }),
      });
      if (res.ok) {
        setNewContent("");
        fetchNotes();
      }
    } catch { /* ignore */ }
    finally { setAdding(false); }
  };

  const handleEdit = async (id: number) => {
    if (!editContent.trim()) return;
    try {
      const res = await authFetch(`/api/photos/${photoId}/notes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent.trim() }),
      });
      if (res.ok) { setEditId(null); fetchNotes(); }
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("删除此备注？")) return;
    try {
      await authFetch(`/api/photos/${photoId}/notes/${id}`, { method: "DELETE" });
      setNotes(prev => prev.filter(n => n.id !== id));
    } catch { /* ignore */ }
  };

  const startEdit = (n: Note) => {
    setEditId(n.id);
    setEditContent(n.content);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex items-center gap-2 text-zinc-500 py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span className="text-xs">加载备注…</span>
        </div>
      ) : (
        <>
          {notes.length === 0 && (
            <p className="text-xs text-zinc-600 italic">暂无备注。</p>
          )}
          <ul className="space-y-2">
            {notes.map(n => (
              <li key={n.id} className="group bg-zinc-800/60 rounded-lg p-3 text-xs">
                {editId === n.id ? (
                  <div className="space-y-2">
                    <textarea
                      ref={textareaRef}
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      rows={3}
                      className="w-full bg-zinc-700 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-100 resize-none focus:outline-none"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => handleEdit(n.id)} className="flex items-center gap-1 bg-blue-700/70 hover:bg-blue-700 text-blue-100 px-2 py-1 rounded text-xs">
                        <Check size={11} /> 保存
                      </button>
                      <button onClick={() => setEditId(null)} className="flex items-center gap-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 px-2 py-1 rounded text-xs">
                        <X size={11} /> 取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-zinc-200 whitespace-pre-wrap leading-relaxed">{n.content}</span>
                    {user && (String(n.user_id) === user.id || user.role === "SuperAdmin") && (
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button onClick={() => startEdit(n)} className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300">
                          <Pencil size={11} />
                        </button>
                        <button onClick={() => handleDelete(n.id)} className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-red-400">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <span className="text-zinc-600 text-[10px] mt-1 block">
                  {new Date(n.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>

          {/* Add new note */}
          <div className="space-y-1.5 pt-1">
            <textarea
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAdd(); }}
              rows={2}
              placeholder="添加备注… (Ctrl+Enter 提交)"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-zinc-500"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !newContent.trim()}
              className="flex items-center gap-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 px-3 py-1.5 rounded-lg text-xs disabled:opacity-50"
            >
              {adding ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              添加备注
            </button>
          </div>
        </>
      )}
    </div>
  );
}
