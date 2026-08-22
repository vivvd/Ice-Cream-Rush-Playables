import { BASE_PATIENCE_MS, FAST_THRESHOLD, LEVELS, MAX_COMBO, TOTAL_LEVELS, UPGRADES } from "./config";
import type {
  BaseId,
  BuildState,
  CinnamonGlazeId,
  CustomerKind,
  CustomerState,
  DrinkComponentId,
  FastDrinkId,
  FlavorId,
  IceCreamOrder,
  OrderItem,
  CampaignProgress,
  RunMode,
  RunState,
  SaveV5,
  ToppingId,
  UpgradeId,
  UpgradeTrack,
} from "./types";

const BASES: BaseId[] = ["cone", "cup", "waffle"];
const FLAVORS: FlavorId[] = ["vanilla", "chocolate", "strawberry", "mint"];
const TOPPINGS: ToppingId[] = ["sprinkles", "drizzle"];
const FAST_DRINKS: FastDrinkId[] = ["lemonade", "berrySoda"];
const BUBBLE_STEPS: DrinkComponentId[] = ["teaCup", "milkTea", "pearls"];
const CINNAMON_GLAZES: CinnamonGlazeId[] = ["vanillaGlaze", "chocolateGlaze", "berryGlaze"];

export const emptyBuild = (): BuildState => ({ scoops: [], bubbleSteps: [] });

export function defaultCampaign(): CampaignProgress {
  return {
    completedThrough: 0,
    bestEarnings: Array.from({ length: TOTAL_LEVELS }, () => 0),
    endlessUnlocked: false,
  };
}

export function defaultSave(): SaveV5 {
  return {
    version: 5,
    coins: 0,
    upgrades: [],
    tutorialComplete: false,
    bakeryTutorialComplete: false,
    bestScore: 0,
    settings: { music: true, sfx: true, reducedMotion: false },
    campaign: defaultCampaign(),
    activeRun: null,
  };
}

const isUpgrade = (value: unknown): value is UpgradeId =>
  typeof value === "string" && UPGRADES.some((upgrade) => upgrade.id === value);

export function migrateSave(raw: string | null | undefined): SaveV5 {
  if (!raw) return defaultSave();
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.version === 5) return sanitizeSaveV5(value);
    if (value.version === 4) return migrateSaveV4(value);
    if (value.version === 3) return migrateLegacySave(value, sanitizeRunV3(value.activeRun));
    if (value.version === 2) return migrateLegacySave(value, migrateRunV2(value.activeRun));
    if (value.version === 1) return migrateLegacySave(value, migrateRunV1(value.activeRun));
    return defaultSave();
  } catch {
    return defaultSave();
  }
}

function sanitizeSaveV5(value: Record<string, unknown>): SaveV5 {
  const base = defaultSave();
  const settings = isRecord(value.settings) ? value.settings : {};
  return {
    version: 5,
    coins: clampInt(value.coins, 0, Number.MAX_SAFE_INTEGER, 0),
    upgrades: sanitizeUpgrades(value.upgrades),
    tutorialComplete: value.tutorialComplete === true,
    bakeryTutorialComplete: value.bakeryTutorialComplete === true,
    bestScore: clampInt(value.bestScore, 0, Number.MAX_SAFE_INTEGER, 0),
    settings: {
      music: typeof settings.music === "boolean" ? settings.music : base.settings.music,
      sfx: typeof settings.sfx === "boolean" ? settings.sfx : base.settings.sfx,
      reducedMotion: typeof settings.reducedMotion === "boolean" ? settings.reducedMotion : base.settings.reducedMotion,
    },
    campaign: sanitizeCampaign(value.campaign),
    activeRun: sanitizeRunV5(value.activeRun),
  };
}

function migrateSaveV4(value: Record<string, unknown>): SaveV5 {
  const oldCampaign = isRecord(value.campaign) ? value.campaign : {};
  const oldCompletedThrough = clampInt(oldCampaign.completedThrough, 0, 20, 0);
  const migrated = sanitizeSaveV5({
    ...value,
    version: 5,
    campaign: { ...oldCampaign, completedThrough: oldCompletedThrough },
  });
  if (oldCampaign.endlessUnlocked === true || oldCompletedThrough >= 20) {
    migrated.campaign.endlessUnlocked = true;
  }
  return migrated;
}

