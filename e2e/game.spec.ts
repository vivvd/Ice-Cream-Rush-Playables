import { expect, test, type Page } from "@playwright/test";

async function installSdkMock(page: Page, saveData = "") {
  await page.route("https://www.youtube.com/game_api/v1", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `
        window.__ytCalls = [];
        window.__ytSaved = ${JSON.stringify(saveData)};
        window.ytgame = {
          IN_PLAYABLES_ENV: true,
          game: {
            firstFrameReady() { window.__ytCalls.push('firstFrameReady'); },
            gameReady() { window.__ytCalls.push('gameReady'); },
            async loadData() { window.__ytCalls.push('loadData'); return window.__ytSaved; },
            async saveData(data) { window.__ytCalls.push('saveData'); window.__ytSaved = data; }
          },
          system: {
            isAudioEnabled() { return true; },
            onAudioEnabledChange(cb) { window.__ytAudio = cb; return () => {}; },
            onPause(cb) { window.__ytPause = cb; return () => {}; },
            onResume(cb) { window.__ytResume = cb; return () => {}; }
          },
          engagement: { async sendScore(score) { window.__ytCalls.push('score:' + score.value); } },
          ads: {
            async requestRewardedAd(id) { window.__ytCalls.push('rewarded:' + id); return true; },
            async requestInterstitialAd() { window.__ytCalls.push('interstitial'); }
          },
          health: { logWarning() { window.__ytCalls.push('warning'); } }
        };
      `,
    });
  });
}

test.beforeEach(async ({ page }) => {
  await installSdkMock(page);
});

test("boots with the required SDK lifecycle order", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "PLAY NOW" })).toBeVisible();
  const calls = await page.evaluate(() => (window as typeof window & { __ytCalls: string[] }).__ytCalls);
  expect(calls.slice(0, 3)).toEqual(["firstFrameReady", "loadData", "gameReady"]);
});

test("teaches ADD TO TRAY then serves the complete first ticket", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "PLAY NOW" }).click();
  await expect(page.getByText("Tap or drag the glowing cone")).toBeVisible();
  await page.getByRole("button", { name: "Add Cone" }).click();
  await expect(page.getByText("Great! Add the vanilla scoop")).toBeVisible();
  await page.getByRole("button", { name: "Add Vanilla" }).click();
  await expect(page.getByText("Perfect — add it to the tray")).toBeVisible();
  await page.getByRole("button", { name: "ADD TO TRAY" }).click();
  await expect(page.getByText("Great! Serve the complete order")).toBeVisible();
  await page.getByRole("button", { name: "SERVE ORDER" }).click();
  await expect(page.getByText("FIRST ORDER")).toHaveCount(0);
  await expect(page.locator(".coins-pill strong")).not.toHaveText("0");
});

test("supports drag cancellation, drag-and-drop, and nested SDK pause", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "PLAY NOW" }).click();
  await page.getByRole("button", { name: "Add Cone" }).click();
  const scoop = page.getByRole("button", { name: "Add Vanilla" });
  const station = page.locator(".assembly-dropzone");

  const scoopBox = await scoop.boundingBox();
  const stationBox = await station.boundingBox();
  if (!scoopBox || !stationBox) throw new Error("Drag targets are not visible");
  await scoop.dispatchEvent("pointerdown", { pointerId: 41, clientX: scoopBox.x + 10, clientY: scoopBox.y + 10 });
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 41, clientX: 160, clientY: 160 })));
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 41 })));
  await expect(page.locator(".drag-ghost")).toHaveCount(0);
  await expect(station.locator(".dessert-scoop")).toHaveCount(0);

  await page.mouse.move(scoopBox.x + scoopBox.width / 2, scoopBox.y + scoopBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(stationBox.x + stationBox.width / 2, stationBox.y + stationBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(station.locator(".dessert-scoop")).toHaveCount(1);

  await page.getByRole("button", { name: "Pause game" }).click();
  await expect(page.getByRole("heading", { name: "GAME PAUSED" })).toBeVisible();
  await page.evaluate(() => (window as typeof window & { __ytPause: () => void }).__ytPause());
  await expect(page.getByText("YOUTUBE PAUSE")).toBeVisible();
  await page.evaluate(() => (window as typeof window & { __ytResume: () => void }).__ytResume());
  await expect(page.getByRole("button", { name: "RESUME" })).toBeVisible();
  await page.getByRole("button", { name: "RESUME" }).click();
  await expect(page.getByRole("heading", { name: "GAME PAUSED" })).toHaveCount(0);
});

