"use client";

import { useEffect, useRef, useState } from "react";
import { drawOverlay, type OverlayOptions } from "@/lib/form/overlay";
import type { PoseSequence } from "@/lib/form/pose";
import { Button, cx } from "../ui";

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

export function SkeletonPlayer({ videoUrl, pose, overlay, seek }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef(overlay);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [exporting, setExporting] = useState<number | null>(null);
  const [download, setDownload] = useState<{ url: string; ext: string } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    overlayRef.current = overlay;
  }, [overlay]);

  // Draw loop for the on-screen overlay.
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
          if (showSkeleton) drawOverlay(ctx, pose, v.currentTime * 1000, contentRect(v), overlayRef.current, Math.max(0.8, Math.min(1.2, w / 640)));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pose, showSkeleton]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !seek) return;
    v.currentTime = seek.ms / 1000;
    v.pause();
  }, [seek]);

  useEffect(() => () => {
    if (download) URL.revokeObjectURL(download.url);
  }, [download]);

  async function exportVideo() {
    setExportError(null);
    setDownload(null);
    if (typeof MediaRecorder === "undefined") {
      setExportError("This browser can't record video. Try Chrome or a recent Safari.");
      return;
    }
    const v = document.createElement("video");
    v.src = videoUrl;
    v.muted = true;
    v.playsInline = true;
    try {
      await new Promise<void>((res, rej) => {
        v.onloadeddata = () => res();
        v.onerror = () => rej(new Error("Couldn't load the video for export."));
      });
      const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
      const W = Math.round(v.videoWidth * scale), H = Math.round(v.videoHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      const type = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
      const rec = new MediaRecorder(canvas.captureStream(30), type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const stopped = new Promise<void>((res) => (rec.onstop = () => res()));
      setExporting(0);
      rec.start(250);
      await v.play();
      await new Promise<void>((res) => {
        const draw = () => {
          ctx.drawImage(v, 0, 0, W, H);
          drawOverlay(ctx, pose, v.currentTime * 1000, { x: 0, y: 0, w: W, h: H }, overlayRef.current, Math.max(1, W / 640));
          setExporting(Math.min(1, v.currentTime / (v.duration || 1)));
          if (v.ended) res();
          else requestAnimationFrame(draw);
        };
        requestAnimationFrame(draw);
      });
      rec.stop();
      await stopped;
      const mime = type.split(";")[0] || "video/webm";
      setDownload({ url: URL.createObjectURL(new Blob(chunks, { type: mime })), ext: mime === "video/mp4" ? "mp4" : "webm" });
    } catch (e) {
      setExportError((e as Error).message || "Export failed.");
    } finally {
      setExporting(null);
      v.removeAttribute("src");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-2xl bg-ink">
        <video ref={videoRef} src={videoUrl} controls playsInline muted className="block max-h-[70vh] w-full object-contain" />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" className="h-9 px-4" onClick={() => setShowSkeleton((s) => !s)}>
          {showSkeleton ? "Hide skeleton" : "Show skeleton"}
        </Button>
        <Button variant="secondary" className="h-9 px-4" onClick={exportVideo} disabled={exporting !== null}>
          {exporting !== null ? `Rendering ${Math.round(exporting * 100)}%` : "Make annotated video"}
        </Button>
        {download && (
          <a href={download.url} download={`pivot-form-review.${download.ext}`} className={cx("text-sm font-semibold text-coral-deep underline underline-offset-4")}>
            Download annotated video
          </a>
        )}
        {exportError && <span className="text-sm text-coral-ink">{exportError}</span>}
      </div>
    </div>
  );
}
