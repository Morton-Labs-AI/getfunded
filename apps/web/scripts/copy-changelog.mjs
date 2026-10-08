// Copies the repository CHANGELOG into the app so the /changelog page can read it
// at request time on Vercel (files outside the app root are not traced).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const src = path.resolve(process.cwd(), "..", "..", "CHANGELOG.md");
const outDir = path.resolve(process.cwd(), "content", "generated");
const dest = path.join(outDir, "CHANGELOG.md");
if (!existsSync(src)) {
  console.warn(`[copy-changelog] ${src} not found; /changelog will show the fallback notice`);
  process.exit(0);
}
mkdirSync(outDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[copy-changelog] copied CHANGELOG.md -> content/generated/`);
