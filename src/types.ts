export type BaseId = "cone" | "cup" | "waffle";
export type FlavorId = "vanilla" | "chocolate" | "strawberry" | "mint";
export type ToppingId = "sprinkles" | "drizzle";
export type FastDrinkId = "lemonade" | "berrySoda";
export type DrinkComponentId = "teaCup" | "milkTea" | "pearls";
export type CinnamonGlazeId = "vanillaGlaze" | "chocolateGlaze" | "berryGlaze";
export type CustomerKind = "regular" | "patient" | "critic";
export type ProductKind = "iceCream" | "fastDrink" | "bubbleTea" | "cinnamonRoll";
export type UpgradeTrack = "iceCream" | "drinks" | "bakery" | "equipment";
export type RunMode = "level" | "endless";

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
  | "rollOven"
  | "chocolateIcing"
  | "berryIcing"
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

export interface CinnamonRollOrder {
  type: "cinnamonRoll";
  glaze: CinnamonGlazeId;
}

export type OrderItem = IceCreamOrder | FastDrinkOrder | BubbleTeaOrder | CinnamonRollOrder;

export interface BuildState {
  type?: ProductKind;
  base?: BaseId;
  scoops: FlavorId[];
  topping?: ToppingId;
  drink?: FastDrinkId;
  bubbleSteps: DrinkComponentId[];
  cinnamonRoll?: boolean;
  cinnamonGlaze?: CinnamonGlazeId;
}

export interface CustomerState {
  id: number;
  kind: CustomerKind;
  remainingTicket: OrderItem[];
  servedItems: OrderItem[];
  activeItemIndex: number;
  build: BuildState;
  maxPatienceMs: number;
  remainingMs: number;
  variant: number;
}

export interface RunState {
  active: boolean;
  mode: RunMode;
  levelNumber?: number;
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

export interface CampaignProgress {
  completedThrough: number;
  bestEarnings: number[];
  endlessUnlocked: boolean;
}

export interface SaveSettings {
  music: boolean;
  sfx: boolean;
  reducedMotion: boolean;
}

export interface SaveV5 {
  version: 5;
  coins: number;
  upgrades: UpgradeId[];
  tutorialComplete: boolean;
  bakeryTutorialComplete: boolean;
  bestScore: number;
  settings: SaveSettings;
  campaign: CampaignProgress;
  activeRun: RunState | null;
}

export type RunResult = "endlessFailed" | "levelWon" | "levelFailedLives" | "levelFailedTime";

export type IngredientSelection =
  | { type: "base"; id: BaseId }
  | { type: "flavor"; id: FlavorId }
  | { type: "topping"; id: ToppingId }
  | { type: "fastDrink"; id: FastDrinkId }
  | { type: "bubble"; id: DrinkComponentId }
  | { type: "cinnamon"; id: "roll" | CinnamonGlazeId };

export type AdState = "idle" | "requesting" | "showing" | "completed" | "dismissed" | "failed";
