import { readdir, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const characterDir = resolve(projectRoot, "public/assets/characters");
const files = (await readdir(characterDir)).filter((file) => file.endsWith(".webp"));
const identities = [...new Set(files.map((file) => file.replace(/-(happy|worried|angry|urgent)\.webp$/, "")))];

for (const identity of identities) {
  const happyPath = resolve(characterDir, `${identity}-happy.webp`);
  const happyMetadata = await sharp(happyPath).metadata();
  const alphaMask = await sharp(happyPath).ensureAlpha().extractChannel(3).raw().toBuffer();

  for (const mood of ["worried", "angry", "urgent"]) {
    const targetPath = resolve(characterDir, `${identity}-${mood}.webp`);
    const temporaryPath = resolve(characterDir, `${identity}-${mood}.fixed.webp`);
    const rgb = await sharp(targetPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    await sharp(rgb.data, { raw: rgb.info })
      .joinChannel(alphaMask, {
        raw: {
          width: happyMetadata.width ?? 384,
          height: happyMetadata.height ?? 384,
          channels: 1,
        },
      })
      .webp({ quality: 92, alphaQuality: 100, smartSubsample: true })
      .toFile(temporaryPath);
    await rename(temporaryPath, targetPath);
  }
}

console.log(`Reused happy alpha masks for ${identities.length * 3} mood sprites.`);
