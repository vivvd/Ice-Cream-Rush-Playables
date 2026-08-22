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

async function startFirstLevel(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "CHOOSE DAY" }).click();
  await page.getByRole("button", { name: /Start Day 1,/ }).click();
}

test.beforeEach(async ({ page }) => {
  await installSdkMock(page);
});

test("boots with the required SDK lifecycle order", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "CHOOSE DAY" })).toBeVisible();
  await expect(page.getByRole("button", { name: "DAY 1 REQUIRED" })).toBeDisabled();
  await expect(page.locator(".hero-order")).toHaveCount(0);
  await expect(page.locator(".hero-dessert")).toHaveCount(1);
  const heroMetrics = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>(".menu-card-modes");
    const counter = document.querySelector<HTMLElement>(".hero-counter");
    const customer = document.querySelector<HTMLElement>(".hero-customer");
    const dessert = document.querySelector<HTMLElement>(".hero-dessert");
    if (!card || !counter || !customer || !dessert) return null;
    const cardRect = card.getBoundingClientRect();
    const counterRect = counter.getBoundingClientRect();
    const customerRect = customer.getBoundingClientRect();
    const dessertRect = dessert.getBoundingClientRect();
    const counterAfter = getComputedStyle(counter, "::after");
    const counterStyle = getComputedStyle(counter);
    const artMidpoint = (
      customerRect.left + customerRect.width / 2
      + dessertRect.left + dessertRect.width / 2
    ) / 2;
    return {
      counterContained: counterRect.left >= cardRect.left && counterRect.right <= cardRect.right,
      barLeft: Number.parseFloat(counterAfter.left),
      barRight: Number.parseFloat(counterAfter.right),
      brownStripWidth: Number.parseFloat(counterStyle.borderBottomWidth),
      artCenterDelta: Math.abs(artMidpoint - (counterRect.left + counterRect.width / 2)),
    };
  });
  expect(heroMetrics).not.toBeNull();
  expect(heroMetrics!.counterContained).toBe(true);
  expect(heroMetrics!.barLeft).toBe(0);
  expect(heroMetrics!.barRight).toBe(0);
  expect(heroMetrics!.brownStripWidth).toBe(0);
  expect(heroMetrics!.artCenterDelta).toBeLessThan(18);
  const calls = await page.evaluate(() => (window as typeof window & { __ytCalls: string[] }).__ytCalls);
  expect(calls.slice(0, 3)).toEqual(["firstFrameReady", "loadData", "gameReady"]);
});

test("teaches per-item serving and auto-completes the first ticket", async ({ page }) => {
  await startFirstLevel(page);
  await expect(page.getByText("Tap or drag the glowing cone")).toBeVisible();
  await page.getByRole("button", { name: "Add Cone" }).click();
  await expect(page.getByText("Great! Add the vanilla scoop")).toBeVisible();
  await page.getByRole("button", { name: "Add Vanilla" }).click();
  await expect(page.getByText("Perfect — serve this item")).toBeVisible();
  await expect(page.getByRole("button", { name: "ADD TO TRAY" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "SERVE ORDER" })).toHaveCount(0);
  await page.getByRole("button", { name: "SERVE" }).click();
  await expect(page.getByText("FIRST ORDER")).toHaveCount(0);
  await expect(page.locator(".coins-pill strong")).not.toHaveText("0");
});

test("supports drag cancellation, drag-and-drop, and nested SDK pause", async ({ page }) => {
  await startFirstLevel(page);
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
  await expect.poll(async () => Number.parseFloat(await page.locator(".pause-backdrop").evaluate((node) => getComputedStyle(node).opacity))).toBeGreaterThan(0.95);
  await page.evaluate(() => (window as typeof window & { __ytPause: () => void }).__ytPause());
  await expect(page.getByText("YOUTUBE PAUSE")).toBeVisible();
  await page.evaluate(() => (window as typeof window & { __ytResume: () => void }).__ytResume());
  await expect(page.getByRole("button", { name: "RESUME" })).toBeVisible();
  await page.getByRole("button", { name: "RESUME" }).click();
  await expect(page.getByRole("heading", { name: "GAME PAUSED" })).toHaveCount(0);
  await page.getByRole("button", { name: "Pause game" }).click();
  await expect(page.getByRole("button", { name: "RESUME" })).toBeVisible();
  await page.getByRole("button", { name: "RESUME" }).click();
  await expect(page.getByRole("heading", { name: "GAME PAUSED" })).toHaveCount(0);
});

