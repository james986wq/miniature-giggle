// Copies the proxy files from node_modules into public/ so Vercel's CDN serves
// them as static files. Runs on `npm run build`.
// Local files in public/uv (uv.config.js, sw.js, uv.sw.js, ...) are never overwritten.
import { cpSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { bareModulePath } from "@mercuryworkshop/bare-as-module3";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

const pub = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const targets = [
  ["uv", uvPath, false],
  ["epoxy", epoxyPath, true],
  ["libcurl", libcurlPath, true],
  ["bareasmodule", bareModulePath, true],
  ["baremux", baremuxPath, true],
];

for (const [name, src, overwrite] of targets) {
  const dest = join(pub, name);
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true, force: overwrite, errorOnExist: false });
  console.log(`copied ${name}`);
}
