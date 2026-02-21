"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";

interface Photo {
  ID: number;
  OriginalFilename: string;
  MinioPath: string;
  Status: string;
  UploadedAt: string;
}

interface PhotoGridProps {
  photos: Photo[];
  minioUrl: string;
}

export default function PhotoGrid({ photos, minioUrl }: PhotoGridProps) {
  if (photos.length === 0) {
    return (
      <div className="text-center py-20 text-zinc-500">
        No photos uploaded yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
      {photos.map((photo) => {
        const thumbPath = photo.MinioPath.replace("raw/", "thumb/").replace(/\.[^/.]+$/, ".webp");
        const imageUrl = `${minioUrl}/photos/${thumbPath}`;

        return (
          <Link href={`/photo/${photo.ID}`} key={photo.ID} scroll={false} className="block">
            <motion.div
              layoutId={`photo-container-${photo.ID}`}
              className="group relative aspect-square overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-800"
            >
              {photo.Status === "completed" ? (
                <motion.div layoutId={`photo-image-${photo.ID}`} className="w-full h-full">
                  <Image
                    src={imageUrl}
                    alt={photo.OriginalFilename}
                    fill
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                  />
                </motion.div>
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <span className="text-sm text-zinc-500">Processing...</span>
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              <div className="absolute bottom-0 left-0 right-0 p-4 translate-y-4 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
                <p className="text-sm font-medium text-white truncate">{photo.OriginalFilename}</p>
                <p className="text-xs text-zinc-300">{new Date(photo.UploadedAt).toLocaleDateString()}</p>
              </div>
            </motion.div>
          </Link>
        );
      })}
    </div>
  );
}
