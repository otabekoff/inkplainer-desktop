// Fetches upstream Inkplainer (the `upstream` git submodule) and refreshes vendor/.
//   bun run setup            check out the pinned upstream commit
//   bun run setup --latest   move the submodule to upstream's newest commit
// Needs internet; everything after this (building, running the app) does not.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "inherit" });

if (process.argv.includes("--latest")) {
  git("submodule", "update", "--init", "--remote", "upstream");
} else {
  git("submodule", "update", "--init", "upstream");
}
execFileSync(process.execPath, [join(root, "scripts", "vendor.mjs")], { stdio: "inherit" });
