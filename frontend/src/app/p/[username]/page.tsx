"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { MapPin, Globe, Camera, ImageIcon, Loader2 } from "lucide-react";

interface PublicPhoto {
  id: number;
  original_filename: string;
  thumbnail_url: string;
  camera_model: string;
  description: string;
  tags: string;
  uploaded_at: string;
}

interface PublicProfile {
  username: string;
  bio: string;
  website: string;
  location: string;
  avatar_url: string;
  photo_count: number;
  photos: PublicPhoto[];
}

export default function PublicPortfolioPage() {
  const params = useParams();
  const username = params?.username as string;

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selected, setSelected] = useState<PublicPhoto | null>(null);

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    fetch(`/api/public/profile/${encodeURIComponent(username)}`)
      .then((r) => {
        if (r.status === 404) {
          if (!cancelled) setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((data: PublicProfile | null) => {
        if (!cancelled && data) setProfile(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-2">
          <ImageIcon className="w-12 h-12 text-neutral-300 mx-auto" />
          <p className="text-neutral-500 text-lg">未找到该摄影师主页</p>
          <p className="text-neutral-400 text-sm">@{username}</p>
        </div>
      </div>
    );
  }

  const parseTags = (raw: string): string[] => {
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  };

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* ── Hero / Profile Section ── */}
      <section className="max-w-5xl mx-auto px-4 py-16 flex flex-col items-center text-center gap-4">
        {profile.avatar_url ? (
          <Image
            src={profile.avatar_url}
            alt={profile.username}
            width={96}
            height={96}
            className="w-24 h-24 rounded-full object-cover ring-2 ring-neutral-700"
            unoptimized
          />
        ) : (
          <div className="w-24 h-24 rounded-full bg-neutral-800 flex items-center justify-center ring-2 ring-neutral-700">
            <Camera className="w-10 h-10 text-neutral-500" />
          </div>
        )}

        <div>
          <h1 className="text-3xl font-bold tracking-tight">@{profile.username}</h1>
          {profile.bio && (
            <p className="mt-2 text-neutral-400 max-w-prose">{profile.bio}</p>
          )}
        </div>

        <div className="flex items-center gap-4 text-sm text-neutral-500">
          {profile.location && (
            <span className="flex items-center gap-1">
              <MapPin className="w-4 h-4" />
              {profile.location}
            </span>
          )}
          {profile.website && (
            <a
              href={profile.website.startsWith("http") ? profile.website : `https://${profile.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-neutral-200 transition-colors"
            >
              <Globe className="w-4 h-4" />
              {profile.website.replace(/^https?:\/\//, "")}
            </a>
          )}
          <span className="flex items-center gap-1">
            <ImageIcon className="w-4 h-4" />
            {profile.photo_count} 张作品
          </span>
        </div>
      </section>

      {/* ── Photo Grid ── */}
      {profile.photos.length === 0 ? (
        <div className="text-center py-24 text-neutral-600">
          <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>该摄影师暂无公开作品</p>
        </div>
      ) : (
        <section className="max-w-6xl mx-auto px-4 pb-20">
          <div className="columns-2 sm:columns-3 md:columns-4 gap-2 space-y-2">
            {profile.photos.map((photo) => (
              <div
                key={photo.id}
                className="break-inside-avoid cursor-pointer group relative overflow-hidden rounded-md bg-neutral-900"
                onClick={() => setSelected(photo)}
              >
                {photo.thumbnail_url ? (
                  <Image
                    src={photo.thumbnail_url}
                    alt={photo.original_filename}
                    width={400}
                    height={300}
                    className="w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    unoptimized
                  />
                ) : (
                  <div className="w-full aspect-square bg-neutral-800 flex items-center justify-center">
                    <ImageIcon className="w-8 h-8 text-neutral-600" />
                  </div>
                )}

                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                  {photo.description && (
                    <p className="text-white text-xs line-clamp-2">{photo.description}</p>
                  )}
                  {photo.camera_model && (
                    <p className="text-neutral-300 text-xs mt-0.5 flex items-center gap-1">
                      <Camera className="w-3 h-3" />
                      {photo.camera_model}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Lightbox Modal ── */}
      {selected && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="relative max-w-4xl w-full bg-neutral-900 rounded-xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {selected.thumbnail_url && (
              <Image
                src={selected.thumbnail_url}
                alt={selected.original_filename}
                width={1200}
                height={800}
                className="w-full object-contain max-h-[75vh]"
                unoptimized
              />
            )}
            <div className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-neutral-200">
                  {selected.original_filename}
                </p>
                <p className="text-xs text-neutral-500">
                  {new Date(selected.uploaded_at).toLocaleDateString("zh-CN")}
                </p>
              </div>
              {selected.description && (
                <p className="text-sm text-neutral-400">{selected.description}</p>
              )}
              {selected.camera_model && (
                <p className="text-xs text-neutral-500 flex items-center gap-1">
                  <Camera className="w-3 h-3" />
                  {selected.camera_model}
                </p>
              )}
              {parseTags(selected.tags).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {parseTags(selected.tags).map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 bg-neutral-800 rounded text-xs text-neutral-400"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => setSelected(null)}
              className="absolute top-3 right-3 text-white/60 hover:text-white bg-black/40 rounded-full w-8 h-8 flex items-center justify-center text-lg leading-none"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