test("manual pause opens settings and Main Menu preserves the exact run", async ({ page }) => {
  await startFirstLevel(page);
  await page.getByRole("button", { name: "Add Cone" }).click();
  const before = await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.snapshot() as { run: { elapsedMs: number; customers: Array<{ remainingMs: number }> } });

  await page.getByRole("button", { name: "Pause game" }).click();
  await page.waitForTimeout(250);
  const paused = await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.snapshot() as { run: { elapsedMs: number; customers: Array<{ remainingMs: number }> } });
  expect(Math.abs(paused.run.customers[0]!.remainingMs - before.run.customers[0]!.remainingMs)).toBeLessThan(100);
  expect(Math.abs(paused.run.elapsedMs - before.run.elapsedMs)).toBeLessThan(100);

  await page.getByRole("button", { name: "SETTINGS" }).click();
  await expect(page.getByRole("heading", { name: "SETTINGS" })).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByRole("heading", { name: "GAME PAUSED" })).toBeVisible();
  await page.getByRole("button", { name: "MAIN MENU" }).click();
  await expect(page.getByRole("button", { name: "CONTINUE DAY 1" })).toBeVisible();

  const saved = await page.evaluate(() => JSON.parse((window as typeof window & { __ytSaved: string }).__ytSaved));
  expect(saved.version).toBe(5);
  expect(saved.activeRun).toMatchObject({ mode: "level", levelNumber: 1 });
  expect(saved.activeRun.customers[0].build).toMatchObject({ type: "iceCream", base: "cone" });
  expect(saved.activeRun.customers[0]).toMatchObject({ servedItems: [] });
  await page.getByRole("button", { name: "CONTINUE DAY 1" }).click();
  await expect(page.locator(".assembly-dropzone .dessert-base")).toHaveCount(1);
});

test("music and sound state follows manual pause and YouTube mute", async ({ page }) => {
  await startFirstLevel(page);
  await expect.poll(async () => page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.snapshot().audio.musicLoop)).toBe(true);

  await page.getByRole("button", { name: "Pause game" }).click();
  await expect.poll(async () => page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.snapshot().audio)).toMatchObject({
    unlocked: true,
    musicLoop: false,
    paused: true,
    platformEnabled: true,
    music: true,
    sfx: true,
  });

  await page.getByRole("button", { name: "RESUME" }).click();
  await expect.poll(async () => page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.snapshot().audio.musicLoop)).toBe(true);

  await page.evaluate(() => (window as typeof window & { __ytAudio: (enabled: boolean) => void }).__ytAudio(false));
  await expect.poll(async () => page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.snapshot().audio)).toMatchObject({
    musicLoop: false,
    platformEnabled: false,
  });

  await page.evaluate(() => (window as typeof window & { __ytAudio: (enabled: boolean) => void }).__ytAudio(true));
  await expect.poll(async () => page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.snapshot().audio)).toMatchObject({
    musicLoop: true,
    platformEnabled: true,
  });
});

