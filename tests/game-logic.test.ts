import { describe, expect, it } from "vitest";
import {
  allUpgradesOwned,
  availableBases,
  availableCinnamonGlazes,
  availableFastDrinks,
  availableFlavors,
  availableToppings,
  buildToItem,
  calculateReward,
  createRun,
  customerPatienceMs,
  defaultSave,
  effectiveElapsedMs,
  findMatchingItemIndex,
  generateTicket,
  intensityLevel,
  isRecoveryWave,
  isLevelUnlocked,
  itemBaseValue,
  itemMatches,
  itemToBuild,
  maxCustomers,
  migrateSave,
  nextCombo,
  nextUpgradeInTrack,
  nextVipTarget,
  partialServedValue,
  requiredActions,
  recordLevelCompletion,
  levelConfig,
  levelRemainingMs,
  spawnIntervalMs,
  ticketItemCount,
  ticketPatienceMultiplier,
  timeoutLivesLost,
  upgradePrerequisite,
  wrongServeRemainingMs,
} from "../src/game-logic";
import { LEVELS, TOTAL_LEVELS, UPGRADES } from "../src/config";
import type { OrderItem, UpgradeId } from "../src/types";

const fixed = (...values: number[]) => {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
};

const vanillaCone: OrderItem = { type: "iceCream", base: "cone", scoops: ["vanilla"] };
const lemonade: OrderItem = { type: "fastDrink", drink: "lemonade" };
const berrySoda: OrderItem = { type: "fastDrink", drink: "berrySoda" };
const bubbleTea: OrderItem = { type: "bubbleTea" };
const vanillaRoll: OrderItem = { type: "cinnamonRoll", glaze: "vanillaGlaze" };
const chocolateRoll: OrderItem = { type: "cinnamonRoll", glaze: "chocolateGlaze" };
const berryRoll: OrderItem = { type: "cinnamonRoll", glaze: "berryGlaze" };

