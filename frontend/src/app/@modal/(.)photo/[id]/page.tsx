import PhotoDetail from "@/components/PhotoDetail";
import { notFound } from "next/navigation";

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

async function getPhoto(id: string): Promise<Photo | null> {
  const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
  try {
    const res = await fetch(`${apiUrl}/photos/${id}`, { cache: "no-store" });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error("Failed to fetch photo");
    }
    return res.json();
  } catch (error) {
    console.error(error);
    return null;
  }
}

export default async function PhotoModalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const photo = await getPhoto(id);

  if (!photo) {
    notFound();
  }

  // B6 fix: minioUrl was declared but PhotoDetail uses /api/image proxy directly.
  return <PhotoDetail photo={photo} />;
}
