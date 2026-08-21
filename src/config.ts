import type {
  BaseId,
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

export const COLORS: Record<FlavorId, string> = {
  vanilla: "#fff3c8",
  chocolate: "#7c4b3b",
  strawberry: "#ff799b",
  mint: "#79dfbd",
};

export const LABELS: Record<BaseId | FlavorId | ToppingId | FastDrinkId | DrinkComponentId, string> = {
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
  teaCup: "Tea Cup",
  milkTea: "Milk Tea",
  pearls: "Tapioca Pearls",
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
  { id: "freezer", track: "equipment", name: "Better Freezer", price: 650, effect: "+15% customer patience" },
  { id: "counter1", track: "equipment", name: "Counter I", price: 2_800, effect: "Serve two customers" },
  { id: "autobase", track: "equipment", name: "Auto Base", price: 9_500, effect: "Preloads the selected ice cream base" },
  { id: "counter2", track: "equipment", name: "Counter II", price: 23_000, effect: "Serve three customers" },
];

export const TRACK_LABELS: Record<UpgradeTrack, string> = {
  iceCream: "ICE CREAM",
  drinks: "DRINKS",
  equipment: "EQUIPMENT",
};
