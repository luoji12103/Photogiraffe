"use client";

import { useEffect, useRef } from "react";
import { RawFrame } from "../lib/useRawDecoder";

interface RawCanvasProps {
  frame: RawFrame;
  className?: string;
  alt?: string;
}

/**
 * RawCanvas renders a decoded RAW frame (8-bit RGB Uint8Array) onto a <canvas>.
 * The canvas uses CSS `object-contain` sizing via className so layout is
 * handled the same way as Next.js <Image fill />.
 *
 * The pixel data is expected to be packed RGB (3 bytes per pixel),
 * which is what libraw-wasm returns with outputBps=8.
 */
export default function RawCanvas({ frame, className, alt }: RawCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { width, height, data } = frame;

    // Guard against malformed frames
    const expectedLength = width * height * 3;
    if (data.length < expectedLength) {
      console.warn(
        `[RawCanvas] Data length mismatch: got ${data.length}, expected ${expectedLength}`
      );
      return;
    }

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Convert packed RGB Uint8Array → RGBA Uint8ClampedArray for ImageData
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      rgba[j]     = data[i];     // R
      rgba[j + 1] = data[i + 1]; // G
      rgba[j + 2] = data[i + 2]; // B
      rgba[j + 3] = 255;          // A = fully opaque
    }

    const imageData = new ImageData(rgba, width, height);
    ctx.putImageData(imageData, 0, 0);
  }, [frame]);

  return (
    <canvas
      ref={canvasRef}
      aria-label={alt}
      className={className}
      style={{
        // Mirror Next/Image fill behaviour: cover parent, maintain aspect ratio
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "contain",
      }}
    />
  );
}
