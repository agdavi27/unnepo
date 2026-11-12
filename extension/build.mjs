// Builds the Chrome extension into extension/dist: load that folder in chrome://extensions (Load unpacked).
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const out = path.join(here, "dist");
// UNNEPO_API overrides the server, for testing against a local copy.
const api = process.env.UNNEPO_API || "https://www.unnepo.com";

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const shared = { outdir: out, bundle: true, target: "chrome116", minify: false, alias: { "@": root }, define: { __UNNEPO_API__: JSON.stringify(api) }, logLevel: "warning" };
// The worker, the panel and the dashboard are modules.
await build({ ...shared, format: "esm", entryPoints: { background: path.join(here, "src/background.ts"), "sidepanel/panel": path.join(here, "src/sidepanel/panel.ts"), "dashboard/dashboard": path.join(here, "src/dashboard/dashboard.ts") } });
// Page scripts are plain scripts that get injected again and again. Each copy is wrapped in its own scope;
// without that, every re-injection reset the first copy's state (and left frozen spiders behind).
await build({ ...shared, format: "iife", entryPoints: { "content/connect": path.join(here, "src/content/connect.ts"), "content/fill": path.join(here, "src/content/fill.ts"), "content/launcher": path.join(here, "src/content/launcher.ts") } });
// Built for the real server, the manifest drops its localhost entries: they're only for testing a local
// copy, and the Chrome Web Store's review asks about every site an extension can reach.
const manifest = JSON.parse(readFileSync(path.join(here, "manifest.json"), "utf8"));
if (!/localhost/.test(api)) {
  const real = (match) => !match.includes("localhost");
  manifest.host_permissions = manifest.host_permissions.filter(real);
  for (const script of manifest.content_scripts) script.matches = script.matches.filter(real);
}
writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
cpSync(path.join(here, "icons"), path.join(out, "icons"), { recursive: true });
cpSync(path.join(here, "fonts"), path.join(out, "fonts"), { recursive: true });
cpSync(path.join(here, "src/sidepanel/panel.html"), path.join(out, "sidepanel/panel.html"));
cpSync(path.join(here, "src/sidepanel/panel.css"), path.join(out, "sidepanel/panel.css"));
cpSync(path.join(here, "src/dashboard/dashboard.html"), path.join(out, "dashboard/dashboard.html"));
cpSync(path.join(here, "src/dashboard/dashboard.css"), path.join(out, "dashboard/dashboard.css"));
console.log(`Built the extension into ${path.relative(root, out)} (server: ${api})`);

// --zip also packs dist into unnepo-extension-<version>.zip at the project root, for the Chrome Web Store.
if (process.argv.includes("--zip")) {
  const zip = path.join(root, `unnepo-extension-${manifest.version_name ?? manifest.version}.zip`);
  rmSync(zip, { force: true });
  execFileSync("zip", ["-qr", zip, ".", "-x", ".*"], { cwd: out });
  console.log(`Packed it into ${path.relative(root, zip)} for the Chrome Web Store`);
  // The website's download, for installing by hand before (or instead of) the store: /extension/install.
  if (!/localhost/.test(api)) {
    const site = path.join(root, "public/downloads/unnepo-extension.zip");
    mkdirSync(path.dirname(site), { recursive: true });
    cpSync(zip, site);
    console.log(`Copied it to ${path.relative(root, site)} for the website's download`);
  }
}
