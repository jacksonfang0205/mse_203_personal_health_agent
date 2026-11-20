// Copies the ffmpeg.wasm browser wrapper (@ffmpeg/ffmpeg, MIT) into public/vendor/ffmpeg.
// The form coach loads it from there at runtime to convert iPhone HEVC clips: Turbopack can't
// bundle its `new Worker(new URL(...))`, and the worker has to be same-origin anyway.
// Re-run after changing the @ffmpeg/ffmpeg version: npm run form:vendor-ffmpeg
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const pkgDir = join(process.cwd(), "node_modules", "@ffmpeg", "ffmpeg");
const { version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const out = join(process.cwd(), "public", "vendor", "ffmpeg");
mkdirSync(out, { recursive: true });
for (const f of ["index.js", "classes.js", "const.js", "errors.js", "types.js", "utils.js", "worker.js"]) {
  copyFileSync(join(pkgDir, "dist", "esm", f), join(out, f));
}
writeFileSync(join(out, "README.md"), `@ffmpeg/ffmpeg ${version} (MIT, https://github.com/ffmpegwasm/ffmpeg.wasm), copied by scripts/form/vendor-ffmpeg.mjs. Do not edit.\n`);
console.log(`Copied @ffmpeg/ffmpeg ${version} to ${out}`);
