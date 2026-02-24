"use client";

import { useEffect, useState, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import Link from "next/link";

// Fix leaflet default icon
// @ts-expect-error – leaflet internal
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export interface MapPhoto {
  id: number;
  lat: number;
  lng: number;
  thumbnail_path: string;
  original_filename: string;
}

interface PhotoMapLeafletProps {
  photos: MapPhoto[];
  onMarkerClick?: (id: number) => void;
}

function FitBounds({ photos }: { photos: MapPhoto[] }) {
  const map = useMap();
  useEffect(() => {
    if (photos.length === 0) return;
    if (photos.length === 1) {
      map.setView([photos[0].lat, photos[0].lng], 10);
      return;
    }
    const bounds = L.latLngBounds(photos.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [photos, map]);
  return null;
}

export default function PhotoMapLeaflet({ photos, onMarkerClick }: PhotoMapLeafletProps) {
  const center: [number, number] = photos.length > 0
    ? [photos[0].lat, photos[0].lng]
    : [30, 100];

  return (
    <MapContainer
      center={center}
      zoom={photos.length === 1 ? 10 : 3}
      style={{ height: "100%", width: "100%" }}
      scrollWheelZoom
      zoomControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds photos={photos} />
      {photos.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lng]}>
          <Popup minWidth={180}>
            <div className="text-center">
              <p className="font-medium text-zinc-800 text-sm mb-2 truncate max-w-[160px]">
                {p.original_filename}
              </p>
              <p className="text-xs text-zinc-500 mb-2">
                {p.lat.toFixed(4)}°, {p.lng.toFixed(4)}°
              </p>
              <Link
                href={`/photo/${p.id}`}
                className="inline-block px-3 py-1 bg-zinc-900 text-white text-xs rounded-lg hover:bg-zinc-700 transition-colors"
              >
                查看照片
              </Link>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