test("manual pause opens settings and Main Menu preserves the exact run", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "PLAY NOW" }).click();
  await page.getByRole("button", { name: "Add Cone" }).click();
  const before = await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.snapshot() as { run: { customers: Array<{ remainingMs: number }> } });

  await page.getByRole("button", { name: "Pause game" }).click();
  await page.waitForTimeout(250);
  const paused = await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.snapshot() as { run: { customers: Array<{ remainingMs: number }> } });
  expect(Math.abs(paused.run.customers[0]!.remainingMs - before.run.customers[0]!.remainingMs)).toBeLessThan(100);

  await page.getByRole("button", { name: "SETTINGS" }).click();
  await expect(page.getByRole("heading", { name: "SETTINGS" })).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByRole("heading", { name: "GAME PAUSED" })).toBeVisible();
  await page.getByRole("button", { name: "MAIN MENU" }).click();
  await expect(page.getByRole("button", { name: "CONTINUE RUN" })).toBeVisible();

  const saved = await page.evaluate(() => JSON.parse((window as typeof window & { __ytSaved: string }).__ytSaved));
  expect(saved.version).toBe(2);
  expect(saved.activeRun.customers[0].build).toMatchObject({ type: "iceCream", base: "cone" });
  await page.getByRole("button", { name: "CONTINUE RUN" }).click();
  await expect(page.locator(".assembly-dropzone .dessert-base")).toHaveCount(1);
});

test("buys directly from independent product branches and equipment dock", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "PLAY NOW" }).click();
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.setStoreState(50_000));

  await page.getByRole("button", { name: "Unlock Paper Cups for 450 coins" }).click();
  await expect(page.getByText("Unlock Strawberry first")).toBeVisible();
  await page.getByRole("button", { name: "Unlock Strawberry for 120 coins" }).click();
  await expect(page.getByRole("button", { name: "Add Strawberry" })).toBeVisible();
  await page.waitForTimeout(320);
  await page.getByRole("button", { name: "Unlock Paper Cups for 450 coins" }).click();
  await expect(page.getByRole("button", { name: "Add Cup" })).toBeVisible();

  await page.waitForTimeout(320);
  await page.getByRole("button", { name: "Unlock Lemonade for 180 coins" }).click();
  await expect(page.getByRole("button", { name: "Add Lemonade" })).toBeVisible();
  await page.waitForTimeout(320);
  await page.getByRole("button", { name: "Unlock Berry Soda for 900 coins" }).click();
  await expect(page.getByRole("button", { name: "Add Berry Soda" })).toBeVisible();
  await page.waitForTimeout(320);
  await page.getByRole("button", { name: "Unlock Bubble Tea for 6500 coins" }).click();
  await expect(page.getByRole("button", { name: "Add Tea Cup" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Tapioca Pearls" })).toBeVisible();

  await page.waitForTimeout(320);
  await page.getByRole("button", { name: "Unlock Better Freezer for 650 coins" }).click();
  await expect(page.getByRole("button", { name: "Better Freezer owned" })).toBeVisible();
  await page.waitForTimeout(320);
  await page.getByRole("button", { name: "Unlock Counter I for 2800 coins" }).click();
  await expect(page.getByRole("button", { name: "Counter I owned" })).toBeVisible();
});

test("builds a three-item ticket, then pays only correct positions on a mixed ticket", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "PLAY NOW" }).click();
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.setDemoTicket());

  const addIceCream = async () => {
    await page.getByRole("button", { name: "Add Cone" }).click();
    await page.getByRole("button", { name: "Add Vanilla" }).click();
    await page.getByRole("button", { name: "ADD TO TRAY" }).click();
  };
  const addBubbleTea = async () => {
    await page.getByRole("button", { name: "Add Tea Cup" }).click();
    await page.getByRole("button", { name: "Add Milk Tea" }).click();
    await page.getByRole("button", { name: "Add Tapioca Pearls" }).click();
    await page.getByRole("button", { name: "ADD TO TRAY" }).click();
  };

  await addIceCream();
  await page.getByRole("button", { name: "Add Lemonade" }).click();
  await page.getByRole("button", { name: "ADD TO TRAY" }).click();
  await addBubbleTea();
  await page.getByRole("button", { name: "SERVE ORDER" }).click();
  await expect(page.getByText(/FAST!.*coins/)).toBeVisible();

  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.setDemoTicket());
  const before = await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.snapshot() as { save: { coins: number }, run: { lives: number } });
  await addIceCream();
  await page.getByRole("button", { name: "Add Berry Soda" }).click();
  await page.getByRole("button", { name: "ADD TO TRAY" }).click();
  await addBubbleTea();
  await page.getByRole("button", { name: "SERVE ORDER" }).click();
  await expect(page.getByText("Customer left angry · partial payment +33")).toBeVisible();
  const after = await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.snapshot() as { save: { coins: number }, run: { lives: number } });
  expect(after.save.coins - before.save.coins).toBe(33);
  expect(after.run.lives).toBe(before.run.lives);
});

