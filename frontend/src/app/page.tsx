import PhotoGrid from "@/components/PhotoGrid";
import Link from "next/link";

interface Photo {
  ID: number;
  OriginalFilename: string;
  MinioPath: string;
  Status: string;
  UploadedAt: string;
}

async function getPhotos(): Promise<Photo[]> {
  const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
  try {
    const res = await fetch(`${apiUrl}/photos`, { cache: "no-store" });
    if (!res.ok) {
      throw new Error("Failed to fetch photos");
    }
    return res.json();
  } catch (error) {
    console.error(error);
    return [];
  }
}

export default async function Home() {
  const photos = await getPhotos();
  const minioUrl = process.env.NEXT_PUBLIC_MINIO_URL || "http://localhost:9000";

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans p-8">
      <header className="mb-12 flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Photogiraffe Gallery</h1>
          <p className="text-zinc-500 dark:text-zinc-400 mt-2">Your high-quality photo collection.</p>
        </div>
        <Link href="/settings" className="px-4 py-2 bg-zinc-200 dark:bg-zinc-800 rounded-lg hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors">
          Settings
        </Link>
      </header>

      <main>
        <PhotoGrid photos={photos} minioUrl={minioUrl} />
      </main>
    </div>
  );
}