test("buys directly from independent product branches and equipment dock", async ({ page }) => {
  await startFirstLevel(page);
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.setStoreState(200_000));

  await page.getByRole("button", { name: "Unlock Paper Cups for 450 cash" }).click();
  await expect(page.getByText("Unlock Strawberry first")).toBeVisible();
  await page.getByRole("button", { name: "Unlock Strawberry for 120 cash" }).click();
  await expect(page.getByRole("button", { name: "Add Strawberry" })).toBeVisible();
  await page.waitForTimeout(320);
  await page.getByRole("button", { name: "Unlock Paper Cups for 450 cash" }).click();
  await expect(page.getByRole("button", { name: "Add Cup" })).toBeVisible();

  await page.waitForTimeout(320);
  await page.getByRole("button", { name: "Unlock Lemonade for 180 cash" }).click();
  await expect(page.getByRole("button", { name: "Add Lemonade" })).toBeVisible();
  await page.waitForTimeout(320);
  await page.getByRole("button", { name: "Unlock Berry Soda for 900 cash" }).click();
  await expect(page.getByRole("button", { name: "Add Berry Soda" })).toBeVisible();
  await page.waitForTimeout(320);
  await page.getByRole("button", { name: "Unlock Bubble Tea for 6500 cash" }).click();
  await expect(page.getByRole("button", { name: "Add Tea Cup" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Tapioca Pearls" })).toBeVisible();

  await page.waitForTimeout(320);
  await page.getByRole("button", { name: "Unlock Roll Oven for 12000 cash" }).click();
  await expect(page.getByRole("button", { name: "Add Cinnamon Roll" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Vanilla Icing" })).toBeVisible();
  await page.waitForTimeout(320);
  await page.getByRole("button", { name: "Unlock Chocolate Icing for 28000 cash" }).click();
  await expect(page.getByRole("button", { name: "Add Chocolate Icing" })).toBeVisible();
  await page.waitForTimeout(320);
  await page.getByRole("button", { name: "Unlock Berry Icing for 55000 cash" }).click();
  await expect(page.getByRole("button", { name: "Add Berry Icing" })).toBeVisible();

  await page.waitForTimeout(320);
  await page.getByRole("button", { name: "Unlock Better Freezer for 650 cash" }).click();
  await expect(page.getByRole("button", { name: "Better Freezer owned" })).toBeVisible();
  await page.waitForTimeout(320);
  await page.getByRole("button", { name: "Unlock Counter I for 2800 cash" }).click();
  await expect(page.getByRole("button", { name: "Counter I owned" })).toBeVisible();
  await expect(page.locator(".counter-upgrade-dock").getByRole("button", { name: "Counter I owned" })).toBeVisible();
  await expect(page.locator(".equipment-dock").getByRole("button", { name: /Counter/ })).toHaveCount(0);
});

test("builds and serves all Cinnamon Roll flavors in two steps", async ({ page }) => {
  await startFirstLevel(page);
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.setCinnamonTicket());
  await expect(page.getByText("ROLL FIRST · ADD ICING · SERVE")).toBeVisible();

  for (const viewport of [{ width: 656, height: 724 }, { width: 393, height: 852 }]) {
    await page.setViewportSize(viewport);
    const miniCenters = await page.locator(".ticket-mini-item").evaluateAll((items) => items.map((item) => {
      const frame = item.getBoundingClientRect();
      const preview = item.querySelector<HTMLElement>(".order-product-preview")?.getBoundingClientRect();
      if (!preview) return { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY };
      return {
        x: Math.abs((preview.left + preview.width / 2) - (frame.left + frame.width / 2)),
        y: Math.abs((preview.top + preview.height / 2) - (frame.top + frame.height / 2)),
      };
    }));
    expect(miniCenters).toHaveLength(3);
    miniCenters.forEach((delta) => {
      expect(delta.x).toBeLessThanOrEqual(0.5);
      expect(delta.y).toBeLessThanOrEqual(0.5);
    });
  }

  await page.getByRole("button", { name: "Add Vanilla Icing" }).click();
  await expect(page.getByText("Add the Cinnamon Roll first")).toBeVisible();

  await page.getByRole("button", { name: "Add Cinnamon Roll" }).click();
  await page.getByRole("button", { name: "Pause game" }).click();
  await page.getByRole("button", { name: "MAIN MENU" }).click();
  const saved = await page.evaluate(() => JSON.parse((window as typeof window & { __ytSaved: string }).__ytSaved));
  expect(saved.activeRun.customers[0].build).toMatchObject({ type: "cinnamonRoll", cinnamonRoll: true });
  await page.getByRole("button", { name: "CONTINUE DAY 1" }).click();
  await expect(page.locator(".assembly-dropzone .cinnamon-roll-product img")).toBeVisible();
  await page.getByRole("button", { name: "Add Vanilla Icing" }).click();
  await page.getByRole("button", { name: "SERVE" }).click();
  await page.waitForTimeout(220);

  for (const icing of ["Chocolate Icing", "Berry Icing"]) {
    await page.getByRole("button", { name: "Add Cinnamon Roll" }).click();
    await page.getByRole("button", { name: `Add ${icing}` }).click();
    await expect(page.locator(".assembly-dropzone .cinnamon-roll-product img")).toBeVisible();
    await page.getByRole("button", { name: "SERVE" }).click();
    await page.waitForTimeout(220);
  }

  await expect(page.getByText("ROLL FIRST · ADD ICING · SERVE")).toHaveCount(0);
  const snapshot = await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.snapshot() as {
    save: { bakeryTutorialComplete: boolean };
    run: { customers: unknown[] };
  });
  expect(snapshot.save.bakeryTutorialComplete).toBe(true);
  expect(snapshot.run.customers).toHaveLength(0);
});

test("keeps a three-scoop topped ice cream fully inside the overhead order card", async ({ page }) => {
  await startFirstLevel(page);
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.setTallIceTicket());

  for (const viewport of [
    { width: 393, height: 852 },
    { width: 650, height: 724 },
    { width: 1366, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    const bounds = await page.locator(".ticket-mini-item").first().evaluate((slot) => {
      const art = [...slot.querySelectorAll<HTMLElement>(".dessert-base, .dessert-scoop > img")];
      if (!art.length) return null;
      const frame = slot.getBoundingClientRect();
      return {
        frame: { top: frame.top, right: frame.right, bottom: frame.bottom, left: frame.left },
        art: art.map((node) => {
          const rect = node.getBoundingClientRect();
          return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
        }),
      };
    });
    expect(bounds).not.toBeNull();
    bounds!.art.forEach((rect) => {
      expect(rect.top).toBeGreaterThanOrEqual(bounds!.frame.top - 0.5);
      expect(rect.right).toBeLessThanOrEqual(bounds!.frame.right + 0.5);
      expect(rect.bottom).toBeLessThanOrEqual(bounds!.frame.bottom + 0.5);
      expect(rect.left).toBeGreaterThanOrEqual(bounds!.frame.left - 0.5);
    });
  }
});

test("serves a three-item ticket in any order and preserves progress after a wrong item", async ({ page }) => {
  await startFirstLevel(page);
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.setDemoTicket());
  await page.locator(".ticket-mini-item").nth(2).click();
  await expect(page.locator(".ticket-mini-item").nth(2)).toHaveClass(/is-active/);
  await expect.poll(async () => page.evaluate(() => {
    const snapshot = window.__ICE_CREAM_RUSH_DEBUG__?.snapshot() as { run?: { customers?: Array<{ activeItemIndex: number }> } } | undefined;
    return snapshot?.run?.customers?.[0]?.activeItemIndex;
  })).toBe(2);

  const serveIceCream = async () => {
    await page.getByRole("button", { name: "Add Cone" }).click();
    await page.getByRole("button", { name: "Add Vanilla", exact: true }).click();
    await page.getByRole("button", { name: "SERVE" }).click();
    await page.waitForTimeout(220);
  };
  const serveBubbleTea = async () => {
    await page.getByRole("button", { name: "Add Tea Cup" }).click();
    await page.getByRole("button", { name: "Add Milk Tea" }).click();
    await page.getByRole("button", { name: "Add Tapioca Pearls" }).click();
    await page.getByRole("button", { name: "SERVE" }).click();
    await page.waitForTimeout(220);
  };

  await serveBubbleTea();
  await expect(page.locator(".customer-number")).toHaveText(/2 LEFT/);
  await page.getByRole("button", { name: "Add Lemonade" }).click();
  await page.getByRole("button", { name: "SERVE" }).click();
  await page.waitForTimeout(220);
  await expect(page.locator(".customer-number")).toHaveText(/1 LEFT/);
  await serveIceCream();
  await expect(page.getByText(/FAST!.*cash/)).toBeVisible();

  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.setDemoTicket());
  const before = await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.snapshot() as { save: { coins: number }, run: { lives: number } });
  await serveIceCream();
  await page.getByRole("button", { name: "Add Berry Soda" }).click();
  await page.getByRole("button", { name: "SERVE" }).click();
  await expect(page.getByText("Wrong item · −35% patience")).toBeVisible();
  const after = await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.snapshot() as {
    save: { coins: number };
    run: { lives: number; customers: Array<{ remainingTicket: unknown[]; servedItems: unknown[] }> };
  });
  expect(after.save.coins - before.save.coins).toBe(0);
  expect(after.run.lives).toBe(before.run.lives);
  expect(after.run.customers[0]?.remainingTicket).toHaveLength(2);
  expect(after.run.customers[0]?.servedItems).toHaveLength(1);
});

