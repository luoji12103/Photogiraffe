"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";


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
  shot_at?: string;
}

interface PhotoMapLeafletProps {
  photos: MapPhoto[];
  onMarkerClick?: (id: number) => void;
}

// ─── Pure-TS grid clustering ──────────────────────────────────────────────────
// Groups points into grid cells based on pixel distance at current zoom level.
// Returns an array of clusters, each containing one or more photos.
interface Cluster {
  lat: number;
  lng: number;
  photos: MapPhoto[];
}

function clusterPhotos(map: L.Map, photos: MapPhoto[], gridSize = 60): Cluster[] {
  const zoom = map.getZoom();
  // Map each photo to a grid cell key
  const cells: Record<string, MapPhoto[]> = {};
  for (const p of photos) {
    const pt = map.project([p.lat, p.lng], zoom);
    const cellX = Math.floor(pt.x / gridSize);
    const cellY = Math.floor(pt.y / gridSize);
    const key = `${cellX}:${cellY}`;
    if (!cells[key]) cells[key] = [];
    cells[key].push(p);
  }
  // Convert each cell group into a cluster (centroid lat/lng)
  return Object.values(cells).map((group) => {
    const lat = group.reduce((s, p) => s + p.lat, 0) / group.length;
    const lng = group.reduce((s, p) => s + p.lng, 0) / group.length;
    return { lat, lng, photos: group };
  });
}

// Icon factories
function clusterIcon(count: number) {
  const size = count < 10 ? 36 : count < 100 ? 44 : 52;
  const bg = count < 10 ? "#3b82f6" : count < 50 ? "#f59e0b" : "#ef4444";
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:#fff;display:flex;align-items:center;justify-content:center;font-size:${size < 44 ? 12 : 14}px;font-weight:700;border:2.5px solid rgba(255,255,255,0.8);box-shadow:0 2px 8px rgba(0,0,0,0.4)">${count}</div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function singleIcon() {
  return new L.Icon.Default();
}

// Inner component that renders markers + reacts to zoom changes
function ClusterLayer({
  photos,
  onMarkerClick,
}: {
  photos: MapPhoto[];
  onMarkerClick?: (id: number) => void;
}) {
  const map = useMap();
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  const rebuild = useCallback(() => {
    if (layerGroupRef.current) {
      layerGroupRef.current.clearLayers();
    } else {
      layerGroupRef.current = L.layerGroup().addTo(map);
    }

    const clusters = clusterPhotos(map, photos);

    clusters.forEach((cluster) => {
      if (cluster.photos.length === 1) {
        const p = cluster.photos[0];
        const marker = L.marker([p.lat, p.lng], { icon: singleIcon() });
        const thumbUrl = `/api/image?path=${encodeURIComponent(p.thumbnail_path)}`;
        marker.bindPopup(
          `<div style="text-align:center;min-width:150px">
            <img src="${thumbUrl}" style="width:130px;height:82px;object-fit:cover;border-radius:5px;margin-bottom:5px" onerror="this.style.display='none'" />
            <p style="font-size:11px;font-weight:600;margin:0 0 3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px">${p.original_filename}</p>
            ${p.shot_at ? `<p style="font-size:10px;color:#888;margin:0 0 5px">${p.shot_at.substring(0, 10)}</p>` : ""}
            <p style="font-size:10px;color:#888;margin:0 0 5px">${p.lat.toFixed(4)}°, ${p.lng.toFixed(4)}°</p>
            <a href="/photo/${p.id}" style="display:inline-block;padding:3px 10px;background:#18181b;color:#fff;font-size:11px;border-radius:5px;text-decoration:none">查看照片</a>
          </div>`,
          { maxWidth: 180 }
        );
        if (onMarkerClick) marker.on("click", () => onMarkerClick(p.id));
        layerGroupRef.current!.addLayer(marker);
      } else {
        // Cluster bubble — click to zoom in
        const icon = clusterIcon(cluster.photos.length);
        const marker = L.marker([cluster.lat, cluster.lng], { icon });
        marker.on("click", () => {
          const bounds = L.latLngBounds(cluster.photos.map((p) => [p.lat, p.lng]));
          map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
        });
        layerGroupRef.current!.addLayer(marker);
      }
    });
  }, [photos, map, onMarkerClick]);

  // Build on mount + rebuild whenever photos change
  useEffect(() => {
    rebuild();
    return () => {
      layerGroupRef.current?.clearLayers();
    };
  }, [rebuild]);

  // Rebuild on every zoom end
  useMapEvents({ zoomend: rebuild, moveend: rebuild });

  // Fit bounds on first render
  useEffect(() => {
    if (photos.length === 1) {
      map.setView([photos[0].lat, photos[0].lng], 10);
    } else if (photos.length > 1) {
      const bounds = L.latLngBounds(photos.map((p) => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export default function PhotoMapLeaflet({ photos, onMarkerClick }: PhotoMapLeafletProps) {
  const center: [number, number] =
    photos.length > 0 ? [photos[0].lat, photos[0].lng] : [30, 100];

  const [localStart, setLocalStart] = useState("");
  const [localEnd, setLocalEnd] = useState("");

  // Filtered photos based on date range
  const displayPhotos = (localStart || localEnd)
    ? photos.filter((p) => {
        if (!p.shot_at) return true;
        const d = p.shot_at.substring(0, 10);
        if (localStart && d < localStart) return false;
        if (localEnd && d > localEnd) return false;
        return true;
      })
    : photos;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      {/* ── Date filter bar ── */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: "12px", padding: "8px 16px",
          background: "#18181b", borderBottom: "1px solid #27272a", fontSize: "12px",
          color: "#a1a1aa", flexWrap: "wrap", zIndex: 10,
        }}
      >
        <span style={{ fontWeight: 600, color: "#71717a" }}>日期过滤</span>
        <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ color: "#71717a" }}>从</span>
          <input
            type="date"
            value={localStart}
            onChange={(e) => setLocalStart(e.target.value)}
            style={{
              background: "#27272a", border: "1px solid #3f3f46", borderRadius: "4px",
              padding: "2px 6px", color: "#e4e4e7", fontSize: "11px", outline: "none",
            }}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ color: "#71717a" }}>到</span>
          <input
            type="date"
            value={localEnd}
            onChange={(e) => setLocalEnd(e.target.value)}
            style={{
              background: "#27272a", border: "1px solid #3f3f46", borderRadius: "4px",
              padding: "2px 6px", color: "#e4e4e7", fontSize: "11px", outline: "none",
            }}
          />
        </label>
        {(localStart || localEnd) && (
          <button
            onClick={() => { setLocalStart(""); setLocalEnd(""); }}
            style={{ color: "#71717a", textDecoration: "underline", fontSize: "11px", background: "none", border: "none", cursor: "pointer" }}
          >
            清除
          </button>
        )}
        <span style={{ marginLeft: "auto", color: "#52525b" }}>
          {displayPhotos.length} / {photos.length} 张
        </span>
      </div>

      {/* ── Map ── */}
      <div style={{ flex: 1, minHeight: 0 }}>
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
          <ClusterLayer photos={displayPhotos} onMarkerClick={onMarkerClick} />
        </MapContainer>
      </div>
    </div>
  );
}

export interface MapPhoto {
  id: number;
  lat: number;
  lng: number;
  thumbnail_path: string;
  original_filename: string;
  shot_at?: string;
}

interface PhotoMapLeafletProps {
  photos: MapPhoto[];
  onMarkerClick?: (id: number) => void;
  // Optional controlled date range filters
  startDate?: string;
  endDate?: string;
}