describe("SaveV5 migration", () => {
  it("returns safe locked V5 defaults for missing, corrupt, and unknown data", () => {
    expect(migrateSave("").version).toBe(5);
    expect(migrateSave("not json").coins).toBe(0);
    expect(migrateSave(JSON.stringify({ version: 99, coins: 999 })).coins).toBe(0);
    expect(defaultSave().campaign).toMatchObject({ completedThrough: 0, endlessUnlocked: false });
    expect(defaultSave().campaign.bestEarnings).toHaveLength(25);
  });

  it("sanitizes V4 campaign values and removes unknown or duplicate upgrades", () => {
    const save = migrateSave(JSON.stringify({
      version: 4,
      coins: -20,
      upgrades: ["strawberry", "unknown", "strawberry", "lemonade"],
      bestScore: 42.8,
      settings: { music: false },
      campaign: { completedThrough: 99, bestEarnings: [-5, 420], endlessUnlocked: false },
    }));
    expect(save.coins).toBe(0);
    expect(save.upgrades).toEqual(["strawberry", "lemonade"]);
    expect(save.bestScore).toBe(42);
    expect(save.settings).toEqual({ music: false, sfx: true, reducedMotion: false });
    expect(save.bakeryTutorialComplete).toBe(false);
    expect(save.campaign).toMatchObject({ completedThrough: 20, endlessUnlocked: true });
    expect(save.campaign.bestEarnings.slice(0, 3)).toEqual([0, 420, 0]);
    expect(save.activeRun).toBeNull();
  });

  it("keeps a current V5 Cinnamon Roll run and does not unlock Endless at Day 20", () => {
    const save = migrateSave(JSON.stringify({
      version: 5,
      coins: 12_345,
      upgrades: ["rollOven", "chocolateIcing"],
      bakeryTutorialComplete: true,
      campaign: { completedThrough: 20, bestEarnings: Array(25).fill(0), endlessUnlocked: false },
      activeRun: {
        active: true,
        mode: "level",
        levelNumber: 21,
        lives: 3,
        customers: [{
          id: 8,
          kind: "regular",
          remainingTicket: [chocolateRoll],
          servedItems: [],
          activeItemIndex: 0,
          build: { type: "cinnamonRoll", scoops: [], bubbleSteps: [], cinnamonRoll: true },
          maxPatienceMs: 30_000,
          remainingMs: 22_000,
          variant: 1,
        }],
      },
    }));
    expect(save).toMatchObject({ version: 5, coins: 12_345, bakeryTutorialComplete: true });
    expect(save.campaign).toMatchObject({ completedThrough: 20, endlessUnlocked: false });
    expect(save.activeRun?.customers[0]).toMatchObject({
      remainingTicket: [chocolateRoll],
      build: { type: "cinnamonRoll", cinnamonRoll: true },
    });
  });

  it("grandfathers a valid V3 profile into unlocked Endless and keeps its active run", () => {
    const save = migrateSave(JSON.stringify({
      version: 3,
      coins: 456,
      tutorialComplete: true,
      bestScore: 999,
      activeRun: { active: true, lives: 3, customers: [], elapsedMs: 500, runCoins: 25 },
    }));
    expect(save).toMatchObject({ version: 5, coins: 456, bestScore: 999 });
    expect(save.campaign).toMatchObject({ completedThrough: 0, endlessUnlocked: true });
    expect(save.activeRun).toMatchObject({ mode: "endless", levelNumber: undefined, runCoins: 25 });
  });

  it("migrates a V1 run into a one-item ticket and keeps the selected build", () => {
    const save = migrateSave(JSON.stringify({
      version: 1,
      coins: 777,
      upgrades: ["strawberry", "cup", "freezer"],
      tutorialComplete: true,
      bestScore: 1_234,
      settings: { music: false, sfx: true, reducedMotion: true },
      activeRun: {
        active: true,
        lives: 2,
        xp: 88,
        combo: 3,
        bestCombo: 4,
        elapsedMs: 12_000,
        runCoins: 70,
        selectedCustomerId: 4,
        spawnRemainingMs: 800,
        customersSinceVip: 2,
        nextVipAt: 6,
        nextCustomerId: 5,
        reviveUsed: false,
        tutorial: false,
        build: { base: "cup", scoops: ["strawberry"] },
        customers: [{
          id: 4,
          kind: "regular",
          order: { base: "cone", scoops: ["vanilla"] },
          maxPatienceMs: 20_000,
          remainingMs: 12_000,
          variant: 2,
        }],
      },
    }));
    expect(save).toMatchObject({ version: 5, coins: 777, bestScore: 1_234, tutorialComplete: true });
    expect(save.campaign.endlessUnlocked).toBe(true);
    expect(save.activeRun?.customers[0]?.remainingTicket).toEqual([vanillaCone]);
    expect(save.activeRun?.customers[0]?.servedItems).toEqual([]);
    expect(save.activeRun?.customers[0]?.build).toMatchObject({ type: "iceCream", base: "cup", scoops: ["strawberry"] });
  });

  it("migrates V2 prepared items without treating them as already served", () => {
    const save = migrateSave(JSON.stringify({
      version: 2,
      coins: 90,
      activeRun: {
        active: true,
        lives: 3,
        customers: [{
          id: 3,
          kind: "regular",
          ticket: [vanillaCone, lemonade],
          prepared: [vanillaCone, null],
          activeItemIndex: 1,
          build: { scoops: [], bubbleSteps: [] },
          maxPatienceMs: 30_000,
          remainingMs: 18_000,
          variant: 2,
        }],
      },
    }));
    expect(save.version).toBe(5);
    expect(save.activeRun?.customers[0]?.remainingTicket).toEqual([vanillaCone, lemonade]);
    expect(save.activeRun?.customers[0]?.servedItems).toEqual([]);
    expect(save.activeRun?.customers[0]?.build).toMatchObject({ type: "iceCream", base: "cone", scoops: ["vanilla"] });
  });
});

