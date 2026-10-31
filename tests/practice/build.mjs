// Practice pages for the extension's filler: `node tests/practice/build.mjs` builds them into
// tests/practice/dist; add `--serve 43180` to serve them. Each page loads harness.js, so
// `await practice({ "Country": "United States" })` in its console fills it with the real filler.
import { build } from "esbuild";
import { cpSync, createReadStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "../..");
const out = path.join(here, "dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await build({
  entryPoints: { harness: path.join(here, "harness.ts"), "react-form": path.join(here, "react-form.tsx") },
  outdir: out, bundle: true, format: "iife", target: "chrome116", alias: { "@": root }, jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning",
});
cpSync(path.join(here, "pages"), out, { recursive: true });
console.log(`Built the practice pages into ${path.relative(root, out)}`);

const serve = process.argv.indexOf("--serve");
if (serve >= 0) {
  const port = Number(process.argv[serve + 1] || 43180);
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname).replace(/^\/+/, "") || "index.html";
    const file = path.join(out, name);
    if (!file.startsWith(out) || !existsSync(file) || statSync(file).isDirectory()) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  }).listen(port, () => console.log(`Practice pages on http://localhost:${port}`));
}
