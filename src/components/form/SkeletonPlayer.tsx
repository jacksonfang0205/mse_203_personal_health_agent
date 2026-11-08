"use client";

import { useEffect, useRef } from "react";
import { drawOverlay, type OverlayOptions } from "@/lib/form/overlay";
import type { PoseSequence } from "@/lib/form/pose";

interface Props {
  videoUrl: string;
  pose: PoseSequence;
  overlay: OverlayOptions;
  /** Change `nonce` to jump to `ms`. */
  seek?: { ms: number; nonce: number } | null;
}

/** Where a video with object-fit: contain actually draws inside its box. */
function contentRect(v: HTMLVideoElement) {
  const bw = v.clientWidth, bh = v.clientHeight;
  const vw = v.videoWidth || bw, vh = v.videoHeight || bh;
  const s = Math.min(bw / vw, bh / vh);
  const w = vw * s, h = vh * s;
  return { x: (bw - w) / 2, y: (bh - h) / 2, w, h };
}

/** The user's video with the tracked skeleton, live joint angle and rep counter drawn on top. */
export function SkeletonPlayer({ videoUrl, pose, overlay, seek }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef(overlay);

  useEffect(() => {
    overlayRef.current = overlay;
  }, [overlay]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current, c = canvasRef.current;
      if (v && c) {
        const dpr = window.devicePixelRatio || 1;
        const w = v.clientWidth, h = v.clientHeight;
        if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
          c.width = Math.round(w * dpr);
          c.height = Math.round(h * dpr);
        }
        const ctx = c.getContext("2d");
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);
          drawOverlay(ctx, pose, v.currentTime * 1000, contentRect(v), overlayRef.current, Math.max(0.8, Math.min(1.2, w / 640)));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pose]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !seek) return;
    v.currentTime = seek.ms / 1000;
    v.pause();
  }, [seek]);

  return (
    <div className="relative overflow-hidden rounded-2xl bg-ink">
      <video ref={videoRef} src={videoUrl} controls playsInline muted className="block max-h-[70vh] w-full object-contain" />
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
    </div>
  );
}