test("switches customer mood at 60, 30, and 15 percent", async ({ page }) => {
  await startFirstLevel(page);
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
  await startFirstLevel(page);
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.unlockAll());
  await expect(page.locator(".customer-card")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Add Waffle bowl" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Chocolate drizzle" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Berry Soda" })).toBeVisible();
  const stageBox = await page.locator(".rush-stage").boundingBox();
  const trayBox = await page.locator(".ingredient-tray").boundingBox();
  expect(stageBox && trayBox && trayBox.y >= stageBox.y + stageBox.height - 1).toBeTruthy();
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
    if (viewport.width <= 620 && viewport.height > 450) {
      const bubblesContained = await page.evaluate(() => {
        const lane = document.querySelector<HTMLElement>(".customer-lane");
        if (!lane) return false;
        const laneRect = lane.getBoundingClientRect();
        return [...document.querySelectorAll<HTMLElement>(".customer-card .order-bubble")].every((bubble) => {
          const rect = bubble.getBoundingClientRect();
          return rect.left >= laneRect.left - 1 && rect.right <= laneRect.right + 1;
        });
      });
      expect(bubblesContained).toBe(true);
    }
  }
});

test("keeps overhead order, Counter, station, and compact actions separated on small screens", async ({ page }) => {
  await startFirstLevel(page);
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.setDemoTicket());

  for (const viewport of [
    { width: 270, height: 378 },
    { width: 360, height: 800 },
    { width: 393, height: 852 },
    { width: 768, height: 1024 },
    { width: 768, height: 768 },
    { width: 820, height: 1180 },
    { width: 982, height: 854 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    const boxes = await page.evaluate(() => {
      const box = (selector: string) => {
        const node = document.querySelector(selector);
        return node && node.getClientRects().length > 0 ? node.getBoundingClientRect().toJSON() : undefined;
      };
      const equipment = document.querySelector<HTMLElement>(".equipment-dock");
      return {
        hud: box(".game-hud"),
        stage: box(".rush-stage"),
        customers: box(".customer-lane"),
        assembly: box(".assembly-panel"),
        orderBubble: box(".order-bubble"),
        portrait: box(".customer-card.is-selected .customer-portrait"),
        ordersContained: [...document.querySelectorAll<HTMLElement>(".order-bubble")].every((bubble) => {
          const frame = bubble.getBoundingClientRect();
          return [...bubble.querySelectorAll<HTMLElement>(".ticket-mini-item")].every((item) => {
            const rect = item.getBoundingClientRect();
            return rect.top >= frame.top - 1 && rect.right <= frame.right + 1
              && rect.bottom <= frame.bottom + 1 && rect.left >= frame.left - 1;
          });
        }),
        tutorial: box(".assembly-left-rail > .tutorial-coach"),
        counter: box(".counter-upgrade-dock"),
        station: box(".assembly-dropzone"),
        actions: box(".assembly-actions"),
        serve: box(".serve-button"),
        equipment: equipment?.getBoundingClientRect().toJSON(),
        equipmentScroll: equipment ? {
          clientHeight: equipment.clientHeight,
          scrollHeight: equipment.scrollHeight,
          overflowY: getComputedStyle(equipment).overflowY,
        } : undefined,
        tray: box(".ingredient-tray"),
      };
    });
    expect(boxes.hud && boxes.stage && boxes.customers && boxes.assembly && boxes.orderBubble && boxes.portrait && boxes.counter && boxes.station && boxes.actions && boxes.serve && boxes.equipment && boxes.tray).toBeTruthy();
    expect(boxes.hud!.bottom).toBeLessThanOrEqual(boxes.stage!.top + 1);
    expect(boxes.customers!.bottom).toBeLessThanOrEqual(boxes.assembly!.top + 1);
    expect(boxes.orderBubble!.top).toBeGreaterThanOrEqual(boxes.customers!.top - 10);
    expect(boxes.orderBubble!.bottom).toBeLessThanOrEqual(boxes.customers!.bottom + 1);
    expect(boxes.orderBubble!.bottom).toBeLessThanOrEqual(boxes.portrait!.top - 1);
    expect(Math.abs((boxes.station!.left + boxes.station!.right) / 2 - (boxes.assembly!.left + boxes.assembly!.right) / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(boxes.station!.width - boxes.station!.height)).toBeLessThanOrEqual(1);
    expect(boxes.serve!.height).toBeLessThanOrEqual(60);
    expect(boxes.equipment!.height).toBeLessThanOrEqual(240);
    expect(boxes.counter!.right).toBeLessThanOrEqual(boxes.station!.left + 1);
    expect(boxes.counter!.top).toBeGreaterThanOrEqual(boxes.assembly!.top - 1);
    expect(boxes.station!.right).toBeLessThanOrEqual(boxes.actions!.left + 1);
    expect(boxes.counter!.bottom).toBeLessThanOrEqual(boxes.assembly!.bottom + 1);
    expect(boxes.station!.bottom).toBeLessThanOrEqual(boxes.assembly!.bottom + 1);
    expect(boxes.actions!.bottom).toBeLessThanOrEqual(boxes.assembly!.bottom + 1);
    const equipmentAssemblyOverlap = Math.min(boxes.assembly!.right, boxes.equipment!.right) - Math.max(boxes.assembly!.left, boxes.equipment!.left) > 1
      && Math.min(boxes.assembly!.bottom, boxes.equipment!.bottom) - Math.max(boxes.assembly!.top, boxes.equipment!.top) > 1;
    expect(equipmentAssemblyOverlap).toBe(false);
    expect(boxes.equipment!.top).toBeGreaterThanOrEqual(boxes.hud!.bottom - 1);
    expect(boxes.equipment!.bottom).toBeLessThanOrEqual(boxes.tray!.top + 1);
    expect(boxes.equipmentScroll?.overflowY).toBe("auto");
    if (viewport.height <= 450) {
      expect(boxes.equipmentScroll!.scrollHeight).toBeGreaterThan(boxes.equipmentScroll!.clientHeight);
      const scrollTop = await page.locator(".equipment-dock").evaluate((node) => {
        node.scrollTop = node.scrollHeight;
        return node.scrollTop;
      });
      expect(scrollTop).toBeGreaterThan(0);
    }
    expect(boxes.ordersContained).toBe(true);
  }
});

test("scales desktop orders and keeps the mobile order and Counter compact", async ({ page }) => {
  await startFirstLevel(page);
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.unlockAll());

  await page.setViewportSize({ width: 1366, height: 768 });
  const desktop = await page.evaluate(() => {
    const bubble = document.querySelector<HTMLElement>(".order-bubble");
    const item = document.querySelector<HTMLElement>(".ticket-mini-item");
    const counter = document.querySelector<HTMLElement>(".counter-upgrade-dock");
    const counterButton = document.querySelector<HTMLElement>(".counter-upgrade-button");
    if (!bubble || !item || !counter || !counterButton) return null;
    return {
      bubbleWidth: bubble.getBoundingClientRect().width,
      itemHeight: item.getBoundingClientRect().height,
      counterWidth: counter.getBoundingClientRect().width,
      counterButtonHeight: counterButton.getBoundingClientRect().height,
    };
  });
  expect(desktop).not.toBeNull();
  expect(desktop!.bubbleWidth).toBeGreaterThanOrEqual(108);
  expect(desktop!.itemHeight).toBeGreaterThanOrEqual(68);
  expect(desktop!.counterWidth).toBeGreaterThanOrEqual(275);
  expect(desktop!.counterButtonHeight).toBeGreaterThanOrEqual(78);

  await page.setViewportSize({ width: 393, height: 852 });
  const mobile = await page.evaluate(() => {
    const assembly = document.querySelector<HTMLElement>(".assembly-panel");
    const card = document.querySelector<HTMLElement>(".customer-card");
    const bubble = card?.querySelector<HTMLElement>(".order-bubble");
    const counter = document.querySelector<HTMLElement>(".counter-upgrade-dock");
    const counterTitle = counter?.querySelector<HTMLElement>(":scope > p");
    const counterButtons = counter?.querySelectorAll<HTMLElement>(".counter-upgrade-button");
    const lastCounterButton = counterButtons?.[counterButtons.length - 1];
    if (!assembly || !card || !bubble || !counter || !counterTitle || !lastCounterButton) return null;
    const assemblyRect = assembly.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const bubbleRect = bubble.getBoundingClientRect();
    const counterRect = counter.getBoundingClientRect();
    const titleRect = counterTitle.getBoundingClientRect();
    const lastButtonRect = lastCounterButton.getBoundingClientRect();
    return {
      bubbleCenterDelta: Math.abs((bubbleRect.left + bubbleRect.width / 2) - (cardRect.left + cardRect.width / 2)),
      bubbleContained: bubbleRect.left >= cardRect.left - 1 && bubbleRect.right <= cardRect.right + 1,
      counterWidth: counterRect.width,
      counterLeftInset: counterRect.left - assemblyRect.left,
      counterTopGap: titleRect.top - counterRect.top,
      counterBottomGap: counterRect.bottom - lastButtonRect.bottom,
    };
  });
  expect(mobile).not.toBeNull();
  expect(mobile!.bubbleCenterDelta).toBeLessThanOrEqual(1);
  expect(mobile!.bubbleContained).toBe(true);
  expect(mobile!.counterWidth).toBeGreaterThanOrEqual(78);
  expect(mobile!.counterLeftInset).toBeLessThanOrEqual(6);
  expect(mobile!.counterTopGap).toBeLessThanOrEqual(8);
  expect(mobile!.counterBottomGap).toBeLessThanOrEqual(8);
});

test("keeps CASH, the day goal, and every heart separated across HUD breakpoints", async ({ page }) => {
  await startFirstLevel(page);
  await expect(page.locator(".coins-pill small")).toHaveText("CASH");

  for (const width of [650, 635, 621, 620, 393, 360, 340, 270]) {
    await page.setViewportSize({ width, height: 800 });
    const metrics = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
      const cash = box(".coins-pill");
      const campaign = box(".campaign-pill");
      const goal = box(".campaign-goal");
      const lives = box(".lives");
      const pause = box(".pause-button");
      const hearts = [...document.querySelectorAll<SVGElement>(".lives .heart-icon")].map((heart) => heart.getBoundingClientRect());
      if (!cash || !campaign || !goal || !lives || !pause || hearts.length !== 3) return null;
      return {
        cashCampaignGap: campaign.left - cash.right,
        campaignGoalContained: goal.left >= campaign.left - 1 && goal.right <= campaign.right + 1,
        heartsContained: hearts.every((heart) => heart.left >= lives.left - 1 && heart.right <= lives.right + 1),
        lastHeartRight: hearts.at(-1)!.right,
        livesRight: lives.right,
        livesPauseGap: pause.left - lives.right,
        horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    expect(metrics).not.toBeNull();
    expect(metrics!.cashCampaignGap).toBeGreaterThanOrEqual(width <= 620 ? 3 : 5);
    expect(metrics!.campaignGoalContained).toBe(true);
    expect(metrics!.heartsContained).toBe(true);
    expect(metrics!.lastHeartRight).toBeLessThanOrEqual(metrics!.livesRight + 1);
    expect(metrics!.livesPauseGap).toBeGreaterThanOrEqual(0);
    expect(metrics!.horizontalOverflow).toBeLessThanOrEqual(1);
  }
});

test("runs rewarded revive and interstitial retry only at the result boundary", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.unlockCampaign());
  await page.getByRole("button", { name: "START ENDLESS" }).click();
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.forceGameOver(100_000));
  await expect(page.getByText("THE ENDLESS RUSH IS OVER")).toBeVisible();
  await page.getByRole("button", { name: /CONTINUE WITH 1 HEART/ }).click();
  await expect(page.getByText("GET READY")).toBeVisible();
  let calls = await page.evaluate(() => (window as typeof window & { __ytCalls: string[] }).__ytCalls);
  expect(calls).toContain("rewarded:ice-cream-rush-revive-v1");

  await page.reload();
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.unlockCampaign());
  await page.getByRole("button", { name: "START ENDLESS" }).click();
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.forceGameOver(100_000));
  await page.getByRole("button", { name: /PLAY AGAIN/ }).click();
  calls = await page.evaluate(() => (window as typeof window & { __ytCalls: string[] }).__ytCalls);
  expect(calls).toContain("interstitial");
});