function migrateLegacySave(value: Record<string, unknown>, activeRun: RunState | null): SaveV5 {
  const migrated = sanitizeSaveV5({ ...value, version: 5, campaign: { endlessUnlocked: true }, activeRun: null });
  migrated.campaign.endlessUnlocked = true;
  migrated.activeRun = activeRun ? { ...activeRun, mode: "endless", levelNumber: undefined } : null;
  return migrated;
}

function sanitizeUpgrades(value: unknown): UpgradeId[] {
  return Array.isArray(value) ? [...new Set(value.filter(isUpgrade))] : [];
}

function sanitizeCampaign(value: unknown): CampaignProgress {
  const base = defaultCampaign();
  if (!isRecord(value)) return base;
  const completedThrough = clampInt(value.completedThrough, 0, TOTAL_LEVELS, 0);
  const source = Array.isArray(value.bestEarnings) ? value.bestEarnings : [];
  return {
    completedThrough,
    bestEarnings: Array.from({ length: TOTAL_LEVELS }, (_, index) =>
      clampInt(source[index], 0, Number.MAX_SAFE_INTEGER, 0)),
    endlessUnlocked: value.endlessUnlocked === true || completedThrough >= TOTAL_LEVELS,
  };
}

function sanitizeRunV5(value: unknown): RunState | null {
  const run = sanitizeRunV3(value);
  if (!run || !isRecord(value)) return run;
  const requestedLevel = clampInt(value.levelNumber, 1, TOTAL_LEVELS, 1);
  const mode: RunMode = value.mode === "level" ? "level" : "endless";
  return {
    ...run,
    mode,
    levelNumber: mode === "level" ? requestedLevel : undefined,
  };
}

function sanitizeRunV3(value: unknown): RunState | null {
  if (!isRecord(value) || value.active !== true || !Array.isArray(value.customers)) return null;
  const customers = value.customers
    .map((customer) => sanitizeCustomerV3(customer))
    .filter((customer): customer is CustomerState => Boolean(customer))
    .slice(0, 3);
  const selectedId = clampInt(value.selectedCustomerId, 1, Number.MAX_SAFE_INTEGER, -1);
  const selectedExists = customers.some((customer) => customer.id === selectedId);
  const highestId = customers.reduce((highest, customer) => Math.max(highest, customer.id), 0);
  return {
    active: true,
    mode: "endless",
    levelNumber: undefined,
    lives: clampInt(value.lives, 1, 3, 3),
    xp: clampInt(value.xp, 0, Number.MAX_SAFE_INTEGER, 0),
    combo: clampInt(value.combo, 1, MAX_COMBO, 1),
    bestCombo: clampInt(value.bestCombo, 1, MAX_COMBO, 1),
    elapsedMs: clampNumber(value.elapsedMs, 0, Number.MAX_SAFE_INTEGER, 0),
    runCoins: clampInt(value.runCoins, 0, Number.MAX_SAFE_INTEGER, 0),
    customers,
    selectedCustomerId: selectedExists ? selectedId : customers[0]?.id,
    spawnRemainingMs: clampNumber(value.spawnRemainingMs, 0, 30_000, 1_000),
    customersSinceVip: clampInt(value.customersSinceVip, 0, 20, 0),
    nextVipAt: clampInt(value.nextVipAt, 5, 7, 6),
    nextCustomerId: Math.max(highestId + 1, clampInt(value.nextCustomerId, 1, Number.MAX_SAFE_INTEGER, highestId + 1)),
    reviveUsed: value.reviveUsed === true,
    tutorial: value.tutorial === true,
  };
}

function sanitizeCustomerV3(value: unknown): CustomerState | null {
  if (!isRecord(value) || !Array.isArray(value.remainingTicket)) return null;
  const remainingTicket = value.remainingTicket.filter(isOrderItem).slice(0, 3);
  if (remainingTicket.length === 0) return null;
  const servedItems = Array.isArray(value.servedItems) ? value.servedItems.filter(isOrderItem).slice(0, 3) : [];
  const maxPatienceMs = clampNumber(value.maxPatienceMs, 1_000, 120_000, 20_000);
  return {
    id: clampInt(value.id, 1, Number.MAX_SAFE_INTEGER, 1),
    kind: isCustomerKind(value.kind) ? value.kind : "regular",
    remainingTicket: structuredClone(remainingTicket),
    servedItems: structuredClone(servedItems),
    activeItemIndex: clampInt(value.activeItemIndex, 0, remainingTicket.length - 1, 0),
    build: sanitizeBuild(value.build),
    maxPatienceMs,
    remainingMs: clampNumber(value.remainingMs, 0, maxPatienceMs, maxPatienceMs),
    variant: clampInt(value.variant, 0, 99, 0),
  };
}

