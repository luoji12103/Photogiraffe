"use client";

/**
 * IPTCPanel — Phase 13 v13.4
 * Lets the owner edit Copyright and Creator (Artist) fields that are embedded
 * into exported JPEGs via piexif.  Data is saved through PUT /api/photos/:id/iptc.
 */

import { useEffect, useState } from "react";
import { ShieldCheck, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

interface Props {
  photoId: number;
}

export default function IPTCPanel({ photoId }: Props) {
  const { authFetch } = useAuth();
  const [copyright, setCopyright] = useState("");
  const [creator, setCreator]     = useState("");
  const [loading,  setLoading]    = useState(true);
  const [saving,   setSaving]     = useState(false);
  const [saved,    setSaved]      = useState(false);
  const [error,    setError]      = useState("");

  // Load existing values
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    authFetch(`/api/photos/${photoId}/iptc`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) {
          setCopyright(d.copyright ?? "");
          setCreator(d.creator ?? "");
        }
      })
      .catch(() => {/* silent */})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [photoId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await authFetch(`/api/photos/${photoId}/iptc`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ copyright, creator }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to save IPTC");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-[var(--pg-text-muted)] uppercase tracking-wider flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-[var(--pg-accent)]" />
        IPTC / Copyright
      </h3>

      {loading ? (
        <div className="flex items-center gap-2 text-[var(--pg-text-muted)] py-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs">Loading…</span>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div>
            <label className="text-xs text-[var(--pg-text-muted)] mb-1 block">
              Copyright
            </label>
            <input
              type="text"
              value={copyright}
              onChange={(e) => setCopyright(e.target.value)}
              placeholder="© 2025 Photographer Name"
              className="w-full bg-[var(--pg-bg-surface)] border border-[var(--pg-border)] text-[var(--pg-text-primary)] text-sm px-3 py-2 rounded-[var(--pg-radius-sm)] placeholder:text-[var(--pg-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--pg-accent)]"
            />
          </div>

          <div>
            <label className="text-xs text-[var(--pg-text-muted)] mb-1 block">
              Creator / Artist
            </label>
            <input
              type="text"
              value={creator}
              onChange={(e) => setCreator(e.target.value)}
              placeholder="Your Name"
              className="w-full bg-[var(--pg-bg-surface)] border border-[var(--pg-border)] text-[var(--pg-text-primary)] text-sm px-3 py-2 rounded-[var(--pg-radius-sm)] placeholder:text-[var(--pg-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--pg-accent)]"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-400 bg-red-400/10 px-3 py-2 rounded-[var(--pg-radius-sm)] text-xs">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 text-xs font-medium bg-[var(--pg-accent)] hover:opacity-90 text-white py-2 rounded-[var(--pg-radius-sm)] transition-opacity disabled:opacity-50"
          >
            {saving ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
            ) : saved ? (
              <><CheckCircle className="w-3.5 h-3.5" /> Saved</>
            ) : (
              "Save IPTC Metadata"
            )}
          </button>

          <p className="text-xs text-[var(--pg-text-muted)] leading-relaxed">
            These values are embedded in JPEG exports (Copyright → <code className="text-[0.7rem]">IFD0:Copyright</code>, Creator → <code className="text-[0.7rem]">IFD0:Artist</code>).
          </p>
        </div>
      )}
    </div>
  );
}
