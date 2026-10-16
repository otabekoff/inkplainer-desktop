// Assembles the app's web files into dist/: the untouched upstream Inkplainer, the
// offline copies from vendor/ and the desktop shell from desktop/. index.html is patched
// to use the local copies; every patch must match exactly, so an upstream change that
// moves things around fails the build instead of silently going back online.
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const upstream = join(root, "upstream");
const dist = join(root, "dist");

for (const need of ["upstream/index.html", "vendor/fonts.css", "vendor/mp4-muxer.mjs"]) {
  await stat(join(root, need)).catch(() => {
    throw new Error(`${need} is missing; run \`bun run setup\` first`);
  });
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const item of ["index.html", "animations.js", "favicon.svg", "site.webmanifest", "LICENSE", "pages"]) {
  await cp(join(upstream, item), join(dist, item), { recursive: true });
}
// Hand images only; the coordinate mapper next to them is an authoring tool.
await cp(join(upstream, "images"), join(dist, "images"), {
  recursive: true,
  filter: (src) => !src.includes("Coordinate Mapper Tool"),
});
await cp(join(root, "vendor"), join(dist, "vendor"), { recursive: true });
await cp(join(root, "desktop"), join(dist, "desktop"), { recursive: true });

async function patch(file, edits) {
  const path = join(dist, file);
  let text = await readFile(path, "utf8");
  for (const [find, replace] of edits) {
    const hits =
      typeof find === "string" ? text.split(find).length - 1 : [...text.matchAll(new RegExp(find, "g"))].length;
    if (hits !== 1) throw new Error(`${file}: expected 1 match for ${find}, found ${hits}`);
    text = text.replace(find, replace);
  }
  if (/https:\/\/(fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr)/.test(text.replace(/<meta[^>]*>/g, ""))) {
    throw new Error(`${file}: still references an online resource after patching`);
  }
  await writeFile(path, text);
}

const fontLinks = /(<link [^>]*fonts\.googleapis\.com[^>]*>\s*)+/;

await patch("index.html", [
  [fontLinks, '<link href="vendor/fonts.css" rel="stylesheet">\n'],
  ["import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.mjs')", "import('./vendor/mp4-muxer.mjs')"],
  [" Check your internet connection.", ""],
  // At the very end, so the desktop styles and scripts come after (and override) the app's own.
  [
    /<\/body>(?![\s\S]*<\/body>)/,
    '<link href="desktop/desktop.css" rel="stylesheet">\n' +
      '<script src="desktop/export.js"></script>\n' +
      '<script src="desktop/desktop.js"></script>\n</body>',
  ],
]);
await patch("pages/docs.html", [[fontLinks, '<link href="../vendor/fonts.css" rel="stylesheet">\n']]);

console.log("dist/ ready");
