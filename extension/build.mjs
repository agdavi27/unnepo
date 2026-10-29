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
await build({
  entryPoints: {
    background: path.join(here, "src/background.ts"),
    "content/connect": path.join(here, "src/content/connect.ts"),
    "content/fill": path.join(here, "src/content/fill.ts"),
    "sidepanel/panel": path.join(here, "src/sidepanel/panel.ts"),
  },
  outdir: out,
  bundle: true,
  format: "esm",
  target: "chrome116",
  minify: false,
  alias: { "@": root },
  define: { __UNNEPO_API__: JSON.stringify(api) },
  logLevel: "warning",
});
cpSync(path.join(here, "manifest.json"), path.join(out, "manifest.json"));
cpSync(path.join(here, "src/sidepanel/panel.html"), path.join(out, "sidepanel/panel.html"));
cpSync(path.join(here, "src/sidepanel/panel.css"), path.join(out, "sidepanel/panel.css"));
console.log(`Built the extension into ${path.relative(root, out)} (server: ${api})`);
