import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const baseURL = process.env.ICE_CREAM_RUSH_URL ?? "http://127.0.0.1:4173";
const output = "qa/screenshots";
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });

async function open(viewport, save = "") {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.route("https://www.youtube.com/game_api/v1", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `window.ytgame={IN_PLAYABLES_ENV:true,game:{firstFrameReady(){},gameReady(){},async loadData(){return ${JSON.stringify(save)}},async saveData(){}},system:{isAudioEnabled(){return false},onAudioEnabledChange(){},onPause(){},onResume(){}},ads:{async requestRewardedAd(){return true},async requestInterstitialAd(){}},engagement:{async sendScore(){}},health:{logWarning(){}}}`,
  }));
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /CHOOSE DAY|CONTINUE DAY/ }).waitFor();
  return page;
}

async function startFirstLevel(page) {
  await page.getByRole("button", { name: "CHOOSE DAY" }).click();
  await page.getByRole("button", { name: /Start Day 1,/ }).click();
}

let page = await open({ width: 393, height: 852 });
await page.screenshot({ path: `${output}/menu-393x852.png` });
await page.getByRole("button", { name: "CHOOSE DAY" }).click();
await page.screenshot({ path: `${output}/level-select-393x852.png` });
await page.getByRole("button", { name: /Start Day 1,/ }).click();
await page.screenshot({ path: `${output}/tutorial-393x852.png` });
await page.close();

page = await open({ width: 1366, height: 768 });
await startFirstLevel(page);
await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.unlockAll());
await page.screenshot({ path: `${output}/full-rush-1366x768.png` });
await page.close();

page = await open({ width: 360, height: 800 });
await startFirstLevel(page);
await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.unlockAll());
await page.screenshot({ path: `${output}/full-rush-360x800.png` });
await page.close();

for (const width of [650, 635, 621, 620]) {
  page = await open({ width, height: 800 });
  await startFirstLevel(page);
  await page.screenshot({ path: `${output}/hud-${width}x800.png` });
  await page.close();
}

page = await open({ width: 270, height: 378 });
await startFirstLevel(page);
await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.unlockAll());
await page.screenshot({ path: `${output}/minimum-270x378.png` });
await page.close();

const partialSave = JSON.stringify({ version: 3, coins: 1250, upgrades: [], tutorialComplete: true, bestScore: 4400, settings: { music: true, sfx: true, reducedMotion: false }, activeRun: null });
page = await open({ width: 768, height: 768 }, partialSave);
await startFirstLevel(page);
await page.waitForTimeout(250);
await page.screenshot({ path: `${output}/direct-unlocks-768x768.png` });
await page.close();

page = await open({ width: 1024, height: 768 });
await startFirstLevel(page);
await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.unlockAll());
await page.getByRole("button", { name: "Reset current build" }).click();
await page.getByRole("button", { name: "Add Waffle bowl" }).click();
await page.getByRole("button", { name: "Add Vanilla" }).click();
await page.getByRole("button", { name: "Add Chocolate", exact: true }).click();
await page.getByRole("button", { name: "Add Mint" }).click();
await page.getByRole("button", { name: "Add Sprinkles" }).click();
await page.waitForTimeout(260);
await page.screenshot({ path: `${output}/tall-dessert-1024x768.png` });
await page.close();

page = await open({ width: 768, height: 768 });
await startFirstLevel(page);
await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.setDemoTicket());
await page.getByRole("button", { name: "Build remaining ticket item 3" }).click();
await page.getByRole("button", { name: "Add Tea Cup" }).click();
await page.getByRole("button", { name: "Add Milk Tea" }).click();
await page.getByRole("button", { name: "Add Tapioca Pearls" }).click();
await page.waitForTimeout(260);
await page.screenshot({ path: `${output}/bubble-tea-768x768.png` });
await page.close();

page = await open({ width: 393, height: 852 });
await startFirstLevel(page);
await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.setDemoTicket());
await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.setPatience(0.12));
await page.screenshot({ path: `${output}/urgent-customer-393x852.png` });
await page.getByRole("button", { name: "Pause game" }).click();
await page.screenshot({ path: `${output}/pause-393x852.png` });
await page.close();

page = await open({ width: 1440, height: 900 });
await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.unlockCampaign());
await page.getByRole("button", { name: "START ENDLESS" }).click();
await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.forceGameOver(100_000));
await page.screenshot({ path: `${output}/game-over-1440x900.png` });
await page.close();

page = await open({ width: 768, height: 768 });
await startFirstLevel(page);
await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.forceLevelWin());
await page.screenshot({ path: `${output}/day-complete-768x768.png` });
await page.close();

page = await open({ width: 2560, height: 1080 });
await startFirstLevel(page);
await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.unlockAll());
await page.screenshot({ path: `${output}/ultrawide-2560x1080.png` });
await page.close();

await browser.close();
console.log(`Saved QA screenshots to ${output}`);
