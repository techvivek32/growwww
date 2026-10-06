// Copies MediaPipe's WebAssembly runtime into public/ so the phone KYC page
// loads it from our own server — no third-party CDN sees the visitor.
// Runs before `next dev` and `next build` (predev / prebuild).
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const src = path.join("node_modules", "@mediapipe", "tasks-vision", "wasm");
const dest = path.join("public", "mediapipe", "wasm");
const files = ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"];

if (!existsSync(src)) {
  console.error(`[mediapipe] ${src} is missing — run npm install`);
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
for (const f of files) copyFileSync(path.join(src, f), path.join(dest, f));
console.log(`[mediapipe] copied ${files.length} runtime files to ${dest}`);
