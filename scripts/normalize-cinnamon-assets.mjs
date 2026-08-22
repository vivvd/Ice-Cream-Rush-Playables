import sharp from "sharp";

const assets = [
  [process.argv[2], "public/assets/products/cinnamon-roll.webp"],
  [process.argv[3], "public/assets/products/cinnamon-roll-vanilla.webp"],
  [process.argv[4], "public/assets/products/cinnamon-roll-chocolate.webp"],
  [process.argv[5], "public/assets/products/cinnamon-roll-berry.webp"],
];

function transparentOutside(input, width, height, channels) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    rgba[index * 4] = input[index * channels];
    rgba[index * 4 + 1] = input[index * channels + 1];
    rgba[index * 4 + 2] = input[index * channels + 2];
    rgba[index * 4 + 3] = channels === 4 ? input[index * channels + 3] : 255;
  }
  if (channels === 4) return rgba;

  const pixelCount = width * height;
  const labels = new Int32Array(pixelCount);
  const queue = new Int32Array(width * height);
  const isSubjectColor = (index) => {
    const offset = index * 4;
    const r = rgba[offset];
    const g = rgba[offset + 1];
    const b = rgba[offset + 2];
    return Math.min(r, g, b) < 170 || Math.max(r, g, b) - Math.min(r, g, b) > 55;
  };
  let label = 0;
  let largestLabel = 0;
  let largestSize = 0;
  for (let start = 0; start < pixelCount; start += 1) {
    if (labels[start] || !isSubjectColor(start)) continue;
    label += 1;
    let head = 0;
    let tail = 0;
    let size = 0;
    labels[start] = label;
    queue[tail++] = start;
    while (head < tail) {
      const index = queue[head++];
      size += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      for (const neighbor of [x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1, y > 0 ? index - width : -1, y + 1 < height ? index + width : -1]) {
        if (neighbor < 0 || labels[neighbor] || !isSubjectColor(neighbor)) continue;
        labels[neighbor] = label;
        queue[tail++] = neighbor;
      }
    }
    if (size > largestSize) {
      largestSize = size;
      largestLabel = label;
    }
  }

  const outside = new Uint8Array(pixelCount);
  let head = 0;
  let tail = 0;
  const enqueueOutside = (index) => {
    if (outside[index] || labels[index] === largestLabel) return;
    outside[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x += 1) {
    enqueueOutside(x);
    enqueueOutside((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueueOutside(y * width);
    enqueueOutside(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueueOutside(index - 1);
    if (x + 1 < width) enqueueOutside(index + 1);
    if (y > 0) enqueueOutside(index - width);
    if (y + 1 < height) enqueueOutside(index + width);
  }
  for (let index = 0; index < pixelCount; index += 1) {
    if (!outside[index]) {
      rgba[index * 4 + 3] = 255;
      continue;
    }
    rgba[index * 4] = 0;
    rgba[index * 4 + 1] = 0;
    rgba[index * 4 + 2] = 0;
    rgba[index * 4 + 3] = 0;
  }
  return rgba;
}

for (const [source, destination] of assets) {
  if (!source) throw new Error("Expected four source images");
  const { data, info } = await sharp(source).raw().toBuffer({ resolveWithObject: true });
  const rgba = transparentOutside(data, info.width, info.height, info.channels);
  await sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({ width: 220, height: 220, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: 18, bottom: 18, left: 18, right: 18, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 90, alphaQuality: 100, smartSubsample: true })
    .toFile(destination);
}
