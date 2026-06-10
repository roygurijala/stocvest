#!/usr/bin/env node
/**
 * Remove the Next.js build cache (`.next`).
 *
 * Long-running `next dev` sessions on Windows can leave stale webpack chunk
 * references (e.g. `Cannot find module './8948.js'`), which surfaces as 404/500
 * on `/_next/static/*` and breaks `/login`. Run before restarting dev when that
 * happens: `npm run clean:next` then `npm run dev`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(frontendRoot, ".next");

if (!fs.existsSync(cacheDir)) {
  console.log("No .next cache to clear.");
  process.exit(0);
}

fs.rmSync(cacheDir, { recursive: true, force: true });
console.log("Cleared frontend/.next");