describe("independent progression tracks", () => {
  it("unlocks each branch sequentially without cross-branch prerequisites", () => {
    expect(nextUpgradeInTrack([], "iceCream")?.id).toBe("strawberry");
    expect(nextUpgradeInTrack([], "drinks")?.id).toBe("lemonade");
    expect(nextUpgradeInTrack([], "bakery")?.id).toBe("rollOven");
    expect(nextUpgradeInTrack([], "equipment")?.id).toBe("freezer");
    expect(upgradePrerequisite([], "cup")?.id).toBe("strawberry");
    expect(upgradePrerequisite(["lemonade"], "berrySoda")).toBeUndefined();
    expect(upgradePrerequisite(["strawberry"], "cup")).toBeUndefined();
    expect(upgradePrerequisite([], "chocolateIcing")?.id).toBe("rollOven");
    expect(upgradePrerequisite(["rollOven"], "chocolateIcing")).toBeUndefined();
  });

  it("uses the exact branch prices and completes after all 16 purchases", () => {
    expect(UPGRADES.map(({ id, price }) => [id, price])).toEqual([
      ["strawberry", 120], ["cup", 450], ["sprinkles", 1_200], ["mint", 3_500], ["waffle", 9_000], ["drizzle", 18_000],
      ["lemonade", 180], ["berrySoda", 900], ["bubbleTea", 6_500],
      ["rollOven", 12_000], ["chocolateIcing", 28_000], ["berryIcing", 55_000],
      ["freezer", 650], ["counter1", 2_800], ["autobase", 9_500], ["counter2", 23_000],
    ]);
    expect(allUpgradesOwned(UPGRADES.map((upgrade) => upgrade.id))).toBe(true);
    expect(UPGRADES.reduce((total, upgrade) => total + upgrade.price, 0)).toBe(170_800);
  });

  it("exposes only purchased products and expands the counter", () => {
    const upgrades: UpgradeId[] = ["strawberry", "cup", "sprinkles", "lemonade", "counter1"];
    expect(availableBases(upgrades)).toEqual(["cone", "cup"]);
    expect(availableFlavors(upgrades)).toEqual(["vanilla", "chocolate", "strawberry"]);
    expect(availableToppings(upgrades)).toEqual(["sprinkles"]);
    expect(availableFastDrinks(upgrades)).toEqual(["lemonade"]);
    expect(availableCinnamonGlazes(upgrades)).toEqual([]);
    expect(availableCinnamonGlazes(["rollOven", "chocolateIcing"])).toEqual(["vanillaGlaze", "chocolateGlaze"]);
    expect(maxCustomers(upgrades)).toBe(2);
    expect(maxCustomers([...upgrades, "counter2"])).toBe(3);
  });
});

describe("25-day campaign", () => {
  it("ships the exact goals, durations, and authored late-campaign pressure", () => {
    expect(TOTAL_LEVELS).toBe(25);
    expect(LEVELS.map((level) => level.goal)).toEqual([
      350, 500, 700, 900, 1_150, 1_450, 1_800, 2_200, 2_650, 3_150,
      3_700, 4_300, 4_950, 5_650, 6_400, 7_200, 8_050, 8_950, 9_900, 10_900,
      12_000, 13_300, 14_700, 16_200, 17_900,
    ]);
    expect(LEVELS.map((level) => level.durationMs)).toEqual([
      120_000, 130_000, 140_000, 150_000, 160_000, 170_000, 180_000, 190_000, 200_000, 210_000,
      220_000, 230_000, 240_000, 240_000, 240_000, 240_000, 240_000, 240_000, 240_000, 240_000,
      240_000, 240_000, 240_000, 240_000, 240_000,
    ]);
    expect(LEVELS.map((level) => level.pressureOffsetMs)).toEqual([
      0, 0, 0, 60_000, 60_000, 60_000, 120_000, 120_000, 120_000, 180_000,
      180_000, 180_000, 240_000, 240_000, 240_000, 300_000, 300_000, 300_000, 360_000, 360_000,
      360_000, 360_000, 420_000, 420_000, 420_000,
    ]);
    expect(LEVELS.reduce((total, level) => total + level.goal, 0)).toBe(158_950);
  });

  it("adds authored pressure to level time but not Endless time", () => {
    const levelRun = createRun("level", false, 10);
    levelRun.elapsedMs = 12_000;
    expect(effectiveElapsedMs(levelRun)).toBe(192_000);
    expect(levelRemainingMs(levelRun)).toBe(levelConfig(10).durationMs - 12_000);

    const endless = createRun("endless");
    endless.elapsedMs = 12_000;
    expect(effectiveElapsedMs(endless)).toBe(12_000);
    expect(levelRemainingMs(endless)).toBe(Number.POSITIVE_INFINITY);
  });

  it("unlocks sequentially, records replay bests, and opens Endless after Day 25", () => {
    let campaign = defaultSave().campaign;
    expect(isLevelUnlocked(campaign, 1)).toBe(true);
    expect(isLevelUnlocked(campaign, 2)).toBe(false);
    campaign = recordLevelCompletion(campaign, 1, 380);
    expect(campaign).toMatchObject({ completedThrough: 1, endlessUnlocked: false });
    expect(campaign.bestEarnings[0]).toBe(380);
    campaign = recordLevelCompletion(campaign, 1, 510);
    expect(campaign.bestEarnings[0]).toBe(510);
    for (let day = 2; day <= TOTAL_LEVELS; day += 1) campaign = recordLevelCompletion(campaign, day, levelConfig(day).goal);
    expect(campaign).toMatchObject({ completedThrough: 25, endlessUnlocked: true });
    expect(isLevelUnlocked(campaign, 25)).toBe(true);
  });
});

