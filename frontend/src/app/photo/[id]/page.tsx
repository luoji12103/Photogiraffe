"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PhotoDetail from "@/components/PhotoDetail";
import { useAuth } from "@/context/AuthContext";
import { Loader2 } from "lucide-react";

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

export default function PhotoPage() {
  const params = useParams<{ id: string }>();
  const { authFetch } = useAuth();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authFetch(`/api/photos/${params.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setPhoto(data))
      .finally(() => setLoading(false));
  }, [params.id, authFetch]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!photo) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-500">
        Photo not found.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      <PhotoDetail photo={photo} />
    </div>
  );
}
