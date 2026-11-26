import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(ROOT, "node_modules", "esbuild-wasm", "esbuild.wasm");
const destDir = join(ROOT, "public");
const dest = join(destDir, "esbuild.wasm");

if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
