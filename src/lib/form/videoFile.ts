/**
 * Getting a user's clip into a form the browser can play.
 *
 * iPhones record .mov files in HEVC (H.265). Safari plays those, but Chrome on
 * most Windows PCs and Firefox can't, so tracking used to fail with "This
 * browser can't read that video". Here we:
 *   1. reject files that aren't a video clip before any work starts, and
 *   2. if the browser can't decode the clip, convert it on the device with
 *      ffmpeg.wasm (the video still never leaves the device).
 */

/** Video clips we read, by extension. Phones may leave `file.type` empty, so the extension decides as well. */
const VIDEO_EXTS = ["mp4", "m4v", "mov", "qt", "webm"] as const;
/** Other video formats ffmpeg can usually read; we try them, converting if needed. */
const OTHER_VIDEO_EXTS = ["avi", "mkv", "3gp", "3g2", "mpg", "mpeg", "wmv", "ogv", "flv", "hevc"];
const IMAGE_EXTS = ["heic", "heif", "jpg", "jpeg", "png", "gif", "webp", "dng", "tif", "tiff", "bmp"];

/** Above this the in-browser converter runs out of memory; native playback has no such limit. */
export const MAX_CONVERT_BYTES = 600 * 1024 * 1024;
/** A one-set clip is never this large, even in 4K. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

export type FileCheck = { ok: true } | { ok: false; message: string };

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

/** Decide from the name, type and size alone whether to try this file. Runs before any analysis. */
export function checkVideoFile(file: { name: string; type: string; size: number }): FileCheck {
  const ext = extensionOf(file.name);
  const type = file.type.toLowerCase();
  const shown = ext ? `.${ext}` : "that";
  const isVideo = type.startsWith("video/") || (VIDEO_EXTS as readonly string[]).includes(ext) || OTHER_VIDEO_EXTS.includes(ext);

  if (!isVideo) {
    if (type.startsWith("image/") || IMAGE_EXTS.includes(ext)) {
      return {
        ok: false,
        message: `That's a photo (${shown} file), not a video. I need a clip of the whole set: an iPhone .mov or an .mp4 works. If it's a Live Photo, open it in Photos and save it as a video first.`,
      };
    }
    return {
      ok: false,
      message: `I can't read ${shown === "that" ? "that file" : `a ${shown} file`}. Send a video clip of one set: an iPhone .mov, an .mp4 or a .webm.`,
    };
  }
  if (file.size === 0) return { ok: false, message: "That file is empty. Try exporting the clip again." };
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, message: `That clip is ${Math.round(file.size / 1024 ** 3)} GB, which is more than one set. Trim it to a single set (under 90 s) and send it again.` };
  }
  return { ok: true };
}

/**
 * True when this browser can decode and show the clip's video. A .mov with HEVC video
 * can load as audio-only in Chrome, so we require a real picture size too.
 */
export function canPlayVideo(url: string, timeoutMs = 10000): Promise<boolean> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    const done = (ok: boolean) => {
      window.clearTimeout(timer);
      v.removeEventListener("loadeddata", onData);
      v.removeEventListener("error", onError);
      v.removeAttribute("src");
      v.load();
      resolve(ok);
    };
    const onData = () => done(v.videoWidth > 0 && v.videoHeight > 0);
    const onError = () => done(false);
    const timer = window.setTimeout(() => done(false), timeoutMs);
    v.addEventListener("loadeddata", onData);
    v.addEventListener("error", onError);
    v.src = url;
  });
}

/**
 * The ffmpeg.wasm wrapper is served from public/vendor/ffmpeg (see scripts/form/vendor-ffmpeg.mjs), because
 * Turbopack can't bundle its worker. The ~30 MB core comes from the CDN, only when a clip needs converting.
 * Keep the core version in step with @ffmpeg/ffmpeg 0.12.x.
 */
const FFMPEG_WRAPPER_URL = "/vendor/ffmpeg/index.js";
const FFMPEG_CORE_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

type FFmpegInstance = import("@ffmpeg/ffmpeg").FFmpeg;
let ffmpegPromise: Promise<FFmpegInstance> | null = null;

