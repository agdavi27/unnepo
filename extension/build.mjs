// Builds the Chrome extension into extension/dist: load that folder in chrome://extensions (Load unpacked).
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const out = path.join(here, "dist");
// UNNEPO_API overrides the server, for testing against a local copy.
const api = process.env.UNNEPO_API || "https://unneponew.vercel.app";

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const shared = { outdir: out, bundle: true, target: "chrome116", minify: false, alias: { "@": root }, define: { __UNNEPO_API__: JSON.stringify(api) }, logLevel: "warning" };
// The worker, the panel and the dashboard are modules.
await build({ ...shared, format: "esm", entryPoints: { background: path.join(here, "src/background.ts"), "sidepanel/panel": path.join(here, "src/sidepanel/panel.ts"), "dashboard/dashboard": path.join(here, "src/dashboard/dashboard.ts") } });
// Page scripts are plain scripts that get injected again and again. Each copy is wrapped in its own scope;
// without that, every re-injection reset the first copy's state (and left frozen spiders behind).
await build({ ...shared, format: "iife", entryPoints: { "content/connect": path.join(here, "src/content/connect.ts"), "content/fill": path.join(here, "src/content/fill.ts"), "content/launcher": path.join(here, "src/content/launcher.ts") } });
cpSync(path.join(here, "manifest.json"), path.join(out, "manifest.json"));
cpSync(path.join(here, "icons"), path.join(out, "icons"), { recursive: true });
cpSync(path.join(here, "fonts"), path.join(out, "fonts"), { recursive: true });
cpSync(path.join(here, "src/sidepanel/panel.html"), path.join(out, "sidepanel/panel.html"));
cpSync(path.join(here, "src/sidepanel/panel.css"), path.join(out, "sidepanel/panel.css"));
cpSync(path.join(here, "src/dashboard/dashboard.html"), path.join(out, "dashboard/dashboard.html"));
cpSync(path.join(here, "src/dashboard/dashboard.css"), path.join(out, "dashboard/dashboard.css"));
console.log(`Built the extension into ${path.relative(root, out)} (server: ${api})`);
