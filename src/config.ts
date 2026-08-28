import type {
  BaseId,
  CinnamonGlazeId,
  DrinkComponentId,
  FastDrinkId,
  FlavorId,
  ToppingId,
  UpgradeId,
  UpgradeTrack,
} from "./types";

export const GAME_TITLE = "Ice Cream Rush";
export const BASE_PATIENCE_MS = 20_000;
export const MAX_COMBO = 4;
export const FAST_THRESHOLD = 0.7;
export const REVIVE_REWARD_ID = "ice-cream-rush-revive-v1";

export interface LevelConfig {
  number: number;
  goal: number;
  durationMs: number;
  pressureOffsetMs: number;
}

const LEVEL_GOALS = [
  350, 500, 700, 900, 1_150, 1_450, 1_800, 2_200, 2_650, 3_150,
  3_700, 4_300, 4_950, 5_650, 6_400, 7_200, 8_050, 8_950, 9_900, 10_900,
  12_000, 13_300, 14_700, 16_200, 17_900,
] as const;

const LATE_CAMPAIGN_PRESSURE = [6, 6, 7, 7, 7] as const;

export const LEVELS: LevelConfig[] = LEVEL_GOALS.map((goal, index) => ({
  number: index + 1,
  goal,
  durationMs: Math.min(240_000, 120_000 + index * 10_000),
  pressureOffsetMs: (index < 20 ? Math.floor(index / 3) : LATE_CAMPAIGN_PRESSURE[index - 20]!) * 60_000,
}));

export const TOTAL_LEVELS = LEVELS.length;

export const COLORS: Record<FlavorId, string> = {
  vanilla: "#fff3c8",
  chocolate: "#7c4b3b",
  strawberry: "#ff799b",
  mint: "#79dfbd",
};

export const LABELS: Record<BaseId | FlavorId | ToppingId | FastDrinkId | DrinkComponentId | CinnamonGlazeId | "roll", string> = {
  cone: "Cone",
  cup: "Cup",
  waffle: "Waffle bowl",
  vanilla: "Vanilla",
  chocolate: "Chocolate",
  strawberry: "Strawberry",
  mint: "Mint",
  sprinkles: "Sprinkles",
  drizzle: "Chocolate drizzle",
  lemonade: "Lemonade",
  berrySoda: "Berry Soda",
  teaCup: "Empty Cup",
  milkTea: "Milk Tea",
  pearls: "Tapioca Pearls",
  roll: "Cinnamon Roll",
  vanillaGlaze: "Vanilla Icing",
  chocolateGlaze: "Chocolate Icing",
  berryGlaze: "Berry Icing",
};

export interface UpgradeConfig {
  id: UpgradeId;
  track: UpgradeTrack;
  name: string;
  price: number;
  effect: string;
}

export const UPGRADES: UpgradeConfig[] = [
  { id: "strawberry", track: "iceCream", name: "Strawberry", price: 120, effect: "Mixed two-scoop orders" },
  { id: "cup", track: "iceCream", name: "Paper Cups", price: 450, effect: "Unlocks a new ice cream base" },
  { id: "sprinkles", track: "iceCream", name: "Sprinkle Bar", price: 1_200, effect: "Adds colorful toppings" },
  { id: "mint", track: "iceCream", name: "Mint Chip", price: 3_500, effect: "Unlocks three-scoop orders" },
  { id: "waffle", track: "iceCream", name: "Waffle Bowls", price: 9_000, effect: "Adds a premium base" },
  { id: "drizzle", track: "iceCream", name: "Drizzle Station", price: 18_000, effect: "Adds chocolate drizzle" },
  { id: "lemonade", track: "drinks", name: "Lemonade", price: 180, effect: "Adds a quick chilled drink" },
  { id: "berrySoda", track: "drinks", name: "Berry Soda", price: 900, effect: "Adds a sparkling berry drink" },
  { id: "bubbleTea", track: "drinks", name: "Bubble Tea", price: 6_500, effect: "Build cup, milk tea, and pearls" },
  { id: "rollOven", track: "bakery", name: "Roll Oven", price: 12_000, effect: "Bake rolls with vanilla icing" },
  { id: "chocolateIcing", track: "bakery", name: "Chocolate Icing", price: 28_000, effect: "Adds chocolate cinnamon rolls" },
  { id: "berryIcing", track: "bakery", name: "Berry Icing", price: 55_000, effect: "Adds berry cinnamon rolls" },
  { id: "freezer", track: "equipment", name: "Better Freezer", price: 650, effect: "+15% customer patience" },
  { id: "counter1", track: "equipment", name: "Counter I", price: 2_800, effect: "Serve two customers" },
  { id: "autobase", track: "equipment", name: "Auto Base", price: 9_500, effect: "Preloads the selected ice cream base" },
  { id: "counter2", track: "equipment", name: "Counter II", price: 23_000, effect: "Serve three customers" },
];

export const TRACK_LABELS: Record<UpgradeTrack, string> = {
  iceCream: "ICE CREAM",
  drinks: "DRINKS",
  bakery: "BAKERY",
  equipment: "EQUIPMENT",
};