describe("ticket generation and product assembly", () => {
  it("uses the 55/35/10, 35/45/20, and 20/45/35 distributions", () => {
    expect([0.1, 0.6, 0.95].map((roll) => ticketItemCount(0, "regular", () => roll))).toEqual([1, 2, 3]);
    expect([0.2, 0.5, 0.9].map((roll) => ticketItemCount(120_000, "regular", () => roll))).toEqual([1, 2, 3]);
    expect([0.1, 0.4, 0.9].map((roll) => ticketItemCount(240_000, "regular", () => roll))).toEqual([1, 2, 3]);
    expect(ticketItemCount(0, "patient", () => 0)).toBe(2);
    expect(ticketItemCount(0, "critic", () => 0)).toBe(2);
  });

  it("generates only owned products and no more than one Bubble Tea or Cinnamon Roll", () => {
    const starter = generateTicket([], "regular", 0, fixed(0.99));
    expect(starter).toHaveLength(3);
    expect(starter.every((item) => item.type === "iceCream")).toBe(true);

    const expanded = generateTicket(UPGRADES.map((upgrade) => upgrade.id), "regular", 300_000, fixed(0.99));
    expect(expanded).toHaveLength(3);
    expect(expanded.filter((item) => item.type === "bubbleTea")).toHaveLength(1);
    expect(expanded.filter((item) => item.type === "cinnamonRoll")).toHaveLength(1);
    expect(expanded.some((item) => item.type === "fastDrink")).toBe(true);
  });

  it("requires the complete Bubble Tea sequence and round-trips built products", () => {
    expect(buildToItem({ type: "bubbleTea", scoops: [], bubbleSteps: ["teaCup", "milkTea"] })).toBeUndefined();
    expect(buildToItem({ type: "bubbleTea", scoops: [], bubbleSteps: ["teaCup", "milkTea", "pearls"] })).toEqual(bubbleTea);
    expect(itemToBuild(bubbleTea)).toEqual({ type: "bubbleTea", scoops: [], bubbleSteps: ["teaCup", "milkTea", "pearls"] });
    expect(buildToItem(itemToBuild(berrySoda))).toEqual(berrySoda);
  });

  it("requires roll then icing and round-trips every Cinnamon Roll flavor", () => {
    expect(buildToItem({ type: "cinnamonRoll", scoops: [], bubbleSteps: [], cinnamonRoll: true })).toBeUndefined();
    expect(buildToItem({ type: "cinnamonRoll", scoops: [], bubbleSteps: [], cinnamonRoll: true, cinnamonGlaze: "vanillaGlaze" })).toEqual(vanillaRoll);
    for (const roll of [vanillaRoll, chocolateRoll, berryRoll]) {
      expect(buildToItem(itemToBuild(roll))).toEqual(roll);
      expect(requiredActions(roll)).toBe(2);
    }
  });

  it("matches exact ice cream scoop order and drink identity", () => {
    const expected: OrderItem = { type: "iceCream", base: "cone", scoops: ["vanilla", "chocolate"], topping: "sprinkles" };
    expect(itemMatches({ ...expected, scoops: ["vanilla", "chocolate"] }, expected)).toBe(true);
    expect(itemMatches({ ...expected, scoops: ["chocolate", "vanilla"] }, expected)).toBe(false);
    expect(itemMatches(lemonade, berrySoda)).toBe(false);
    expect(itemMatches(chocolateRoll, chocolateRoll)).toBe(true);
    expect(itemMatches(chocolateRoll, berryRoll)).toBe(false);
  });
});