test("wins a day at the exact goal, unlocks the next day, and persists campaign progress", async ({ page }) => {
  await startFirstLevel(page);
  await expect(page.getByText("DAY 1").first()).toBeVisible();
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.forceLevelWin());
  await expect(page.getByText("DAY 1 COMPLETE")).toBeVisible();
  await expect(page.getByText("GOAL REACHED!")).toBeVisible();
  const resultProgress = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>(".level-result-score");
    const bar = document.querySelector<HTMLElement>(".level-result-score > i");
    if (!card || !bar) return null;
    const outer = card.getBoundingClientRect();
    const inner = bar.getBoundingClientRect();
    return { outerLeft: outer.left, outerRight: outer.right, innerLeft: inner.left, innerRight: inner.right };
  });
  expect(resultProgress).not.toBeNull();
  expect(resultProgress!.innerLeft).toBeGreaterThanOrEqual(resultProgress!.outerLeft);
  expect(resultProgress!.innerRight).toBeLessThanOrEqual(resultProgress!.outerRight);
  await expect.poll(async () => page.evaluate(() => JSON.parse((window as typeof window & { __ytSaved: string }).__ytSaved || "{}").campaign?.completedThrough)).toBe(1);
  await page.getByRole("button", { name: /NEXT DAY/ }).click();
  await expect(page.getByText("DAY 2").first()).toBeVisible();
});

