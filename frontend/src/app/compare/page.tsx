"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import CompareView from "@/components/CompareView";
import { Loader2, ArrowLeft } from "lucide-react";

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
        const [dataA, dataB]: [Photo, Photo] = await Promise.all([
          resA.json(),
          resB.json(),
        ]);
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
    <div className="flex flex-col min-h-screen bg-zinc-950 text-zinc-200">
      {/* Top bar */}
      <header className="flex items-center gap-4 px-4 py-3 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          返回
        </button>
        <h1 className="text-sm font-medium text-zinc-300">照片对比</h1>
        {photoA && photoB && (
          <span className="ml-auto text-xs text-zinc-600">
            #{photoA.ID} · #{photoB.ID}
          </span>
        )}
      </header>

      {/* Body */}
      <div className="flex-1 flex flex-col min-h-0">
        {loading && (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
          </div>
        )}

        {error && (
          <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
            {error}
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
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
        </div>
      }
    >
      <CompareContent />
    </Suspense>
  );
}
