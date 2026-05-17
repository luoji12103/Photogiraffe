"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { motion } from "framer-motion";
import CompareView from "@/components/CompareView";
import { Loader2, ArrowLeft, AlertCircle } from "lucide-react";

interface ExifData {
  CameraModel: string;
  LensModel: string;
  Aperture: string;
  ShutterSpeed: string;
  ISO: string;
  FocalLength: string;
  DateTimeOriginal: string;
  GPSLatitude: string;
  GPSLongitude: string;
  Software: string;
  ColorSpace: string;
  ICCProfileName?: string;
}

interface Photo {
  ID: number;
  OriginalFilename: string;
  MinioPath: string;
  Status: string;
  UploadedAt: string;
  ExifData?: ExifData;
}

function CompareContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { authFetch } = useAuth();

  const idA = params.get("a");
  const idB = params.get("b");

  const [photoA, setPhotoA] = useState<Photo | null>(null);
  const [photoB, setPhotoB] = useState<Photo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!idA || !idB) {
      setError("缺少照片 ID 参数（需要 ?a=id&b=id）");
      setLoading(false);
      return;
    }
    const fetchBoth = async () => {
      try {
        const [resA, resB] = await Promise.all([
          authFetch(`/api/photos/${idA}`),
          authFetch(`/api/photos/${idB}`),
        ]);
        if (!resA.ok || !resB.ok) throw new Error("加载照片失败");
        const [dataA, dataB]: [Photo, Photo] = await Promise.all([resA.json(), resB.json()]);
        setPhotoA(dataA);
        setPhotoB(dataB);
      } catch {
        setError("无法加载照片，请重试");
      } finally {
        setLoading(false);
      }
    };
    fetchBoth();
  }, [idA, idB, authFetch]);

  return (
    <div
      className="flex flex-col min-h-screen"
      style={{ background: "var(--pg-bg-base)", color: "var(--pg-text-primary)" }}
    >
      {/* Top bar */}
      <motion.header
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-center gap-4 px-4 py-3 shrink-0"
        style={{ background: "var(--pg-bg-surface)", borderBottom: "1px solid var(--pg-border)" }}
      >
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm transition-colors"
          style={{ color: "var(--pg-text-tertiary)" }}
        >
          <ArrowLeft className="w-4 h-4" />
          返回
        </button>
        <span className="text-sm font-medium" style={{ color: "var(--pg-text-secondary)" }}>
          照片对比
        </span>
        {photoA && photoB && (
          <span className="ml-auto text-xs" style={{ color: "var(--pg-text-muted)" }}>
            #{photoA.ID} · #{photoB.ID}
          </span>
        )}
      </motion.header>

      {/* Body */}
      <div className="flex-1 flex flex-col min-h-0">
        {loading && (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--pg-accent)" }} />
          </div>
        )}
        {error && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <AlertCircle className="w-8 h-8" style={{ color: "var(--pg-error)" }} />
            <p className="text-sm" style={{ color: "var(--pg-text-secondary)" }}>{error}</p>
          </div>
        )}
        {!loading && !error && photoA && photoB && (
          <CompareView photoA={photoA} photoB={photoB} />
        )}
      </div>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center"
          style={{ background: "var(--pg-bg-base)" }}
        >
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--pg-accent)" }} />
        </div>
      }
    >
      <CompareContent />
    </Suspense>
  );
}