function migrateRunV2(value: unknown): RunState | null {
  if (!isRecord(value) || value.active !== true || !Array.isArray(value.customers)) return null;
  const customers = value.customers.flatMap((customerValue): CustomerState[] => {
    if (!isRecord(customerValue) || !Array.isArray(customerValue.ticket)) return [];
    const remainingTicket = customerValue.ticket.filter(isOrderItem).slice(0, 3);
    if (remainingTicket.length === 0) return [];
    const currentBuild = sanitizeBuild(customerValue.build);
    const prepared = Array.isArray(customerValue.prepared) ? customerValue.prepared.find(isOrderItem) : undefined;
    return [{
      id: clampInt(customerValue.id, 1, Number.MAX_SAFE_INTEGER, 1),
      kind: isCustomerKind(customerValue.kind) ? customerValue.kind : "regular",
      remainingTicket: structuredClone(remainingTicket),
      servedItems: [],
      activeItemIndex: clampInt(customerValue.activeItemIndex, 0, remainingTicket.length - 1, 0),
      build: currentBuild.type ? currentBuild : prepared ? itemToBuild(prepared) : emptyBuild(),
      maxPatienceMs: clampNumber(customerValue.maxPatienceMs, 1_000, 120_000, 20_000),
      remainingMs: clampNumber(customerValue.remainingMs, 0, clampNumber(customerValue.maxPatienceMs, 1_000, 120_000, 20_000), 20_000),
      variant: clampInt(customerValue.variant, 0, 99, 0),
    }];
  }).slice(0, 3);
  return sanitizeRunV3({ ...value, customers });
}

function migrateRunV1(value: unknown): RunState | null {
  if (!isRecord(value) || value.active !== true || !Array.isArray(value.customers)) return null;
  const selectedId = clampInt(value.selectedCustomerId, 1, Number.MAX_SAFE_INTEGER, -1);
  const legacyBuild = sanitizeLegacyBuild(value.build);
  const customers = value.customers.flatMap((customerValue): CustomerState[] => {
    if (!isRecord(customerValue) || !isLegacyIceCreamOrder(customerValue.order)) return [];
    const maxPatienceMs = clampNumber(customerValue.maxPatienceMs, 1_000, 120_000, 20_000);
    const id = clampInt(customerValue.id, 1, Number.MAX_SAFE_INTEGER, 1);
    return [{
      id,
      kind: isCustomerKind(customerValue.kind) ? customerValue.kind : "regular",
      remainingTicket: [{ type: "iceCream", ...structuredClone(customerValue.order) }],
      servedItems: [],
      activeItemIndex: 0,
      build: id === selectedId ? legacyBuild : emptyBuild(),
      maxPatienceMs,
      remainingMs: clampNumber(customerValue.remainingMs, 0, maxPatienceMs, maxPatienceMs),
      variant: clampInt(customerValue.variant, 0, 99, 0),
    }];
  }).slice(0, 3);
  return sanitizeRunV3({ ...value, version: 3, customers, selectedCustomerId: selectedId });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isCustomerKind(value: unknown): value is CustomerKind {
  return value === "regular" || value === "patient" || value === "critic";
}

function isLegacyIceCreamOrder(value: unknown): value is Omit<IceCreamOrder, "type"> {
  if (!isRecord(value)) return false;
  return (
    BASES.includes(value.base as BaseId) &&
    Array.isArray(value.scoops) &&
    value.scoops.length >= 1 &&
    value.scoops.length <= 3 &&
    value.scoops.every((scoop) => FLAVORS.includes(scoop as FlavorId)) &&
    (value.topping === undefined || TOPPINGS.includes(value.topping as ToppingId))
  );
}

export function isOrderItem(value: unknown): value is OrderItem {
  if (!isRecord(value)) return false;
  if (value.type === "iceCream") return isLegacyIceCreamOrder(value);
  if (value.type === "fastDrink") return FAST_DRINKS.includes(value.drink as FastDrinkId);
  if (value.type === "cinnamonRoll") return CINNAMON_GLAZES.includes(value.glaze as CinnamonGlazeId);
  return value.type === "bubbleTea";
}

export function sanitizeBuild(value: unknown): BuildState {
  if (!isRecord(value)) return emptyBuild();
  if (value.type === "iceCream") {
    return {
      type: "iceCream",
      base: BASES.includes(value.base as BaseId) ? value.base as BaseId : undefined,
      scoops: Array.isArray(value.scoops)
        ? value.scoops.filter((item): item is FlavorId => FLAVORS.includes(item as FlavorId)).slice(0, 3)
        : [],
      topping: TOPPINGS.includes(value.topping as ToppingId) ? value.topping as ToppingId : undefined,
      bubbleSteps: [],
    };
  }
  if (value.type === "fastDrink" && FAST_DRINKS.includes(value.drink as FastDrinkId)) {
    return { type: "fastDrink", drink: value.drink as FastDrinkId, scoops: [], bubbleSteps: [] };
  }
  if (value.type === "bubbleTea") {
    const input = Array.isArray(value.bubbleSteps) ? value.bubbleSteps : [];
    const steps: DrinkComponentId[] = [];
    for (const expected of BUBBLE_STEPS) {
      if (input[steps.length] !== expected) break;
      steps.push(expected);
    }
    return { type: "bubbleTea", scoops: [], bubbleSteps: steps };
  }
  if (value.type === "cinnamonRoll") {
    return {
      type: "cinnamonRoll",
      scoops: [],
      bubbleSteps: [],
      cinnamonRoll: value.cinnamonRoll === true,
      cinnamonGlaze: CINNAMON_GLAZES.includes(value.cinnamonGlaze as CinnamonGlazeId)
        ? value.cinnamonGlaze as CinnamonGlazeId
        : undefined,
    };
  }
  return emptyBuild();
}

function sanitizeLegacyBuild(value: unknown): BuildState {
  if (!isRecord(value)) return emptyBuild();
  const hasIceCreamPart = BASES.includes(value.base as BaseId) || Array.isArray(value.scoops) || TOPPINGS.includes(value.topping as ToppingId);
  return hasIceCreamPart ? sanitizeBuild({ ...value, type: "iceCream" }) : emptyBuild();
}

const clampNumber = (value: unknown, min: number, max: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Number(value))) : fallback;

