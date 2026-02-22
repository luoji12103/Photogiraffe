"use client";

import { useEffect, useRef, useState } from "react";

interface LibRawImageDataShape {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface RawFrame {
  width: number;
  height: number;
  /** RGB interleaved 8-bit pixels (3 bytes per pixel, length = width * height * 3) */
  data: Uint8Array;
}

const RAW_EXTENSIONS = new Set([
  ".arw", ".cr2", ".cr3", ".nef", ".raw", ".dng",
  ".orf", ".raf", ".rw2", ".rw1", ".hif", ".3fr",
  ".pef", ".srw", ".x3f",
]);

export function isRawFile(filename: string): boolean {
  const ext = "." + (filename.split(".").pop()?.toLowerCase() ?? "");
  return RAW_EXTENSIONS.has(ext);
}

export function useRawDecoder(photoId: number, rawUrl: string | null) {
  const [frame, setFrame] = useState<RawFrame | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!rawUrl) return;

    cancelRef.current = false;
    setLoading(true);
    setError(null);
    setFrame(null);

    (async () => {
      try {
        // Dynamic import avoids SSR issues and defers loading the ~2MB WASM
        const LibRawModule = await import("libraw-wasm");
        const LibRaw = LibRawModule.default;

        if (cancelRef.current) return;

        const res = await fetch(rawUrl);
        if (!res.ok) throw new Error(`Failed to fetch RAW file: HTTP ${res.status}`);

        const buf = await res.arrayBuffer();
        if (cancelRef.current) return;

        const raw = new LibRaw();

        // Open the RAW file with camera white balance + sRGB output
        await raw.open(new Uint8Array(buf), {
          useCameraWb: true,
          outputColor: 1,   // sRGB
          outputBps: 8,     // 8-bit per channel for canvas compatibility
          halfSize: false,  // Full resolution
          userQual: 3,      // AHD demosaicing (quality/speed balance)
        });

        if (cancelRef.current) { return; }

        // Get dimensions from metadata
        const meta = await raw.metadata();
        if (cancelRef.current) { return; }

        // Get decoded pixel data
        const imgData = await raw.imageData();
        if (cancelRef.current) { return; }

        // libraw-wasm imageData() returns either an object with {data,width,height}
        // or a plain Uint8Array depending on the version.
        let pixels: Uint8Array;
        let width: number;
        let height: number;

        if (imgData instanceof Uint8Array) {
          pixels = imgData;
          width = (meta.width ?? meta.iwidth ?? meta.imgdata?.sizes?.iwidth ?? 0) as number;
          height = (meta.height ?? meta.iheight ?? meta.imgdata?.sizes?.iheight ?? 0) as number;
        } else {
          // Object shape: { data: Uint8Array, width: number, height: number }
          const shaped = imgData as LibRawImageDataShape;
          pixels = shaped.data;
          width = (shaped.width ?? meta.width ?? 0) as number;
          height = (shaped.height ?? meta.height ?? 0) as number;
        }

        if (!width || !height || !pixels?.length) {
          throw new Error(`Invalid image dimensions: ${width}×${height}, data length: ${pixels?.length}`);
        }

        setFrame({ width, height, data: pixels });
      } catch (err: unknown) {
        if (!cancelRef.current) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn("[useRawDecoder] Error decoding RAW:", msg);
          setError(msg);
        }
      } finally {
        if (!cancelRef.current) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelRef.current = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoId, rawUrl]);

  return { frame, loading, error };
}