describe("submission, combo, and rewards", () => {
  const premiumIceCream: OrderItem = { type: "iceCream", base: "cup", scoops: ["vanilla", "chocolate"], topping: "sprinkles" };

  it("increments combo at exactly 70 percent and caps at x4", () => {
    expect(nextCombo(1, 0.6999, false)).toBe(1);
    expect(nextCombo(1, 0.7, false)).toBe(2);
    expect(nextCombo(3, 1, false)).toBe(4);
    expect(nextCombo(4, 1, false)).toBe(4);
    expect(nextCombo(1, 0.1, true)).toBe(4);
  });

  it("matches the selected item first, then any remaining item, including duplicates", () => {
    const remaining = [lemonade, premiumIceCream, lemonade];
    expect(findMatchingItemIndex(remaining, premiumIceCream, 0)).toBe(1);
    expect(findMatchingItemIndex(remaining, lemonade, 2)).toBe(2);
    expect(findMatchingItemIndex(remaining, berrySoda, 0)).toBe(-1);
  });

  it("pays served products at base value only after an unfinished timeout", () => {
    expect(partialServedValue([premiumIceCream, bubbleTea])).toBe(42);
    expect(partialServedValue([])).toBe(0);
  });

  it("subtracts exactly 35 percent of maximum patience and clamps at zero", () => {
    expect(wrongServeRemainingMs(18_000, 20_000)).toBe(11_000);
    expect(wrongServeRemainingMs(6_999, 20_000)).toBe(0);
  });

  it("keeps timeout penalties at one heart, or two for a critic", () => {
    expect(timeoutLivesLost("regular")).toBe(1);
    expect(timeoutLivesLost("patient")).toBe(1);
    expect(timeoutLivesLost("critic")).toBe(2);
  });

  it("calculates ticket bonus, tip, combo, and VIP multiplier for the whole order", () => {
    expect(itemBaseValue(premiumIceCream)).toBe(20);
    expect([vanillaRoll, chocolateRoll, berryRoll].map(itemBaseValue)).toEqual([18, 21, 24]);
    const reward = calculateReward([premiumIceCream, lemonade, bubbleTea], "critic", 0.8, 4);
    expect(reward).toEqual({ base: 62, tip: 24, vipMultiplier: 2, coins: 688, xp: 624 });
    expect(calculateReward([premiumIceCream], "patient", 0.8, 4).vipMultiplier).toBe(1.5);
  });
});

describe("patience, pressure, and lifecycle", () => {
  it("scales patience by ticket length and extra assembly actions, capped at x2.2", () => {
    const ticket: OrderItem[] = [
      { type: "iceCream", base: "cup", scoops: ["vanilla", "chocolate"], topping: "sprinkles" },
      lemonade,
      bubbleTea,
    ];
    expect(ticketPatienceMultiplier(ticket)).toBeCloseTo(1.96);
    expect(customerPatienceMs("patient", [], 0, ticket)).toBe(58_800);
    const actionHeavy: OrderItem[] = Array.from({ length: 3 }, () => ({ type: "iceCream", base: "cup", scoops: ["vanilla", "chocolate", "mint"], topping: "sprinkles" }));
    expect(ticketPatienceMultiplier(actionHeavy)).toBe(2.2);
  });

  it("uses timestamp-derived pressure, recovery waves, and freezer patience", () => {
    expect(intensityLevel(59_999)).toBe(0);
    expect(intensityLevel(60_000)).toBe(1);
    expect(intensityLevel(99 * 60_000)).toBe(8);
    expect(isRecoveryWave(180_000)).toBe(true);
    expect(isRecoveryWave(201_000)).toBe(false);
    expect(spawnIntervalMs([], 8 * 60_000)).toBe(3_500);
    expect(customerPatienceMs("patient", ["freezer"], 0, [vanillaCone])).toBe(34_500);
  });

  it("selects VIP cadence in the inclusive 5–7 range and starts a clean run", () => {
    expect(nextVipTarget(() => 0)).toBe(5);
    expect(nextVipTarget(() => 0.999)).toBe(7);
    expect(createRun()).toMatchObject({ lives: 3, combo: 1, xp: 0, active: true, customers: [], tutorial: false });
  });
});