const clampInt = (value: unknown, min: number, max: number, fallback: number) =>
  Math.floor(clampNumber(value, min, max, fallback));

export function createRun(mode: RunMode = "endless", tutorial = false, levelNumber?: number): RunState {
  return {
    active: true,
    mode,
    levelNumber: mode === "level" ? clampInt(levelNumber, 1, TOTAL_LEVELS, 1) : undefined,
    lives: 3,
    xp: 0,
    combo: 1,
    bestCombo: 1,
    elapsedMs: 0,
    runCoins: 0,
    customers: [],
    spawnRemainingMs: 0,
    customersSinceVip: 0,
    nextVipAt: 5,
    nextCustomerId: 1,
    reviveUsed: false,
    tutorial,
  };
}

export function levelConfig(levelNumber: number) {
  return LEVELS[clampInt(levelNumber, 1, TOTAL_LEVELS, 1) - 1]!;
}

export function effectiveElapsedMs(run: RunState): number {
  return run.elapsedMs + (run.mode === "level" ? levelConfig(run.levelNumber ?? 1).pressureOffsetMs : 0);
}

export function levelRemainingMs(run: RunState): number {
  if (run.mode !== "level") return Number.POSITIVE_INFINITY;
  return Math.max(0, levelConfig(run.levelNumber ?? 1).durationMs - run.elapsedMs);
}

export function isLevelUnlocked(campaign: CampaignProgress, levelNumber: number): boolean {
  return levelNumber >= 1 && levelNumber <= Math.min(TOTAL_LEVELS, campaign.completedThrough + 1);
}

export function recordLevelCompletion(campaign: CampaignProgress, levelNumber: number, earnings: number): CampaignProgress {
  const level = clampInt(levelNumber, 1, TOTAL_LEVELS, 1);
  const bestEarnings = [...campaign.bestEarnings];
  bestEarnings[level - 1] = Math.max(bestEarnings[level - 1] ?? 0, clampInt(earnings, 0, Number.MAX_SAFE_INTEGER, 0));
  const completedThrough = level <= campaign.completedThrough + 1
    ? Math.max(campaign.completedThrough, level)
    : campaign.completedThrough;
  return {
    completedThrough,
    bestEarnings,
    endlessUnlocked: campaign.endlessUnlocked || completedThrough >= TOTAL_LEVELS,
  };
}