test("fails a timed-out day without offering a rewarded revive", async ({ page }) => {
  await startFirstLevel(page);
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.forceLevelTimeout());
  await expect(page.getByText("SHIFT MISSED")).toBeVisible();
  await expect(page.getByText("TIME'S UP")).toBeVisible();
  await expect(page.getByRole("button", { name: /CONTINUE WITH 1 HEART/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "RETRY DAY 1" })).toBeVisible();
});

test("grandfathers a SaveV3 profile into unlocked Endless", async ({ page }) => {
  await page.unroute("https://www.youtube.com/game_api/v1");
  await installSdkMock(page, JSON.stringify({ version: 3, coins: 420, bestScore: 777, tutorialComplete: true, upgrades: [] }));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "START ENDLESS" })).toBeVisible();
  await expect(page.getByText("BEST 777", { exact: true })).toBeVisible();
});

test("shows all 25 days and readable product and equipment prices", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "CHOOSE DAY" }).click();
  await expect(page.locator(".day-card")).toHaveCount(25);
  await expect(page.getByRole("button", { name: /Start Day 1,/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Start Day 2,/ })).toBeDisabled();
  await page.getByRole("button", { name: /Start Day 1,/ }).click();
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.setStoreState(99_999));
  await expect(page.locator(".cash-icon .cash-svg")).toHaveCount(1);
  await expect(page.locator(".reset-button .reset-svg")).toHaveCount(1);
  await expect(page.locator(".lives .heart-icon")).toHaveCount(3);
  const metrics = await page.evaluate(() => {
    const price = document.querySelector<HTMLElement>(".unlock-price");
    const priceButton = price?.closest<HTMLElement>(".ingredient-button");
    const productLock = document.querySelector<HTMLElement>(".locked-product .product-lock");
    const equipmentButton = document.querySelector<HTMLElement>(".equipment-button:not(.is-owned)");
    const equipmentArt = equipmentButton?.querySelector<HTMLElement>(".equipment-art");
    const equipment = document.querySelector<HTMLElement>(".equipment-button:not(.is-owned) > span");
    const equipmentName = document.querySelector<HTMLElement>(".equipment-button:not(.is-owned) > strong");
    const counter = document.querySelector<HTMLElement>(".counter-upgrade-button");
    const hud = document.querySelector<HTMLElement>(".game-hud");
    const campaignText = document.querySelector<HTMLElement>(".campaign-goal b");
    const stage = document.querySelector<HTMLElement>(".rush-stage");
    if (!price || !priceButton || !productLock || !equipmentButton || !equipmentArt
      || !equipment || !equipmentName || !counter || !hud || !campaignText || !stage) return null;
    const priceStyle = getComputedStyle(price);
    const equipmentStyle = getComputedStyle(equipment);
    const equipmentNameStyle = getComputedStyle(equipmentName);
    const priceRect = price.getBoundingClientRect();
    const priceButtonRect = priceButton.getBoundingClientRect();
    const equipmentButtonRect = equipmentButton.getBoundingClientRect();
    const equipmentArtRect = equipmentArt.getBoundingClientRect();
    const hudRect = hud.getBoundingClientRect();
    const hudFirstRect = hud.firstElementChild?.getBoundingClientRect();
    const hudLastRect = hud.lastElementChild?.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    return {
      productFont: Number.parseFloat(priceStyle.fontSize),
      productHeight: priceRect.height,
      productLockDisplay: getComputedStyle(productLock).display,
      priceContained: priceRect.left >= priceButtonRect.left && priceRect.right <= priceButtonRect.right,
      equipmentFont: Number.parseFloat(equipmentStyle.fontSize),
      equipmentNameFont: Number.parseFloat(equipmentNameStyle.fontSize),
      equipmentArtContained: equipmentArtRect.left >= equipmentButtonRect.left
        && equipmentArtRect.right <= equipmentButtonRect.right
        && equipmentArtRect.top >= equipmentButtonRect.top
        && equipmentArtRect.bottom <= equipmentButtonRect.bottom,
      counterWidth: counter.getBoundingClientRect().width,
      hudLeftInset: hudFirstRect ? hudFirstRect.left - hudRect.left : -1,
      hudRightInset: hudLastRect ? hudRect.right - hudLastRect.right : -1,
      campaignFont: Number.parseFloat(getComputedStyle(campaignText).fontSize),
      stageRightGap: Math.abs(window.innerWidth - stageRect.right),
    };
  });
  expect(metrics).not.toBeNull();
  expect(metrics!.productFont).toBeGreaterThanOrEqual(11);
  expect(metrics!.productHeight).toBeGreaterThanOrEqual(22);
  expect(metrics!.productLockDisplay).toBe("none");
  expect(metrics!.priceContained).toBe(true);
  expect(metrics!.equipmentFont).toBeGreaterThanOrEqual(8.5);
  expect(metrics!.equipmentNameFont).toBeGreaterThanOrEqual(9);
  expect(metrics!.equipmentArtContained).toBe(true);
  expect(metrics!.counterWidth).toBeGreaterThanOrEqual(48);
  expect(metrics!.hudLeftInset).toBeGreaterThanOrEqual(5);
  expect(metrics!.hudRightInset).toBeGreaterThanOrEqual(5);
  expect(metrics!.campaignFont).toBeGreaterThanOrEqual(9.5);
  expect(metrics!.stageRightGap).toBeLessThanOrEqual(1);
});

