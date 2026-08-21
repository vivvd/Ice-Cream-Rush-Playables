import { describe, expect, it } from "vitest";
import {
  allUpgradesOwned,
  availableBases,
  availableFastDrinks,
  availableFlavors,
  availableToppings,
  buildToItem,
  calculateReward,
  createRun,
  customerPatienceMs,
  evaluateSubmission,
  generateTicket,
  intensityLevel,
  isRecoveryWave,
  itemBaseValue,
  itemMatches,
  itemToBuild,
  maxCustomers,
  migrateSave,
  nextCombo,
  nextUpgradeInTrack,
  nextVipTarget,
  spawnIntervalMs,
  ticketItemCount,
  ticketPatienceMultiplier,
  timeoutLivesLost,
  upgradePrerequisite,
} from "../src/game-logic";
import { UPGRADES } from "../src/config";
import type { OrderItem, UpgradeId } from "../src/types";

const fixed = (...values: number[]) => {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
};

const vanillaCone: OrderItem = { type: "iceCream", base: "cone", scoops: ["vanilla"] };
const lemonade: OrderItem = { type: "fastDrink", drink: "lemonade" };
const berrySoda: OrderItem = { type: "fastDrink", drink: "berrySoda" };
const bubbleTea: OrderItem = { type: "bubbleTea" };

describe("SaveV2 migration", () => {
  it("returns safe V2 defaults for missing, corrupt, and unknown data", () => {
    expect(migrateSave("").version).toBe(2);
    expect(migrateSave("not json").coins).toBe(0);
    expect(migrateSave(JSON.stringify({ version: 99, coins: 999 })).coins).toBe(0);
  });

  it("sanitizes V2 values and removes unknown or duplicate upgrades", () => {
    const save = migrateSave(JSON.stringify({
      version: 2,
      coins: -20,
      upgrades: ["strawberry", "unknown", "strawberry", "lemonade"],
      bestScore: 42.8,
      settings: { music: false },
    }));
    expect(save.coins).toBe(0);
    expect(save.upgrades).toEqual(["strawberry", "lemonade"]);
    expect(save.bestScore).toBe(42);
    expect(save.settings).toEqual({ music: false, sfx: true, reducedMotion: false });
    expect(save.activeRun).toBeNull();
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
    expect(save).toMatchObject({ version: 2, coins: 777, bestScore: 1_234, tutorialComplete: true });
    expect(save.activeRun?.customers[0]?.ticket).toEqual([vanillaCone]);
    expect(save.activeRun?.customers[0]?.prepared).toEqual([null]);
    expect(save.activeRun?.customers[0]?.build).toMatchObject({ type: "iceCream", base: "cup", scoops: ["strawberry"] });
  });
});

describe("independent progression tracks", () => {
  it("unlocks each branch sequentially without cross-branch prerequisites", () => {
    expect(nextUpgradeInTrack([], "iceCream")?.id).toBe("strawberry");
    expect(nextUpgradeInTrack([], "drinks")?.id).toBe("lemonade");
    expect(nextUpgradeInTrack([], "equipment")?.id).toBe("freezer");
    expect(upgradePrerequisite([], "cup")?.id).toBe("strawberry");
    expect(upgradePrerequisite(["lemonade"], "berrySoda")).toBeUndefined();
    expect(upgradePrerequisite(["strawberry"], "cup")).toBeUndefined();
  });

  it("uses the exact branch prices and completes after all 13 purchases", () => {
    expect(UPGRADES.map(({ id, price }) => [id, price])).toEqual([
      ["strawberry", 120], ["cup", 450], ["sprinkles", 1_200], ["mint", 3_500], ["waffle", 9_000], ["drizzle", 18_000],
      ["lemonade", 180], ["berrySoda", 900], ["bubbleTea", 6_500],
      ["freezer", 650], ["counter1", 2_800], ["autobase", 9_500], ["counter2", 23_000],
    ]);
    expect(allUpgradesOwned(UPGRADES.map((upgrade) => upgrade.id))).toBe(true);
  });

  it("exposes only purchased products and expands the counter", () => {
    const upgrades: UpgradeId[] = ["strawberry", "cup", "sprinkles", "lemonade", "counter1"];
    expect(availableBases(upgrades)).toEqual(["cone", "cup"]);
    expect(availableFlavors(upgrades)).toEqual(["vanilla", "chocolate", "strawberry"]);
    expect(availableToppings(upgrades)).toEqual(["sprinkles"]);
    expect(availableFastDrinks(upgrades)).toEqual(["lemonade"]);
    expect(maxCustomers(upgrades)).toBe(2);
    expect(maxCustomers([...upgrades, "counter2"])).toBe(3);
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

  it("generates only owned products and no more than one bubble tea", () => {
    const starter = generateTicket([], "regular", 0, fixed(0.99));
    expect(starter).toHaveLength(3);
    expect(starter.every((item) => item.type === "iceCream")).toBe(true);

    const expanded = generateTicket(UPGRADES.map((upgrade) => upgrade.id), "regular", 300_000, fixed(0.99));
    expect(expanded).toHaveLength(3);
    expect(expanded.filter((item) => item.type === "bubbleTea")).toHaveLength(1);
    expect(expanded.some((item) => item.type === "fastDrink")).toBe(true);
  });

  it("requires the complete Bubble Tea sequence and round-trips prepared products", () => {
    expect(buildToItem({ type: "bubbleTea", scoops: [], bubbleSteps: ["teaCup", "milkTea"] })).toBeUndefined();
    expect(buildToItem({ type: "bubbleTea", scoops: [], bubbleSteps: ["teaCup", "milkTea", "pearls"] })).toEqual(bubbleTea);
    expect(itemToBuild(bubbleTea)).toEqual({ type: "bubbleTea", scoops: [], bubbleSteps: ["teaCup", "milkTea", "pearls"] });
    expect(buildToItem(itemToBuild(berrySoda))).toEqual(berrySoda);
  });

  it("matches exact ice cream scoop order and drink identity", () => {
    const expected: OrderItem = { type: "iceCream", base: "cone", scoops: ["vanilla", "chocolate"], topping: "sprinkles" };
    expect(itemMatches({ ...expected, scoops: ["vanilla", "chocolate"] }, expected)).toBe(true);
    expect(itemMatches({ ...expected, scoops: ["chocolate", "vanilla"] }, expected)).toBe(false);
    expect(itemMatches(lemonade, berrySoda)).toBe(false);
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

  it("pays correct positions at base value only for a mixed ticket", () => {
    const result = evaluateSubmission([premiumIceCream, lemonade, bubbleTea], [premiumIceCream, berrySoda, bubbleTea], "regular");
    expect(result).toEqual({ allCorrect: false, correct: [true, false, true], partialCoins: 42, livesLost: 0 });
    expect(evaluateSubmission([lemonade], [berrySoda], "regular").partialCoins).toBe(0);
    expect(evaluateSubmission([lemonade], [berrySoda], "critic").livesLost).toBe(2);
  });

  it("keeps timeout penalties at one heart, or two for a critic", () => {
    expect(timeoutLivesLost("regular")).toBe(1);
    expect(timeoutLivesLost("patient")).toBe(1);
    expect(timeoutLivesLost("critic")).toBe(2);
  });

  it("calculates ticket bonus, tip, combo, and VIP multiplier for the whole order", () => {
    expect(itemBaseValue(premiumIceCream)).toBe(20);
    const reward = calculateReward([premiumIceCream, lemonade, bubbleTea], "critic", 0.8, 4);
    expect(reward).toEqual({ base: 62, tip: 24, vipMultiplier: 5, coins: 1_720, xp: 1_560 });
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
