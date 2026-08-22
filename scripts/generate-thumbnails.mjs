import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const assets = resolve(projectRoot, "public/assets");
const output = resolve(projectRoot, "submission/thumbnails");
await mkdir(output, { recursive: true });

const asset = (group, name) => resolve(assets, group, `${name}.webp`);

async function resized(path, width, height = width) {
  return sharp(path).resize(width, height, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  }).png().toBuffer();
}

async function heroDessert() {
  const canvas = sharp({ create: { width: 700, height: 900, channels: 4, background: "#00000000" } });
  const [cone, chocolate, vanilla, strawberry, sprinkles] = await Promise.all([
    resized(asset("products", "cone"), 430),
    resized(asset("products", "chocolate"), 320),
    resized(asset("products", "vanilla"), 320),
    resized(asset("products", "strawberry"), 320),
    resized(asset("products", "sprinkles"), 300),
  ]);
  return canvas.composite([
    { input: cone, left: 135, top: 485 },
    { input: chocolate, left: 190, top: 385 },
    { input: vanilla, left: 190, top: 225 },
    { input: strawberry, left: 190, top: 65 },
    { input: sprinkles, left: 200, top: 35 },
  ]).png().toBuffer();
}

function sparkleOverlay(width, height) {
  const stroke = Math.max(4, Math.round(Math.min(width, height) * .006));
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><radialGradient id="g"><stop offset="0" stop-color="#fff9de" stop-opacity=".96"/><stop offset="1" stop-color="#fff9de" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="${width / 2}" cy="${height * .49}" rx="${width * .27}" ry="${height * .36}" fill="url(#g)"/>
    <g fill="#ffd45f" stroke="#35283f" stroke-width="${stroke}" stroke-linejoin="round">
      <path d="M${width * .12} ${height * .25}l${stroke * 2} ${stroke * 4} ${stroke * 4} ${stroke * 2}-${stroke * 4} ${stroke * 2}-${stroke * 2} ${stroke * 4}-${stroke * 2}-${stroke * 4}-${stroke * 4}-${stroke * 2} ${stroke * 4}-${stroke * 2}z"/>
      <path d="M${width * .87} ${height * .3}l${stroke * 2} ${stroke * 4} ${stroke * 4} ${stroke * 2}-${stroke * 4} ${stroke * 2}-${stroke * 2} ${stroke * 4}-${stroke * 2}-${stroke * 4}-${stroke * 4}-${stroke * 2} ${stroke * 4}-${stroke * 2}z"/>
    </g>
  </svg>`);
}

const hero = await heroDessert();
const sizes = [
  [1024, 1024, "thumbnail-1x1.png"],
  [1080, 1512, "thumbnail-5x7.png"],
  [1280, 720, "thumbnail-16x9.png"],
];

for (const [width, height, name] of sizes) {
  const portrait = height / width > 1.18;
  const characterWidth = Math.round(width * (portrait ? .48 : .32));
  const characterHeight = Math.round(characterWidth * 1.08);
  const heroWidth = Math.round(Math.min(width * (portrait ? .78 : .46), height * .68));
  const heroHeight = Math.round(heroWidth * 900 / 700);
  const [leftCharacter, rightCharacter, heroLayer] = await Promise.all([
    resized(asset("characters", "regular-0-happy"), characterWidth, characterHeight),
    resized(asset("characters", "patient-1-happy"), characterWidth, characterHeight),
    sharp(hero).resize(heroWidth, heroHeight, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    }).png().toBuffer(),
  ]);

  const background = asset("scene", portrait ? "parlor-portrait" : "parlor-landscape");
  await sharp(background)
    .resize(width, height, { fit: "cover" })
    .modulate({ saturation: 1.08, brightness: .98 })
    .composite([
      { input: sparkleOverlay(width, height), left: 0, top: 0 },
      { input: leftCharacter, left: Math.round(width * (portrait ? -.02 : .015)), top: Math.round(height * (portrait ? .46 : .38)) },
      { input: rightCharacter, left: width - characterWidth - Math.round(width * (portrait ? -.02 : .015)), top: Math.round(height * (portrait ? .48 : .38)) },
      { input: heroLayer, left: Math.round((width - heroWidth) / 2), top: Math.round(height - heroHeight - height * .025) },
    ])
    .png({ compressionLevel: 9, palette: true, quality: 92, colours: 256, effort: 10 })
    .toFile(resolve(output, name));
  console.log(`Created submission/thumbnails/${name}`);
}
