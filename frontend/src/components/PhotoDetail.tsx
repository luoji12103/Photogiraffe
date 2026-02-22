"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Camera, Aperture, Zap, MapPin, Calendar, Sparkles, Loader2, Palette, Cpu } from "lucide-react";
import { useRawDecoder, isRawFile } from "../lib/useRawDecoder";
import RawCanvas from "./RawCanvas";

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

interface AIAnalysis {
  description: string;
  composition: string;
  color_emotion: string;
  artistic_advice: string;
}

interface Photo {
  ID: number;
  OriginalFilename: string;
  MinioPath: string;
  Status: string;
  UploadedAt: string;
  ExifData?: ExifData;
  AIAnalysis?: string | null; // null when AI analysis not yet performed
}

interface PhotoDetailProps {
  photo: Photo;
}

export default function PhotoDetail({ photo: initialPhoto }: PhotoDetailProps) {
  const router = useRouter();
  const [photo, setPhoto] = useState<Photo>(initialPhoto);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");

  const handleClose = () => {
    // router.back() closes the intercepting modal and returns to gallery;
    // if opened directly (no history), fall back to the home page.
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  // Use the proxy image for the detail view (route through Next.js API to avoid CORS/port issues)
  const proxyPath = photo.MinioPath.replace("raw/", "proxy/").replace(/\.[^/.]+$/, ".webp");
  const imageUrl = `/api/image?path=${encodeURIComponent(proxyPath)}`;

  // Progressive RAW loading: detect RAW files and decode natively in browser
  const isRaw = isRawFile(photo.OriginalFilename);
  const rawProxyUrl = isRaw
    ? `/api/image?path=${encodeURIComponent(photo.MinioPath)}`
    : null;
  const { frame: rawFrame, loading: rawLoading, error: rawError } = useRawDecoder(
    photo.ID,
    rawProxyUrl
  );

  const exif = photo.ExifData;
  
  let aiAnalysis: AIAnalysis | null = null;
  if (photo.AIAnalysis) {
    try {
      aiAnalysis = JSON.parse(photo.AIAnalysis);
    } catch (e) {
      console.error("Failed to parse AI analysis:", e);
    }
  }

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setAnalysisError("");
    try {
      const res = await fetch(`/api/photos/${photo.ID}/analyze`, {
        method: "POST",
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to trigger analysis");
      }
      
      // Poll for results
      const pollInterval = setInterval(async () => {
        const checkRes = await fetch(`/api/photos/${photo.ID}`);
        if (checkRes.ok) {
          const updatedPhoto = await checkRes.json();
          if (updatedPhoto.AIAnalysis) {
            setPhoto(updatedPhoto);
            setIsAnalyzing(false);
            clearInterval(pollInterval);
          }
        }
      }, 3000);
      
      // Timeout after 60 seconds.
      // B5 fix: use functional setState to read the *current* value of
      // isAnalyzing instead of the stale closure value (which is always false).
      setTimeout(() => {
        clearInterval(pollInterval);
        setIsAnalyzing((wasAnalyzing) => {
          if (wasAnalyzing) {
            setAnalysisError("Analysis timed out. Please try again later.");
            return false;
          }
          return wasAnalyzing;
        });
      }, 60000);
      
    } catch (error: any) {
      setAnalysisError(error.message);
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
      <button
        onClick={handleClose}
        className="absolute top-6 right-6 z-50 p-2 text-white/70 hover:text-white transition-colors bg-black/20 rounded-full hover:bg-black/40"
        aria-label="Close"
      >
        <X size={24} />
      </button>

      <div className="w-full h-full flex flex-col md:flex-row">
        {/* Image Section */}
        <div className="flex-1 relative flex items-center justify-center p-4 md:p-8">
          {/* RAW quality badge */}
          {isRaw && (
            <div className="absolute top-4 left-4 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-sm border border-zinc-700">
              <Cpu className="w-3.5 h-3.5 text-emerald-400" />
              {rawLoading ? (
                <>
                  <Loader2 className="w-3 h-3 text-emerald-400 animate-spin" />
                  <span className="text-xs text-emerald-400">Decoding RAW…</span>
                </>
              ) : rawFrame ? (
                <span className="text-xs text-emerald-400 font-medium">RAW Native</span>
              ) : rawError ? (
                <span className="text-xs text-amber-400">WebP Proxy</span>
              ) : null}
            </div>
          )}

          <motion.div
            layoutId={`photo-container-${photo.ID}`}
            className="relative w-full h-full max-w-5xl max-h-[80vh] flex items-center justify-center"
          >
            <motion.div layoutId={`photo-image-${photo.ID}`} className="relative w-full h-full">
              {/* WebP proxy: always rendered; hidden once RAW frame is ready */}
              <AnimatePresence>
                {!rawFrame && (
                  <motion.div
                    key="proxy"
                    className="absolute inset-0"
                    initial={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.5 }}
                  >
                    <Image
                      src={imageUrl}
                      alt={photo.OriginalFilename}
                      fill
                      className="object-contain"
                      sizes="100vw"
                      priority
                      unoptimized
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* RAW canvas: rendered when native decode completes */}
              <AnimatePresence>
                {rawFrame && (
                  <motion.div
                    key="raw"
                    className="absolute inset-0"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.6 }}
                  >
                    <RawCanvas
                      frame={rawFrame}
                      alt={photo.OriginalFilename}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        </div>

        {/* EXIF Info Section */}
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3, duration: 0.4 }}
          className="w-full md:w-80 lg:w-96 bg-zinc-900/80 border-l border-zinc-800 p-6 md:p-8 overflow-y-auto text-zinc-300"
        >
          <h2 className="text-xl font-semibold text-white mb-6 truncate" title={photo.OriginalFilename}>
            {photo.OriginalFilename}
          </h2>

          {exif ? (
            <div className="space-y-6">
              {/* Camera & Lens */}
              <div className="space-y-3">
                <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Equipment</h3>
                {exif.CameraModel && (
                  <div className="flex items-start gap-3">
                    <Camera className="w-5 h-5 text-zinc-400 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-zinc-200">{exif.CameraModel}</p>
                    </div>
                  </div>
                )}
                {exif.LensModel && (
                  <div className="flex items-start gap-3">
                    <Aperture className="w-5 h-5 text-zinc-400 mt-0.5" />
                    <div>
                      <p className="text-sm text-zinc-300">{exif.LensModel}</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="h-px bg-zinc-800" />

              {/* Settings */}
              <div className="space-y-3">
                <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Settings</h3>
                <div className="grid grid-cols-2 gap-4">
                  {exif.Aperture && (
                    <div>
                      <p className="text-xs text-zinc-500">Aperture</p>
                      <p className="text-sm font-medium text-zinc-200">f/{exif.Aperture}</p>
                    </div>
                  )}
                  {exif.ShutterSpeed && (
                    <div>
                      <p className="text-xs text-zinc-500">Shutter</p>
                      <p className="text-sm font-medium text-zinc-200">1/{exif.ShutterSpeed}s</p>
                    </div>
                  )}
                  {exif.ISO && (
                    <div>
                      <p className="text-xs text-zinc-500">ISO</p>
                      <p className="text-sm font-medium text-zinc-200">{exif.ISO}</p>
                    </div>
                  )}
                  {exif.FocalLength && (
                    <div>
                      <p className="text-xs text-zinc-500">Focal Length</p>
                      <p className="text-sm font-medium text-zinc-200">{exif.FocalLength}mm</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="h-px bg-zinc-800" />

              {/* Details */}
              <div className="space-y-3">
                <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Details</h3>
                {exif.DateTimeOriginal && (
                  <div className="flex items-center gap-3">
                    <Calendar className="w-4 h-4 text-zinc-400" />
                    <p className="text-sm text-zinc-300" suppressHydrationWarning>
                      {new Date(exif.DateTimeOriginal.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')).toLocaleString()}
                    </p>
                  </div>
                )}
                {(!!exif.GPSLatitude && !!exif.GPSLongitude) && (
                  <div className="flex items-center gap-3">
                    <MapPin className="w-4 h-4 text-zinc-400" />
                    <p className="text-sm text-zinc-300">
                      {parseFloat(exif.GPSLatitude).toFixed(4)}, {parseFloat(exif.GPSLongitude).toFixed(4)}
                    </p>
                  </div>
                )}
                {exif.Software && (
                  <div className="flex items-center gap-3">
                    <Zap className="w-4 h-4 text-zinc-400" />
                    <p className="text-sm text-zinc-300">{exif.Software}</p>
                  </div>
                )}
                {/* Color space badge — shown when ICCProfileName or ColorSpace is available */}
                {(exif.ICCProfileName || exif.ColorSpace) && (() => {
                  const label = exif.ICCProfileName || exif.ColorSpace;
                  const badgeClass = /adobe/i.test(label)
                    ? "bg-orange-500/20 text-orange-300 border-orange-500/30"
                    : /p3/i.test(label)
                    ? "bg-purple-500/20 text-purple-300 border-purple-500/30"
                    : /2020/i.test(label)
                    ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/30"
                    : /srgb/i.test(label)
                    ? "bg-blue-500/20 text-blue-300 border-blue-500/30"
                    : "bg-zinc-700/40 text-zinc-300 border-zinc-600/30";
                  return (
                    <div className="flex items-center gap-3">
                      <Palette className="w-4 h-4 text-zinc-400" />
                      <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded border ${badgeClass}`}>
                        {label}
                      </span>
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : (
            <div className="text-sm text-zinc-500 italic">
              No EXIF data available for this photo.
            </div>
          )}

          <div className="h-px bg-zinc-800 my-6" />

          {/* AI Analysis Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                AI Analysis
              </h3>
              {!aiAnalysis && !isAnalyzing && (
                <button
                  onClick={handleAnalyze}
                  className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-md transition-colors"
                >
                  Analyze Photo
                </button>
              )}
            </div>

            {isAnalyzing && (
              <div className="flex items-center justify-center py-8 text-zinc-500">
                <Loader2 className="w-6 h-6 animate-spin mr-2" />
                <span className="text-sm">Analyzing image...</span>
              </div>
            )}

            {analysisError && (
              <div className="text-sm text-red-400 bg-red-400/10 p-3 rounded-md">
                {analysisError}
              </div>
            )}

            {aiAnalysis && (
              <div className="space-y-4 text-sm">
                <div>
                  <h4 className="text-zinc-400 font-medium mb-1">Description</h4>
                  <p className="text-zinc-300 leading-relaxed">{aiAnalysis.description}</p>
                </div>
                <div>
                  <h4 className="text-zinc-400 font-medium mb-1">Composition</h4>
                  <p className="text-zinc-300 leading-relaxed">{aiAnalysis.composition}</p>
                </div>
                <div>
                  <h4 className="text-zinc-400 font-medium mb-1">Color & Emotion</h4>
                  <p className="text-zinc-300 leading-relaxed">{aiAnalysis.color_emotion}</p>
                </div>
                <div>
                  <h4 className="text-zinc-400 font-medium mb-1">Artistic Advice</h4>
                  <p className="text-zinc-300 leading-relaxed">{aiAnalysis.artistic_advice}</p>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
