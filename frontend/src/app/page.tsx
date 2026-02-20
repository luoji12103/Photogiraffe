import Image from "next/image";

interface Photo {
  ID: number;
  OriginalFilename: string;
  MinioPath: string;
  Status: string;
  UploadedAt: string;
}

async function getPhotos(): Promise<Photo[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
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
      <header className="mb-12">
        <h1 className="text-4xl font-bold tracking-tight">Photogiraffe Gallery</h1>
        <p className="text-zinc-500 dark:text-zinc-400 mt-2">Your high-quality photo collection.</p>
      </header>

      <main>
        {photos.length === 0 ? (
          <div className="text-center py-20 text-zinc-500">
            No photos uploaded yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {photos.map((photo) => {
              // Construct thumbnail URL
              // Assuming minio_path is like "raw/uuid.jpg" and thumb is "thumb/uuid.webp"
              const thumbPath = photo.MinioPath.replace("raw/", "thumb/").replace(/\.[^/.]+$/, ".webp");
              const imageUrl = `${minioUrl}/photos/${thumbPath}`;

              return (
                <div key={photo.ID} className="group relative aspect-square overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-800">
                  {photo.Status === "completed" ? (
                    <Image
                      src={imageUrl}
                      alt={photo.OriginalFilename}
                      fill
                      className="object-cover transition-transform duration-300 group-hover:scale-105"
                      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    />
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
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
