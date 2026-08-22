import { chromium } from "@playwright/test";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const url = process.env.ICE_CREAM_RUSH_URL ?? "http://127.0.0.1:4180";
const siteRoot = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
let server;

if (!process.env.ICE_CREAM_RUSH_URL) {
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", url).pathname);
      const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const filePath = resolve(siteRoot, relativePath);

      if (filePath !== siteRoot && !filePath.startsWith(`${siteRoot}${sep}`)) {
        response.writeHead(403).end("Forbidden");
        return;
      }

      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) throw new Error("Not a file");
      response.writeHead(200, { "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream" });
      createReadStream(filePath).pipe(response);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(4180, "127.0.0.1", resolveListen);
  });
}

const csp = "default-src 'none'; script-src 'report-sample' 'self' 'unsafe-eval' 'unsafe-inline' blob: https://www.youtube.com/game_api/v1 https://www.youtube.com/game_api/v1/; object-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' blob: data:; sandbox allow-pointer-lock allow-same-origin allow-scripts; base-uri 'self'; worker-src 'self' blob:";
let browser;

try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => errors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ""}`));
  page.on("request", (request) => {
    const requestUrl = request.url();
    if (requestUrl === "https://www.youtube.com/game_api/v1") return;
    if (new URL(requestUrl).origin !== new URL(url).origin) errors.push(`unexpected external request: ${requestUrl}`);
  });

  await page.route("https://www.youtube.com/game_api/v1", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `window.__calls=[];window.ytgame={IN_PLAYABLES_ENV:true,game:{firstFrameReady(){window.__calls.push('first')},gameReady(){window.__calls.push('ready')},async loadData(){window.__calls.push('load');return ''},async saveData(){}},system:{isAudioEnabled(){return false},onAudioEnabledChange(){},onPause(){},onResume(){}},engagement:{async sendScore(){}},ads:{async requestRewardedAd(){return false},async requestInterstitialAd(){}},health:{logWarning(){}}}`,
  }));

  await page.route(`${url}/`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": csp } });
  });

  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "CHOOSE DAY" }).click();
  await page.getByRole("button", { name: /Start Day 1,/ }).click();
  await page.getByRole("button", { name: "Add Cone" }).click();
  await page.getByRole("button", { name: "Add Vanilla" }).click();
  await page.getByRole("button", { name: "SERVE" }).click();
  const calls = await page.evaluate(() => window.__calls);
  if (JSON.stringify(calls) !== JSON.stringify(["first", "load", "ready"])) errors.push(`SDK order: ${JSON.stringify(calls)}`);
  if (await page.getByText("FIRST ORDER").count()) errors.push("Tutorial did not complete");
  const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  if (heap >= 512 * 1024 * 1024) errors.push(`Heap exceeds 512 MiB: ${heap}`);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Release smoke test passed with CSP, SDK lifecycle, local assets, and first-order interaction.");
} finally {
  await browser?.close();
  if (server) await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
}
