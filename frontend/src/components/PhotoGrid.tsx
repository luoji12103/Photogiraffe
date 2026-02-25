"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { useRef, useState, useEffect } from "react";
import { CheckCircle2, Circle } from "lucide-react";

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
  layout?: "grid" | "masonry";
  selectable?: boolean;
  selectedIds?: Set<number>;
  onToggle?: (id: number) => void;
}

/* ── Card enter animation variants ── */
const cardVariants = {
  hidden: { opacity: 0, y: 24, scale: 0.97 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: {
      delay: Math.min(i * 0.04, 0.6),
      duration: 0.45,
      ease: [0.25, 0.46, 0.45, 0.94] as const,
    },
  }),
};

/* ── Photo Card ── */
function PhotoCard({
  photo, selectable, selected, onToggle, masonry = false, index = 0,
}: {
  photo: Photo; selectable?: boolean; selected?: boolean;
  onToggle?: (id: number) => void; masonry?: boolean; index?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const thumbPath = photo.MinioPath.replace("raw/", "thumb/").replace(/\.[^/.]+$/, ".webp");
  const imageUrl = `/api/image?path=${encodeURIComponent(thumbPath)}`;

  const cardContent = (
    <motion.div
      layoutId={selectable ? undefined : `photo-container-${photo.ID}`}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      custom={index}
      className="group relative overflow-hidden cursor-pointer"
      style={{
        borderRadius: "var(--pg-radius-lg)",
        background: "var(--pg-bg-elevated)",
        boxShadow: "var(--pg-shadow-sm)",
        border: selectable && selected
          ? "2px solid var(--pg-accent)"
          : "1px solid var(--pg-border-subtle)",
        aspectRatio: masonry ? undefined : "1 / 1",
      }}
      whileHover={{
        y: -4,
        boxShadow: "var(--pg-card-hover-shadow)",
        transition: { duration: 0.25 },
      }}
    >
      {photo.Status === "completed" && visible ? (
        <motion.div
          layoutId={selectable ? undefined : `photo-image-${photo.ID}`}
          className={masonry ? "w-full" : "w-full h-full"}
        >
          {masonry ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={photo.OriginalFilename}
              className="w-full h-auto block transition-transform duration-500 ease-out group-hover:scale-[1.03]"
            />
          ) : (
            <Image
              src={imageUrl}
              alt={photo.OriginalFilename}
              fill
              className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
              unoptimized
            />
          )}
        </motion.div>
      ) : photo.Status === "processing" ? (
        <div className={`flex ${masonry ? "min-h-[120px]" : "h-full"} w-full items-center justify-center`}>
          <div className="flex flex-col items-center gap-2">
            <div
              className="w-6 h-6 border-2 rounded-full animate-spin"
              style={{ borderColor: "var(--pg-border)", borderTopColor: "var(--pg-accent)" }}
            />
            <span className="text-xs" style={{ color: "var(--pg-text-muted)" }}>处理中…</span>
          </div>
        </div>
      ) : photo.Status === "failed" ? (
        <div className={`flex ${masonry ? "min-h-[120px]" : "h-full"} w-full items-center justify-center`}>
          <span className="text-sm" style={{ color: "var(--pg-error)" }}>处理失败</span>
        </div>
      ) : (
        <div
          className={`flex ${masonry ? "min-h-[120px]" : "h-full"} w-full items-center justify-center`}
          style={{ background: "var(--pg-bg-elevated)" }}
        />
      )}

      {/* Hover overlay */}
      <div
        className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 50%)" }}
      />
      <div className="absolute bottom-0 left-0 right-0 p-3 sm:p-4 translate-y-2 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
        <p className="text-sm font-medium text-white truncate">{photo.OriginalFilename}</p>
        <p className="text-xs text-white/70" suppressHydrationWarning>
          {new Date(photo.UploadedAt).toLocaleDateString()}
        </p>
      </div>

      {/* Selection indicator */}
      {selectable && (
        <div className="absolute top-2 right-2 z-10">
          {selected ? (
            <CheckCircle2
              className="w-6 h-6 drop-shadow-md"
              style={{ color: "var(--pg-accent)" }}
            />
          ) : (
            <Circle className="w-6 h-6 text-white/70 drop-shadow-md opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </div>
      )}
    </motion.div>
  );

  return (
    <div ref={ref}>
      {selectable ? (
        <div onClick={() => onToggle?.(photo.ID)}>{cardContent}</div>
      ) : (
        <Link href={`/photo/${photo.ID}`} scroll={false} className="block">
          {cardContent}
        </Link>
      )}
    </div>
  );
}

/* ── Skeleton Card ── */
function SkeletonCard({ masonry = false, index = 0 }: { masonry?: boolean; index?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className="animate-pulse"
      style={{
        borderRadius: "var(--pg-radius-lg)",
        background: "var(--pg-bg-elevated)",
        aspectRatio: masonry ? undefined : "1 / 1",
        height: masonry ? `${120 + Math.random() * 80}px` : undefined,
        marginBottom: masonry ? "1.5rem" : undefined,
      }}
    />
  );
}

export default function PhotoGrid({
  photos, loading = false, layout = "grid",
  selectable = false, selectedIds = new Set<number>(), onToggle,
}: PhotoGridProps) {
  if (loading) {
    if (layout === "masonry") {
      return (
        <div style={{ columns: "220px", columnGap: "1.5rem" }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonCard key={i} masonry index={i} />
          ))}
        </div>
      );
    }
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonCard key={i} index={i} />
        ))}
      </div>
    );
  }

  if (photos.length === 0) return null;

  if (layout === "masonry") {
    return (
      <div style={{ columns: "220px", columnGap: "1.5rem" }}>
        {photos.map((photo, i) => (
          <div key={photo.ID} style={{ breakInside: "avoid", marginBottom: "1.5rem" }}>
            <PhotoCard
              photo={photo} selectable={selectable}
              selected={selectedIds.has(photo.ID)} onToggle={onToggle}
              masonry index={i}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-5">
      {photos.map((photo, i) => (
        <PhotoCard
          key={photo.ID} photo={photo}
          selectable={selectable} selected={selectedIds.has(photo.ID)}
          onToggle={onToggle} index={i}
        />
      ))}
    </div>
  );
}