export function availableBases(upgrades: readonly UpgradeId[]): BaseId[] {
  const bases: BaseId[] = ["cone"];
  if (upgrades.includes("cup")) bases.push("cup");
  if (upgrades.includes("waffle")) bases.push("waffle");
  return bases;
}

export function availableFlavors(upgrades: readonly UpgradeId[]): FlavorId[] {
  const flavors: FlavorId[] = ["vanilla", "chocolate"];
  if (upgrades.includes("strawberry")) flavors.push("strawberry");
  if (upgrades.includes("mint")) flavors.push("mint");
  return flavors;
}

export function availableToppings(upgrades: readonly UpgradeId[]): ToppingId[] {
  const toppings: ToppingId[] = [];
  if (upgrades.includes("sprinkles")) toppings.push("sprinkles");
  if (upgrades.includes("drizzle")) toppings.push("drizzle");
  return toppings;
}

export function availableFastDrinks(upgrades: readonly UpgradeId[]): FastDrinkId[] {
  return FAST_DRINKS.filter((drink) => upgrades.includes(drink));
}

export function availableCinnamonGlazes(upgrades: readonly UpgradeId[]): CinnamonGlazeId[] {
  const glazes: CinnamonGlazeId[] = [];
  if (upgrades.includes("rollOven")) glazes.push("vanillaGlaze");
  if (upgrades.includes("chocolateIcing")) glazes.push("chocolateGlaze");
  if (upgrades.includes("berryIcing")) glazes.push("berryGlaze");
  return glazes;
}

export function maxCustomers(upgrades: readonly UpgradeId[]): number {
  if (upgrades.includes("counter2")) return 3;
  if (upgrades.includes("counter1")) return 2;
  return 1;
}

export function intensityLevel(elapsedMs: number): number {
  return Math.min(8, Math.floor(Math.max(0, elapsedMs) / 60_000));
}

export function isRecoveryWave(elapsedMs: number): boolean {
  const level = intensityLevel(elapsedMs);
  return level > 0 && level % 3 === 0 && elapsedMs % 60_000 < 20_000;
}

export function spawnIntervalMs(upgrades: readonly UpgradeId[], elapsedMs: number): number {
  const base = upgrades.includes("counter2") ? 3_200 : upgrades.includes("counter1") ? 4_000 : 5_000;
  const pressure = Math.max(0.7, 1 - intensityLevel(elapsedMs) * 0.05);
  return Math.round(base * pressure * (isRecoveryWave(elapsedMs) ? 1.25 : 1));
}

export function customerPatienceMs(
  kind: CustomerKind,
  upgrades: readonly UpgradeId[],
  elapsedMs: number,
  ticket: readonly OrderItem[] = [],
): number {
  const pressure = Math.max(0.7, 1 - intensityLevel(elapsedMs) * 0.04);
  const freezer = upgrades.includes("freezer") ? 1.15 : 1;
  const vip = kind === "patient" ? 1.5 : kind === "critic" ? 0.65 : 1;
  const recovery = isRecoveryWave(elapsedMs) ? 1.15 : 1;
  return Math.round(BASE_PATIENCE_MS * pressure * freezer * vip * recovery * ticketPatienceMultiplier(ticket));
}

export function ticketPatienceMultiplier(ticket: readonly OrderItem[]): number {
  if (ticket.length === 0) return 1;
  const actions = ticket.reduce((total, item) => total + requiredActions(item), 0);
  const extraActions = Math.max(0, actions - ticket.length * 2);
  return Math.min(2.2, 1 + 0.42 * Math.max(0, ticket.length - 1) + 0.06 * extraActions);
}

const pick = <T>(items: readonly T[], rng: () => number): T => items[Math.min(items.length - 1, Math.floor(rng() * items.length))]!;

export function ticketItemCount(elapsedMs: number, kind: CustomerKind, rng: () => number = Math.random): number {
  const level = intensityLevel(elapsedMs);
  const [one, two] = level <= 1 ? [0.55, 0.9] : level <= 3 ? [0.35, 0.8] : [0.2, 0.65];
  const roll = rng();
  const count = roll < one ? 1 : roll < two ? 2 : 3;
  return kind === "regular" ? count : Math.max(2, count);
}

