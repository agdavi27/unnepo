// Pushes the current branch with the next version: V1 becomes V1.001, then V1.002, and so on. The web app's
// badge (lib/version.ts) and the extension (manifest "version_name", shown in its panel) always match.
// Chrome's own version number can't have leading zeros, so the extension's "version" is 1.1, 1.2, ...
// Usage: npm run push (commit your work first; only the version files are committed here).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const versionFile = path.join(root, "lib/version.ts");
const manifestFile = path.join(root, "extension/manifest.json");

const pending = git("status", "--porcelain").split("\n").filter(Boolean);
if (pending.length) {
  console.error(`Commit or stash these first, so the version commit holds only the version:\n${pending.join("\n")}`);
  process.exit(1);
}

const source = readFileSync(versionFile, "utf8");
const current = source.match(/VERSION = "(\d+)(?:\.(\d+))?"/);
if (!current) throw new Error("Couldn't read the version in lib/version.ts.");
const major = Number(current[1]);
const build = Number(current[2] ?? 0) + 1;
const next = `${major}.${String(build).padStart(3, "0")}`;

writeFileSync(versionFile, source.replace(/VERSION = "[^"]*"/, `VERSION = "${next}"`));
const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
manifest.version = `${major}.${build}`;
manifest.version_name = next;
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

git("add", versionFile, manifestFile);
execFileSync("git", ["commit", "-m", `Version ${next}`], { cwd: root, stdio: "inherit" });
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
execFileSync("git", ["push", "-u", "origin", branch], { cwd: root, stdio: "inherit" });
console.log(`Pushed ${branch} as V${next}.`);
