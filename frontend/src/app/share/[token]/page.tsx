"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { Aperture, Camera, Clock, MapPin, Share2, AlertCircle } from "lucide-react";

interface ExifData {
  CameraModel: string;
  LensModel: string;
  FocalLength: string;
  Aperture: string;
  ShutterSpeed: string;
  ISO: string;
  GPSLatitude: string;
  GPSLongitude: string;
  DateTimeOriginal: string;
}

interface ShareData {
  photo: {
    id: number;
    original_filename: string;
    uploaded_at: string;
    exif: ExifData;
  };
  proxy_url: string;
  thumb_url: string;
  share: {
    token: string;
    expires_at: string | null;
    created_at: string;
  };
}

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/share/${token}`)
      .then((res) => {
        if (!res.ok) return res.json().then((d) => Promise.reject(d.error || "Not found"));
        return res.json();
      })
      .then((d: ShareData) => setData(d))
      .catch((e: string) => setError(e))
      .finally(() => setLoading(false));
  }, [token]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <AlertCircle className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-zinc-200 mb-2">Link Unavailable</h1>
          <p className="text-zinc-500 text-sm">{error || "This share link is not available."}</p>
        </div>
      </div>
    );
  }

  const { photo, proxy_url, share } = data;
  const exif = photo.exif;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Minimal header */}
      <header className="fixed top-0 left-0 right-0 z-40 h-12 flex items-center justify-between px-4 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/50">
        <a href="/" className="flex items-center gap-2 text-zinc-400 hover:text-zinc-200 transition-colors">
          <Aperture className="w-5 h-5" />
          <span className="text-sm font-medium">Photogiraffe</span>
        </a>
        <button
          onClick={handleCopyLink}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium
                     bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
        >
          <Share2 className="w-3.5 h-3.5" />
          {copied ? "Copied!" : "Copy link"}
        </button>
      </header>

      <div className="pt-12">
        {/* Photo */}
        <div className="relative w-full bg-black" style={{ maxHeight: "70vh", minHeight: "300px" }}>
          <Image
            src={proxy_url}
            alt={photo.original_filename}
            fill
            className="object-contain"
            unoptimized
            priority
          />
        </div>

        {/* Info panel */}
        <div className="max-w-2xl mx-auto px-4 py-8">
          <h1 className="text-xl font-semibold mb-1 break-all">{photo.original_filename}</h1>

          {share.expires_at && (
            <p className="text-xs text-amber-400 mb-4 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              Expires {new Date(share.expires_at).toLocaleDateString()}
            </p>
          )}

          {/* EXIF info */}
          {exif && (
            <div className="mt-6 space-y-4">
              {exif.CameraModel && (
                <div className="flex items-start gap-3">
                  <Camera className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">{exif.CameraModel}</p>
                    {exif.LensModel && <p className="text-xs text-zinc-500">{exif.LensModel}</p>}
                  </div>
                </div>
              )}

              {(exif.FocalLength || exif.Aperture || exif.ShutterSpeed || exif.ISO) && (
                <div className="flex flex-wrap gap-2">
                  {exif.FocalLength && <Chip label={exif.FocalLength} />}
                  {exif.Aperture && <Chip label={`f/${exif.Aperture}`} />}
                  {exif.ShutterSpeed && <Chip label={exif.ShutterSpeed} />}
                  {exif.ISO && <Chip label={`ISO ${exif.ISO}`} />}
                </div>
              )}

              {exif.DateTimeOriginal && (
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <Clock className="w-4 h-4 text-zinc-500" />
                  {exif.DateTimeOriginal}
                </div>
              )}

              {exif.GPSLatitude && exif.GPSLongitude && (
                <a
                  href={`https://www.google.com/maps?q=${exif.GPSLatitude},${exif.GPSLongitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  <MapPin className="w-4 h-4 text-zinc-500" />
                  View on map
                </a>
              )}
            </div>
          )}

          <p className="mt-8 text-xs text-zinc-600 text-center">
            Shared via{" "}
            <a href="/" className="text-zinc-500 hover:text-zinc-300 transition-colors">
              Photogiraffe
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="px-2 py-1 rounded-md bg-zinc-800 text-zinc-300 text-xs font-mono">
      {label}
    </span>
  );
}
