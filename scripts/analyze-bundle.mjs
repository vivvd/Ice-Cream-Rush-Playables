import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";

const root = resolve(process.argv[2] ?? "dist");
const fileLimit = 30 * 1024 * 1024;
const bundleLimit = 30 * 1024 * 1024;
const preferredFile = 512 * 1024;
const validName = /^[A-Za-z0-9._-]+$/;
const files = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile()) files.push(path);
  }
}

await walk(root);
let total = 0;
const warnings = [];
for (const file of files) {
  const size = (await stat(file)).size;
  total += size;
  const rel = relative(root, file).split(sep).join("/");
  if (rel.split("/").some((name) => !validName.test(name))) throw new Error(`Invalid filename: ${rel}`);
  if (size >= fileLimit) throw new Error(`File exceeds 30 MiB: ${rel}`);
  if (size >= preferredFile) warnings.push(`File exceeds preferred 512 KiB: ${rel}`);
}
if (total >= bundleLimit) throw new Error("Bundle exceeds 30 MiB");
if (!files.some((file) => relative(root, file) === "index.html")) throw new Error("Missing root index.html");

const html = await readFile(resolve(root, "index.html"), "utf8");
const sdk = html.indexOf("https://www.youtube.com/game_api/v1");
const gameScript = html.search(/<script[^>]+(?:src="\.\/assets\/|type="module")/);
if (sdk < 0 || (gameScript >= 0 && sdk > gameScript)) throw new Error("YouTube SDK must load before game code");
if (/\b(?:src|href)=["']\/(?!\/)/.test(html)) throw new Error("Found root-absolute bundle reference");

console.log(`Files: ${files.length}`);
console.log(`Total: ${(total / 1024).toFixed(1)} KiB`);
console.log(`Initial bundle target: PASS (${(total / 1024 / 1024).toFixed(2)} MiB < 15 MiB)`);
for (const warning of warnings) console.warn(`WARNING: ${warning}`);