test("unlocks Endless after Day 25 and starts it without an interstitial", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.unlockCampaign(24));
  await page.getByRole("button", { name: "CHOOSE DAY" }).click();
  await page.getByRole("button", { name: /Start Day 25,/ }).click();
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.forceLevelWin());
  await expect(page.getByText("ENDLESS UNLOCKED")).toBeVisible();
  await page.getByRole("button", { name: "PLAY ENDLESS" }).click();
  const snapshot = await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.snapshot() as { run: { mode: string } });
  expect(snapshot.run.mode).toBe("endless");
  const calls = await page.evaluate(() => (window as typeof window & { __ytCalls: string[] }).__ytCalls);
  expect(calls).not.toContain("interstitial");
});

test("protects an active day with an abandon confirmation before changing modes", async ({ page }) => {
  await startFirstLevel(page);
  await page.getByRole("button", { name: "Pause game" }).click();
  await page.getByRole("button", { name: "MAIN MENU" }).click();
  await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.unlockCampaign());
  await page.getByRole("button", { name: "START ENDLESS" }).click();
  await expect(page.getByRole("heading", { name: "LEAVE DAY 1?" })).toBeVisible();
  await page.getByRole("button", { name: "KEEP CURRENT RUN" }).click();
  await expect(page.getByRole("button", { name: "CONTINUE DAY 1" })).toBeVisible();
  await page.getByRole("button", { name: "START ENDLESS" }).click();
  await page.getByRole("button", { name: "LEAVE & START" }).click();
  const snapshot = await page.evaluate(() => window.__ICE_CREAM_RUSH_DEBUG__?.snapshot() as { run: { mode: string } });
  expect(snapshot.run.mode).toBe("endless");
});