/** The worker imports the core with import(), which needs a same-origin (blob) URL. */
async function toBlobURL(url: string, type: string) {
  const failed = new Error("The video converter didn't download. Check your connection and try again, or open this page in Safari.");
  const res = await fetch(url).catch(() => {
    throw failed;
  });
  if (!res.ok) throw failed;
  return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type }));
}

function getFFmpeg(): Promise<FFmpegInstance> {
  ffmpegPromise ??= (async () => {
    const { FFmpeg } = (await import(/* turbopackIgnore: true */ /* webpackIgnore: true */ FFMPEG_WRAPPER_URL)) as typeof import("@ffmpeg/ffmpeg");
    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(`${FFMPEG_CORE_URL}/ffmpeg-core.js`, "text/javascript"),
      toBlobURL(`${FFMPEG_CORE_URL}/ffmpeg-core.wasm`, "application/wasm"),
    ]);
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({ coreURL, wasmURL });
    return ffmpeg;
  })();
  ffmpegPromise.catch(() => {
    ffmpegPromise = null;
  });
  return ffmpegPromise;
}

export interface ConvertOptions {
  onProgress?: (fraction: number, stage: "converter" | "converting") => void;
  signal?: AbortSignal;
}

/** Longest side of the converted clip. Pose tracking works at 256 px, so this is plenty and keeps conversion quick. */
const MAX_SIDE = 960;

/**
 * Re-encode a clip the browser can't decode into one it can: H.264 .mp4 where supported,
 * otherwise VP8 .webm (open-source Chromium has no H.264). Drops audio, caps 30 fps,
 * and applies the phone's rotation so portrait clips stay portrait.
 */
export async function convertForBrowser(file: File, o: ConvertOptions = {}): Promise<{ url: string; file: File }> {
  if (file.size > MAX_CONVERT_BYTES) {
    throw new Error(
      `This browser can't play it, and at ${Math.round(file.size / 1024 ** 2)} MB it's too big to convert here. Open the page in Safari, or trim the clip to one set and film at 1080p.`,
    );
  }
  o.onProgress?.(0, "converter");
  const ffmpeg = await getFFmpeg();
  if (o.signal?.aborted) throw new DOMException("Cancelled", "AbortError");

  const h264 = document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"') !== "";
  const input = `input.${extensionOf(file.name) || "mov"}`;
  const output = h264 ? "output.mp4" : "output.webm";
  const onProgress = ({ progress }: { progress: number }) => {
    if (Number.isFinite(progress)) o.onProgress?.(Math.min(1, Math.max(0, progress)), "converting");
  };
  // Cancelling mid-conversion: the only way to stop ffmpeg.wasm is to end its worker, which we then reload next time.
  const onAbort = () => {
    ffmpeg.terminate();
    ffmpegPromise = null;
  };
  o.signal?.addEventListener("abort", onAbort);
  ffmpeg.on("progress", onProgress);
  try {
    await ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()));
    const scale = `scale='if(gte(iw,ih),min(${MAX_SIDE},iw),-2)':'if(gte(iw,ih),-2,min(${MAX_SIDE},ih))'`;
    const codec = h264
      ? ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
      : ["-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "2M", "-pix_fmt", "yuv420p"];
    const code = await ffmpeg.exec(["-i", input, "-an", "-vf", `fps=30,${scale}`, ...codec, output]);
    if (o.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (code !== 0) throw new Error("Converting it failed. Try exporting it again as an .mp4, or open this page in Safari.");
    const data = await ffmpeg.readFile(output);
    if (typeof data === "string" || data.byteLength === 0) throw new Error("Converting it failed. Try exporting it again as an .mp4, or open this page in Safari.");
    const type = h264 ? "video/mp4" : "video/webm";
    const name = file.name.replace(/\.[^.]*$/, "") + (h264 ? ".mp4" : ".webm");
    const out = new File([data as Uint8Array<ArrayBuffer>], name, { type });
    o.onProgress?.(1, "converting");
    return { url: URL.createObjectURL(out), file: out };
  } catch (e) {
    if (o.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    throw e;
  } finally {
    o.signal?.removeEventListener("abort", onAbort);
    if (!o.signal?.aborted) {
      ffmpeg.off("progress", onProgress);
      await Promise.allSettled([ffmpeg.deleteFile(input), ffmpeg.deleteFile(output)]);
    }
  }
}
