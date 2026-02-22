"use client";

import { useEffect, useState } from "react";
import PhotoGrid from "@/components/PhotoGrid";
import UploadPanel from "@/components/UploadPanel";
import { useAuth } from "@/context/AuthContext";

interface Photo {
  ID: number;
  OriginalFilename: string;
  MinioPath: string;
  Status: string;
  UploadedAt: string;
}

export default function Home() {
  const { authFetch, user } = useAuth();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return; // AuthGuard handles redirect; wait until user is loaded
    authFetch("/api/photos")
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: Photo[]) => setPhotos(data))
      .catch((err) => console.error("Failed to load photos:", err))
      .finally(() => setLoading(false));
  }, [user, authFetch]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans p-8">
      <header className="mb-12 flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Photogiraffe Gallery</h1>
          <p className="text-zinc-500 dark:text-zinc-400 mt-2">Your high-quality photo collection.</p>
        </div>
        <div className="flex items-center gap-3">
          <UploadPanel onUploadComplete={() => {
            authFetch("/api/photos")
              .then((res) => res.ok ? res.json() : Promise.reject())
              .then((data: Photo[]) => setPhotos(data))
              .catch(() => {});
          }} />
        </div>
      </header>

      <main>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-xl bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
            ))}
          </div>
        ) : (
          <PhotoGrid photos={photos} />
        )}
      </main>
    </div>
  );
}

