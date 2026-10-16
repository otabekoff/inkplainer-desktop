// Assembles the app's web files into dist/: the app itself (app/, forked from Inkplainer),
// the offline copies from vendor/ and the desktop shell from desktop/. Fails if any page
// still loads something from the internet, so the app stays fully offline.
import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

for (const need of ["app/index.html", "vendor/fonts.css", "vendor/mp4-muxer.mjs", "vendor/webm-muxer.mjs"]) {
  await stat(join(root, need)).catch(() => {
    throw new Error(`${need} is missing${need.startsWith("vendor") ? "; run `bun run vendor` first" : ""}`);
  });
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(root, "app"), dist, { recursive: true });
await cp(join(root, "vendor"), join(dist, "vendor"), { recursive: true });
await cp(join(root, "desktop"), join(dist, "desktop"), { recursive: true });

// Anything a page or script would fetch from the network at runtime.
const ONLINE = /(?:src|href)\s*=\s*["']https?:|import\(\s*["']https?:|url\(\s*["']?https?:|fetch\(\s*["']https?:/;

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if ([".html", ".js", ".mjs", ".css"].includes(extname(entry.name))) yield path;
  }
}
for await (const file of files(dist)) {
  // <a href="https://..."> links open in the browser; only loads matter.
  const text = (await readFile(file, "utf8")).replace(/<a\s[^>]*>/g, "").replace(/<meta[^>]*>/g, "");
  const hit = text.match(ONLINE);
  if (hit) throw new Error(`${file.slice(dist.length + 1)} loads an online resource: ${hit[0]}`);
}

console.log("dist/ ready");
