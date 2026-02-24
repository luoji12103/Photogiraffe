"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, Images, Aperture } from "lucide-react";

interface PhotoThumb {
  id: number;
  original_filename: string;
  thumbnail_url: string;
}

interface AlbumShare {
  album: {
    id: number;
    name: string;
    description: string;
    created_at: string;
  };
  photos: PhotoThumb[];
}

export default function SharedAlbumPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<AlbumShare | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/share/album/${token}`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("相册不存在或分享链接已失效");
        return res.json();
      })
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      {/* Header */}
      <header className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
        <Aperture className="w-5 h-5 text-zinc-500" />
        <span className="text-sm text-zinc-500 font-medium">Photogiraffe</span>
        <span className="ml-auto text-xs text-zinc-600">公开相册</span>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-zinc-500" />
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center py-20 text-zinc-500 text-sm">
            {error}
          </div>
        )}

        {data && (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-semibold text-zinc-100">{data.album.name}</h1>
              {data.album.description && (
                <p className="text-sm text-zinc-500 mt-1">{data.album.description}</p>
              )}
              <p className="text-xs text-zinc-600 mt-2">{data.photos.length} 张照片</p>
            </div>

            {data.photos.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-zinc-600 gap-3">
                <Images className="w-14 h-14 opacity-40" />
                <p className="text-sm">相册中没有照片</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {data.photos.map((photo) => (
                  <div
                    key={photo.id}
                    className="aspect-square bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800"
                    title={photo.original_filename}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.thumbnail_url}
                      alt={photo.original_filename}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