export function generateIceCreamOrder(
  upgrades: readonly UpgradeId[],
  kind: CustomerKind,
  rng: () => number = Math.random,
): IceCreamOrder {
  const bases = availableBases(upgrades);
  const flavors = availableFlavors(upgrades);
  const toppings = availableToppings(upgrades);
  const normalMax = upgrades.includes("mint") ? 3 : upgrades.includes("strawberry") ? 2 : 1;
  const vipBonus = kind === "regular" ? 0 : 1;
  const maxScoops = Math.min(3, normalMax + vipBonus);
  const minScoops = kind === "regular" ? 1 : Math.min(2, maxScoops);
  const scoopCount = minScoops + Math.floor(rng() * (maxScoops - minScoops + 1));
  const toppingChance = kind === "regular" ? 0.45 : 0.9;
  return {
    type: "iceCream",
    base: pick(bases, rng),
    scoops: Array.from({ length: scoopCount }, () => pick(flavors, rng)),
    topping: toppings.length > 0 && rng() < toppingChance ? pick(toppings, rng) : undefined,
  };
}

export function generateTicket(
  upgrades: readonly UpgradeId[],
  kind: CustomerKind,
  elapsedMs: number,
  rng: () => number = Math.random,
): OrderItem[] {
  const itemCount = ticketItemCount(elapsedMs, kind, rng);
  const products: Array<"iceCream" | FastDrinkId | "bubbleTea" | "cinnamonRoll"> = ["iceCream", ...availableFastDrinks(upgrades)];
  if (upgrades.includes("bubbleTea")) products.push("bubbleTea");
  const cinnamonGlazes = availableCinnamonGlazes(upgrades);
  if (cinnamonGlazes.length > 0) products.push("cinnamonRoll");
  let bubbleUsed = false;
  let cinnamonUsed = false;
  return Array.from({ length: itemCount }, () => {
    const pool = products.filter((product) =>
      (!bubbleUsed || product !== "bubbleTea") && (!cinnamonUsed || product !== "cinnamonRoll"));
    const product = pick(pool, rng);
    if (product === "iceCream") return generateIceCreamOrder(upgrades, kind, rng);
    if (product === "bubbleTea") {
      bubbleUsed = true;
      return { type: "bubbleTea" };
    }
    if (product === "cinnamonRoll") {
      cinnamonUsed = true;
      return { type: "cinnamonRoll", glaze: pick(cinnamonGlazes, rng) };
    }
    return { type: "fastDrink", drink: product };
  });
}

export function requiredActions(item: OrderItem): number {
  if (item.type === "iceCream") return 1 + item.scoops.length + (item.topping ? 1 : 0);
  if (item.type === "cinnamonRoll") return 2;
  return item.type === "bubbleTea" ? 3 : 1;
}

export function buildToItem(build: BuildState): OrderItem | undefined {
  if (build.type === "iceCream" && build.base && build.scoops.length > 0) {
    return { type: "iceCream", base: build.base, scoops: [...build.scoops], topping: build.topping };
  }
  if (build.type === "fastDrink" && build.drink) return { type: "fastDrink", drink: build.drink };
  if (build.type === "bubbleTea" && BUBBLE_STEPS.every((step, index) => build.bubbleSteps[index] === step)) {
    return { type: "bubbleTea" };
  }
  if (build.type === "cinnamonRoll" && build.cinnamonRoll && build.cinnamonGlaze) {
    return { type: "cinnamonRoll", glaze: build.cinnamonGlaze };
  }
  return undefined;
}

export function itemToBuild(item: OrderItem): BuildState {
  if (item.type === "iceCream") {
    return { type: "iceCream", base: item.base, scoops: [...item.scoops], topping: item.topping, bubbleSteps: [] };
  }
  if (item.type === "fastDrink") return { type: "fastDrink", drink: item.drink, scoops: [], bubbleSteps: [] };
  if (item.type === "bubbleTea") return { type: "bubbleTea", scoops: [], bubbleSteps: [...BUBBLE_STEPS] };
  return { type: "cinnamonRoll", scoops: [], bubbleSteps: [], cinnamonRoll: true, cinnamonGlaze: item.glaze };
}