test("switches customer mood at 60, 30, and 15 percent", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "PLAY NOW" }).click();
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.setDemoTicket());
  const card = page.locator(".customer-card").first();
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.setPatience(0.6));
  await expect(card).toHaveClass(/is-worried/);
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.setPatience(0.3));
  await expect(card).toHaveClass(/is-angry/);
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.setPatience(0.15));
  await expect(card).toHaveClass(/is-urgent/);
});

test("shows three customers and all products without viewport overflow", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "PLAY NOW" }).click();
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.unlockAll());
  await expect(page.locator(".customer-card")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Add Waffle bowl" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Chocolate drizzle" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Berry Soda" })).toBeVisible();
  for (const viewport of [
    { width: 270, height: 378 },
    { width: 360, height: 800 },
    { width: 393, height: 852 },
    { width: 768, height: 1024 },
    { width: 768, height: 768 },
    { width: 1024, height: 768 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1080 },
    { width: 3440, height: 1440 },
  ]) {
    await page.setViewportSize(viewport);
    const overflow = await page.evaluate(() => ({
      horizontal: document.documentElement.scrollWidth - window.innerWidth,
      vertical: document.documentElement.scrollHeight - window.innerHeight,
    }));
    expect(overflow.horizontal).toBeLessThanOrEqual(1);
    expect(overflow.vertical).toBeLessThanOrEqual(1);
  }
});

test("runs rewarded revive and interstitial retry only at the result boundary", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "PLAY NOW" }).click();
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.forceGameOver(100_000));
  await expect(page.getByText("THE RUSH IS OVER")).toBeVisible();
  await page.getByRole("button", { name: /CONTINUE WITH 1 HEART/ }).click();
  await expect(page.getByText("GET READY")).toBeVisible();
  let calls = await page.evaluate(() => (window as typeof window & { __ytCalls: string[] }).__ytCalls);
  expect(calls).toContain("rewarded:ice-cream-rush-revive-v1");

  await page.reload();
  await page.getByRole("button", { name: /PLAY NOW|CONTINUE RUN/ }).click();
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.forceGameOver(100_000));
  await page.getByRole("button", { name: /PLAY AGAIN/ }).click();
  calls = await page.evaluate(() => (window as typeof window & { __ytCalls: string[] }).__ytCalls);
  expect(calls).toContain("interstitial");
});
