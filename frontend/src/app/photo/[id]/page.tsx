import PhotoDetail from "@/components/PhotoDetail";
import { notFound } from "next/navigation";

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

export default async function PhotoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const photo = await getPhoto(id);

  if (!photo) {
    notFound();
  }

  const minioUrl = process.env.NEXT_PUBLIC_MINIO_URL || "http://localhost:9000";

  return (
    <div className="min-h-screen bg-zinc-950">
      <PhotoDetail photo={photo} minioUrl={minioUrl} />
    </div>
  );
}
