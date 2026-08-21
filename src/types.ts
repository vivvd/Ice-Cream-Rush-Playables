export type BaseId = "cone" | "cup" | "waffle";
export type FlavorId = "vanilla" | "chocolate" | "strawberry" | "mint";
export type ToppingId = "sprinkles" | "drizzle";
export type FastDrinkId = "lemonade" | "berrySoda";
export type DrinkComponentId = "teaCup" | "milkTea" | "pearls";
export type CustomerKind = "regular" | "patient" | "critic";
export type ProductKind = "iceCream" | "fastDrink" | "bubbleTea";
export type UpgradeTrack = "iceCream" | "drinks" | "equipment";

export type UpgradeId =
  | "strawberry"
  | "cup"
  | "sprinkles"
  | "mint"
  | "waffle"
  | "drizzle"
  | "lemonade"
  | "berrySoda"
  | "bubbleTea"
  | "freezer"
  | "counter1"
  | "autobase"
  | "counter2";

export interface IceCreamOrder {
  type: "iceCream";
  base: BaseId;
  scoops: FlavorId[];
  topping?: ToppingId;
}

export interface FastDrinkOrder {
  type: "fastDrink";
  drink: FastDrinkId;
}

export interface BubbleTeaOrder {
  type: "bubbleTea";
}

export type OrderItem = IceCreamOrder | FastDrinkOrder | BubbleTeaOrder;

export interface BuildState {
  type?: ProductKind;
  base?: BaseId;
  scoops: FlavorId[];
  topping?: ToppingId;
  drink?: FastDrinkId;
  bubbleSteps: DrinkComponentId[];
}

export interface CustomerState {
  id: number;
  kind: CustomerKind;
  ticket: OrderItem[];
  prepared: Array<OrderItem | null>;
  activeItemIndex: number;
  build: BuildState;
  maxPatienceMs: number;
  remainingMs: number;
  variant: number;
}

export interface RunState {
  active: boolean;
  lives: number;
  xp: number;
  combo: number;
  bestCombo: number;
  elapsedMs: number;
  runCoins: number;
  customers: CustomerState[];
  selectedCustomerId?: number;
  spawnRemainingMs: number;
  customersSinceVip: number;
  nextVipAt: number;
  nextCustomerId: number;
  reviveUsed: boolean;
  tutorial: boolean;
}

export interface SaveSettings {
  music: boolean;
  sfx: boolean;
  reducedMotion: boolean;
}

export interface SaveV2 {
  version: 2;
  coins: number;
  upgrades: UpgradeId[];
  tutorialComplete: boolean;
  bestScore: number;
  settings: SaveSettings;
  activeRun: RunState | null;
}

export type IngredientSelection =
  | { type: "base"; id: BaseId }
  | { type: "flavor"; id: FlavorId }
  | { type: "topping"; id: ToppingId }
  | { type: "fastDrink"; id: FastDrinkId }
  | { type: "bubble"; id: DrinkComponentId };

export type AdState = "idle" | "requesting" | "showing" | "completed" | "dismissed" | "failed";
