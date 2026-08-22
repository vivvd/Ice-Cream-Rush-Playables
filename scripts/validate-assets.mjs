import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const assetRoot = resolve(projectRoot, "public/assets");
const characterRoot = resolve(assetRoot, "characters");
const equipmentRoot = resolve(assetRoot, "equipment");
const productRoot = resolve(assetRoot, "products");
const errors = [];

for (const file of (await readdir(characterRoot)).filter((name) => name.endsWith(".webp")).sort()) {
  const path = resolve(characterRoot, file);
  const metadata = await sharp(path).metadata();
  const alpha = (await sharp(path).stats()).channels[3];
  if (!metadata.hasAlpha || !alpha || alpha.min !== 0 || alpha.max !== 255) errors.push(`${file}: missing full alpha range`);

  if (!file.includes("-happy")) {
    const happy = resolve(characterRoot, file.replace(/-(worried|angry|urgent)/, "-happy"));
    const happyAlpha = (await sharp(happy).stats()).channels[3];
    if (!alpha || !happyAlpha || Math.abs(alpha.mean - happyAlpha.mean) > 2) errors.push(`${file}: alpha mask differs from identity anchor`);
  }
}

for (const file of (await readdir(equipmentRoot)).filter((name) => name.endsWith(".webp")).sort()) {
  const path = resolve(equipmentRoot, file);
  const metadata = await sharp(path).metadata();
  if (!metadata.hasAlpha) errors.push(`${file}: equipment icon lacks transparency`);
}

for (const file of (await readdir(productRoot)).filter((name) => name.endsWith(".webp")).sort()) {
  const path = resolve(productRoot, file);
  const metadata = await sharp(path).metadata();
  if (metadata.width !== 256 || metadata.height !== 256) errors.push(`${file}: product sprite is not 256x256`);
  if (!metadata.hasAlpha) errors.push(`${file}: product sprite lacks transparency`);
}

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if ((await stat(path)).size > 512 * 1024) errors.push(`${path}: exceeds 512 KiB`);
  }
}

await walk(assetRoot);
if (errors.length) throw new Error(errors.join("\n"));
console.log("Validated product canvases, character alpha masks, equipment transparency, and 512 KiB asset limits.");
