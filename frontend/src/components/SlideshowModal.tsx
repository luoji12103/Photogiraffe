"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { X, Play, Pause, ChevronLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface SlidePhoto {
  ID: number;
  OriginalFilename: string;
  MinioPath: string;
  ExifData?: {
    CameraModel?: string;
    DateTimeOriginal?: string;
  };
}

interface SlideshowModalProps {
  photos: SlidePhoto[];
  initialIndex?: number;
  onClose: () => void;
}

const SPEED_OPTIONS = [
  { label: "3s", value: 3000 },
  { label: "5s", value: 5000 },
  { label: "10s", value: 10000 },
];

export default function SlideshowModal({
  photos,
  initialIndex = 0,
  onClose,
}: SlideshowModalProps) {
  const [index, setIndex] = useState(initialIndex);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(5000);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const current = photos[index];

  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % photos.length);
  }, [photos.length]);

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + photos.length) % photos.length);
  }, [photos.length]);

  // Auto-advance timer
  useEffect(() => {
    if (!playing) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(goNext, speed);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, speed, goNext]);

  // Keyboard controls
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") { goNext(); setPlaying(false); }
      else if (e.key === "ArrowLeft") { goPrev(); setPlaying(false); }
      else if (e.key === " ") { e.preventDefault(); setPlaying((v) => !v); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, goNext, goPrev]);

  if (!current) return null;

  const proxyPath = current.MinioPath.replace("raw/", "proxy/").replace(/\.[^/.]+$/, ".webp");
  const imageUrl = `/api/image?path=${encodeURIComponent(proxyPath)}`;

  return (
    <div
      className="fixed inset-0 z-[200] bg-black flex flex-col select-none"
      onClick={(e) => {
        // Click center area: toggle play/pause
        if ((e.target as HTMLElement).closest("button")) return;
        setPlaying((v) => !v);
      }}
    >
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4 bg-gradient-to-b from-black/60 to-transparent">
        <span className="text-white/80 text-sm">
          {index + 1} / {photos.length}
        </span>
        {/* Speed selector */}
        <div className="flex items-center gap-1">
          {SPEED_OPTIONS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setSpeed(value)}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                speed === value
                  ? "bg-white/20 text-white"
                  : "text-white/50 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-white/20 transition-colors text-white"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Image */}
      <AnimatePresence mode="wait">
        <motion.div
          key={current.ID}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="flex-1 flex items-center justify-center"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={current.OriginalFilename}
            className="max-w-full max-h-full object-contain"
            style={{ maxHeight: "calc(100vh - 100px)" }}
          />
        </motion.div>
      </AnimatePresence>

      {/* Bottom bar */}
      <div className="absolute bottom-0 left-0 right-0 z-10 p-4 bg-gradient-to-t from-black/70 to-transparent">
        <div className="flex items-center justify-between">
          {/* Photo info */}
          <div className="text-white/80">
            <p className="text-sm font-medium truncate max-w-xs">{current.OriginalFilename}</p>
            {current.ExifData?.CameraModel && (
              <p className="text-xs text-white/50">{current.ExifData.CameraModel}</p>
            )}
            {current.ExifData?.DateTimeOriginal && (
              <p className="text-xs text-white/50" suppressHydrationWarning>
                {new Date(current.ExifData.DateTimeOriginal.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3")).toLocaleDateString()}
              </p>
            )}
          </div>

          {/* Playback controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={(e) => { e.stopPropagation(); goPrev(); setPlaying(false); }}
              className="p-2 rounded-full hover:bg-white/20 transition-colors text-white"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setPlaying((v) => !v); }}
              className="p-3 rounded-full bg-white/20 hover:bg-white/30 transition-colors text-white"
            >
              {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); goNext(); setPlaying(false); }}
              className="p-2 rounded-full hover:bg-white/20 transition-colors text-white"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-white/20 rounded-full h-0.5 mt-3">
          <div
            className="bg-white rounded-full h-0.5"
            style={{ width: `${((index + 1) / photos.length) * 100}%`, transition: "width 0.3s" }}
          />
        </div>
      </div>
    </div>
  );
}
