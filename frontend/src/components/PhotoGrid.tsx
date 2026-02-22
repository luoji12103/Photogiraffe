"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { useRef, useState, useEffect } from "react";

interface Photo {
  ID: number;
  OriginalFilename: string;
  MinioPath: string;
  Status: string;
  UploadedAt: string;
}

interface PhotoGridProps {
  photos: Photo[];
  loading?: boolean;
}

// Individual card with IntersectionObserver-based lazy reveal
function PhotoCard({ photo }: { photo: Photo }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const thumbPath = photo.MinioPath.replace("raw/", "thumb/").replace(/\.[^/.]+$/, ".webp");
  const imageUrl = `/api/image?path=${encodeURIComponent(thumbPath)}`;

  return (
    <div ref={ref}>
      <Link href={`/photo/${photo.ID}`} scroll={false} className="block">
        <motion.div
          layoutId={`photo-container-${photo.ID}`}
          className="group relative aspect-square overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-800"
        >
          {photo.Status === "completed" && visible ? (
            <motion.div layoutId={`photo-image-${photo.ID}`} className="w-full h-full">
              <Image
                src={imageUrl}
                alt={photo.OriginalFilename}
                fill
                className="object-cover transition-transform duration-300 group-hover:scale-105"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                unoptimized
              />
            </motion.div>
          ) : photo.Status === "processing" ? (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-sm text-zinc-500 animate-pulse">Processing…</span>
            </div>
          ) : photo.Status === "failed" ? (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-sm text-red-400">Failed</span>
            </div>
          ) : (
            // Placeholder while not yet in viewport
            <div className="flex h-full w-full items-center justify-center bg-zinc-100 dark:bg-zinc-800" />
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <div className="absolute bottom-0 left-0 right-0 p-4 translate-y-4 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
            <p className="text-sm font-medium text-white truncate">{photo.OriginalFilename}</p>
            <p className="text-xs text-zinc-300" suppressHydrationWarning>
              {new Date(photo.UploadedAt).toLocaleDateString()}
            </p>
          </div>
        </motion.div>
      </Link>
    </div>
  );
}

// Skeleton card for loading state
function SkeletonCard() {
  return (
    <div className="aspect-square rounded-xl bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
  );
}

export default function PhotoGrid({ photos, loading = false }: PhotoGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (photos.length === 0) {
    return null; // empty state handled in parent
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
      {photos.map((photo) => (
        <PhotoCard key={photo.ID} photo={photo} />
      ))}
    </div>
  );
}