export function itemMatches(actual: OrderItem, expected: OrderItem): boolean {
  if (actual.type !== expected.type) return false;
  if (actual.type === "fastDrink" && expected.type === "fastDrink") return actual.drink === expected.drink;
  if (actual.type === "bubbleTea") return true;
  if (actual.type === "cinnamonRoll" && expected.type === "cinnamonRoll") return actual.glaze === expected.glaze;
  if (actual.type !== "iceCream" || expected.type !== "iceCream") return false;
  return (
    actual.base === expected.base &&
    actual.topping === expected.topping &&
    actual.scoops.length === expected.scoops.length &&
    actual.scoops.every((scoop, index) => scoop === expected.scoops[index])
  );
}

export function findMatchingItemIndex(
  remainingTicket: readonly OrderItem[],
  actual: OrderItem,
  preferredIndex = 0,
): number {
  if (preferredIndex >= 0 && preferredIndex < remainingTicket.length && itemMatches(actual, remainingTicket[preferredIndex]!)) {
    return preferredIndex;
  }
  return remainingTicket.findIndex((expected) => itemMatches(actual, expected));
}

export function timeoutLivesLost(kind: CustomerKind): number {
  return kind === "critic" ? 2 : 1;
}

export function nextCombo(current: number, remainingRatio: number, isVip: boolean): number {
  if (isVip) return MAX_COMBO;
  if (remainingRatio >= FAST_THRESHOLD) return Math.min(MAX_COMBO, Math.max(2, current + 1));
  return current;
}

export function itemBaseValue(item: OrderItem): number {
  if (item.type === "fastDrink") return item.drink === "berrySoda" ? 14 : 10;
  if (item.type === "bubbleTea") return 22;
  if (item.type === "cinnamonRoll") {
    return item.glaze === "berryGlaze" ? 24 : item.glaze === "chocolateGlaze" ? 21 : 18;
  }
  return 8 + item.scoops.length * 3 + (item.base === "cone" ? 0 : 2) + (item.topping ? 4 : 0);
}

export function partialServedValue(servedItems: readonly OrderItem[]): number {
  return servedItems.reduce((total, item) => total + itemBaseValue(item), 0);
}

export function wrongServeRemainingMs(remainingMs: number, maxPatienceMs: number): number {
  return Math.max(0, remainingMs - maxPatienceMs * 0.35);
}

export interface RewardResult {
  coins: number;
  xp: number;
  base: number;
  tip: number;
  vipMultiplier: number;
}

export function calculateReward(ticket: readonly OrderItem[], kind: CustomerKind, remainingRatio: number, combo: number): RewardResult {
  const base = ticket.reduce((total, item) => total + itemBaseValue(item), 0) + Math.max(0, ticket.length - 1) * 5;
  const ratio = Math.max(0, Math.min(1, remainingRatio));
  const tip = Math.floor(base * ratio * 0.5);
  const vipMultiplier = kind === "critic" ? 2 : kind === "patient" ? 1.5 : 1;
  const coins = Math.floor((base + tip) * combo * vipMultiplier);
  const actions = ticket.reduce((total, item) => total + requiredActions(item), 0);
  const xp = Math.round((10 + actions * 5 + ticket.length * 4 + ratio * 20) * combo * vipMultiplier);
  return { coins, xp, base, tip, vipMultiplier };
}

export function nextVipTarget(rng: () => number = Math.random): number {
  return 5 + Math.floor(rng() * 3);
}

export function upgradesForTrack(track: UpgradeTrack) {
  return UPGRADES.filter((upgrade) => upgrade.track === track);
}

export function nextUpgradeInTrack(upgrades: readonly UpgradeId[], track: UpgradeTrack) {
  return upgradesForTrack(track).find((upgrade) => !upgrades.includes(upgrade.id));
}

export function upgradePrerequisite(upgrades: readonly UpgradeId[], id: UpgradeId) {
  const upgrade = UPGRADES.find((item) => item.id === id);
  if (!upgrade) return undefined;
  const track = upgradesForTrack(upgrade.track);
  const index = track.findIndex((item) => item.id === id);
  if (index <= 0 || upgrades.includes(track[index - 1]!.id)) return undefined;
  return track[index - 1];
}

export function allUpgradesOwned(upgrades: readonly UpgradeId[]): boolean {
  return UPGRADES.every((upgrade) => upgrades.includes(upgrade.id));
}
