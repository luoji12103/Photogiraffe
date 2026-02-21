"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { X, Camera, Aperture, Clock, Zap, MapPin, Calendar } from "lucide-react";

interface ExifData {
  Make: string;
  Model: string;
  LensModel: string;
  FNumber: number;
  ExposureTime: string;
  ISOSpeedRatings: number;
  FocalLength: number;
  DateTimeOriginal: string;
  GPSLatitude: number;
  GPSLongitude: number;
  Software: string;
}

interface Photo {
  ID: number;
  OriginalFilename: string;
  MinioPath: string;
  Status: string;
  UploadedAt: string;
  ExifData?: ExifData;
}

interface PhotoDetailProps {
  photo: Photo;
  minioUrl: string;
}

export default function PhotoDetail({ photo, minioUrl }: PhotoDetailProps) {
  // Use the proxy image for the detail view
  const proxyPath = photo.MinioPath.replace("raw/", "proxy/").replace(/\.[^/.]+$/, ".webp");
  const imageUrl = `${minioUrl}/photos/${proxyPath}`;

  const exif = photo.ExifData;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
      <Link 
        href="/" 
        scroll={false}
        className="absolute top-6 right-6 z-50 p-2 text-white/70 hover:text-white transition-colors bg-black/20 rounded-full hover:bg-black/40"
      >
        <X size={24} />
      </Link>

      <div className="w-full h-full flex flex-col md:flex-row">
        {/* Image Section */}
        <div className="flex-1 relative flex items-center justify-center p-4 md:p-8">
          <motion.div
            layoutId={`photo-container-${photo.ID}`}
            className="relative w-full h-full max-w-5xl max-h-[80vh] flex items-center justify-center"
          >
            <motion.div layoutId={`photo-image-${photo.ID}`} className="relative w-full h-full">
              <Image
                src={imageUrl}
                alt={photo.OriginalFilename}
                fill
                className="object-contain"
                sizes="100vw"
                priority
              />
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
                {(exif.Make || exif.Model) && (
                  <div className="flex items-start gap-3">
                    <Camera className="w-5 h-5 text-zinc-400 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-zinc-200">{exif.Make} {exif.Model}</p>
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
                  {exif.FNumber && (
                    <div>
                      <p className="text-xs text-zinc-500">Aperture</p>
                      <p className="text-sm font-medium text-zinc-200">f/{exif.FNumber}</p>
                    </div>
                  )}
                  {exif.ExposureTime && (
                    <div>
                      <p className="text-xs text-zinc-500">Shutter</p>
                      <p className="text-sm font-medium text-zinc-200">{exif.ExposureTime}s</p>
                    </div>
                  )}
                  {exif.ISOSpeedRatings && (
                    <div>
                      <p className="text-xs text-zinc-500">ISO</p>
                      <p className="text-sm font-medium text-zinc-200">{exif.ISOSpeedRatings}</p>
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
                    <p className="text-sm text-zinc-300">
                      {new Date(exif.DateTimeOriginal.replace(/:/, '-').replace(/:/, '-')).toLocaleString()}
                    </p>
                  </div>
                )}
                {(exif.GPSLatitude !== 0 && exif.GPSLongitude !== 0) && (
                  <div className="flex items-center gap-3">
                    <MapPin className="w-4 h-4 text-zinc-400" />
                    <p className="text-sm text-zinc-300">
                      {exif.GPSLatitude.toFixed(4)}, {exif.GPSLongitude.toFixed(4)}
                    </p>
                  </div>
                )}
                {exif.Software && (
                  <div className="flex items-center gap-3">
                    <Zap className="w-4 h-4 text-zinc-400" />
                    <p className="text-sm text-zinc-300">{exif.Software}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-sm text-zinc-500 italic">
              No EXIF data available for this photo.
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
