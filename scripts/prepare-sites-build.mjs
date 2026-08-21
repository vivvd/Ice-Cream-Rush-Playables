import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const workerSource = resolve(root, "dist/rsc/index.js");
const workerTarget = resolve(root, "dist/server/index.js");

await mkdir(resolve(root, "dist/server"), { recursive: true });
await copyFile(workerSource, workerTarget);
console.log("Prepared Sites worker entrypoint.");
