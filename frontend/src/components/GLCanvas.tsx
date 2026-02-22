"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { GLRenderer, AdjustParams, DEFAULT_ADJUST } from "../lib/gl-renderer";
import type { RawFrame } from "../lib/useRawDecoder";

interface GLCanvasProps {
  /** URL of the WebP proxy image (always provided) */
  proxyUrl: string;
  /** Fully decoded RAW frame, replaces proxy texture when available */
  rawFrame?: RawFrame | null;
  /** Adjustment parameters (exposure, brightness, contrast, saturation) */
  params?: AdjustParams;
  alt?: string;
  className?: string;
  /** Called when the proxy image texture is ready */
  onReady?: () => void;
}

/**
 * GLCanvas renders an image through a WebGL pipeline with real-time colour adjustments.
 * Accepts either a WebP proxy URL (HTMLImageElement) or a decoded RAW frame (Uint8Array),
 * and re-renders on every params change via requestAnimationFrame.
 *
 * Falls back to a plain <img> if WebGL is not supported.
 */
export default function GLCanvas({
  proxyUrl,
  rawFrame,
  params = DEFAULT_ADJUST,
  alt,
  className,
  onReady,
}: GLCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GLRenderer | null>(null);
  const rafRef = useRef<number>(0);
  const paramsRef = useRef<AdjustParams>(params);
  const [glSupported, setGlSupported] = useState(true);
  const [textureLoaded, setTextureLoaded] = useState(false);

  // Keep paramsRef in sync for use inside the RAF callback
  paramsRef.current = params;

  // Stable render function (doesn't need to be recreated when params change)
  const scheduleRender = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rendererRef.current?.render(paramsRef.current);
    });
  }, []);

  // --- Initialise WebGL once on mount ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new GLRenderer();
    const ok = renderer.init(canvas);
    if (!ok) {
      setGlSupported(false);
      return;
    }
    rendererRef.current = renderer;

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  // --- Upload proxy WebP image when proxyUrl changes ---
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !glSupported) return;

    setTextureLoaded(false);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      renderer.uploadImage(img);
      setTextureLoaded(true);
      scheduleRender();
      onReady?.();
    };
    img.onerror = () => {
      console.warn("[GLCanvas] Failed to load proxy image:", proxyUrl);
    };
    img.src = proxyUrl;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proxyUrl, glSupported]);

  // --- Replace texture when RAW frame becomes available ---
  useEffect(() => {
    if (!rawFrame || !rendererRef.current || !glSupported) return;
    rendererRef.current.uploadFrame(rawFrame);
    scheduleRender();
  }, [rawFrame, glSupported, scheduleRender]);

  // --- Re-render on every params change ---
  useEffect(() => {
    if (!textureLoaded && !rawFrame) return;
    scheduleRender();
  }, [params, textureLoaded, rawFrame, scheduleRender]);

  if (!glSupported) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={proxyUrl}
        alt={alt}
        className={className}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      aria-label={alt}
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "contain",
        // Canvas shows nothing until texture is loaded
        opacity: textureLoaded || rawFrame ? 1 : 0,
        transition: "opacity 0.3s ease",
      }}
    />
  );
}
